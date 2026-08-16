import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobManager } from '../core/jobs/job-manager.js';
import { MailerService } from '../core/mailer.js';

test('JobManager - Creates, tracks and aborts background translation jobs', async () => {
  const manager = new JobManager();

  const job = manager.createJob({
    rawContent: '# Test Heading\n\nThis is a sample paragraph.',
    filename: 'test_job.md',
    options: {
      sourceLang: 'en',
      targetLang: 'vi',
      style: 'technical',
    },
    recipientEmail: 'test@example.com',
  });

  assert.ok(job.id && job.id.length === 36, 'Job ID should be UUIDv7');
  assert.equal(job.status, 'pending');
  assert.equal(job.filename, 'test_job.md');
  assert.equal(job.recipientEmail, 'test@example.com');

  // Verify getJob and getAllJobs
  const retrieved = manager.getJob(job.id);
  assert.ok(retrieved);
  assert.equal(retrieved.id, job.id);

  const all = manager.getAllJobs();
  assert.ok(all.some((j) => j.id === job.id));

  // Abort pending / running job
  const aborted = manager.abortJob(job.id);
  assert.equal(aborted, true);
  assert.equal(manager.getJob(job.id)?.status, 'aborted');

  // Delete job
  const deleted = manager.deleteJob(job.id);
  assert.equal(deleted, true);
  assert.equal(manager.getJob(job.id), undefined);
});

test('JobManager - Subscribes and receives event callbacks', async () => {
  const manager = new JobManager();

  const job = manager.createJob({
    rawContent: 'Sample text to translate',
    filename: 'sample.txt',
    options: {
      sourceLang: 'en',
      targetLang: 'vi',
      style: 'natural',
    },
  });

  const events: string[] = [];
  const unsubscribe = manager.subscribe(job.id, (event) => {
    events.push(event);
  });

  // Trigger abort to test event emission
  manager.abortJob(job.id);
  assert.ok(events.includes('abort'));

  unsubscribe();
});

test('MailerService - Validates recipient email and SMTP config', async () => {
  const mailer = new MailerService();

  // Test invalid recipient email
  const res = await mailer.sendDocumentEmail({
    recipientEmail: 'invalid-email',
    filename: 'doc_vi.md',
    translatedContent: 'Bản dịch',
    stats: {
      durationMs: 1200,
      totalChunks: 1,
    },
  });

  assert.equal(res.success, false);
  assert.ok(res.error?.includes('không hợp lệ'));

  // Test connection error on empty host
  const testConn = await mailer.testConnection({
    host: '',
    port: 587,
  });
  assert.equal(testConn.success, false);
});
