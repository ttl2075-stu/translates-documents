import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { ChunkItem } from '../../interfaces.js';
import { DocxMaskState } from './docx-masker.js';

export class DocxRebuilder {
  private parser = new DOMParser();
  private serializer = new XMLSerializer();

  /**
   * Rebuilds .docx file by injecting translated text back into OpenXML DOM nodes,
   * restoring frozen OMML math, drawings, hyperlinks and applying exact original rPr styles.
   */
  public async rebuildDocx(translatedChunks: ChunkItem[], state: DocxMaskState): Promise<string> {
    const { zipData, targetFiles, elementsMap, stylesMap } = state;

    // 1. Map all translated paragraph texts by file and pIndex
    const translatedParagraphsMap = new Map<string, string>(); // `${file}#${pIndex}` -> translatedText

    for (const chunk of translatedChunks) {
      const units = chunk.metadata?.units || [];
      const rawText = chunk.translatedText || chunk.maskedText;

      // Extract all <p id="X">...</p> tags
      const pTagRegex = /<\s*p\s+id="(\d+)"\s*>([\s\S]*?)<\/\s*p\s*>/gi;
      let match: RegExpExecArray | null;
      let matchedCount = 0;

      while ((match = pTagRegex.exec(rawText)) !== null) {
        const pIndex = parseInt(match[1], 10);
        const innerText = match[2].trim();
        const unit = units.find((u: any) => u.pIndex === pIndex);
        const file = unit ? unit.file : (units[0] ? units[0].file : 'word/document.xml');
        translatedParagraphsMap.set(`${file}#${pIndex}`, innerText);
        matchedCount++;
      }

      // Fallback: If LLM omitted <p id="..."> tags, split by double newlines or single newlines
      if (matchedCount === 0 && units.length > 0) {
        const cleanedText = rawText.replace(/<\/?p(?: id="\d+")?>/gi, '').trim();
        const lines = cleanedText.split(/\n\n+/);
        for (let i = 0; i < units.length; i++) {
          const unit = units[i];
          const lineText = i < lines.length ? lines[i].trim() : lines[lines.length - 1]?.trim() || '';
          translatedParagraphsMap.set(`${unit.file}#${unit.pIndex}`, lineText);
        }
      }
    }

    // 2. Process each target XML file
    for (const [fileName, xmlContent] of Object.entries(targetFiles)) {
      const doc = this.parser.parseFromString(xmlContent, 'application/xml');
      const paragraphs = doc.getElementsByTagName('w:p');

      for (let i = 0; i < paragraphs.length; i++) {
        const key = `${fileName}#${i}`;
        if (!translatedParagraphsMap.has(key)) continue;

        let translatedText = translatedParagraphsMap.get(key) || '';
        // Clean any leftover <p> or </p> tags
        translatedText = translatedText.replace(/<\/?p(?: id="\d+")?>/gi, '').trim();

        const p = paragraphs[i];

        // Preserve <w:pPr> (Paragraph styling like alignment, indentation, line spacing)
        const pPrList = p.getElementsByTagName('w:pPr');
        const pPr = pPrList.length > 0 ? pPrList[0].cloneNode(true) : null;

        // Clear existing children
        while (p.firstChild) {
          p.removeChild(p.firstChild);
        }

        // Re-attach <w:pPr> at the beginning
        if (pPr) {
          p.appendChild(pPr);
        }

        // Reconstruct children runs, math and drawings from translated text
        this.reconstructParagraphChildren(doc, p, translatedText, elementsMap, stylesMap);
      }

      const serializedXml = this.serializer.serializeToString(doc);
      zipData.file(fileName, serializedXml);
    }

    // 3. Generate final .docx binary as base64 string
    const docxBase64 = await zipData.generateAsync({
      type: 'base64',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    return docxBase64;
  }

  private reconstructParagraphChildren(
    doc: any,
    p: any,
    text: string,
    elementsMap: Map<string, any>,
    stylesMap: Map<string, any>
  ): void {
    // Regular expression to match all inline tags and placeholders:
    // 1. Math: ___OMATH_BLOCK_X___
    // 2. Drawing: ___DRAWING_BLOCK_X___
    // 3. Bold/Italic/Style tag: <(b|i|r)\s+id="([^"]+)">([\s\S]*?)<\/\1>
    // 4. Link: <link\s+rId="([^"]*)">([\s\S]*?)<\/link>
    const tokenRegex = /(___OMATH_BLOCK_\d+___|___DRAWING_BLOCK_\d+___|<(b|i|r)\s+id="([^"]+)">([\s\S]*?)<\/\2>|<link\s+rId="([^"]*)">([\s\S]*?)<\/link>)/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(text)) !== null) {
      // Add regular text before match
      if (match.index > lastIndex) {
        const plainText = text.substring(lastIndex, match.index);
        if (plainText) {
          p.appendChild(this.createRunNode(doc, plainText, null));
        }
      }

      const fullToken = match[1];

      // Handle Math
      if (fullToken.startsWith('___OMATH_BLOCK_')) {
        const mathNode = elementsMap.get(fullToken);
        if (mathNode) {
          p.appendChild(mathNode.cloneNode(true));
        }
      }
      // Handle Drawing / Image
      else if (fullToken.startsWith('___DRAWING_BLOCK_')) {
        const drawingNode = elementsMap.get(fullToken);
        if (drawingNode) {
          p.appendChild(drawingNode.cloneNode(true));
        }
      }
      // Handle Link
      else if (fullToken.startsWith('<link')) {
        const rId = match[5] || '';
        const linkText = match[6] || '';
        const hyperlink = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:hyperlink');
        if (rId) {
          hyperlink.setAttribute('r:id', rId);
        }
        hyperlink.appendChild(this.createRunNode(doc, linkText, null));
        p.appendChild(hyperlink);
      }
      // Handle Styled text (<b id="...">, <i id="...">, <r id="...">)
      else {
        const styleId = match[3];
        const innerText = match[4];
        const rPr = stylesMap.get(styleId);
        p.appendChild(this.createRunNode(doc, innerText, rPr));
      }

      lastIndex = tokenRegex.lastIndex;
    }

    // Add trailing text
    if (lastIndex < text.length) {
      const remainingText = text.substring(lastIndex);
      if (remainingText) {
        p.appendChild(this.createRunNode(doc, remainingText, null));
      }
    }
  }

  private createRunNode(doc: any, textContent: string, rPrNode: any): any {
    const r = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');

    if (rPrNode) {
      r.appendChild(rPrNode.cloneNode(true));
    }

    const t = doc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = textContent;
    r.appendChild(t);

    return r;
  }
}

export const defaultDocxRebuilder = new DocxRebuilder();
