# 🚀 AI Document Translator & Markdown Scientific Viewer

Ứng dụng web chuyên nghiệp dịch và hiển thị tài liệu khoa học đa định dạng (**Markdown, JSON, Plain Text**) bằng trí tuệ nhân tạo (hỗ trợ **OpenAI, DeepSeek** và mọi API tương thích OpenAI). 

Hệ thống được thiết kế với kiến trúc **bảo toàn 100% cấu trúc tài liệu**, hỗ trợ **công thức toán học LaTeX (KaTeX)**, **hình ảnh trực quan**, **mục lục tự động (TOC)**, **chế độ in ấn đa trang chuẩn PDF** và **trình soạn thảo Markdown thời gian thực**.

---

## ✨ Tính Năng Nổi Bật

### 1. 🧠 Động Cơ Dịch AI & Bảo Toàn Cấu Trúc (Structure-Preserving Engine)
- **Bảo toàn 100% cú pháp nguồn**:
  - **YAML / TOML Frontmatter**: Giữ nguyên thông tin metadata bài viết.
  - **Khối mã nguồn (Code Blocks)**: Bảo toàn nguyên vẹn mã nguồn (Python, C++, JS, Bash, v.v.), có nền xám thanh lịch và nút sao chép nhanh.
  - **Công thức toán học LaTeX**: Bảo vệ tuyệt đối các định dạng toán học:
    - *Display Math*: `$$ ... $$`, `\[ ... \]`, `\begin{equation}`, `\begin{align}`, `\begin{gather}`, ma trận `\begin{pmatrix/bmatrix}`.
    - *Inline Math*: `$ ... $`, `\( ... \)`.
  - **Bảng biểu, hình ảnh, liên kết và chú thích**: Giữ nguyên các định dạng `![alt](url)`, thẻ `<img>`, bảng Markdown, footnotes.
- **Dịch tài liệu JSON thông minh**: Chỉ dịch các chuỗi giá trị văn bản, giữ nguyên key và cấu trúc cây JSON lồng nhau.

### 2. ⚡ Live Streaming Thời Gian Thực (Token-by-Token SSE)
- Giao tiếp với OpenAI/DeepSeek API qua cơ chế **`stream: true`**.
- Server chuyển tiếp luồng token tức thì qua **Server-Sent Events (SSE)** về trình duyệt: **Thời gian xuất hiện từ đầu tiên chỉ ~0.5 giây**, loại bỏ hoàn toàn hiện tượng đứng hoặc treo giao diện.
- Cơ chế xử lý phân đoạn song song (**Parallel Concurrency Workers**) giúp tài liệu dài hàng ngàn từ được dịch trong vài giây.

### 3. 🎓 Chuyên Biệt Cho Bài Báo Khoa Học (Academic Research Mode)
- Cung cấp kiểu dịch chuyên dụng **Research Paper (IEEE / ACM / Nature / Springer)**: Giữ nguyên thuật ngữ học thuật quốc tế, tên tác giả, trích dẫn tài liệu tham khảo và ký hiệu toán học.
- Hỗ trợ thêm các kiểu dịch: *Technical (Kỹ thuật/CNTT)*, *Natural (Tự nhiên)*, *Formal (Trang trọng)*, *Concise (Ngắn gọn)*, *Literary (Văn học)*.
- Tích hợp **Từ điển thuật ngữ (Glossary)** và **Chỉ dẫn dịch tùy biến (Custom Instructions)**.

### 4. 🗄️ Bộ Nhớ Đệm Thông Minh (Smart SHA-256 Cache)
- Tự động băm (hash) từng đoạn văn bản kèm ngữ cảnh (ngôn ngữ, kiểu dịch, từ điển, model).
- Các đoạn văn bản lặp lại hoặc dịch lại sẽ được lấy từ Cache với độ trễ **0ms** và **tiết kiệm 100% chi phí token API**.

### 5. 🎨 Giao Diện Tối Đa Không Gian Output & Trình Đọc Hiện Đại
- **Bố cục 100% Fullwidth Output**: Khung nhập liệu nguồn được đặt gọn gàng phía trên và có thể thu gọn linh hoạt để nhường trọn vẹn không gian cho bản dịch.
- **Trình đọc Markdown độc lập (Open .md File)**: Cho phép mở trực tiếp bất kỳ file `.md` nào trên máy tính để đọc, render công thức KaTeX và in ấn.
- **Chỉnh sửa trực tiếp (Live Output Editor & Sync)**: Cho phép tự do chỉnh sửa bản dịch tại tab *Chỉnh sửa*, tự động đồng bộ sang tab *Xem trước*, *Mục lục* và *Diff*.
- **Tùy chỉnh định dạng (Typography Customizer)**:
  - Cỡ chữ linh hoạt: `13px` – `22px`.
  - Dãn dòng (Line-height): `1.5`, `1.75`, `2.0`.
  - Khoảng cách đoạn: Hẹp, Chuẩn, Thoáng.
  - Kiểu Font: *Inter (Hiện đại)*, *Merriweather (Bài báo khoa học)*, *JetBrains Mono (Kỹ thuật)*.
- **Mục lục tài liệu tự động (Table of Contents - TOC)**: Tự động trích xuất các cấp tiêu đề `H1, H2, H3` kèm tính năng cuộn mượt (Smooth Scroll).
- **In ấn đa trang & Xuất PDF chuẩn (`@media print`)**: Tự động phân trang chuẩn xác (2, 5, 20+ trang), ẩn thanh công cụ, định dạng lề `@page { margin: 1.5cm; }` và chống ngắt đôi khối công thức/code.
- **Toàn màn hình (Fullwidth Focus Mode)**: Mở rộng 100% chiều ngang màn hình để đọc duyệt tiện lợi.

---

## 🏗️ Cấu Trúc Thư Mục Dự Án

```
Translates-documents/
├── src/
│   ├── config.ts                     # Cấu hình môi trường (.env)
│   ├── core/
│   │   ├── interfaces.ts             # Định nghĩa Types & Interfaces
│   │   ├── prompts.ts                # Prompt Rules theo chuẩn học thuật & phong cách
│   │   ├── cache.ts                  # Bộ nhớ đệm SHA-256 lưu tạm token
│   │   ├── openai-service.ts         # Client gọi OpenAI/DeepSeek API (Stream + Token Callback)
│   │   ├── engine.ts                 # Điều phối phân đoạn, concurrency và unmasking
│   │   └── adapters/
│   │       ├── registry.ts           # Quản lý danh sách Adapter theo định dạng file
│   │       ├── markdown.adapter.ts   # Adapter xử lý Markdown, Frontmatter, Code, Math
│   │       ├── json.adapter.ts       # Adapter xử lý JSON cấu trúc cây
│   │       └── text.adapter.ts       # Adapter xử lý Plain Text
│   ├── server/
│   │   └── index.ts                  # Express HTTP Server & SSE Streaming Endpoint
│   └── tests/
│       └── adapters.test.ts          # Bộ kiểm thử tự động (Unit Tests)
├── public/
│   ├── index.html                    # Giao diện Tailwind CSS, KaTeX, FontAwesome
│   ├── css/
│   │   └── style.css                 # Typography động, KaTeX, Code Theme, Print Stylesheet
│   └── js/
│       └── app.js                    # Logic client, SSE stream, KaTeX parser, TOC, Sync editor
├── .env.example                      # File mẫu cấu hình biến môi trường
├── package.json                      # Quản lý scripts và dependencies
└── tsconfig.json                     # Cấu hình TypeScript
```

---

## 🛠️ Cài Đặt & Cấu Hình

### 1. Yêu cầu hệ thống
- **Node.js**: Phiên bản `>= 18.0.0` (Khuyến nghị Node.js 20 hoặc 22).
- **npm** hoặc **yarn / pnpm**.

### 2. Cài đặt Dependencies
```bash
git clone <repository-url>
cd Translates-documents
npm install
```

### 3. Cấu hình file `.env`
Tạo file `.env` tại thư mục gốc của dự án:
```env
PORT=3000

# API Key của nhà cung cấp LLM (OpenAI hoặc DeepSeek)
OPENAI_API_KEY=sk-your-api-key-here

# Base URL API (Hỗ trợ DeepSeek, OpenAI hoặc bên thứ ba)
# DeepSeek: https://api.deepseek.com
# OpenAI:   https://api.openai.com/v1
OPENAI_BASE_URL=https://api.deepseek.com

# Model AI (Khuyến nghị dùng deepseek-chat hoặc gpt-4o-mini để có tốc độ stream nhanh nhất)
OPENAI_MODEL=deepseek-chat

# Số luồng dịch song song đồng thời (Concurrency)
TRANSLATION_CONCURRENCY=3

# Kích thước tối đa mỗi phân đoạn (ký tự)
MAX_CHUNK_SIZE=1200
```

---

## 🚀 Khởi Chạy Ứng Dụng

### Chế độ Development (Khuyến nghị)
Chạy server với tính năng auto-reload khi thay đổi code:
```bash
npm run dev
```
Truy cập giao diện tại: **`http://localhost:3000`**

### Chế độ Production Build
Biên dịch mã nguồn TypeScript và khởi chạy server production:
```bash
npm run build
npm start
```

### Chạy Kiểm Thử Tự Động (Unit Tests)
```bash
npm test
```

---

## 📡 API Endpoints

### 1. Stream Translation (`POST /api/translate-stream`)
Endpoint nhận nội dung văn bản và truyền về luồng sự kiện Server-Sent Events (SSE):
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "content": "# Research Paper Title\n\n$$\\sigma(z) = \\frac{1}{1 + e^{-z}}$$",
    "filename": "paper.md",
    "options": {
      "sourceLang": "en",
      "targetLang": "vi",
      "style": "research",
      "enableCache": true
    }
  }
  ```
- **SSE Events**:
  - `event: progress`: Trạng thái tiến độ phân tích và tỷ lệ % hoàn thành.
  - `event: token`: Từng token từ khóa được sinh ra theo thời gian thực.
  - `event: complete`: Trả về toàn bộ nội dung tài liệu đã được khôi phục 100% cấu trúc gốc.

### 2. Tải File Lên (`POST /api/upload`)
Tải file `.md`, `.json`, `.txt` lên để đọc nội dung:
- **Multipart form data**: `file`

### 3. Bộ Nhớ Cache (`GET /api/cache/stats`, `POST /api/cache/clear`)
Kiểm tra số lượng cache hits, lượng token tiết kiệm được hoặc xóa cache.

---

## 📄 Bản Quyền & Giấy Phép
Dự án được phân phối dưới giấy phép **ISC License**. Bạn có thể tự do phát triển, tùy biến và tích hợp vào các dự án cá nhân hoặc thương mại.
