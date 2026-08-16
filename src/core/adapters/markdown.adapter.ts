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

    // Split along major structural boundaries (headings and double newlines)
    const paragraphs = text.split(/\n\n+/);
    const chunks: ChunkItem[] = [];
    let currentChunkText = '';
    let chunkId = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];

      if (currentChunkText.length > 0 && (currentChunkText.length + para.length + 2) > maxChunkSize) {
        chunks.push({
          id: chunkId++,
          originalText: currentChunkText.trim(),
          maskedText: currentChunkText.trim(),
        });
        currentChunkText = '';
      }

      if (para.length > maxChunkSize) {
        const lines = para.split(/\n+/);
        for (const line of lines) {
          if (currentChunkText.length > 0 && (currentChunkText.length + line.length + 1) > maxChunkSize) {
            chunks.push({
              id: chunkId++,
              originalText: currentChunkText.trim(),
              maskedText: currentChunkText.trim(),
            });
            currentChunkText = '';
          }
          currentChunkText += (currentChunkText.length > 0 ? '\n' : '') + line;
        }
      } else {
        currentChunkText += (currentChunkText.length > 0 ? '\n\n' : '') + para;
      }
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
