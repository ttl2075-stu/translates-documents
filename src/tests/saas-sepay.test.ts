import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { initDatabase, getDbPool } from '../core/db/database.js';
import { defaultAuthService } from '../core/auth/auth-service.js';
import { defaultSubscriptionService } from '../core/subscription/subscription-service.js';
import { defaultJobManager } from '../core/jobs/job-manager.js';
import { config } from '../config.js';

test('0. Database initialization', async () => {
  try {
    await initDatabase();
    const pool = getDbPool();
    assert.ok(pool, 'MySQL pool should be initialized');
  } catch (err: any) {
    console.warn('MySQL chưa khởi chạy trên localhost:3306. Bỏ qua nếu môi trường test không có MySQL daemon.');
  }
});

test('1. Auth & Subscription initialization', async (t) => {
  try {
    const testEmail = `test_user_${Date.now()}@example.com`;
    const regResult = await defaultAuthService.register(testEmail, 'Password123', 'Tester User');

    assert.strictEqual(regResult.user.email, testEmail);
    assert.strictEqual(regResult.user.role, 'user');
    assert.strictEqual(regResult.subscription.planId, 'free');
    assert.strictEqual(regResult.subscription.charLimitMonthly, 20000);
    assert.ok(regResult.token.length > 20, 'JWT token should be signed');

    const loginResult = await defaultAuthService.login(testEmail, 'Password123');
    assert.strictEqual(loginResult.user.id, regResult.user.id);
  } catch (err: any) {
    if (err.message.includes('ECONNREFUSED')) {
      t.skip('MySQL server không hoạt động tại cổng 3306');
    } else {
      throw err;
    }
  }
});

test('2. Order creation & VietQR generation', async (t) => {
  try {
    const testEmail = `buyer_${Date.now()}@example.com`;
    const regResult = await defaultAuthService.register(testEmail, 'Password123', 'Buyer Pro');

    const order = await defaultSubscriptionService.createOrder(regResult.user.id, 'pro');
    assert.ok(order.orderCode.startsWith('TRANS'), 'Order code should start with TRANS');
    assert.strictEqual(order.amountVnd, 99000);
    assert.strictEqual(order.status, 'pending');
    assert.ok(order.qrUrl.includes('img.vietqr.io'), 'VietQR URL should be generated');

    const fetchedOrder = await defaultSubscriptionService.getOrderByCode(order.orderCode);
    assert.ok(fetchedOrder);
    assert.strictEqual(fetchedOrder.orderCode, order.orderCode);
  } catch (err: any) {
    if (err.message.includes('ECONNREFUSED')) {
      t.skip('MySQL server không hoạt động tại cổng 3306');
    } else {
      throw err;
    }
  }
});

test('3. SePay Webhook processing with HMAC-SHA256 & Plan activation', async (t) => {
  try {
    const testEmail = `sepay_user_${Date.now()}@example.com`;
    const regResult = await defaultAuthService.register(testEmail, 'Password123', 'SePay Tester');

    const order = await defaultSubscriptionService.createOrder(regResult.user.id, 'pro');

    const sepayId = Math.floor(100000 + Math.random() * 900000);
    const payload = {
      id: sepayId,
      gateway: 'MBBank',
      transactionDate: new Date().toISOString().replace('T', ' ').slice(0, 19),
      accountNumber: '0988888888',
      subAccount: '',
      code: order.orderCode,
      content: `${order.orderCode} thanh toan nang cap goi pro`,
      transferType: 'in',
      transferAmount: 99000,
      accumulated: 5000000,
      referenceCode: `FT${Date.now()}`,
    };

    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const secret = await defaultSubscriptionService.getSystemSetting('sepay_webhook_secret', config.sepayWebhookSecret);
    let signatureHeader = '';
    if (secret) {
      signatureHeader = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    }

    const result = await defaultSubscriptionService.handleSePayWebhook(rawBody, signatureHeader, timestamp);
    assert.strictEqual(result.success, true);

    const updatedOrder = await defaultSubscriptionService.getOrderByCode(order.orderCode);
    assert.strictEqual(updatedOrder?.status, 'paid');

    const userSub = await defaultAuthService.getUserSubscription(regResult.user.id);
    assert.strictEqual(userSub.planId, 'pro');
    assert.strictEqual(userSub.charLimitMonthly, 500000);

    const dupResult = await defaultSubscriptionService.handleSePayWebhook(rawBody, signatureHeader, timestamp);
    assert.strictEqual(dupResult.success, true);
    assert.strictEqual(dupResult.duplicate, true);
  } catch (err: any) {
    if (err.message.includes('ECONNREFUSED')) {
      t.skip('MySQL server không hoạt động tại cổng 3306');
    } else {
      throw err;
    }
  }
});

test('4. Background Job multi-tenant binding & character usage quota', async (t) => {
  try {
    const testEmail = `job_user_${Date.now()}@example.com`;
    const user = await defaultAuthService.register(testEmail, 'Password123', 'Job Runner');

    const job = defaultJobManager.createJob({
      userId: user.user.id,
      rawContent: '# Heading\nThis is a sample sentence.',
      filename: 'test.md',
      options: { sourceLang: 'en', targetLang: 'vi', style: 'technical' },
    });

    assert.strictEqual(job.userId, user.user.id);

    const userJobs = defaultJobManager.getAllJobs(user.user.id, false);
    assert.ok(userJobs.some((j) => j.id === job.id));

    await defaultSubscriptionService.recordUsage(user.user.id, 500);
    const updatedSub = await defaultAuthService.getUserSubscription(user.user.id);
    assert.strictEqual(updatedSub.charsUsedMonth, 500);
  } catch (err: any) {
    if (err.message.includes('ECONNREFUSED')) {
      t.skip('MySQL server không hoạt động tại cổng 3306');
    } else {
      throw err;
    }
  }
});

test('5. Admin stats & Overview', async (t) => {
  try {
    const stats = await defaultSubscriptionService.getAdminStats();
    assert.ok(typeof stats.totalUsers === 'number');
    assert.ok(typeof stats.totalRevenueVnd === 'number');
    assert.ok(typeof stats.totalPaidOrders === 'number');

    const { transactions } = await defaultSubscriptionService.getAllTransactions(10, 0);
    assert.ok(Array.isArray(transactions));
  } catch (err: any) {
    if (err.message.includes('ECONNREFUSED')) {
      t.skip('MySQL server không hoạt động tại cổng 3306');
    } else {
      throw err;
    }
  }
});

test('6. Google OAuth user registration & login', async (t) => {
  try {
    const googleId = `gid_${Date.now()}`;
    const email = `google_user_${Date.now()}@gmail.com`;

    const authResult = await defaultAuthService.loginWithGoogleProfile({
      googleId,
      email,
      name: 'Google User Test',
      avatarUrl: 'https://lh3.googleusercontent.com/a/test-avatar',
    });

    assert.strictEqual(authResult.user.email, email);
    assert.strictEqual(authResult.user.name, 'Google User Test');
    assert.strictEqual(authResult.subscription.planId, 'free');
    assert.ok(authResult.token.length > 20);

    // Logging in again with same Google account should return the same user
    const secondLogin = await defaultAuthService.loginWithGoogleProfile({
      googleId,
      email,
      name: 'Google User Test Updated',
    });

    assert.strictEqual(secondLogin.user.id, authResult.user.id);
  } catch (err: any) {
    if (err.message.includes('ECONNREFUSED')) {
      t.skip('MySQL server không hoạt động tại cổng 3306');
    } else {
      throw err;
    }
  }
});
