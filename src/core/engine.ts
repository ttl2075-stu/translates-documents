import { defaultRegistry } from './adapters/registry.js';
import { defaultOpenAIService, OpenAIService, TokenCallback } from './openai-service.js';
import { ChunkItem, ProgressCallback, TranslationOptions } from './interfaces.js';
import { config } from '../config.js';
import { defaultTranslationCache } from './cache.js';

export interface TranslationExecutionOptions {
  filename?: string;
  adapterId?: string;
  options: TranslationOptions;
  apiOverride?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  onProgress?: ProgressCallback;
  onToken?: TokenCallback;
}

export interface TranslationExecutionResult {
  translatedContent: string;
  originalContent: string;
  filename: string;
  adapterName: string;
  totalChunks: number;
  cachedChunks: number;
  durationMs: number;
  cacheStats?: {
    totalHits: number;
    hitRate: string;
    estimatedSavedTokens: number;
  };
}

export class TranslationEngine {
  constructor(
    private registry = defaultRegistry,
    private openAIService: OpenAIService = defaultOpenAIService
  ) {}

  async translateDocument(
    rawContent: string,
    execOptions: TranslationExecutionOptions
  ): Promise<TranslationExecutionResult> {
    const startTime = Date.now();
    const { filename = 'document.md', adapterId, options, apiOverride, onProgress, onToken } = execOptions;

    // 1. Resolve Document Adapter
    const adapter = adapterId
      ? this.registry.getAdapter(adapterId) || this.registry.getAdapterByFilename(filename)
      : this.registry.getAdapterByFilename(filename);

    if (!adapter) {
      throw new Error(`Không tìm thấy Adapter xử lý định dạng cho file: ${filename}`);
    }

    onProgress?.({
      currentChunk: 0,
      totalChunks: 1,
      percent: 5,
      status: 'parsing',
      message: `Đang phân tích cấu trúc tài liệu...`,
    });

    // 2. Parse & Mask Document Structure
    const parseResult = await adapter.parseAndMask(rawContent, options);
    const totalChunks = parseResult.chunks.length;

    onProgress?.({
      currentChunk: 0,
      totalChunks,
      percent: 15,
      status: 'translating',
      message: `Đã phân tách thành ${totalChunks} phần. Bắt đầu truyền dữ liệu AI...`,
    });

    // 3. Translate Chunks with Streaming
    const translatedChunks: ChunkItem[] = [...parseResult.chunks];
    const concurrency = Math.min(config.concurrency || 3, totalChunks);
    const queue = [...parseResult.chunks];
    let completedChunks = 0;
    let cachedChunks = 0;

    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const chunk = queue.shift();
        if (!chunk) break;

        onProgress?.({
          currentChunk: completedChunks,
          totalChunks,
          percent: Math.min(90, Math.max(15, Math.round(15 + (completedChunks / totalChunks) * 75))),
          status: 'translating',
          message: `Đang dịch đoạn ${chunk.id + 1}/${totalChunks}...`,
        });

        try {
          const { text: translatedText, fromCache } = await this.openAIService.translateChunkStream(
            chunk.maskedText,
            chunk.id,
            options,
            (token, id) => {
              onToken?.(token, id);
            },
            apiOverride
          );

          const targetChunk = translatedChunks.find((c) => c.id === chunk.id);
          if (targetChunk) {
            targetChunk.translatedText = translatedText;
          }

          completedChunks++;
          if (fromCache) cachedChunks++;

          const percent = Math.min(95, Math.round(15 + (completedChunks / totalChunks) * 75));

          onProgress?.({
            currentChunk: completedChunks,
            totalChunks,
            percent,
            chunkPreview: translatedText.substring(0, 100),
            status: 'translating',
            message: `Đã hoàn thành ${completedChunks}/${totalChunks} đoạn ${fromCache ? '(⚡ từ Cache)' : ''} (${percent}%)`,
          });
        } catch (error: any) {
          throw new Error(`Lỗi ở đoạn ${chunk.id + 1}/${totalChunks}: ${error.message}`);
        }
      }
    });

    await Promise.all(workers);

    // 4. Assemble & Unmask Document
    onProgress?.({
      currentChunk: totalChunks,
      totalChunks,
      percent: 96,
      status: 'assembling',
      message: 'Đang hoàn thiện và khôi phục định dạng gốc...',
    });

    const translatedContent = await adapter.unmaskAndSerialize(translatedChunks, parseResult.state);
    const durationMs = Date.now() - startTime;
    const cacheStats = defaultTranslationCache.getStats();

    onProgress?.({
      currentChunk: totalChunks,
      totalChunks,
      percent: 100,
      status: 'completed',
      message: `Hoàn tất dịch trong ${(durationMs / 1000).toFixed(1)}s! (${cachedChunks}/${totalChunks} từ cache)`,
    });

    return {
      translatedContent,
      originalContent: rawContent,
      filename,
      adapterName: adapter.name,
      totalChunks,
      cachedChunks,
      durationMs,
      cacheStats: {
        totalHits: cacheStats.totalHits,
        hitRate: cacheStats.hitRate,
        estimatedSavedTokens: cacheStats.estimatedSavedTokens,
      },
    };
  }
}

export const defaultEngine = new TranslationEngine();
