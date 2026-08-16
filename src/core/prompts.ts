import { TranslationOptions, TranslationStyle } from './interfaces.js';

const STYLE_GUIDELINES: Record<TranslationStyle, string> = {
  natural: `
- Translate fluently, naturally, and idiomatically into the target language.
- Maintain a balanced, modern conversational and readable tone.
- Avoid robotic literal word-for-word translation while staying faithful to the original meaning.
`,
  technical: `
- Prioritize high technical precision and accuracy.
- Keep standard industry terminology, programming keywords, APIs, function names, and technical terms in English when appropriate or add common translations.
- Do not translate proper nouns, framework names, acronyms, or protocol names.
- Ensure technical explanations remain mathematically and logically exact.
`,
  research: `
- Maintain strict academic and scholarly rigor suitable for peer-reviewed scientific papers (IEEE, ACM, Nature, Springer, Elsevier standards).
- Use formal academic phrasing, passive/active voice conventions standard in scientific literature, and precise terminology.
- Preserve all citation references (e.g. [1], [Smith et al., 2024], \\cite{...}), author names, hypothesis statements, methodology terminology, statistical metrics (p-value, ANOVA, confidence intervals), and formula notations exactly.
- Keep domain-specific terminology consistent throughout the entire document.
`,
  formal: `
- Use formal, polite, and professional language (suitable for business, documentation, and official publications).
- Maintain dignified grammar, honorifics (if applicable in target language), and professional conventions.
`,
  concise: `
- Translate concisely, directly, and crisply without losing core meaning.
- Remove redundant filler words and simplify complex sentence structures for maximum clarity.
`,
  literary: `
- Translate with literary elegance, rich vocabulary, and emotional resonance.
- Pay attention to rhythm, flow, idioms, and stylistic nuance.
`,
};

export function buildSystemPrompt(options: TranslationOptions): string {
  const { sourceLang, targetLang, style, customGlossary, customInstructions } = options;

  const srcText = sourceLang === 'auto' ? 'the source language (auto-detected)' : sourceLang;
  const styleGuide = STYLE_GUIDELINES[style] || STYLE_GUIDELINES.natural;

  let prompt = `You are a professional, world-class document translation engine specialized in translating documents while strictly preserving structure and syntax.

Target Task:
- Translate the provided text from ${srcText} to ${targetLang}.

Style & Tone Guideline:
${styleGuide}

CRITICAL RULES FOR STRUCTURE & SYNTAX PRESERVATION:
1. PRESERVE SPECIAL PLACEHOLDERS EXACTLY:
   - Any tokens matching patterns like "[[_MASK_TYPE_INDEX_]]" (e.g. [[_CODEBLOCK_0_]], [[_INLINECODE_1_]], [[_MATH_2_]], [[_URL_3_]], [[_TAG_4_]]) MUST NOT BE TRANSLATED OR MODIFIED IN ANY WAY.
   - Retain their exact spelling, capitalization, underscores, brackets, and positions.
2. PRESERVE MARKDOWN & FORMATTING SYNTAX:
   - Keep all structural formatting intact: Headers (#, ##, ###), bold (**text**), italic (*text*), blockquotes (>), list markers (-, *, 1.), table delimiters (|), horizontal rules (---).
   - Do NOT add or remove markdown headers, table columns, or list nesting.
   - Do NOT wrap the entire output in extra markdown code fences like \`\`\`markdown or \`\`\` unless it was in the input.
3. PRESERVE PARAGRAPHS, LINE BREAKS & INDENTATION:
   - Maintain the exact paragraph boundaries, line breaks, and indentation.
   - Do NOT merge separate paragraphs or list items into a single run-on block.
`;

  if (customGlossary && Object.keys(customGlossary).length > 0) {
    prompt += `\nCUSTOM GLOSSARY (Strictly enforce these term translations):\n`;
    for (const [key, val] of Object.entries(customGlossary)) {
      prompt += `- "${key}" -> "${val}"\n`;
    }
  }

  if (customInstructions && customInstructions.trim().length > 0) {
    prompt += `\nADDITIONAL USER INSTRUCTIONS:\n${customInstructions.trim()}\n`;
  }

  prompt += `\nOutput ONLY the translated text without commentary, pleasantries, or explanations.`;

  return prompt;
}
