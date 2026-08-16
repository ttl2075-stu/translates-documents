export type TranslationStyle =
  | 'natural'    // Tự nhiên, mượt mà, phù hợp đọc thông thường
  | 'technical'  // Chính xác về mặt kỹ thuật, giữ nguyên thuật ngữ chuyên ngành
  | 'research'   // Nghiên cứu học thuật, chuẩn mực bài báo khoa học (Academic & Scientific Research)
  | 'formal'     // Trang trọng, dùng trong hợp đồng, văn bản hành chính, báo cáo
  | 'concise'    // Súc tích, ngắn gọn, lược bỏ rườm rà
  | 'literary';  // Văn học, trau chuốt, giàu hình ảnh

export interface TranslationOptions {
  sourceLang: string;          // e.g., 'auto', 'en', 'vi', 'ja', 'zh', 'fr'
  targetLang: string;          // e.g., 'vi', 'en', 'ja', 'zh', 'de'
  style: TranslationStyle;
  mode?: 'parallel' | 'contextual_session'; // 'parallel': siêu nhanh; 'contextual_session': giữ mạch hội thoại & nhất quán ngữ cảnh
  enableCache?: boolean;       // Bật/tắt cache thông minh
  enableFormatReview?: boolean; // Bật/tắt agent rà soát và chuẩn hóa định dạng sau dịch
  customGlossary?: Record<string, string>; // e.g. { "hook": "hook", "state": "trạng thái" }
  customInstructions?: string; // e.g. "Do not translate brand names"
  model?: string;
  temperature?: number;
}

export interface ChunkItem {
  id: number;
  originalText: string;
  maskedText: string;
  translatedText?: string;
  metadata?: Record<string, any>;
}

export interface DocumentParseResult {
  chunks: ChunkItem[];
  state: any; // Adapter-specific context needed to rebuild original structure
}

export interface DocumentAdapter {
  readonly id: string;
  readonly name: string;
  readonly supportedExtensions: string[];
  readonly description: string;

  /**
   * Parses raw file content (UTF-8 text or base64 / binary Buffer), extracts translatable text while protecting syntax / code / tags
   */
  parseAndMask(content: string | Buffer, options: TranslationOptions): Promise<DocumentParseResult>;

  /**
   * Replaces placeholders and reconstructs the original document structure
   */
  unmaskAndSerialize(translatedChunks: ChunkItem[], state: any): Promise<string>;
}

export interface TranslationProgress {
  currentChunk: number;
  totalChunks: number;
  percent: number;
  chunkPreview?: string;
  status: 'parsing' | 'translating' | 'assembling' | 'reviewing' | 'completed' | 'error';
  message?: string;
}

export type ProgressCallback = (progress: TranslationProgress) => void;
