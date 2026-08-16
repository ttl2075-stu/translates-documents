import { OpenAIService, defaultOpenAIService } from './openai-service.js';
import { TranslationOptions } from './interfaces.js';

export class RuleBasedFormatLinter {
  /**
   * Fast, deterministic rule-based formatting normalization
   */
  static normalize(markdown: string): string {
    if (!markdown) return '';

    let text = markdown;

    // 1. Fix missing space after Markdown headers: e.g. #Title -> # Title, ###Header -> ### Header
    text = text.replace(/^(#{1,6})([^\s#\r\n])/gm, '$1 $2');

    // 2. Fix broken link and image syntax spacing: e.g. [text] (url) -> [text](url) or ![alt] (url) -> ![alt](url)
    text = text.replace(/(\[[^\]]+\])\s+(\([^)]+\))/g, '$1$2');

    // 3. Fix broken Markdown table syntax:
    // - Ensure rows with multiple pipes start with | and end with |
    const lines = text.split(/\r?\n/);
    const fixedLines: string[] = [];
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmed = line.trim();

      const looksLikeTableRow = trimmed.includes('|') && (trimmed.startsWith('|') || /\|.*\|/.test(trimmed));
      const isTableSeparator = /^\s*\|?\s*:?-+:?\s*\|/.test(trimmed);

      if (looksLikeTableRow) {
        inTable = true;
        let formattedRow = trimmed;
        if (!formattedRow.startsWith('|')) formattedRow = '| ' + formattedRow;
        if (!formattedRow.endsWith('|')) formattedRow = formattedRow + ' |';

        // Check if next line should be a delimiter but isn't
        fixedLines.push(formattedRow);
      } else {
        inTable = false;
        fixedLines.push(line);
      }
    }
    text = fixedLines.join('\n');

    // 4. Fix unbalanced LaTeX math block markers ($$...$$)
    // Ensure display math $$ starts and ends on dedicated clean lines or proper pairs
    text = text.replace(/\$\$\s*([^$]+?)\s*\$\$/g, '$$\n$1\n$$');

    // 5. Clean up any leftover raw think tags or unescaped thinking remnants
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    text = text.replace(/<think>[\s\S]*$/gi, '');
    text = text.replace(/^<\/think>\s*/gm, '');

    // 6. Fix list item spacing: e.g. "1.Item" -> "1. Item", "-Item" -> "- Item"
    text = text.replace(/^(\s*[-*+]|\s*\d+[\.\)])([^\s\r\n])/gm, '$1 $2');

    // 7. Remove excessive consecutive blank lines (limit to max 2 newlines)
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
  }
}

export class FormatReviewerService {
  private openAIService: OpenAIService;

  constructor(openAIService: OpenAIService = defaultOpenAIService) {
    this.openAIService = openAIService;
  }

  /**
   * Reviews and standardizes document formatting using fast linting rules + optional AI Agent review
   */
  async reviewAndFixFormatting(
    content: string,
    options: TranslationOptions,
    useAIAgent: boolean = true,
    apiOverride?: { apiKey?: string; baseURL?: string; model?: string }
  ): Promise<{ text: string; fixed: boolean; message?: string }> {
    if (!content || content.trim().length === 0) {
      return { text: content, fixed: false };
    }

    // Step 1: Run fast rule-based normalization
    const ruleNormalized = RuleBasedFormatLinter.normalize(content);

    // If AI Agent review is disabled or content is very short/simple, return rule-normalized result
    if (!useAIAgent) {
      return {
        text: ruleNormalized,
        fixed: ruleNormalized !== content,
        message: 'Đã chuẩn hóa định dạng theo bộ quy tắc cấu trúc.',
      };
    }

    // Step 2: For complex markdown with tables, equations or code, invoke AI Format Reviewer Agent
    const needsAgentReview =
      ruleNormalized.includes('|') ||
      ruleNormalized.includes('$$') ||
      ruleNormalized.includes('```') ||
      ruleNormalized.includes('~') ||
      ruleNormalized.includes('<table');

    if (!needsAgentReview) {
      return {
        text: ruleNormalized,
        fixed: ruleNormalized !== content,
        message: 'Đã chuẩn hóa cấu trúc thành công.',
      };
    }

    try {
      const systemPrompt = `You are an Expert Markdown Formatting & Layout Reviewer Agent.
Your SOLE and STRICT responsibility is to audit, validate, and repair formatting anomalies in the provided translated document.

CRITICAL INSTRUCTIONS:
1. DO NOT change, rephrase, add, or delete any translated words or textual content.
2. Fix Markdown table formatting:
   - Ensure all rows have equal column counts aligned with delimiter rows | :--- | :--- |.
   - Ensure tables are properly closed and formatted.
3. Fix LaTeX Math formulas ($...$, $$...$$):
   - Ensure all opening and closing dollar signs are properly balanced.
   - Do not escape LaTeX equations inside math blocks.
4. Fix Fenced Code blocks (\`\`\`...\`\`\`):
   - Ensure code blocks are properly opened and closed with triple backticks.
5. Fix List syntax and indentation hierarchy.
6. Fix Links and Images syntax: ensure [text](url) and ![alt](url) are well-formed.
7. Output ONLY the repaired Markdown text directly without any introductory pleasantries, explanations, or <think> tags.`;

      const refined = await this.openAIService.refineText(
        {
          selectedText: ruleNormalized,
          instruction: 'Rà soát và chuẩn hóa toàn bộ cấu trúc định dạng bảng, công thức toán LaTeX, khối code và danh sách.',
          sourceLang: options.sourceLang,
          targetLang: options.targetLang,
          style: options.style,
        },
        apiOverride
      );

      const cleaned = RuleBasedFormatLinter.normalize(refined);
      return {
        text: cleaned,
        fixed: true,
        message: 'Agent đã hoàn tất rà soát và chuẩn hóa cấu trúc định dạng.',
      };
    } catch (err: any) {
      // Fallback cleanly to rule-normalized text on any API error
      return {
        text: ruleNormalized,
        fixed: ruleNormalized !== content,
        message: `Đã áp dụng chuẩn hóa quy tắc (AI Agent bỏ qua: ${err.message}).`,
      };
    }
  }
}

export const defaultFormatReviewer = new FormatReviewerService();
