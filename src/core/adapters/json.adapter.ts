import { ChunkItem, DocumentAdapter, DocumentParseResult, TranslationOptions } from '../interfaces.js';
import { config } from '../../config.js';

interface JsonNode {
  path: string[];
  originalValue: string;
}

export class JsonAdapter implements DocumentAdapter {
  readonly id = 'json';
  readonly name = 'JSON Document';
  readonly supportedExtensions = ['.json'];
  readonly description = 'Dịch các giá trị chuỗi văn bản (String values) trong file JSON, giữ nguyên toàn bộ cấu trúc keys, numbers, booleans và arrays';

  async parseAndMask(content: string, _options: TranslationOptions): Promise<DocumentParseResult> {
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (e: any) {
      throw new Error(`Invalid JSON document: ${e.message}`);
    }

    const nodes: JsonNode[] = [];

    const traverse = (obj: any, path: string[]) => {
      if (typeof obj === 'string') {
        nodes.push({ path: [...path], originalValue: obj });
      } else if (Array.isArray(obj)) {
        obj.forEach((item, index) => traverse(item, [...path, index.toString()]));
      } else if (obj !== null && typeof obj === 'object') {
        for (const [key, val] of Object.entries(obj)) {
          traverse(val, [...path, key]);
        }
      }
    };

    traverse(parsed, []);

    // Group translatable string values into batches based on configured character budget & max item count
    const chunks: ChunkItem[] = [];
    const maxBatchChars = config.maxChunkSize || 1200;
    const maxItemsPerBatch = 25;

    let currentBatch: { node: JsonNode; globalIndex: number }[] = [];
    let currentBatchChars = 0;
    let chunkId = 0;

    const flushBatch = () => {
      if (currentBatch.length > 0) {
        const maskedText = currentBatch
          .map((item) => `[ITEM_${item.globalIndex}]: ${item.node.originalValue}`)
          .join('\n');

        chunks.push({
          id: chunkId++,
          originalText: maskedText,
          maskedText,
          metadata: {
            startIndex: currentBatch[0].globalIndex,
            count: currentBatch.length,
          },
        });

        currentBatch = [];
        currentBatchChars = 0;
      }
    };

    nodes.forEach((node, globalIndex) => {
      const itemLen = node.originalValue.length + 15;
      if (
        currentBatch.length > 0 &&
        (currentBatchChars + itemLen > maxBatchChars || currentBatch.length >= maxItemsPerBatch)
      ) {
        flushBatch();
      }

      currentBatch.push({ node, globalIndex });
      currentBatchChars += itemLen;
    });

    flushBatch();

    return {
      chunks,
      state: {
        rawJson: parsed,
        nodes,
      },
    };
  }

  async unmaskAndSerialize(translatedChunks: ChunkItem[], state: any): Promise<string> {
    const { rawJson, nodes } = state;
    const translatedMap = new Map<number, string>();

    for (const chunk of translatedChunks) {
      const text = chunk.translatedText || chunk.maskedText;
      const lines = text.split('\n');
      for (const line of lines) {
        const match = line.match(/^\[ITEM_(\d+)\]:\s*(.*)$/);
        if (match) {
          const idx = parseInt(match[1], 10);
          translatedMap.set(idx, match[2]);
        }
      }
    }

    // Deep clone raw JSON
    const cloned = JSON.parse(JSON.stringify(rawJson));

    const setNestedValue = (obj: any, path: string[], value: string) => {
      let current = obj;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        current = current[key];
      }
      current[path[path.length - 1]] = value;
    };

    nodes.forEach((node: JsonNode, index: number) => {
      const translatedVal = translatedMap.get(index) ?? node.originalValue;
      setNestedValue(cloned, node.path, translatedVal);
    });

    return JSON.stringify(cloned, null, 2);
  }
}
