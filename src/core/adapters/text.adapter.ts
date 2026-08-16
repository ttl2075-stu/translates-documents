import { ChunkItem, DocumentAdapter, DocumentParseResult, TranslationOptions } from '../interfaces.js';
import { config } from '../../config.js';

export class TextAdapter implements DocumentAdapter {
  readonly id = 'text';
  readonly name = 'Plain Text';
  readonly supportedExtensions = ['.txt', '.text', '.log'];
  readonly description = 'Dịch văn bản thuần túy theo đoạn, bảo tồn ngắt dòng và thụt lề';

  async parseAndMask(content: string, _options: TranslationOptions): Promise<DocumentParseResult> {
    const rawParagraphs = content.split(/\n\n+/);
    const pieces: {
      text: string;
      blockId: number;
      isSubPiece: boolean;
      subPieceIndex: number;
      totalSubPieces: number;
    }[] = [];

    rawParagraphs.forEach((para, blockId) => {
      const trimmed = para.trim();
      if (!trimmed) return;

      if (trimmed.length <= config.maxChunkSize) {
        pieces.push({
          text: trimmed,
          blockId,
          isSubPiece: false,
          subPieceIndex: 0,
          totalSubPieces: 1,
        });
      } else {
        // Split long paragraph at sentence boundaries
        const sentenceRegex = /([^.!?。！？\n]+[.!?。！？\n]+(?:\s+|$)|[^\n]+\n*)/g;
        const matches = trimmed.match(sentenceRegex) || [trimmed];
        const subParas: string[] = [];
        let currentSub = '';

        for (const sentence of matches) {
          if (currentSub.length > 0 && (currentSub.length + sentence.length) > config.maxChunkSize) {
            subParas.push(currentSub.trim());
            currentSub = '';
          }
          currentSub += (currentSub.length > 0 ? ' ' : '') + sentence.trim();
        }
        if (currentSub.trim().length > 0) {
          subParas.push(currentSub.trim());
        }

        subParas.forEach((subText, subIdx) => {
          pieces.push({
            text: subText,
            blockId,
            isSubPiece: true,
            subPieceIndex: subIdx,
            totalSubPieces: subParas.length,
          });
        });
      }
    });

    const chunks: ChunkItem[] = [];
    let currentBatch: string[] = [];
    let currentBatchLen = 0;
    let chunkId = 0;

    const flushBatch = () => {
      if (currentBatch.length > 0) {
        const joined = currentBatch.join('\n\n');
        chunks.push({
          id: chunkId++,
          originalText: joined,
          maskedText: joined,
          metadata: { isSubChunk: false },
        });
        currentBatch = [];
        currentBatchLen = 0;
      }
    };

    for (const piece of pieces) {
      if (piece.isSubPiece) {
        flushBatch();
        chunks.push({
          id: chunkId++,
          originalText: piece.text,
          maskedText: piece.text,
          metadata: {
            blockId: piece.blockId,
            isSubChunk: true,
            subChunkIndex: piece.subPieceIndex,
            totalSubChunks: piece.totalSubPieces,
          },
        });
      } else {
        const addedLen = currentBatch.length > 0 ? piece.text.length + 2 : piece.text.length;
        if (currentBatch.length > 0 && (currentBatchLen + addedLen) > config.maxChunkSize) {
          flushBatch();
        }
        currentBatch.push(piece.text);
        currentBatchLen += (currentBatch.length > 1 ? 2 : 0) + piece.text.length;
      }
    }

    flushBatch();

    return {
      chunks: chunks.length > 0 ? chunks : [{ id: 0, originalText: content, maskedText: content }],
      state: {},
    };
  }

  async unmaskAndSerialize(translatedChunks: ChunkItem[], _state: any): Promise<string> {
    const sortedChunks = translatedChunks.slice().sort((a, b) => a.id - b.id);
    let fullText = '';

    for (let i = 0; i < sortedChunks.length; i++) {
      const chunk = sortedChunks[i];
      const text = (chunk.translatedText ?? chunk.maskedText).trim();
      if (!text) continue;

      if (fullText.length === 0) {
        fullText = text;
      } else {
        const prevChunk = sortedChunks[i - 1];
        const isSameBlockSubChunk =
          Boolean(prevChunk?.metadata?.isSubChunk) &&
          Boolean(chunk.metadata?.isSubChunk) &&
          prevChunk?.metadata?.blockId !== undefined &&
          prevChunk.metadata.blockId === chunk.metadata?.blockId;

        if (isSameBlockSubChunk) {
          if (fullText.endsWith('\n')) {
            fullText += text;
          } else {
            fullText += ' ' + text;
          }
        } else {
          fullText += '\n\n' + text;
        }
      }
    }

    return fullText;
  }
}
