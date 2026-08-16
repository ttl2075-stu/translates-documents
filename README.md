# AI Document Translator 🚀

Hệ thống dịch tài liệu thông minh sử dụng các mô hình AI theo chuẩn **OpenAI API** (`/v1/chat/completions`), được thiết kế chuyên biệt để **bảo toàn 100% cấu trúc cú pháp** (Code Blocks, Frontmatter, LaTeX Math, Markdown Links, Tables, HTML Tags) và kiến trúc **Adapter Pattern** mở rộng linh hoạt.

---

## 🌟 Tính Năng Nổi Bật

1. **Bảo tồn tuyệt đối cấu trúc tài liệu**:
   - **Markdown**: Giữ nguyên vẹn YAML/TOML Frontmatter, Block Code (Python, Go, JS, etc.), Inline Code, Math LaTeX (`$...$`, `$$...$$`), HTML tags, URLs và cấu trúc Tables.
   - **JSON**: Dịch tất cả các giá trị văn bản (String values) nhưng giữ nguyên 100% key names, numbers, booleans, arrays và cây object phân cấp.
   - **Plain Text**: Dịch theo đoạn với phân tách thông minh.
2. **Kiến Trúc Tổng Quát (Adapter Pattern)**:
   - Dễ dàng mở rộng cho các định dạng mới (HTML, DOCX, CSV, SRT, PO, v.v.) chỉ bằng cách thêm một file Adapter vào thư mục `src/core/adapters/`.
3. **Chuẩn OpenAI-Compatible API linh hoạt**:
   - Tương thích với **OpenAI** (`gpt-4o-mini`, `gpt-4o`), **DeepSeek** (`deepseek-chat`), **OpenRouter**, **Groq**, **Ollama** cục bộ hoặc bất kỳ server LLM nào hỗ trợ chuẩn OpenAI.
   - Toàn bộ cấu hình LLM API Key, Base URL, Model được quản lý an toàn từ phía **Backend** (`.env` hoặc UI Settings).
4. **Tùy biến phong cách dịch (Translation Styles / Tones)**:
   - 🌿 **Tự nhiên & Mượt mà (Natural / Fluent)**
   - ⚙️ **Chuẩn Kỹ thuật & IT (Technical / Exact)**
   - 👔 **Trang trọng & Công việc (Formal / Business)**
   - ⚡ **Tóm lược & Ngắn gọn (Concise / Direct)**
   - 📖 **Văn học & Trau chuốt (Literary)**
   - 📚 **Từ điển thuật ngữ riêng (Custom Project Glossary)**
5. **Giao diện Web UI hiện đại (Vanilla CSS)**:
   - Bộ xem song song 2 cột (Dual-column Editor & Live Rendered Markdown Preview).
   - Realtime Streaming (SSE) hiển thị thanh tiến độ dịch tài liệu lớn nhiều phần.
   - Kéo thả file trực tiếp (Drag & Drop), tải file mẫu, sao chép và tải file đã dịch về máy.

---

## 🛠️ Hướng Dẫn Cài Đặt & Chạy Ứng Dụng

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Cấu hình biến môi trường Backend (`.env`)
Tạo hoặc chỉnh sửa file `.env` tại thư mục gốc dự án:
```env
PORT=3000

# OpenAI API Key (hoặc DeepSeek, OpenRouter...)
OPENAI_API_KEY=sk-your-openai-api-key

# Base URL của OpenAI hoặc nhà cung cấp tương thích
OPENAI_BASE_URL=https://api.openai.com/v1

# Tên mô hình mặc định
OPENAI_MODEL=gpt-4o-mini

# Số luồng dịch song song (Concurrency)
TRANSLATION_CONCURRENCY=3

# Kích thước ký tự tối đa cho mỗi phần dịch
MAX_CHUNK_SIZE=2500
```

> **Gợi ý**: Bạn có thể dùng trực tiếp **DeepSeek** (`OPENAI_BASE_URL=https://api.deepseek.com`, `OPENAI_MODEL=deepseek-chat`) hoặc **Ollama chạy cục bộ** (`OPENAI_BASE_URL=http://localhost:11434/v1`, `OPENAI_MODEL=llama3.3`).

### 3. Khởi động ứng dụng
Chế độ phát triển (Development):
```bash
npm run dev
```

Hoặc build và chạy Production:
```bash
npm run build
npm start
```

Mở trình duyệt tại: **`http://localhost:3000`**

### 4. Chạy kiểm thử tự động (Unit Tests)
```bash
npm test -- --import tsx src/tests/adapters.test.ts
```

---

## 🧩 Hướng Dẫn Thêm Định Dạng Mới (Extending Adapters)

Để hỗ trợ thêm một định dạng file mới (ví dụ `HtmlAdapter` cho file `.html`), chỉ cần:

1. Tạo file `src/core/adapters/html.adapter.ts` thực thi interface `DocumentAdapter`:
```typescript
import { DocumentAdapter, DocumentParseResult, ChunkItem, TranslationOptions } from '../interfaces.js';

export class HtmlAdapter implements DocumentAdapter {
  readonly id = 'html';
  readonly name = 'HTML Document';
  readonly supportedExtensions = ['.html', '.htm'];
  readonly description = 'Dịch nội dung văn bản bên trong các thẻ HTML';

  async parseAndMask(content: string, options: TranslationOptions): Promise<DocumentParseResult> {
    // Tách text cần dịch và mask các thẻ <script>, <style>, <img>, v.v.
  }

  async unmaskAndSerialize(translatedChunks: ChunkItem[], state: any): Promise<string> {
    // Ghép nối và hoàn thiện HTML
  }
}
```

2. Đăng ký adapter vào `src/core/adapters/registry.ts`:
```typescript
this.register(new HtmlAdapter());
```
Hệ thống sẽ tự động nhận diện file `.html` khi người dùng tải lên mà không cần sửa bất kỳ dòng code UI nào!
