import { ChunkItem, DocumentAdapter, DocumentParseResult, TranslationOptions } from '../interfaces.js';
import { config } from '../../config.js';

export class TextAdapter implements DocumentAdapter {
  readonly id = 'text';
  readonly name = 'Plain Text';
  readonly supportedExtensions = ['.txt', '.text', '.log'];
  readonly description = 'Dịch văn bản thuần túy theo đoạn, bảo tồn ngắt dòng và thụt lề';

  async parseAndMask(content: string, _options: TranslationOptions): Promise<DocumentParseResult> {
    const paragraphs = content.split(/\n\n+/);
    const chunks: ChunkItem[] = [];
    let currentText = '';
    let chunkId = 0;

    for (const para of paragraphs) {
      if (currentText.length > 0 && currentText.length + para.length > config.maxChunkSize) {
        chunks.push({
          id: chunkId++,
          originalText: currentText.trim(),
          maskedText: currentText.trim(),
        });
        currentText = '';
      }
      currentText += (currentText.length > 0 ? '\n\n' : '') + para;
    }

    if (currentText.trim().length > 0) {
      chunks.push({
        id: chunkId++,
        originalText: currentText.trim(),
        maskedText: currentText.trim(),
      });
    }

    return {
      chunks,
      state: {},
    };
  }

  async unmaskAndSerialize(translatedChunks: ChunkItem[], _state: any): Promise<string> {
    return translatedChunks.map((c) => c.translatedText || c.maskedText).join('\n\n');
  }
}
