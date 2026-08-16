import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, updateRuntimeConfig } from '../config.js';
import { defaultRegistry } from '../core/adapters/registry.js';
import { defaultEngine } from '../core/engine.js';
import { defaultOpenAIService } from '../core/openai-service.js';
import { defaultTranslationCache } from '../core/cache.js';
import { TranslationOptions, TranslationProgress } from '../core/interfaces.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../../public');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB limit
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(publicDir));

// 1. Get current backend configuration
app.get('/api/config', (_req, res) => {
  res.json({
    openaiBaseUrl: config.openaiBaseUrl,
    openaiModel: config.openaiModel,
    concurrency: config.concurrency,
    maxChunkSize: config.maxChunkSize,
    hasApiKey: Boolean(config.openaiApiKey && config.openaiApiKey.trim().length > 0),
    maskedApiKey: config.openaiApiKey
      ? `${config.openaiApiKey.slice(0, 4)}...${config.openaiApiKey.slice(-4)}`
      : '',
  });
});

// 2. Update runtime backend configuration
app.post('/api/config', (req, res) => {
  try {
    const { openaiApiKey, openaiBaseUrl, openaiModel, concurrency, maxChunkSize } = req.body;
    updateRuntimeConfig({
      openaiApiKey,
      openaiBaseUrl,
      openaiModel,
      concurrency: concurrency ? parseInt(concurrency, 10) : undefined,
      maxChunkSize: maxChunkSize ? parseInt(maxChunkSize, 10) : undefined,
    });

    res.json({
      success: true,
      message: 'Cập nhật cấu hình thành công!',
      config: {
        openaiBaseUrl: config.openaiBaseUrl,
        openaiModel: config.openaiModel,
        concurrency: config.concurrency,
        hasApiKey: Boolean(config.openaiApiKey),
      },
    });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 3. Test LLM API connection
app.post('/api/test-connection', async (req, res) => {
  const { apiKey, baseUrl, model } = req.body;
  const result = await defaultOpenAIService.testConnection({ apiKey, baseUrl, model });
  res.json(result);
});

// 4. Cache statistics & management
app.get('/api/cache/stats', (_req, res) => {
  res.json(defaultTranslationCache.getStats());
});

app.post('/api/cache/clear', (_req, res) => {
  defaultTranslationCache.clear();
  res.json({ success: true, message: 'Đã xóa toàn bộ bộ nhớ đệm (Cache) thành công!' });
});

// 5. Get supported document formats
app.get('/api/formats', (_req, res) => {
  const formats = defaultRegistry.getAllAdapters();
  res.json({ formats });
});

// 6. Upload file endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Không tìm thấy file tải lên.' });
    }

    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const content = req.file.buffer.toString('utf-8');
    const adapter = defaultRegistry.getAdapterByFilename(filename);

    res.json({
      filename,
      size: req.file.size,
      adapterId: adapter.id,
      adapterName: adapter.name,
      content,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Direct Translation API
app.post('/api/translate', async (req, res) => {
  try {
    const { content, filename = 'document.md', adapterId, options } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Nội dung tài liệu cần dịch không được để trống.' });
    }

    const result = await defaultEngine.translateDocument(content, {
      filename,
      adapterId,
      options: options as TranslationOptions,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Resilient SSE Streaming Translation API with Keep-alive & Abort handling
app.post('/api/translate-stream', async (req, res) => {
  const { content, filename = 'document.md', adapterId, options } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Nội dung tài liệu không được để trống.' });
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no', // Disable proxy buffering
    Connection: 'keep-alive',
  });
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  let isAborted = false;
  res.on('close', () => {
    if (!res.writableFinished) {
      isAborted = true;
    }
  });

  const sendEvent = (event: string, data: any) => {
    if (!isAborted && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    }
  };

  // Send initial ping event immediately
  sendEvent('progress', {
    currentChunk: 0,
    totalChunks: 1,
    percent: 5,
    status: 'parsing',
    message: 'Đang kết nối backend và phân tích cấu trúc tài liệu...',
  });

  // Keep-alive heartbeat interval
  const heartbeat = setInterval(() => {
    if (!isAborted && !res.writableEnded) {
      res.write(':keepalive\n\n');
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    }
  }, 10000);

  try {
    const result = await defaultEngine.translateDocument(content, {
      filename,
      adapterId,
      options: options as TranslationOptions,
      onProgress: (progress: TranslationProgress) => {
        sendEvent('progress', progress);
      },
      onToken: (token: string, chunkId: number) => {
        sendEvent('token', { token, chunkId });
      },
    });

    sendEvent('complete', result);
  } catch (error: any) {
    sendEvent('error', { message: error.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// Global Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server Unhandled Error:', err);
  res.status(500).json({ error: err.message || 'Lỗi máy chủ nội bộ' });
});

// Start Server
const server = app.listen(config.port, () => {
  console.log(`====================================================`);
  console.log(`🚀 AI Document Translator Server đang chạy tại:`);
  console.log(`👉 http://localhost:${config.port}`);
  console.log(`⚙️  API Base URL: ${config.openaiBaseUrl}`);
  console.log(`🤖 Model: ${config.openaiModel}`);
  console.log(`🔑 API Key: ${config.openaiApiKey ? 'Đã cấu hình' : 'Chưa thiết lập'}`);
  console.log(`====================================================`);
});

export { app, server };
