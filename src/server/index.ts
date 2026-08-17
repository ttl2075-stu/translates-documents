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
import { defaultJobManager } from '../core/jobs/job-manager.js';
import { defaultMailerService } from '../core/mailer.js';
import { defaultFormatReviewer } from '../core/format-reviewer.js';
import { defaultSubscriptionService } from '../core/subscription/subscription-service.js';

// Route Handlers
import { authRouter } from './routes/auth-routes.js';
import { planRouter } from './routes/plan-routes.js';
import { webhookRouter } from './routes/webhook-routes.js';
import { adminRouter } from './routes/admin-routes.js';
import { seoRouter } from './routes/seo-routes.js';
import { optionalAuth, requireAuth, AuthenticatedRequest } from '../core/auth/auth-middleware.js';

import { initPrismaDatabase } from '../core/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../../public');

// Initialize Prisma MySQL Database & Seed
try {
  await initPrismaDatabase();
  console.log(`🐬 Đã khởi tạo và kết nối thành công tới Prisma MySQL Database: ${config.dbName}`);
} catch (err: any) {
  console.error(`❌ Lỗi kết nối Prisma MySQL Database:`, err.message);
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB limit
});

// Middleware
app.use(cors());

// SePay Webhook MUST receive raw body for HMAC signature verification
app.use('/api/webhooks/sepay', express.raw({ type: '*/*' }));
app.use('/api/webhooks', webhookRouter);

// General JSON & URL-encoded parsing for standard API endpoints
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

// SEO & Sitemap Routes
app.use(seoRouter);

// Static files
app.use(express.static(publicDir));

// Explicit route for Studio Workspace
app.get('/app', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Landing Page alias
app.get('/landing', (_req, res) => {
  res.sendFile(path.join(publicDir, 'landing.html'));
});

// Root: Serve Landing page by default for optimal SEO conversion
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'landing.html'));
});

// Dedicated Admin Portal
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// Mount Feature Routers
app.use('/api/auth', authRouter);
app.use('/api/plans', planRouter);
app.use('/api/admin', adminRouter);

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
    const isDocx = filename.toLowerCase().endsWith('.docx');
    const content = isDocx ? req.file.buffer.toString('base64') : req.file.buffer.toString('utf-8');
    const adapter = defaultRegistry.getAdapterByFilename(filename);

    res.json({
      filename,
      size: req.file.size,
      adapterId: adapter.id,
      adapterName: adapter.name,
      content,
      isBinary: isDocx,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Direct Translation API
app.post('/api/translate', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { content, filename = 'document.md', adapterId, options } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Nội dung tài liệu cần dịch không được để trống.' });
    }

    // Quota check for logged-in users
    if (req.subscription) {
      const sub = req.subscription;
      const remaining = Math.max(0, sub.charLimitMonthly - sub.charsUsedMonth);
      if (sub.planId !== 'enterprise' && content.length > remaining) {
        return res.status(403).json({
          error: `Tài liệu (${content.length.toLocaleString()} ký tự) vượt quá hạn mức còn lại (${remaining.toLocaleString()} ký tự). Vui lòng nâng cấp gói cước.`,
        });
      }
    }

    const result = await defaultEngine.translateDocument(content, {
      filename,
      adapterId,
      options: options as TranslationOptions,
    });

    if (req.user) {
      defaultSubscriptionService.recordUsage(req.user.id, result.totalCharacters || content.length);
    }

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7.1. Targeted Text Refinement / Prompt Edit API
app.post('/api/refine', async (req, res) => {
  try {
    const { selectedText, instruction, contextBefore, contextAfter, options, apiOverride } = req.body;

    if (!selectedText || typeof selectedText !== 'string' || selectedText.trim().length === 0) {
      return res.status(400).json({ error: 'Nội dung bôi chọn không được để trống.' });
    }

    if (!instruction || typeof instruction !== 'string' || instruction.trim().length === 0) {
      return res.status(400).json({ error: 'Yêu cầu prompt chỉnh sửa không được để trống.' });
    }

    const refinedText = await defaultOpenAIService.refineText(
      {
        selectedText,
        instruction,
        contextBefore: contextBefore || '',
        contextAfter: contextAfter || '',
        sourceLang: options?.sourceLang || 'auto',
        targetLang: options?.targetLang || 'vi',
        style: options?.style || 'technical',
      },
      apiOverride
    );

    res.json({
      success: true,
      refinedText,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7.2. Standalone Format Reviewer & Linter API
app.post('/api/review-format', async (req, res) => {
  try {
    const { content, options, useAIAgent = true, apiOverride } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Nội dung tài liệu không được để trống.' });
    }

    const result = await defaultFormatReviewer.reviewAndFixFormatting(
      content,
      options || { sourceLang: 'auto', targetLang: 'vi', style: 'technical' },
      Boolean(useAIAgent),
      apiOverride
    );

    res.json({
      success: true,
      formattedText: result.text,
      fixed: result.fixed,
      message: result.message,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Resilient SSE Streaming Translation API
app.post('/api/translate-stream', optionalAuth, async (req: AuthenticatedRequest, res) => {
  const { content, filename = 'document.md', adapterId, options } = req.body;

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'Nội dung tài liệu không được để trống.' });
  }

  // Quota check
  if (req.subscription) {
    const sub = req.subscription;
    const remaining = Math.max(0, sub.charLimitMonthly - sub.charsUsedMonth);
    if (sub.planId !== 'enterprise' && content.length > remaining) {
      return res.status(403).json({
        error: `Tài liệu vượt quá hạn mức còn lại trong tháng (${remaining.toLocaleString()} ký tự). Vui lòng nâng cấp gói cước.`,
      });
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
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

  sendEvent('progress', {
    currentChunk: 0,
    totalChunks: 1,
    percent: 5,
    status: 'parsing',
    message: 'Đang kết nối backend và phân tích cấu trúc tài liệu...',
  });

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

    if (req.user) {
      defaultSubscriptionService.recordUsage(req.user.id, result.totalCharacters || content.length);
    }

    sendEvent('complete', result);
  } catch (error: any) {
    sendEvent('error', { message: error.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// 9. Multi-user Background Jobs Management Endpoints

// 9.1. Create & Start Background Translation Job
app.post('/api/jobs', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { content, filename = 'document.md', adapterId, options, recipientEmail, apiOverride } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Nội dung tài liệu không được để trống.' });
    }

    // Quota check
    if (req.subscription) {
      const sub = req.subscription;
      const remaining = Math.max(0, sub.charLimitMonthly - sub.charsUsedMonth);
      if (sub.planId !== 'enterprise' && content.length > remaining) {
        return res.status(403).json({
          error: `Tài liệu (${content.length.toLocaleString()} ký tự) vượt quá hạn mức còn lại (${remaining.toLocaleString()} ký tự). Vui lòng nâng cấp gói cước.`,
        });
      }
    }

    const userId = req.user ? req.user.id : 'usr_guest';
    const emailToUse = recipientEmail || (req.user ? req.user.email : undefined);

    const job = defaultJobManager.createJob({
      userId,
      rawContent: content,
      filename,
      adapterId,
      options: options as TranslationOptions,
      recipientEmail: emailToUse,
      apiOverride,
    });

    // Start asynchronously in background
    defaultJobManager.startJob(job.id, apiOverride);

    res.json({
      success: true,
      message: 'Tiến trình dịch nền đã được khởi tạo thành công!',
      job,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 9.2. List Jobs (User-scoped or Admin-wide)
app.get('/api/jobs', optionalAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user ? req.user.id : undefined;
  const isAdmin = req.user?.role === 'admin';
  const jobs = defaultJobManager.getAllJobs(userId, isAdmin);
  res.json({ jobs });
});

// 9.3. Get Job Details
app.get('/api/jobs/:id', optionalAuth, (req: AuthenticatedRequest, res) => {
  const job = defaultJobManager.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy tiến trình.' });
  }

  if (req.user && req.user.role !== 'admin' && job.userId !== 'usr_guest' && job.userId !== req.user.id) {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập tiến trình này.' });
  }

  res.json({ job });
});

// 9.4. Stream Job Live Progress via SSE
app.get('/api/jobs/:id/stream', (req, res) => {
  const job = defaultJobManager.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy tiến trình.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  const sendEvent = (event: string, data: any) => {
    if (!res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    }
  };

  sendEvent('status', { status: job.status, job });
  sendEvent('progress', job.progress);

  if (job.status === 'completed') {
    sendEvent('complete', { jobId: job.id, result: { translatedContent: job.translatedContent } });
    return res.end();
  }

  if (job.status === 'aborted' || job.status === 'failed') {
    sendEvent('error', { jobId: job.id, message: job.error || 'Tiến trình đã kết thúc.' });
    return res.end();
  }

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(':keepalive\n\n');
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    }
  }, 10000);

  const unsubscribe = defaultJobManager.subscribe(job.id, (event, data) => {
    sendEvent(event, data);
    if (event === 'complete' || event === 'error' || event === 'abort') {
      clearInterval(heartbeat);
      res.end();
    }
  });

  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// 9.5. Abort Job
app.post('/api/jobs/:id/abort', (req, res) => {
  const success = defaultJobManager.abortJob(req.params.id);
  if (success) {
    res.json({ success: true, message: 'Đã hủy tiến trình thành công!' });
  } else {
    res.status(400).json({ success: false, message: 'Không thể hủy tiến trình hoặc tiến trình không tồn tại.' });
  }
});

// 9.6. Delete Job
app.delete('/api/jobs/:id', (req, res) => {
  const success = defaultJobManager.deleteJob(req.params.id);
  if (success) {
    res.json({ success: true, message: 'Đã xóa tiến trình thành công!' });
  } else {
    res.status(404).json({ success: false, message: 'Không tìm thấy tiến trình.' });
  }
});

// 9.7. Download Translated File
app.get('/api/jobs/:id/download', (req, res) => {
  const job = defaultJobManager.getJob(req.params.id);
  if (!job || !job.translatedContent) {
    return res.status(404).json({ error: 'Không tìm thấy file kết quả.' });
  }

  const targetLang = job.options.targetLang || 'vi';
  const lastDot = job.filename.lastIndexOf('.');
  const outName =
    lastDot !== -1
      ? `${job.filename.substring(0, lastDot)}_${targetLang}${job.filename.substring(lastDot)}`
      : `${job.filename}_${targetLang}.md`;

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outName)}"`);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(job.translatedContent);
});

// 10. SMTP Mail Server Status
app.get('/api/email/status', (_req, res) => {
  res.json({
    configured: Boolean(config.smtpHost && config.smtpHost.trim().length > 0),
    smtpHost: config.smtpHost ? config.smtpHost : undefined,
    smtpFrom: config.smtpFrom,
  });
});

// Global Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server Unhandled Error:', err);
  res.status(500).json({ error: err.message || 'Lỗi máy chủ nội bộ' });
});

// Start Server
const server = app.listen(config.port, () => {
  console.log(`====================================================`);
  console.log(`🚀 AI Document Translator & SaaS Platform đang chạy tại:`);
  console.log(`👉 http://localhost:${config.port}`);
  console.log(`🌐 Landing Page: http://localhost:${config.port}/`);
  console.log(`💻 Studio App: http://localhost:${config.port}/app`);
  console.log(`⚙️  API Base URL: ${config.openaiBaseUrl}`);
  console.log(`🤖 Model: ${config.openaiModel}`);
  console.log(`💳 SePay Webhook: http://localhost:${config.port}/api/webhooks/sepay`);
  console.log(`====================================================`);
});

export { app, server };
