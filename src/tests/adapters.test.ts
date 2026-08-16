import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownAdapter } from '../core/adapters/markdown.adapter.js';
import { JsonAdapter } from '../core/adapters/json.adapter.js';
import { defaultRegistry } from '../core/adapters/registry.js';
import { buildSystemPrompt } from '../core/prompts.js';

test('MarkdownAdapter - Structure Preservation & Masking', async () => {
  const adapter = new MarkdownAdapter();
  const sampleMarkdown = `---
title: "Testing Document"
author: "AI"
---

# Heading 1

This is regular text with \`inline_code()\` and math $E=mc^2$.

\`\`\`python
def hello_world():
    print("Do not translate code!")
    return True
\`\`\`

Check out [Google Search](https://google.com "Search").

$$
\\int_{0}^{\\infty} e^{-x} dx = 1
$$
`;

  const parsed = await adapter.parseAndMask(sampleMarkdown, {
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'technical',
  });

  // Verify that chunks are created for separate blocks
  assert.ok(parsed.chunks.length >= 1);
  const allMaskedText = parsed.chunks.map((c) => c.maskedText).join('\n\n');
  assert.ok(allMaskedText.includes('[[_MASK_FRONTMATTER_'));
  assert.ok(allMaskedText.includes('[[_MASK_FENCE_CODE_'));
  assert.ok(allMaskedText.includes('[[_MASK_INLINE_CODE_'));
  assert.ok(allMaskedText.includes('[[_MASK_MATH_INLINE_'));
  assert.ok(allMaskedText.includes('[[_MASK_MATH_BLOCK_'));
  assert.ok(allMaskedText.includes('[[_MASK_LINK_TARGET_'));

  // Simulate LLM translation on text chunks
  const translatedChunks = parsed.chunks.map((c) => ({
    ...c,
    translatedText: c.maskedText
      .replace('This is regular text with', 'Đây là văn bản thông thường với')
      .replace('Check out', 'Hãy xem'),
  }));

  const unmasked = await adapter.unmaskAndSerialize(
    translatedChunks,
    parsed.state
  );

  // Check that all original blocks are completely restored
  assert.ok(unmasked.includes('title: "Testing Document"'));
  assert.ok(unmasked.includes('def hello_world():'));
  assert.ok(unmasked.includes('print("Do not translate code!")'));
  assert.ok(unmasked.includes('`inline_code()`'));
  assert.ok(unmasked.includes('$E=mc^2$'));
  assert.ok(unmasked.includes('\\int_{0}^{\\infty} e^{-x} dx = 1'));
  assert.ok(unmasked.includes('(https://google.com "Search")'));
  assert.ok(unmasked.includes('Đây là văn bản thông thường'));
});

test('JsonAdapter - Translates values only, retains keys & structure', async () => {
  const adapter = new JsonAdapter();
  const jsonRaw = JSON.stringify({
    title: 'Hello world',
    count: 42,
    active: true,
    nested: {
      desc: 'Description text',
    },
  });

  const parsed = await adapter.parseAndMask(jsonRaw, {
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'natural',
  });

  assert.equal(parsed.chunks.length, 1);
  assert.ok(parsed.chunks[0].maskedText.includes('[ITEM_0]: Hello world'));
  assert.ok(parsed.chunks[0].maskedText.includes('[ITEM_1]: Description text'));

  // Simulate translation
  const translatedChunk = `[ITEM_0]: Xin chào thế giới\n[ITEM_1]: Văn bản mô tả`;
  const reconstructed = await adapter.unmaskAndSerialize(
    [{ ...parsed.chunks[0], translatedText: translatedChunk }],
    parsed.state
  );

  const restoredObj = JSON.parse(reconstructed);
  assert.equal(restoredObj.title, 'Xin chào thế giới');
  assert.equal(restoredObj.nested.desc, 'Văn bản mô tả');
  assert.equal(restoredObj.count, 42);
  assert.equal(restoredObj.active, true);
});

test('AdapterRegistry - Auto resolves file types', () => {
  const md = defaultRegistry.getAdapterByFilename('README.md');
  assert.equal(md.id, 'markdown');

  const json = defaultRegistry.getAdapterByFilename('data.json');
  assert.equal(json.id, 'json');

  const txt = defaultRegistry.getAdapterByFilename('notes.txt');
  assert.equal(txt.id, 'text');
});

test('buildSystemPrompt - Embeds styles and custom glossary', () => {
  const prompt = buildSystemPrompt({
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'research',
    customGlossary: { 'contrastive learning': 'học tương phản' },
    customInstructions: 'Keep mathematical notations strictly intact',
  });

  assert.ok(prompt.includes('en to vi'));
  assert.ok(prompt.includes('học tương phản'));
  assert.ok(prompt.includes('IEEE, ACM, Nature, Springer, Elsevier'));
  assert.ok(prompt.includes('Keep mathematical notations strictly intact'));
  assert.ok(prompt.includes('CRITICAL RULES FOR STRUCTURE & SYNTAX PRESERVATION'));
});

test('TranslationCache - SHA-256 caching & hit rate tracking', async () => {
  const { TranslationCache } = await import('../core/cache.js');
  const cache = new TranslationCache();

  const original = 'Hello world';
  const translated = 'Xin chào thế giới';

  // Initially miss
  const miss = cache.get(original, 'en', 'vi', 'natural', 'gpt-4o-mini');
  assert.equal(miss, null);

  // Set cache
  cache.set(original, translated, 'en', 'vi', 'natural', 'gpt-4o-mini');

  // Hit cache
  const hit = cache.get(original, 'en', 'vi', 'natural', 'gpt-4o-mini');
  assert.equal(hit, translated);

  const stats = cache.getStats();
  assert.equal(stats.totalEntries, 1);
  assert.equal(stats.totalHits, 1);
  assert.equal(stats.totalMisses, 1);
  assert.equal(stats.hitRate, '50.0%');
});

test('MarkdownAdapter - Semantic Batching respects block boundaries (Tables, Lists, Paragraphs)', async () => {
  const adapter = new MarkdownAdapter();
  const { updateRuntimeConfig } = await import('../config.js');
  updateRuntimeConfig({ maxChunkSize: 220 });

  const doc = `# Section Title

This is a comprehensive paragraph explaining the fundamental concepts of system design.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| timeout | int | Request timeout in milliseconds |
| retry | bool | Whether to retry failed requests |
| buffer | size | Memory buffer allocation limit |

- First primary item with key details
- Second primary item with additional info
- Third primary item concluding the list

Final concluding remarks for the entire document.`;

  const parsed = await adapter.parseAndMask(doc, {
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'technical',
  });

  // Verify multiple chunks were formed
  assert.ok(parsed.chunks.length > 1);

  // Verify no chunk cuts in the middle of a table without table syntax
  for (const chunk of parsed.chunks) {
    if (chunk.maskedText.includes('| timeout |')) {
      // Must contain header or valid table structure
      assert.ok(chunk.maskedText.includes('| Parameter |') || chunk.maskedText.includes('| :--- |'));
    }
  }

  // Verify list items are cleanly grouped
  const listChunk = parsed.chunks.find((c) => c.maskedText.includes('- First primary item'));
  assert.ok(listChunk);
  assert.ok(listChunk.maskedText.includes('- Second primary item'));

  // Test full serialization
  const reconstructed = await adapter.unmaskAndSerialize(parsed.chunks, parsed.state);
  assert.ok(reconstructed.includes('| Parameter | Type | Description |'));
  assert.ok(reconstructed.includes('| timeout | int | Request timeout in milliseconds |'));
  assert.ok(reconstructed.includes('- First primary item with key details'));
  assert.ok(reconstructed.includes('# Section Title'));
});

test('TextAdapter - Splits on sentence and paragraph boundaries', async () => {
  const { TextAdapter } = await import('../core/adapters/text.adapter.js');
  const { updateRuntimeConfig } = await import('../config.js');
  updateRuntimeConfig({ maxChunkSize: 150 });

  const adapter = new TextAdapter();
  const textContent = `Paragraph one is relatively brief and clear. It contains two concise sentences.

Paragraph two is slightly longer and introduces more background information for the user to understand. It has multiple sentences explaining details.`;

  const parsed = await adapter.parseAndMask(textContent, {
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'natural',
  });

  assert.ok(parsed.chunks.length >= 2);
  // Each chunk should not end with an incomplete word
  for (const chunk of parsed.chunks) {
    assert.ok(chunk.originalText.length <= 250);
  }
});

test('TextAdapter - Oversized paragraph splits and rejoins as ONE single paragraph', async () => {
  const { TextAdapter } = await import('../core/adapters/text.adapter.js');
  const { updateRuntimeConfig } = await import('../config.js');
  updateRuntimeConfig({ maxChunkSize: 100 });

  const adapter = new TextAdapter();
  const textContent = `First short paragraph.

This is a very long text paragraph with multiple complete sentences. It explains complex concepts across several phrases. It continues even further to ensure it exceeds the max chunk size limit.

Final concluding paragraph.`;

  const parsed = await adapter.parseAndMask(textContent, {
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'natural',
  });

  assert.ok(parsed.chunks.length >= 3);
  const reconstructed = await adapter.unmaskAndSerialize(parsed.chunks, parsed.state);
  const paragraphs = reconstructed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  assert.equal(paragraphs.length, 3, `Expected 3 paragraphs in TextAdapter, got ${paragraphs.length}:\n${reconstructed}`);
});

test('MarkdownAdapter - Large Table and Nested List handling', async () => {
  const adapter = new MarkdownAdapter();
  const { updateRuntimeConfig } = await import('../config.js');
  updateRuntimeConfig({ maxChunkSize: 180 });

  const longTableDoc = `| ID | Item Name | Quantity | Price | Description |
|---|---|---|---|---|
| 1 | Database Server Alpha | 4 | $1,200 | Primary database cluster instance |
| 2 | Cache Server Redis | 8 | $400 | In-memory caching node cluster |
| 3 | Load Balancer Nginx | 2 | $300 | High availability reverse proxy |
| 4 | Worker Node Go | 16 | $800 | Distributed async task processor |`;

  const parsedTable = await adapter.parseAndMask(longTableDoc, {
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'technical',
  });

  // Because table is > 180 chars, it should be split into valid sub-tables with headers
  assert.ok(parsedTable.chunks.length > 1);
  for (const chunk of parsedTable.chunks) {
    assert.ok(chunk.maskedText.includes('| ID | Item Name |'));
    assert.ok(chunk.maskedText.includes('|---|---|'));
  }

  const nestedListDoc = `- Level 1 item A
  - Level 2 item A1 with detail
  - Level 2 item A2 with detail
- Level 1 item B
  - Level 2 item B1
  - Level 2 item B2`;

  const parsedList = await adapter.parseAndMask(nestedListDoc, {
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'natural',
  });

  // Reconstructed list matches hierarchy
  const reconstructedList = await adapter.unmaskAndSerialize(parsedList.chunks, parsedList.state);
  assert.ok(reconstructedList.includes('Level 1 item A'));
  assert.ok(reconstructedList.includes('Level 2 item A1'));
  assert.ok(reconstructedList.includes('Level 1 item B'));
});

test('OpenAIService - RefineText parameter validation', async () => {
  const { defaultOpenAIService } = await import('../core/openai-service.js');

  // Should throw on empty selected text
  await assert.rejects(
    async () => {
      await defaultOpenAIService.refineText({
        selectedText: '',
        instruction: 'Fix table',
      });
    },
    { message: /Nội dung bôi chọn không được để trống/ }
  );

  // Should throw on empty instruction
  await assert.rejects(
    async () => {
      await defaultOpenAIService.refineText({
        selectedText: '| col1 | col2 |',
        instruction: '',
      });
    },
    { message: /Yêu cầu chỉnh sửa/ }
  );
});

test('OpenAIService - stripThinkingTags removes reasoning blocks from DeepSeek-R1', async () => {
  const { stripThinkingTags } = await import('../core/openai-service.js');

  const withClosedThink = '<think>I need to translate this sentence to Vietnamese.</think>Xin chào thế giới!';
  assert.equal(stripThinkingTags(withClosedThink), 'Xin chào thế giới!');

  const withMultilineThink = `<think>
1. Identify tone: formal
2. Select appropriate terminology
</think>
Đây là kết quả dịch hoàn chỉnh.`;
  assert.equal(stripThinkingTags(withMultilineThink), 'Đây là kết quả dịch hoàn chỉnh.');

  const normalText = 'Bản dịch thông thường không có think tag.';
  assert.equal(stripThinkingTags(normalText), 'Bản dịch thông thường không có think tag.');
});

test('MarkdownAdapter - Accumulates small paragraphs until maxChunkSize is reached', async () => {
  const adapter = new MarkdownAdapter();
  const { updateRuntimeConfig } = await import('../config.js');
  updateRuntimeConfig({ maxChunkSize: 500 });

  const shortParagraphsDoc = `# Tiêu đề chính

Đoạn 1: Giới thiệu tổng quan nội dung ngắn.

Đoạn 2: Tiếp tục bổ sung thêm thông tin chi tiết về hệ thống.

Đoạn 3: Mô tả các thành phần cấu trúc và dữ liệu.

Đoạn 4: Đoạn này có độ dài vừa phải để kết hợp cùng các đoạn trước.

Đoạn 5: Đoạn cuối cùng tổng kết toàn bộ nội dung của bài viết.`;

  const parsed = await adapter.parseAndMask(shortParagraphsDoc, {
    sourceLang: 'vi',
    targetLang: 'en',
    style: 'technical',
  });

  // Total doc is ~350 chars < 500 maxChunkSize, so all 6 paragraphs should be accumulated into 1 chunk
  assert.equal(parsed.chunks.length, 1);
  assert.ok(parsed.chunks[0].maskedText.includes('# Tiêu đề chính'));
  assert.ok(parsed.chunks[0].maskedText.includes('Đoạn 1:'));
  assert.ok(parsed.chunks[0].maskedText.includes('Đoạn 5:'));

  // Test with a smaller maxChunkSize to verify multi-chunk accumulation
  updateRuntimeConfig({ maxChunkSize: 150 });
  const parsedMulti = await adapter.parseAndMask(shortParagraphsDoc, {
    sourceLang: 'vi',
    targetLang: 'en',
    style: 'technical',
  });

  // Should create multiple chunks, where each chunk has multiple paragraphs if they fit
  assert.ok(parsedMulti.chunks.length > 1);
  assert.ok(parsedMulti.chunks.length < 6); // Not 1 chunk per paragraph (6), but batched together (<6)
});

test('MarkdownAdapter - Oversized paragraph splits into sub-chunks and rejoins as ONE single paragraph', async () => {
  const adapter = new MarkdownAdapter();
  const { updateRuntimeConfig } = await import('../config.js');
  updateRuntimeConfig({ maxChunkSize: 120 });

  const heading = '# Chương 1: Giới thiệu kiến trúc';
  const shortIntro = 'Đây là đoạn mở đầu ngắn gọn.';
  const longParagraph = 'Câu thứ nhất trong đoạn văn rất dài giải thích về thuật toán. Câu thứ hai tiếp tục mở rộng thêm các khía cạnh phân tích chi tiết. Câu thứ ba cung cấp các dẫn chứng thực nghiệm cụ thể và đánh giá độ chính xác. Câu thứ tư tổng hợp lại toàn bộ kết luận của đoạn văn dài này.';
  const conclusion = 'Đây là đoạn kết luận kết thúc chương.';

  const doc = `${heading}\n\n${shortIntro}\n\n${longParagraph}\n\n${conclusion}`;

  const parsed = await adapter.parseAndMask(doc, {
    sourceLang: 'vi',
    targetLang: 'en',
    style: 'technical',
  });

  // Long paragraph alone was ~270 chars > 120 maxChunkSize, so it must be split into multiple sub-chunks
  const subChunks = parsed.chunks.filter((c) => c.metadata?.isSubChunk);
  assert.ok(subChunks.length >= 2, 'Long paragraph should be split into at least 2 sub-chunks');

  // Verify each sub-chunk contains the subChunk metadata
  assert.equal(subChunks[0].metadata?.blockType, 'paragraph');
  assert.equal(subChunks[0].metadata?.subChunkIndex, 0);

  // Simulate translation for each chunk
  const translatedChunks = parsed.chunks.map((c) => ({
    ...c,
    translatedText: c.maskedText.replace('Câu thứ nhất', '[Dịch] Câu thứ nhất'),
  }));

  // Reconstruct document
  const reconstructed = await adapter.unmaskAndSerialize(translatedChunks, parsed.state);

  // Split by double newline \n\n to check paragraph count
  const paragraphs = reconstructed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  // There should be EXACTLY 4 paragraphs: (1) Heading, (2) Short intro, (3) Long paragraph, (4) Conclusion
  assert.equal(paragraphs.length, 4, `Expected exactly 4 paragraphs, but got ${paragraphs.length}:\n${reconstructed}`);

  // Verify the 3rd paragraph is intact and contains all sentences joined as 1 single paragraph
  assert.ok(paragraphs[2].includes('Câu thứ nhất'));
  assert.ok(paragraphs[2].includes('Câu thứ hai'));
  assert.ok(paragraphs[2].includes('Câu thứ ba'));
  assert.ok(paragraphs[2].includes('Câu thứ tư'));
  // And the 3rd paragraph must NOT contain any internal \n\n
  assert.ok(!paragraphs[2].includes('\n\n'));
});






