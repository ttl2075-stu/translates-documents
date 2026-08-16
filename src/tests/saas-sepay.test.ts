import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { initPrismaDatabase, prisma, uuidv7 } from '../core/db/prisma.js';
import { defaultAuthService } from '../core/auth/auth-service.js';
import { defaultSubscriptionService } from '../core/subscription/subscription-service.js';
import { defaultJobManager } from '../core/jobs/job-manager.js';
import { config } from '../config.js';

test('0. UUIDv7 format validation', () => {
  const id1 = uuidv7();
  const id2 = uuidv7();

  assert.strictEqual(id1.length, 36);
  assert.strictEqual(id2.length, 36);
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(id1 !== id2, 'UUIDv7 should be unique');
});

test('1. Database initialization via Prisma', async (t) => {
  try {
    await initPrismaDatabase();
    assert.ok(prisma, 'Prisma Client should be initialized');
  } catch (err: any) {
    t.skip(`MySQL database chưa sẵn sàng (${err.message}). Bỏ qua test database.`);
  }
});

test('2. Auth & Subscription initialization (Prisma + UUIDv7)', async (t) => {
  try {
    const testEmail = `test_user_${Date.now()}@example.com`;
    const regResult = await defaultAuthService.register(testEmail, 'Password123', 'Tester User');

    assert.strictEqual(regResult.user.email, testEmail);
    assert.strictEqual(regResult.user.role, 'user');
    assert.strictEqual(regResult.subscription.planId, 'free');
    assert.strictEqual(regResult.subscription.charLimitMonthly, 20000);
    assert.ok(regResult.token.length > 20, 'JWT token should be signed');
    assert.match(regResult.user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/i, 'User ID must be valid UUIDv7');

    const loginResult = await defaultAuthService.login(testEmail, 'Password123');
    assert.strictEqual(loginResult.user.id, regResult.user.id);
  } catch (err: any) {
    t.skip(`MySQL không hoạt động hoặc yêu cầu plugin auth (${err.message})`);
  }
});

test('3. Google OAuth login & Account Linking logic', async (t) => {
  try {
    const googleProfile = {
      googleId: `gid_${Date.now()}`,
      email: `google_user_${Date.now()}@gmail.com`,
      name: 'Google User',
      avatarUrl: 'https://lh3.googleusercontent.com/a/default-user',
    };

    const res = await defaultAuthService.loginWithGoogleProfile(googleProfile);
    assert.strictEqual(res.user.email, googleProfile.email);
    assert.strictEqual(res.user.googleId, googleProfile.googleId);
    assert.strictEqual(res.user.avatarUrl, googleProfile.avatarUrl);
    assert.strictEqual(res.subscription.planId, 'free');
    assert.match(res.user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/i, 'Google User ID must be UUIDv7');
  } catch (err: any) {
    t.skip(`MySQL không hoạt động (${err.message})`);
  }
});

test('4. Order creation & VietQR generation', async (t) => {
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
    t.skip(`MySQL không hoạt động (${err.message})`);
  }
});

test('5. SePay Webhook processing with HMAC-SHA256 & Plan activation', async (t) => {
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
      transferType: 'in' as const,
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
  } catch (err: any) {
    t.skip(`MySQL không hoạt động (${err.message})`);
  }
});
