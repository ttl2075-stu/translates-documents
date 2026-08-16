import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuleBasedFormatLinter, FormatReviewerService } from '../core/format-reviewer.js';

test('RuleBasedFormatLinter - Normalizes headings, links, tables, lists, and LaTeX math', () => {
  const malformedMarkdown = `#Tiêu đề dính chữ
###Đầu mục 3 dính

Đây là một liên kết bị hở [Trang chủ] (https://example.com) và ảnh ![Logo] (https://example.com/logo.png).

Col 1 | Col 2 | Col 3
:--- | :--- | :---
Val 1 | Val 2 | Val 3

<think>
Suy nghĩ nội bộ của mô hình...
</think>

$$ E = mc^2 $$

-Mục danh sách 1
-Mục danh sách 2
1.Mục đánh số 1
2.Mục đánh số 2
`;

  const cleaned = RuleBasedFormatLinter.normalize(malformedMarkdown);

  // 1. Check header spaces
  assert.ok(cleaned.includes('# Tiêu đề dính chữ'));
  assert.ok(cleaned.includes('### Đầu mục 3 dính'));

  // 2. Check link & image spaces
  assert.ok(cleaned.includes('[Trang chủ](https://example.com)'));
  assert.ok(cleaned.includes('![Logo](https://example.com/logo.png)'));

  // 3. Check table borders
  assert.ok(cleaned.includes('| Col 1 | Col 2 | Col 3 |'));
  assert.ok(cleaned.includes('| Val 1 | Val 2 | Val 3 |'));

  // 4. Check think tag removal
  assert.ok(!cleaned.includes('<think>'));
  assert.ok(!cleaned.includes('Suy nghĩ nội bộ'));

  // 5. Check list item spacing
  assert.ok(cleaned.includes('- Mục danh sách 1'));
  assert.ok(cleaned.includes('1. Mục đánh số 1'));
});

test('FormatReviewerService - Reviews and standardizes document formatting', async () => {
  const reviewer = new FormatReviewerService();

  // Test empty content
  const emptyRes = await reviewer.reviewAndFixFormatting('', {
    sourceLang: 'en',
    targetLang: 'vi',
    style: 'technical',
  });
  assert.equal(emptyRes.text, '');
  assert.equal(emptyRes.fixed, false);

  // Test content with rule-only mode
  const simpleMalformed = '#Title\n\nParagraph text.';
  const res = await reviewer.reviewAndFixFormatting(
    simpleMalformed,
    {
      sourceLang: 'en',
      targetLang: 'vi',
      style: 'technical',
    },
    false // disable AI Agent for pure rule verification
  );

  assert.equal(res.text, '# Title\n\nParagraph text.');
  assert.equal(res.fixed, true);
});
