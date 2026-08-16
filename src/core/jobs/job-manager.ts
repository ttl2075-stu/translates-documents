import { defaultEngine, TranslationEngine } from '../engine.js';
import { defaultRegistry, AdapterRegistry } from '../adapters/registry.js';
import { TranslationOptions, TranslationProgress } from '../interfaces.js';
import { defaultMailerService, MailerService } from '../mailer.js';
import { query, execute } from '../db/database.js';
import { defaultSubscriptionService } from '../subscription/subscription-service.js';

export interface TranslationJob {
  id: string;
  userId: string;
  filename: string;
  adapterId: string;
  adapterName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  progress: {
    percent: number;
    currentChunk: number;
    totalChunks: number;
    status: 'parsing' | 'translating' | 'assembling' | 'completed' | 'error' | 'aborted';
    message?: string;
    chunkPreview?: string;
  };
  options: TranslationOptions;
  recipientEmail?: string;
  emailSent?: boolean;
  emailError?: string;
  rawContent: string;
  translatedContent?: string;
  totalChunks: number;
  cachedChunks: number;
  durationMs: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface CreateJobOptions {
  userId?: string;
  rawContent: string;
  filename?: string;
  adapterId?: string;
  options: TranslationOptions;
  recipientEmail?: string;
  apiOverride?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
}

export type JobEventListener = (event: string, data: any) => void;

export class JobManager {
  private jobs: Map<string, TranslationJob> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private listeners: Map<string, Set<JobEventListener>> = new Map();

  constructor(
    private engine: TranslationEngine = defaultEngine,
    private registry: AdapterRegistry = defaultRegistry,
    private mailer: MailerService = defaultMailerService
  ) {
    this.loadJobsFromDb().catch(() => {});
  }

  public async loadJobsFromDb() {
    try {
      const rows = await query<any>('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200');
      for (const r of rows) {
        let options: any = {};
        try {
          options = JSON.parse(r.options_json || '{}');
        } catch {}

        const job: TranslationJob = {
          id: r.id,
          userId: r.user_id,
          filename: r.filename,
          adapterId: r.adapter_id,
          adapterName: r.adapter_name,
          status: r.status as any,
          progress: {
            percent: Number(r.progress_percent) || (r.status === 'completed' ? 100 : 0),
            currentChunk: Number(r.total_chunks) || 0,
            totalChunks: Number(r.total_chunks) || 1,
            status: r.status as any,
            message: r.error_message || (r.status === 'completed' ? 'Hoàn tất' : ''),
          },
          options,
          recipientEmail: r.recipient_email,
          emailSent: Boolean(r.email_sent),
          rawContent: r.raw_content || '',
          translatedContent: r.translated_content || '',
          totalChunks: Number(r.total_chunks) || 0,
          cachedChunks: Number(r.cached_chunks) || 0,
          durationMs: Number(r.duration_ms) || 0,
          createdAt: Number(r.created_at),
          completedAt: r.completed_at ? Number(r.completed_at) : undefined,
          error: r.error_message,
        };
        this.jobs.set(job.id, job);
      }
    } catch (err: any) {
      console.error('Không thể load jobs từ MySQL:', err.message);
    }
  }

  public async saveJobToDb(job: TranslationJob) {
    try {
      await execute(`
        INSERT INTO jobs 
        (id, user_id, filename, adapter_id, adapter_name, status, progress_percent, options_json, 
         recipient_email, email_sent, total_chunks, cached_chunks, duration_ms, raw_content, translated_content, error_message, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          progress_percent = VALUES(progress_percent),
          email_sent = VALUES(email_sent),
          total_chunks = VALUES(total_chunks),
          cached_chunks = VALUES(cached_chunks),
          duration_ms = VALUES(duration_ms),
          translated_content = VALUES(translated_content),
          error_message = VALUES(error_message),
          completed_at = VALUES(completed_at)
      `, [
        job.id,
        job.userId,
        job.filename,
        job.adapterId,
        job.adapterName,
        job.status,
        job.progress.percent,
        JSON.stringify(job.options),
        job.recipientEmail || null,
        job.emailSent ? 1 : 0,
        job.totalChunks,
        job.cachedChunks,
        job.durationMs,
        job.rawContent,
        job.translatedContent || null,
        job.error || null,
        job.createdAt,
        job.completedAt || null,
      ]);
    } catch (err: any) {
      console.error('Lỗi lưu job vào MySQL:', err.message);
    }
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  createJob(createOptions: CreateJobOptions): TranslationJob {
    const { userId = 'usr_guest', rawContent, filename = 'document.md', adapterId, options, recipientEmail } = createOptions;

    const adapter = adapterId
      ? this.registry.getAdapter(adapterId) || this.registry.getAdapterByFilename(filename)
      : this.registry.getAdapterByFilename(filename);

    if (!adapter) {
      throw new Error(`Không tìm thấy Adapter xử lý định dạng cho file: ${filename}`);
    }

    const id = this.generateJobId();

    const job: TranslationJob = {
      id,
      userId,
      filename,
      adapterId: adapter.id,
      adapterName: adapter.name,
      status: 'pending',
      progress: {
        percent: 0,
        currentChunk: 0,
        totalChunks: 1,
        status: 'parsing',
        message: 'Đang xếp hàng tiến trình...',
      },
      options,
      recipientEmail: recipientEmail && recipientEmail.trim().length > 0 ? recipientEmail.trim() : undefined,
      rawContent,
      totalChunks: 0,
      cachedChunks: 0,
      durationMs: 0,
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);
    this.saveJobToDb(job).catch(() => {});
    return job;
  }

  startJob(id: string, apiOverride?: { apiKey?: string; baseUrl?: string; model?: string }): TranslationJob {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Không tìm thấy Job có ID: ${id}`);
    }

    if (job.status === 'running') {
      return job;
    }

    const abortController = new AbortController();
    this.abortControllers.set(id, abortController);

    job.status = 'running';
    job.startedAt = Date.now();
    this.saveJobToDb(job).catch(() => {});
    this.emitEvent(id, 'status', { status: 'running', job });

    (async () => {
      try {
        const result = await this.engine.translateDocument(job.rawContent, {
          filename: job.filename,
          adapterId: job.adapterId,
          options: job.options,
          apiOverride,
          onProgress: (prog: TranslationProgress) => {
            if (abortController.signal.aborted) return;
            job.progress = {
              percent: prog.percent,
              currentChunk: prog.currentChunk,
              totalChunks: prog.totalChunks,
              status: prog.status as any,
              message: prog.message,
              chunkPreview: prog.chunkPreview,
            };
            job.totalChunks = prog.totalChunks;
            this.emitEvent(id, 'progress', prog);
          },
          onToken: (token: string, chunkId: number) => {
            if (abortController.signal.aborted) return;
            this.emitEvent(id, 'token', { token, chunkId });
          },
        });

        if (abortController.signal.aborted) {
          return;
        }

        job.status = 'completed';
        job.translatedContent = result.translatedContent;
        job.totalChunks = result.totalChunks;
        job.cachedChunks = result.cachedChunks;
        job.durationMs = result.durationMs;
        job.completedAt = Date.now();
        job.progress = {
          percent: 100,
          currentChunk: result.totalChunks,
          totalChunks: result.totalChunks,
          status: 'completed',
          message: `Hoàn tất trong ${(result.durationMs / 1000).toFixed(1)}s!`,
        };

        if (job.userId && job.userId !== 'usr_guest') {
          await defaultSubscriptionService.recordUsage(job.userId, job.rawContent.length);
        }

        await this.saveJobToDb(job);
        this.emitEvent(id, 'complete', { jobId: id, result });

        if (job.recipientEmail && job.translatedContent) {
          const targetLang = job.options.targetLang || 'vi';
          const lastDot = job.filename.lastIndexOf('.');
          const outName =
            lastDot !== -1
              ? `${job.filename.substring(0, lastDot)}_${targetLang}${job.filename.substring(lastDot)}`
              : `${job.filename}_${targetLang}.md`;

          const emailRes = await this.mailer.sendDocumentEmail({
            recipientEmail: job.recipientEmail,
            filename: outName,
            translatedContent: job.translatedContent,
            sourceLang: job.options.sourceLang,
            targetLang: job.options.targetLang,
            stats: {
              durationMs: job.durationMs,
              totalChunks: job.totalChunks,
              cachedChunks: job.cachedChunks,
            },
          });

          job.emailSent = emailRes.success;
          if (!emailRes.success) {
            job.emailError = emailRes.error;
          }
          await this.saveJobToDb(job);
        }
      } catch (err: any) {
        if (abortController.signal.aborted) {
          return;
        }

        job.status = 'failed';
        job.error = err.message;
        job.completedAt = Date.now();
        job.progress.status = 'error';
        job.progress.message = `Lỗi: ${err.message}`;

        await this.saveJobToDb(job);
        this.emitEvent(id, 'error', { jobId: id, error: err.message });
      } finally {
        this.abortControllers.delete(id);
      }
    })();

    return job;
  }

  abortJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }

    if (job.status === 'running' || job.status === 'pending') {
      job.status = 'aborted';
      job.completedAt = Date.now();
      job.progress = {
        percent: job.progress.percent,
        currentChunk: job.progress.currentChunk,
        totalChunks: job.progress.totalChunks,
        status: 'aborted',
        message: 'Tiến trình đã bị người dùng hủy bỏ.',
      };

      this.saveJobToDb(job).catch(() => {});
      this.emitEvent(id, 'abort', {
        jobId: id,
        message: 'Tiến trình đã bị hủy thành công.',
      });
      return true;
    }

    return false;
  }

  getJob(id: string): TranslationJob | undefined {
    return this.jobs.get(id);
  }

  getAllJobs(userId?: string, isAdmin?: boolean): TranslationJob[] {
    const all = Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
    if (isAdmin) {
      return all;
    }
    if (userId) {
      return all.filter((j) => j.userId === userId);
    }
    return all;
  }

  deleteJob(id: string): boolean {
    this.abortJob(id);
    this.listeners.delete(id);
    execute('DELETE FROM jobs WHERE id = ?', [id]).catch(() => {});
    return this.jobs.delete(id);
  }

  subscribe(jobId: string, listener: JobEventListener): () => void {
    if (!this.listeners.has(jobId)) {
      this.listeners.set(jobId, new Set());
    }
    const set = this.listeners.get(jobId)!;
    set.add(listener);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(jobId);
      }
    };
  }

  private emitEvent(jobId: string, event: string, data: any): void {
    const set = this.listeners.get(jobId);
    if (set) {
      for (const listener of set) {
        try {
          listener(event, data);
        } catch (_) {}
      }
    }
  }
}

export const defaultJobManager = new JobManager();
