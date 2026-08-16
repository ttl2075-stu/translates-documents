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
