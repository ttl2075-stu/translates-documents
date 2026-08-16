import crypto from 'crypto';

export interface CacheEntry {
  translatedText: string;
  timestamp: number;
  model: string;
  sourceLang: string;
  targetLang: string;
  hits: number;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: string;
  estimatedSavedTokens: number;
}

export class TranslationCache {
  private cache: Map<string, CacheEntry> = new Map();
  private totalHits = 0;
  private totalMisses = 0;
  private maxEntries = 5000;

  private generateKey(
    text: string,
    sourceLang: string,
    targetLang: string,
    style: string,
    model: string,
    glossary?: Record<string, string>,
    customInstructions?: string
  ): string {
    const raw = JSON.stringify({
      text: text.trim(),
      sourceLang,
      targetLang,
      style,
      model,
      glossary: glossary || {},
      customInstructions: customInstructions || '',
    });

    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  get(
    text: string,
    sourceLang: string,
    targetLang: string,
    style: string,
    model: string,
    glossary?: Record<string, string>,
    customInstructions?: string
  ): string | null {
    const key = this.generateKey(text, sourceLang, targetLang, style, model, glossary, customInstructions);
    const entry = this.cache.get(key);

    if (entry) {
      this.totalHits++;
      entry.hits++;
      return entry.translatedText;
    }

    this.totalMisses++;
    return null;
  }

  set(
    text: string,
    translatedText: string,
    sourceLang: string,
    targetLang: string,
    style: string,
    model: string,
    glossary?: Record<string, string>,
    customInstructions?: string
  ): void {
    if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    const key = this.generateKey(text, sourceLang, targetLang, style, model, glossary, customInstructions);
    this.cache.set(key, {
      translatedText,
      timestamp: Date.now(),
      model,
      sourceLang,
      targetLang,
      hits: 0,
    });
  }

  clear(): void {
    this.cache.clear();
    this.totalHits = 0;
    this.totalMisses = 0;
  }

  getStats(): CacheStats {
    const totalRequests = this.totalHits + this.totalMisses;
    const hitRate = totalRequests === 0 ? '0%' : `${((this.totalHits / totalRequests) * 100).toFixed(1)}%`;
    // Rough estimate: 1 char ~= 0.25 token, saved input + output tokens
    const estimatedSavedTokens = this.totalHits * 250;

    return {
      totalEntries: this.cache.size,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate,
      estimatedSavedTokens,
    };
  }
}

export const defaultTranslationCache = new TranslationCache();
