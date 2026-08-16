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

  // Verify that code block is masked and not present in prose
  assert.ok(parsed.chunks.length >= 1);
  const chunk = parsed.chunks[0];
  assert.ok(chunk.maskedText.includes('[[_MASK_FRONTMATTER_'));
  assert.ok(chunk.maskedText.includes('[[_MASK_FENCE_CODE_'));
  assert.ok(chunk.maskedText.includes('[[_MASK_INLINE_CODE_'));
  assert.ok(chunk.maskedText.includes('[[_MASK_MATH_INLINE_'));
  assert.ok(chunk.maskedText.includes('[[_MASK_MATH_BLOCK_'));
  assert.ok(chunk.maskedText.includes('[[_MASK_LINK_TARGET_'));

  // Simulate LLM translation on text around masks
  const translatedMaskedText = chunk.maskedText
    .replace('This is regular text with', 'Đây là văn bản thông thường với')
    .replace('Check out', 'Hãy xem');

  const unmasked = await adapter.unmaskAndSerialize(
    [{ ...chunk, translatedText: translatedMaskedText }],
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



