import { ChunkItem, DocumentAdapter, DocumentParseResult, TranslationOptions } from '../interfaces.js';
import { config } from '../../config.js';

export class TextAdapter implements DocumentAdapter {
  readonly id = 'text';
  readonly name = 'Plain Text';
  readonly supportedExtensions = ['.txt', '.text', '.log'];
  readonly description = 'Dịch văn bản thuần túy theo đoạn, bảo tồn ngắt dòng và thụt lề';

  async parseAndMask(content: string, _options: TranslationOptions): Promise<DocumentParseResult> {
    const rawParagraphs = content.split(/\n\n+/);
    const normalizedBlocks: string[] = [];

    for (const para of rawParagraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (trimmed.length <= config.maxChunkSize) {
        normalizedBlocks.push(trimmed);
      } else {
        // Split long paragraph at sentence boundaries
        const sentenceRegex = /([^.!?。！？\n]+[.!?。！？\n]+(?:\s+|$)|[^\n]+\n*)/g;
        const matches = trimmed.match(sentenceRegex) || [trimmed];
        let currentSub = '';

        for (const sentence of matches) {
          if (currentSub.length > 0 && (currentSub.length + sentence.length) > config.maxChunkSize) {
            normalizedBlocks.push(currentSub.trim());
            currentSub = '';
          }
          currentSub += (currentSub.length > 0 ? ' ' : '') + sentence.trim();
        }
        if (currentSub.trim().length > 0) {
          normalizedBlocks.push(currentSub.trim());
        }
      }
    }

    const chunks: ChunkItem[] = normalizedBlocks.map((block, idx) => ({
      id: idx,
      originalText: block,
      maskedText: block,
    }));

    return {
      chunks: chunks.length > 0 ? chunks : [{ id: 0, originalText: content, maskedText: content }],
      state: {},
    };
  }

  async unmaskAndSerialize(translatedChunks: ChunkItem[], _state: any): Promise<string> {
    return translatedChunks.map((c) => c.translatedText || c.maskedText).join('\n\n');
  }
}
