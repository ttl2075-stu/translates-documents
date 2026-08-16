import { ChunkItem, DocumentAdapter, DocumentParseResult, TranslationOptions } from '../interfaces.js';
import { config } from '../../config.js';

interface MaskRecord {
  mask: string;
  original: string;
  type: 'frontmatter' | 'fence_code' | 'inline_code' | 'math_block' | 'math_inline' | 'html_tag' | 'link_target' | 'image' | 'footnote';
}

export class MarkdownAdapter implements DocumentAdapter {
  readonly id = 'markdown';
  readonly name = 'Markdown Document';
  readonly supportedExtensions = ['.md', '.markdown', '.mdown', '.mkd', '.mdx'];
  readonly description = 'Dịch tài liệu Markdown chuẩn với bảo vệ tuyệt đối Code blocks, Frontmatter, LaTeX, Links và Tables';

  async parseAndMask(content: string, _options: TranslationOptions): Promise<DocumentParseResult> {
    const maskRecords: MaskRecord[] = [];
    let counter = 0;

    const createMask = (original: string, type: MaskRecord['type']): string => {
      const mask = `[[_MASK_${type.toUpperCase()}_${counter++}_]]`;
      maskRecords.push({ mask, original, type });
      return mask;
    };

    let processed = content;

    // 1. Mask YAML / TOML Frontmatter at the beginning of the file
    processed = processed.replace(/^---[\r\n]+([\s\S]*?)[\r\n]+---/g, (match) => {
      return createMask(match, 'frontmatter');
    });
    processed = processed.replace(/^\+\+\+[\r\n]+([\s\S]*?)[\r\n]+\+\+\+/g, (match) => {
      return createMask(match, 'frontmatter');
    });

    // 2. Mask 4-backtick or 3-backtick Fenced Code Blocks & Tildes (handles nested codeblocks)
    processed = processed.replace(/(````[\s\S]*?````|```[\s\S]*?```|~~~~[\s\S]*?~~~~|~~~[\s\S]*?~~~)/g, (match) => {
      return createMask(match, 'fence_code');
    });

    // 3. Mask Block Math ($$ ... $$)
    processed = processed.replace(/(\$\$[\s\S]*?\$\$)/g, (match) => {
      return createMask(match, 'math_block');
    });

    // 4. Mask Inline Math ($ ... $) (ensuring no escaped \$ and no multiline newline issues)
    processed = processed.replace(/(\$(?!\$)((?:\\.|[^$\\\n])+?)\$)/g, (match) => {
      return createMask(match, 'math_inline');
    });

    // 5. Mask HTML Comments & Raw HTML Blocks (<script>, <style>, <iframe>, <svg>)
    processed = processed.replace(/(<!--[\s\S]*?-->)/g, (match) => {
      return createMask(match, 'html_tag');
    });
    processed = processed.replace(/(<(?:script|style|iframe|svg|canvas)[\s\S]*?<\/(?:script|style|iframe|svg|canvas)>)/gi, (match) => {
      return createMask(match, 'html_tag');
    });

    // 6. Mask Footnote definitions like [^1]: https://...
    processed = processed.replace(/(\[\^[^\]]+\]:\s*https?:\/\/\S+)/g, (match) => {
      return createMask(match, 'footnote');
    });

    // 7. Mask Inline Code (`...`)
    processed = processed.replace(/(`[^`\r\n]+`)/g, (match) => {
      return createMask(match, 'inline_code');
    });

    // 8. Mask Markdown Image links completely: ![alt](url "title")
    processed = processed.replace(/(!\[[^\]]*\]\([^)]+\))/g, (match) => {
      return createMask(match, 'image');
    });

    // 9. Mask Markdown Link URLs (keep anchor text translatable): [anchor text](url "title")
    processed = processed.replace(/(\[[^\]]+\])\((https?:\/\/[^\s)]+|[^\s)]+)(\s+"[^"]*")?\)/g, (_match, anchorText, url, title) => {
      const targetAndTitle = `(${url}${title || ''})`;
      const targetMask = createMask(targetAndTitle, 'link_target');
      return `${anchorText}${targetMask}`;
    });

    // 10. Split masked content into manageable semantic chunks without breaking structural boundaries
    const chunks = this.splitIntoSemanticChunks(processed, config.maxChunkSize);

    return {
      chunks,
      state: {
        maskRecords,
        totalMasks: maskRecords.length,
      },
    };
  }

  async unmaskAndSerialize(translatedChunks: ChunkItem[], state: any): Promise<string> {
    const maskRecords: MaskRecord[] = state?.maskRecords || [];

    // Reconstruct full text from translated chunks
    let fullTranslated = translatedChunks.map((c) => c.translatedText ?? c.maskedText).join('\n\n');

    // Restore masks in reverse order to prevent collision
    for (let i = maskRecords.length - 1; i >= 0; i--) {
      const record = maskRecords[i];
      // Create flexible regex to catch spacing alterations like [ [ _MASK_..._ ] ]
      const safeMaskPattern = record.mask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const flexibleRegex = new RegExp(safeMaskPattern.replace(/_/g, '[_\\s]*'), 'g');

      if (flexibleRegex.test(fullTranslated)) {
        fullTranslated = fullTranslated.replace(flexibleRegex, () => record.original);
      } else {
        fullTranslated = fullTranslated.split(record.mask).join(record.original);
      }
    }

    return fullTranslated;
  }

  private extractMarkdownBlocks(text: string): string[] {
    const lines = text.split(/\r?\n/);
    const blocks: string[] = [];
    let currentBlockLines: string[] = [];
    let currentBlockType: 'none' | 'table' | 'list' | 'blockquote' | 'paragraph' = 'none';

    const isTableLine = (line: string): boolean => {
      const trimmed = line.trim();
      return trimmed.startsWith('|') || (trimmed.includes('|') && /\|.*\|/.test(trimmed));
    };

    const isListLine = (line: string): boolean => {
      return /^\s*(?:[-*+]|\d+[\.\)])\s+/.test(line);
    };

    const isListContinuationLine = (line: string): boolean => {
      return /^\s{2,}\S+/.test(line) || /^\t+\S+/.test(line);
    };

    const isBlockquoteLine = (line: string): boolean => {
      return /^\s*>/.test(line);
    };

    const isHeadingLine = (line: string): boolean => {
      return /^\s*#{1,6}\s+/.test(line);
    };

    const isHrLine = (line: string): boolean => {
      return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
    };

    const isMaskBlockLine = (line: string): boolean => {
      return /^\s*\[\[_MASK_(?:FRONTMATTER|FENCE_CODE|MATH_BLOCK|HTML_TAG)_\d+_\]\]\s*$/.test(line.trim());
    };

    const flushBlock = () => {
      if (currentBlockLines.length > 0) {
        const content = currentBlockLines.join('\n').trim();
        if (content.length > 0) {
          blocks.push(content);
        }
        currentBlockLines = [];
        currentBlockType = 'none';
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Blank line indicates a boundary between blocks
      if (trimmed.length === 0) {
        flushBlock();
        continue;
      }

      // Standalone Masked Block
      if (isMaskBlockLine(line)) {
        flushBlock();
        blocks.push(trimmed);
        continue;
      }

      // Heading is an independent block
      if (isHeadingLine(line)) {
        flushBlock();
        blocks.push(trimmed);
        continue;
      }

      // Horizontal Rule
      if (isHrLine(line)) {
        flushBlock();
        blocks.push(trimmed);
        continue;
      }

      // Table line
      if (isTableLine(line)) {
        if (currentBlockType !== 'table') {
          flushBlock();
          currentBlockType = 'table';
        }
        currentBlockLines.push(line);
        continue;
      }

      // List item or continuation line
      if (isListLine(line) || (currentBlockType === 'list' && isListContinuationLine(line))) {
        if (currentBlockType !== 'list') {
          flushBlock();
          currentBlockType = 'list';
        }
        currentBlockLines.push(line);
        continue;
      }

      // Blockquote line
      if (isBlockquoteLine(line)) {
        if (currentBlockType !== 'blockquote') {
          flushBlock();
          currentBlockType = 'blockquote';
        }
        currentBlockLines.push(line);
        continue;
      }

      // Paragraph line
      if (currentBlockType !== 'paragraph') {
        flushBlock();
        currentBlockType = 'paragraph';
      }
      currentBlockLines.push(line);
    }

    flushBlock();
    return blocks;
  }

  private splitLargeTable(tableText: string, maxChunkSize: number): string[] {
    const lines = tableText.split('\n');
    if (lines.length <= 2) return [tableText];

    let sepIdx = 1;
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      if (/^\s*\|?[\s:-|-]+\|?\s*$/.test(lines[i]) && lines[i].includes('-')) {
        sepIdx = i;
        break;
      }
    }

    const header = lines.slice(0, sepIdx + 1).join('\n');
    const dataRows = lines.slice(sepIdx + 1);
    const subTables: string[] = [];
    let currentRows: string[] = [];
    let currentLen = header.length;

    for (const row of dataRows) {
      if (currentRows.length > 0 && (currentLen + row.length + 1) > maxChunkSize) {
        subTables.push(`${header}\n${currentRows.join('\n')}`);
        currentRows = [];
        currentLen = header.length;
      }
      currentRows.push(row);
      currentLen += row.length + 1;
    }

    if (currentRows.length > 0) {
      subTables.push(`${header}\n${currentRows.join('\n')}`);
    }

    return subTables.length > 0 ? subTables : [tableText];
  }

  private splitLargeList(listText: string, maxChunkSize: number): string[] {
    const items: string[] = [];
    const lines = listText.split('\n');
    let currentItemLines: string[] = [];

    for (const line of lines) {
      if (/^\s*(?:[-*+]|\d+[\.\)])\s+/.test(line) && !/^\s{2,}|\t+/.test(line)) {
        if (currentItemLines.length > 0) {
          items.push(currentItemLines.join('\n'));
          currentItemLines = [];
        }
      }
      currentItemLines.push(line);
    }
    if (currentItemLines.length > 0) {
      items.push(currentItemLines.join('\n'));
    }

    const subLists: string[] = [];
    let currentListText = '';

    for (const item of items) {
      if (currentListText.length > 0 && (currentListText.length + item.length + 1) > maxChunkSize) {
        subLists.push(currentListText.trim());
        currentListText = '';
      }
      currentListText += (currentListText.length > 0 ? '\n' : '') + item;
    }
    if (currentListText.trim().length > 0) {
      subLists.push(currentListText.trim());
    }

    return subLists.length > 0 ? subLists : [listText];
  }

  private splitLargeParagraph(paraText: string, maxChunkSize: number): string[] {
    const sentenceRegex = /([^.!?。！？\n]+[.!?。！？\n]+(?:\s+|$)|[^\n]+\n*)/g;
    const matches = paraText.match(sentenceRegex) || [paraText];

    const subParas: string[] = [];
    let currentParaText = '';

    for (const sentence of matches) {
      if (currentParaText.length > 0 && (currentParaText.length + sentence.length) > maxChunkSize) {
        subParas.push(currentParaText.trim());
        currentParaText = '';
      }

      if (sentence.length > maxChunkSize) {
        const words = sentence.split(/\s+/);
        for (const word of words) {
          if (currentParaText.length > 0 && (currentParaText.length + word.length + 1) > maxChunkSize) {
            subParas.push(currentParaText.trim());
            currentParaText = '';
          }
          currentParaText += (currentParaText.length > 0 ? ' ' : '') + word;
        }
      } else {
        currentParaText += (currentParaText.length > 0 ? ' ' : '') + sentence.trim();
      }
    }

    if (currentParaText.trim().length > 0) {
      subParas.push(currentParaText.trim());
    }

    return subParas.length > 0 ? subParas : [paraText];
  }

  private splitIntoSemanticChunks(text: string, maxChunkSize: number): ChunkItem[] {
    if (text.length <= maxChunkSize) {
      return [
        {
          id: 0,
          originalText: text,
          maskedText: text,
        },
      ];
    }

    const rawBlocks = this.extractMarkdownBlocks(text);
    const normalizedBlocks: string[] = [];

    // Expand any single block that exceeds maxChunkSize into clean structural sub-blocks
    for (const block of rawBlocks) {
      if (block.length <= maxChunkSize) {
        normalizedBlocks.push(block);
      } else {
        const isTable = block.includes('\n') && (block.startsWith('|') || block.includes('|---') || /\|.*\|/.test(block));
        const isList = /^\s*(?:[-*+]|\d+[\.\)])\s+/m.test(block);

        if (isTable) {
          normalizedBlocks.push(...this.splitLargeTable(block, maxChunkSize));
        } else if (isList) {
          normalizedBlocks.push(...this.splitLargeList(block, maxChunkSize));
        } else {
          normalizedBlocks.push(...this.splitLargeParagraph(block, maxChunkSize));
        }
      }
    }

    // Accumulate normalized blocks into chunks cleanly at block boundaries
    const chunks: ChunkItem[] = [];
    let currentChunkText = '';
    let chunkId = 0;

    for (const block of normalizedBlocks) {
      // If adding this block exceeds maxChunkSize, cut the batch cleanly at the end of the previous block
      if (currentChunkText.length > 0 && (currentChunkText.length + block.length + 2) > maxChunkSize) {
        chunks.push({
          id: chunkId++,
          originalText: currentChunkText.trim(),
          maskedText: currentChunkText.trim(),
        });
        currentChunkText = '';
      }

      currentChunkText += (currentChunkText.length > 0 ? '\n\n' : '') + block;
    }

    if (currentChunkText.trim().length > 0) {
      chunks.push({
        id: chunkId++,
        originalText: currentChunkText.trim(),
        maskedText: currentChunkText.trim(),
      });
    }

    return chunks;
  }
}
