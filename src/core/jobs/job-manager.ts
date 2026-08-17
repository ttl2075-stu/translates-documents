import { defaultEngine, TranslationEngine } from '../engine.js';
import { defaultRegistry, AdapterRegistry } from '../adapters/registry.js';
import { TranslationOptions, TranslationProgress } from '../interfaces.js';
import { defaultMailerService, MailerService } from '../mailer.js';
import { prisma, uuidv7 } from '../db/prisma.js';
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
      const rows = await prisma.job.findMany({
        take: 200,
        orderBy: { createdAt: 'desc' },
      });

      for (const r of rows) {
        let options: any = {};
        try {
          options = JSON.parse(r.optionsJson || '{}');
        } catch {}

        const job: TranslationJob = {
          id: r.id,
          userId: r.userId,
          filename: r.filename,
          adapterId: r.adapterId,
          adapterName: r.adapterName,
          status: r.status as any,
          progress: {
            percent: r.progressPercent || (r.status === 'completed' ? 100 : 0),
            currentChunk: r.totalChunks || 0,
            totalChunks: r.totalChunks || 1,
            status: r.status as any,
            message: r.errorMessage || (r.status === 'completed' ? 'Hoàn tất' : ''),
          },
          options,
          recipientEmail: r.recipientEmail || undefined,
          emailSent: r.emailSent,
          rawContent: r.rawContent || '',
          translatedContent: r.translatedContent || undefined,
          totalChunks: r.totalChunks,
          cachedChunks: r.cachedChunks,
          durationMs: r.durationMs,
          createdAt: Number(r.createdAt),
          completedAt: r.completedAt ? Number(r.completedAt) : undefined,
          error: r.errorMessage || undefined,
        };
        this.jobs.set(job.id, job);
      }
    } catch (err: any) {
      console.error('Không thể load jobs từ Prisma:', err.message);
    }
  }

  public async saveJobToDb(job: TranslationJob) {
    try {
      await prisma.job.upsert({
        where: { id: job.id },
        create: {
          id: job.id,
          userId: job.userId,
          filename: job.filename,
          adapterId: job.adapterId,
          adapterName: job.adapterName,
          status: job.status,
          progressPercent: job.progress.percent,
          optionsJson: JSON.stringify(job.options),
          recipientEmail: job.recipientEmail || null,
          emailSent: Boolean(job.emailSent),
          totalChunks: job.totalChunks,
          cachedChunks: job.cachedChunks,
          durationMs: job.durationMs,
          rawContent: job.rawContent,
          translatedContent: job.translatedContent || null,
          errorMessage: job.error || null,
          createdAt: BigInt(job.createdAt),
          completedAt: job.completedAt ? BigInt(job.completedAt) : null,
        },
        update: {
          status: job.status,
          progressPercent: job.progress.percent,
          emailSent: Boolean(job.emailSent),
          totalChunks: job.totalChunks,
          cachedChunks: job.cachedChunks,
          durationMs: job.durationMs,
          translatedContent: job.translatedContent || null,
          errorMessage: job.error || null,
          completedAt: job.completedAt ? BigInt(job.completedAt) : null,
        },
      });
    } catch (err: any) {
      console.error('Lỗi lưu job vào Prisma:', err.message);
    }
  }

  createJob(createOptions: CreateJobOptions): TranslationJob {
    const { userId = 'usr_guest', rawContent, filename = 'document.md', adapterId, options, recipientEmail } = createOptions;

    const adapter = adapterId
      ? this.registry.getAdapter(adapterId) || this.registry.getAdapterByFilename(filename)
      : this.registry.getAdapterByFilename(filename);

    if (!adapter) {
      throw new Error(`Không tìm thấy Adapter xử lý định dạng cho file: ${filename}`);
    }

    const id = uuidv7();

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
          await defaultSubscriptionService.recordUsage(job.userId, result.totalCharacters || job.rawContent.length);
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
    prisma.job.delete({ where: { id } }).catch(() => {});
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
