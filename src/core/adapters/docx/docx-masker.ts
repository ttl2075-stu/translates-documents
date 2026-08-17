import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { ChunkItem, TranslationOptions } from '../../interfaces.js';

export interface DocxMaskState {
  zipData: JSZip;
  targetFiles: Record<string, string>; // filename -> modified XML string
  elementsMap: Map<string, any>; // id -> original XML element / rPr
  stylesMap: Map<string, any>; // styleId -> rPr clone
  totalParagraphs: number;
}

export class DocxMasker {
  private parser = new DOMParser();
  private serializer = new XMLSerializer();

  /**
   * Unpacks .docx, extracts translatable text from document.xml, headers, footers
   * while freezing OMML Math (<m:oMath>), Drawing (<w:drawing>), Fields and annotating runs with inline tags.
   */
  public async extractAndMask(docxBase64OrBuffer: string | Buffer, options: TranslationOptions): Promise<{ chunks: ChunkItem[]; state: DocxMaskState }> {
    let zip: JSZip;
    if (typeof docxBase64OrBuffer === 'string') {
      // Check if raw base64 or data URL
      const base64Clean = docxBase64OrBuffer.replace(/^data:.*?;base64,/, '');
      zip = await JSZip.loadAsync(base64Clean, { base64: true });
    } else {
      zip = await JSZip.loadAsync(docxBase64OrBuffer);
    }

    const elementsMap = new Map<string, any>();
    const stylesMap = new Map<string, any>();
    const targetFiles: Record<string, string> = {};
    const rawParagraphUnits: Array<{ file: string; pIndex: number; maskedText: string; originalText: string }> = [];

    // Find all XML files that contain text
    const xmlFileNames: string[] = [];
    zip.forEach((relativePath) => {
      if (
        relativePath.startsWith('word/') &&
        relativePath.endsWith('.xml') &&
        (relativePath === 'word/document.xml' ||
          relativePath.includes('header') ||
          relativePath.includes('footer') ||
          relativePath.includes('footnote') ||
          relativePath.includes('endnote'))
      ) {
        xmlFileNames.push(relativePath);
      }
    });

    let mathCounter = 0;
    let drawingCounter = 0;
    let styleCounter = 0;
    let globalPIndex = 0;

    for (const fileName of xmlFileNames) {
      const fileContent = await zip.file(fileName)?.async('string');
      if (!fileContent) continue;

      const doc = this.parser.parseFromString(fileContent, 'application/xml');
      const paragraphs = doc.getElementsByTagName('w:p');

      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        let pMaskedText = '';
        let pOriginalText = '';

        // Iterate child nodes of <w:p>
        const childNodes = Array.from(p.childNodes || []);
        if (childNodes.length === 0) continue;

        for (const node of childNodes) {
          const nodeName = node.nodeName;

          // 1. Math formulas (<m:oMath>, <m:oMathPara>) -> Freeze
          if (nodeName === 'm:oMath' || nodeName === 'm:oMathPara') {
            mathCounter++;
            const mathId = `___OMATH_BLOCK_${mathCounter}___`;
            elementsMap.set(mathId, node.cloneNode(true));
            pMaskedText += ` ${mathId} `;
            pOriginalText += ` [Công thức toán ${mathCounter}] `;
            continue;
          }

          // 2. Drawings / Images (<w:drawing>) -> Freeze
          if (nodeName === 'w:drawing' || nodeName === 'w:pict') {
            drawingCounter++;
            const drawingId = `___DRAWING_BLOCK_${drawingCounter}___`;
            elementsMap.set(drawingId, node.cloneNode(true));
            pMaskedText += ` ${drawingId} `;
            pOriginalText += ` [Hình ảnh ${drawingCounter}] `;
            continue;
          }

          // 3. Hyperlink (<w:hyperlink>)
          if (nodeName === 'w:hyperlink') {
            const rId = (node as any).getAttribute ? (node as any).getAttribute('r:id') || '' : '';
            const linkRuns = (node as any).getElementsByTagName ? (node as any).getElementsByTagName('w:t') : [];
            let linkText = '';
            for (let t = 0; t < linkRuns.length; t++) {
              linkText += linkRuns[t].textContent || '';
            }
            if (linkText.trim()) {
              pMaskedText += `<link rId="${rId}">${linkText}</link>`;
              pOriginalText += linkText;
            }
            continue;
          }

          // 4. Standard Runs (<w:r>)
          if (nodeName === 'w:r') {
            const tNodes = (node as any).getElementsByTagName ? (node as any).getElementsByTagName('w:t') : [];
            let rText = '';
            for (let t = 0; t < tNodes.length; t++) {
              rText += tNodes[t].textContent || '';
            }

            if (!rText) continue;

            // Check formatting properties (<w:rPr>)
            const rPrNodes = (node as any).getElementsByTagName ? (node as any).getElementsByTagName('w:rPr') : [];
            const rPr = rPrNodes.length > 0 ? rPrNodes[0] : null;

            if (rPr && this.hasDistinctFormatting(rPr)) {
              styleCounter++;
              const styleId = `s${styleCounter}`;
              stylesMap.set(styleId, rPr.cloneNode(true));

              const isBold = rPr.getElementsByTagName('w:b').length > 0;
              const isItalic = rPr.getElementsByTagName('w:i').length > 0;

              if (isBold && !isItalic) {
                pMaskedText += `<b id="${styleId}">${rText}</b>`;
              } else if (isItalic && !isBold) {
                pMaskedText += `<i id="${styleId}">${rText}</i>`;
              } else {
                pMaskedText += `<r id="${styleId}">${rText}</r>`;
              }
            } else {
              pMaskedText += rText;
            }
            pOriginalText += rText;
          }
        }

        if (pMaskedText.trim().length > 0) {
          rawParagraphUnits.push({
            file: fileName,
            pIndex: i,
            maskedText: pMaskedText.trim(),
            originalText: pOriginalText.trim(),
          });
        }
      }

      targetFiles[fileName] = this.serializer.serializeToString(doc);
    }

    // 5. Semantic Batching (Group paragraphs up to maxChunkSize ~1400 chars)
    const maxChunkSize = 1400;
    const chunks: ChunkItem[] = [];
    let currentBatchTexts: string[] = [];
    let currentBatchOriginals: string[] = [];
    let currentBatchMetadata: any[] = [];
    let currentLength = 0;
    let chunkId = 0;

    for (const unit of rawParagraphUnits) {
      const unitWrapped = `<p id="${unit.pIndex}">${unit.maskedText}</p>`;
      const unitOriginalWrapped = `<p id="${unit.pIndex}">${unit.originalText}</p>`;
      const unitLen = unitWrapped.length;

      if (currentLength + unitLen > maxChunkSize && currentBatchTexts.length > 0) {
        chunkId++;
        chunks.push({
          id: chunkId,
          maskedText: currentBatchTexts.join('\n\n'),
          originalText: currentBatchOriginals.join('\n\n'),
          metadata: { units: currentBatchMetadata },
        });
        currentBatchTexts = [];
        currentBatchOriginals = [];
        currentBatchMetadata = [];
        currentLength = 0;
      }

      currentBatchTexts.push(unitWrapped);
      currentBatchOriginals.push(unitOriginalWrapped);
      currentBatchMetadata.push({ file: unit.file, pIndex: unit.pIndex });
      currentLength += unitLen + 2;
    }

    if (currentBatchTexts.length > 0) {
      chunkId++;
      chunks.push({
        id: chunkId,
        maskedText: currentBatchTexts.join('\n\n'),
        originalText: currentBatchOriginals.join('\n\n'),
        metadata: { units: currentBatchMetadata },
      });
    }

    return {
      chunks,
      state: {
        zipData: zip,
        targetFiles,
        elementsMap,
        stylesMap,
        totalParagraphs: rawParagraphUnits.length,
      },
    };
  }

  private hasDistinctFormatting(rPr: any): boolean {
    if (!rPr) return false;
    const tags = ['w:b', 'w:i', 'w:u', 'w:color', 'w:highlight', 'w:strike', 'w:vertAlign', 'w:sz'];
    for (const t of tags) {
      if (rPr.getElementsByTagName(t).length > 0) return true;
    }
    return false;
  }
}

export const defaultDocxMasker = new DocxMasker();
