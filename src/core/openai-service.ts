import OpenAI from 'openai';
import { config } from '../config.js';
import { TranslationOptions } from './interfaces.js';
import { buildSystemPrompt } from './prompts.js';
import { defaultTranslationCache, TranslationCache } from './cache.js';

export interface TranslationCallResult {
  text: string;
  fromCache: boolean;
}

export type TokenCallback = (token: string, chunkId: number) => void;

export class OpenAIService {
  constructor(private cache: TranslationCache = defaultTranslationCache) {}

  private getClient(customApiKey?: string, customBaseUrl?: string): OpenAI {
    const apiKey = customApiKey || config.openaiApiKey;
    const baseURL = customBaseUrl || config.openaiBaseUrl;

    if (!apiKey) {
      throw new Error('Chưa cấu hình OPENAI_API_KEY ở file .env của backend.');
    }

    return new OpenAI({
      apiKey,
      baseURL: baseURL.replace(/\/+$/, ''),
      timeout: 45000, // 45s max timeout to prevent indefinite hangs
    });
  }

  /**
   * Translates a single chunk with live streaming tokens, cache check & prompt caching
   */
  async translateChunkStream(
    text: string,
    chunkId: number,
    options: TranslationOptions,
    onToken?: TokenCallback,
    clientConfig?: { apiKey?: string; baseUrl?: string; model?: string }
  ): Promise<TranslationCallResult> {
    if (!text || text.trim().length === 0) {
      return { text, fromCache: false };
    }

    const model = clientConfig?.model || options.model || config.openaiModel;
    const useCache = options.enableCache !== false;

    // 1. Check Cache
    if (useCache) {
      const cached = this.cache.get(
        text,
        options.sourceLang,
        options.targetLang,
        options.style,
        model,
        options.customGlossary,
        options.customInstructions
      );

      if (cached !== null) {
        onToken?.(cached, chunkId);
        return { text: cached, fromCache: true };
      }
    }

    // 2. Stream from OpenAI / DeepSeek API
    const client = this.getClient(clientConfig?.apiKey, clientConfig?.baseUrl);
    const systemPrompt = buildSystemPrompt(options);

    try {
      const stream = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: options.temperature ?? 0.2,
        stream: true,
      });

      let fullTranslated = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullTranslated += delta;
          onToken?.(delta, chunkId);
        }
      }

      fullTranslated = fullTranslated.trim();

      // 3. Save to Cache
      if (useCache && fullTranslated.length > 0) {
        this.cache.set(
          text,
          fullTranslated,
          options.sourceLang,
          options.targetLang,
          options.style,
          model,
          options.customGlossary,
          options.customInstructions
        );
      }

      return { text: fullTranslated, fromCache: false };
    } catch (error: any) {
      const msg = error?.message || 'Lỗi khi gọi OpenAI/DeepSeek API';
      throw new Error(`Lỗi dịch (${model}): ${msg}`);
    }
  }

  /**
   * Non-streaming fallback
   */
  async translateChunk(
    text: string,
    options: TranslationOptions,
    clientConfig?: { apiKey?: string; baseUrl?: string; model?: string }
  ): Promise<TranslationCallResult> {
    return this.translateChunkStream(text, 0, options, undefined, clientConfig);
  }

  async testConnection(customConfig?: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ success: boolean; message: string; models?: string[] }> {
    try {
      const client = this.getClient(customConfig?.apiKey, customConfig?.baseUrl);
      const testModel = customConfig?.model || config.openaiModel;
      const res = await client.chat.completions.create({
        model: testModel,
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5,
      });
      return {
        success: true,
        message: `Kết nối thành công tới model ${testModel}!`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Không thể kết nối API: ${err.message}`,
      };
    }
  }
}

export const defaultOpenAIService = new OpenAIService();
