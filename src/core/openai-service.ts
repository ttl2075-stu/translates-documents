import OpenAI from 'openai';
import { config } from '../config.js';
import { TranslationOptions } from './interfaces.js';
import { buildSystemPrompt } from './prompts.js';
import { defaultTranslationCache, TranslationCache } from './cache.js';

export interface TranslationCallResult {
  text: string;
  fromCache: boolean;
}

export type TokenCallback = (token: string, chunkId: number) => void;

export class OpenAIService {
  constructor(private cache: TranslationCache = defaultTranslationCache) {}

  private getClient(customApiKey?: string, customBaseUrl?: string): OpenAI {
    const apiKey = customApiKey || config.openaiApiKey;
    const baseURL = customBaseUrl || config.openaiBaseUrl;

    if (!apiKey) {
      throw new Error('Chưa cấu hình OPENAI_API_KEY ở file .env của backend.');
    }

    return new OpenAI({
      apiKey,
      baseURL: baseURL.replace(/\/+$/, ''),
      timeout: 45000, // 45s max timeout to prevent indefinite hangs
    });
  }

  /**
   * Translates a single chunk with live streaming tokens, cache check & prompt caching
   */
  async translateChunkStream(
    text: string,
    chunkId: number,
    options: TranslationOptions,
    onToken?: TokenCallback,
    clientConfig?: { apiKey?: string; baseUrl?: string; model?: string }
  ): Promise<TranslationCallResult> {
    if (!text || text.trim().length === 0) {
      return { text, fromCache: false };
    }

    const model = clientConfig?.model || options.model || config.openaiModel;
    const useCache = options.enableCache !== false;

    // 1. Check Cache
    if (useCache) {
      const cached = this.cache.get(
        text,
        options.sourceLang,
        options.targetLang,
        options.style,
        model,
        options.customGlossary,
        options.customInstructions
      );

      if (cached !== null) {
        onToken?.(cached, chunkId);
        return { text: cached, fromCache: true };
      }
    }

    // 2. Stream from OpenAI / DeepSeek API
    const client = this.getClient(clientConfig?.apiKey, clientConfig?.baseUrl);
    const systemPrompt = buildSystemPrompt(options);

    try {
      const stream = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: options.temperature ?? 0.2,
        stream: true,
      });

      let fullTranslated = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullTranslated += delta;
          onToken?.(delta, chunkId);
        }
      }

      fullTranslated = fullTranslated.trim();

      // 3. Save to Cache
      if (useCache && fullTranslated.length > 0) {
        this.cache.set(
          text,
          fullTranslated,
          options.sourceLang,
          options.targetLang,
          options.style,
          model,
          options.customGlossary,
          options.customInstructions
        );
      }

      return { text: fullTranslated, fromCache: false };
    } catch (error: any) {
      const msg = error?.message || 'Lỗi khi gọi OpenAI/DeepSeek API';
      throw new Error(`Lỗi dịch (${model}): ${msg}`);
    }
  }

  /**
   * Non-streaming fallback
   */
  async translateChunk(
    text: string,
    options: TranslationOptions,
    clientConfig?: { apiKey?: string; baseUrl?: string; model?: string }
  ): Promise<TranslationCallResult> {
    return this.translateChunkStream(text, 0, options, undefined, clientConfig);
  }

  /**
   * Refines or fixes selected text based on user prompt instruction & surrounding context
   */
  async refineText(
    options: {
      selectedText: string;
      instruction: string;
      contextBefore?: string;
      contextAfter?: string;
      sourceLang?: string;
      targetLang?: string;
      style?: string;
    },
    clientConfig?: { apiKey?: string; baseUrl?: string; model?: string }
  ): Promise<string> {
    const {
      selectedText,
      instruction,
      contextBefore = '',
      contextAfter = '',
      targetLang = 'vi',
      style = 'technical',
    } = options;

    if (!selectedText || selectedText.trim().length === 0) {
      throw new Error('Nội dung bôi chọn không được để trống.');
    }

    if (!instruction || instruction.trim().length === 0) {
      throw new Error('Yêu cầu chỉnh sửa (prompt) không được để trống.');
    }

    const systemPrompt = `You are an expert document editor, Markdown formatting fixer, and technical translator.
Your task is to refine, fix, reformat, or re-translate the [SELECTED TEXT] according to the user's specific instruction.

CRITICAL RULES:
1. Follow the user's instruction precisely (e.g., fix broken markdown tables/columns, correct list indentation, fix LaTeX math, improve phrasing, correct spelling, adjust tone).
2. Output in ${targetLang} language with a ${style} style unless the instruction specifies otherwise.
3. Preserve valid Markdown formatting syntax (pipes for tables, dashes for lists, backticks for code, math dollar signs).
4. Preserve any placeholder tokens like [[_MASK_..._]] exactly without alteration.
5. Return ONLY the replacement text for [SELECTED TEXT]. Do NOT include conversational filler, explanations, markdown commentary, or extra wrapping codeblocks unless the selection itself was a codeblock.`;

    let userPrompt = '';
    if (contextBefore.trim().length > 0 || contextAfter.trim().length > 0) {
      userPrompt += `[SURROUNDING CONTEXT]\n...${contextBefore.slice(-300)} [SELECTED_START] >>>\n`;
    }
    userPrompt += `[SELECTED TEXT TO EDIT]:\n${selectedText}\n`;
    if (contextBefore.trim().length > 0 || contextAfter.trim().length > 0) {
      userPrompt += `<<< [SELECTED_END] ${contextAfter.slice(0, 300)}...\n\n`;
    }
    userPrompt += `[USER INSTRUCTION]:\n${instruction}\n\nOutput only the corrected replacement text:`;

    const client = this.getClient(clientConfig?.apiKey, clientConfig?.baseUrl);
    const model = clientConfig?.model || config.openaiModel;

    try {
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      });

      return res.choices[0]?.message?.content?.trim() || selectedText;
    } catch (error: any) {
      const msg = error?.message || 'Lỗi khi gọi API chỉnh sửa';
      throw new Error(`Lỗi chỉnh sửa AI (${model}): ${msg}`);
    }
  }

  async testConnection(customConfig?: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ success: boolean; message: string; models?: string[] }> {
    try {
      const client = this.getClient(customConfig?.apiKey, customConfig?.baseUrl);
      const testModel = customConfig?.model || config.openaiModel;
      const res = await client.chat.completions.create({
        model: testModel,
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5,
      });
      return {
        success: true,
        message: `Kết nối thành công tới model ${testModel}!`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Không thể kết nối API: ${err.message}`,
      };
    }
  }
}

export const defaultOpenAIService = new OpenAIService();
