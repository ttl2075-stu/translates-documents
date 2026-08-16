import test from 'node:test';
import assert from 'node:assert';
import JSZip from 'jszip';
import { DocxAdapter } from '../core/adapters/docx-adapter.js';

test('DocxAdapter - Structure, Table, Math (OMML) & Style Preservation', async () => {
  const adapter = new DocxAdapter();

  // 1. Construct a mock valid .docx package in memory
  const zip = new JSZip();
  const mockDocumentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <w:body>
    <!-- Normal paragraph with bold & italic -->
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r><w:t>Hello world, this is </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>important</w:t></w:r>
      <w:r><w:t> and </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>confidential</w:t></w:r>
      <w:r><w:t> data.</w:t></w:r>
    </w:p>

    <!-- Paragraph with OMML Math Formula -->
    <w:p>
      <w:r><w:t>The energy equation is: </w:t></w:r>
      <m:oMath>
        <m:r><m:t>E=mc^2</m:t></m:r>
      </m:oMath>
      <w:r><w:t> which was proven by Einstein.</w:t></w:r>
    </w:p>

    <!-- Table with 2 rows & 2 columns -->
    <w:tbl>
      <w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="2500"/>
        <w:gridCol w:w="2500"/>
      </w:tblGrid>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Metric</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Value</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>Accuracy</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>
          <w:p><w:r><w:t>99.8%</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

  zip.file('word/document.xml', mockDocumentXml);
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types></Types>');

  const docxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const docxBase64 = docxBuffer.toString('base64');

  // 2. Parse and mask .docx
  const parseResult = await adapter.parseAndMask(docxBase64, {
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'research',
  });

  assert.ok(parseResult.chunks.length > 0, 'Should extract chunks from docx');
  const allMaskedText = parseResult.chunks.map((c) => c.maskedText).join('\n\n');

  // Verify Math is frozen
  assert.ok(allMaskedText.includes('___OMATH_BLOCK_1___'), 'Math must be replaced by OMML placeholder');
  // Verify Inline Styles are annotated
  assert.ok(allMaskedText.includes('<b id='), 'Bold text must be annotated with <b id="...">');
  assert.ok(allMaskedText.includes('<i id='), 'Italic text must be annotated with <i id="...">');

  // 3. Simulate translation
  const translatedChunks = parseResult.chunks.map((chunk) => {
    let trans = chunk.maskedText;
    trans = trans.replace('Hello world, this is', 'Xin chào thế giới, đây là');
    trans = trans.replace('important', 'quan trọng');
    trans = trans.replace('and', 'và');
    trans = trans.replace('confidential', 'bảo mật');
    trans = trans.replace('data.', 'dữ liệu.');
    trans = trans.replace('The energy equation is:', 'Phương trình năng lượng là:');
    trans = trans.replace('which was proven by Einstein.', 'được chứng minh bởi Einstein.');
    trans = trans.replace('Metric', 'Chỉ số');
    trans = trans.replace('Value', 'Giá trị');
    trans = trans.replace('Accuracy', 'Độ chính xác');
    return {
      ...chunk,
      translatedText: trans,
    };
  });

  // 4. Unmask and serialize back to .docx
  const rebuiltDocxBase64 = await adapter.unmaskAndSerialize(translatedChunks, parseResult.state);
  assert.ok(typeof rebuiltDocxBase64 === 'string', 'Should return docx base64 string');

  // 5. Inspect rebuilt .docx contents
  const rebuiltZip = await JSZip.loadAsync(rebuiltDocxBase64, { base64: true });
  const rebuiltXml = await rebuiltZip.file('word/document.xml')?.async('string');
  assert.ok(rebuiltXml, 'Rebuilt docx must contain word/document.xml');

  // Verify translated text is present
  assert.ok(rebuiltXml.includes('Xin chào thế giới, đây là'), 'Must contain translated text');
  assert.ok(rebuiltXml.includes('quan trọng'), 'Must contain translated bold word');
  assert.ok(rebuiltXml.includes('bảo mật'), 'Must contain translated italic word');
  assert.ok(rebuiltXml.includes('Độ chính xác'), 'Table cell content must be translated');

  // Verify Math OMML is preserved 100%
  assert.ok(rebuiltXml.includes('<m:oMath>'), 'OMML <m:oMath> must be restored');
  assert.ok(rebuiltXml.includes('E=mc^2'), 'Formula content must remain intact');

  // Verify Table structure is preserved 100%
  assert.ok(rebuiltXml.includes('<w:tbl>'), 'Table tag <w:tbl> must remain intact');
  assert.ok(rebuiltXml.includes('<w:tblGrid>'), 'Table grid must remain intact');
  assert.ok(rebuiltXml.includes('<w:tc>'), 'Table cells must remain intact');
});
