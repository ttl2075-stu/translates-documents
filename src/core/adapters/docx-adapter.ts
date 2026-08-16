import { ChunkItem, DocumentAdapter, DocumentParseResult, TranslationOptions } from '../interfaces.js';
import { defaultDocxMasker, DocxMaskState } from './docx/docx-masker.js';
import { defaultDocxRebuilder } from './docx/docx-rebuilder.js';

export class DocxAdapter implements DocumentAdapter {
  public readonly id = 'docx';
  public readonly name = 'Microsoft Word (.docx) Structure-Preserving Adapter';
  public readonly supportedExtensions = ['.docx'];
  public readonly description =
    'Dịch thuật file Microsoft Word (.docx) bảo toàn 100% cấu trúc, bảng biểu, công thức toán OMML, hình ảnh và định dạng ký tự.';

  /**
   * Parses .docx file (base64 or buffer), extracts text while protecting OMML math, drawings and styling tags.
   */
  public async parseAndMask(content: string | Buffer, options: TranslationOptions): Promise<DocumentParseResult> {
    const { chunks, state } = await defaultDocxMasker.extractAndMask(content, options);
    return {
      chunks,
      state,
    };
  }

  /**
   * Unmasks and rebuilds the final .docx binary (as base64 string) with all styles and structure intact.
   */
  public async unmaskAndSerialize(translatedChunks: ChunkItem[], state: DocxMaskState): Promise<string> {
    return await defaultDocxRebuilder.rebuildDocx(translatedChunks, state);
  }
}

export const docxAdapter = new DocxAdapter();
