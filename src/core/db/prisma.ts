import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../../config.js';

/**
 * Global Prisma Client Instance
 */
export const prisma = new PrismaClient();

import * as nodeCrypto from 'node:crypto';

/**
 * Standard RFC 9562 UUIDv7 Generator
 * 48-bit timestamp in milliseconds + 4-bit version (7) + 12-bit random + 2-bit variant (10) + 62-bit random
 * Time-ordered, monotonic, optimal for MySQL B-tree clustering.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);

  if (typeof nodeCrypto?.randomFillSync === 'function') {
    nodeCrypto.randomFillSync(bytes);
  } else if (typeof nodeCrypto?.randomBytes === 'function') {
    bytes.set(nodeCrypto.randomBytes(16));
  } else if (typeof globalThis?.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const now = Date.now();

  // 48-bit timestamp (Big-Endian)
  bytes[0] = (now / 0x10000000000) & 0xff;
  bytes[1] = (now / 0x100000000) & 0xff;
  bytes[2] = (now / 0x1000000) & 0xff;
  bytes[3] = (now / 0x10000) & 0xff;
  bytes[4] = (now / 0x100) & 0xff;
  bytes[5] = now & 0xff;

  // Version 7 in byte 6: 0111 xxxx -> (bytes[6] & 0x0f) | 0x70
  bytes[6] = (bytes[6] & 0x0f) | 0x70;

  // Variant in byte 8: 10xx xxxx -> (bytes[8] & 0x3f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

let isInitialized = false;

/**
 * Initializes and seeds Prisma database if needed
 */
export async function initPrismaDatabase(): Promise<void> {
  if (isInitialized) return;

  try {
    // 1. Seed Subscription Plans
    const countPlans = await prisma.subscriptionPlan.count();
    if (countPlans === 0) {
      const defaultPlans = [
        {
          id: 'free',
          name: 'Gói Khởi Đầu (Free)',
          priceVnd: BigInt(0),
          durationDays: 3650,
          charLimitMonthly: 20000,
          maxConcurrentJobs: 1,
          allowBackgroundJobs: false,
          allowAiFormatReview: false,
          features: JSON.stringify([
            'Dịch tối đa 20.000 ký tự / tháng',
            'Bảo toàn Markdown, Code, TXT',
            'Công thức KaTeX và Bảng biểu',
            'Tốc độ tiêu chuẩn',
          ]),
          badge: 'Miễn phí',
          isActive: true,
        },
        {
          id: 'pro',
          name: 'Gói Chuyên Nghiệp (Pro)',
          priceVnd: BigInt(99000),
          durationDays: 30,
          charLimitMonthly: 500000,
          maxConcurrentJobs: 3,
          allowBackgroundJobs: true,
          allowAiFormatReview: true,
          features: JSON.stringify([
            'Dịch 500.000 ký tự / tháng (~300 trang sách)',
            'Tất cả định dạng Markdown, JSON, TXT, Docs',
            'Tiến trình dịch nền tự động (Background Jobs)',
            'Tự động gửi file kết quả qua Email',
            'Xử lý đồng thời 3 luồng tốc độ cao',
            'Trợ lý tinh chỉnh câu văn & Linter định dạng',
          ]),
          badge: 'Phổ biến nhất',
          isActive: true,
        },
        {
          id: 'enterprise',
          name: 'Gói Doanh Nghiệp (Enterprise)',
          priceVnd: BigInt(299000),
          durationDays: 30,
          charLimitMonthly: 3000000,
          maxConcurrentJobs: 10,
          allowBackgroundJobs: true,
          allowAiFormatReview: true,
          features: JSON.stringify([
            'Dịch 3.000.000 ký tự / tháng (~1.800 trang)',
            'Mọi tính năng của gói Pro',
            'Ưu tiên hàng đợi dịch siêu tốc (High Priority)',
            'Không giới hạn dung lượng tải lên mỗi file',
            'Hỗ trợ tích hợp Custom LLM API & Model riêng',
            'Hỗ trợ kỹ thuật 24/7 qua Zalo & Email',
          ]),
          badge: 'Cao cấp',
          isActive: true,
        },
      ];

      for (const p of defaultPlans) {
        await prisma.subscriptionPlan.upsert({
          where: { id: p.id },
          create: p,
          update: {
            allowBackgroundJobs: p.allowBackgroundJobs,
            allowAiFormatReview: p.allowAiFormatReview,
          },
        });
      }
    }

    // 2. Seed Default Admin User
    const countUsers = await prisma.user.count();
    if (countUsers === 0) {
      const adminId = uuidv7();
      const adminEmail = 'admin@translator.local';
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync('Admin@123456', salt);
      const now = BigInt(Date.now());
      const currentMonth = new Date().toISOString().slice(0, 7);

      await prisma.user.create({
        data: {
          id: adminId,
          email: adminEmail,
          passwordHash,
          name: 'Hệ Thống Quản Trị',
          role: 'admin',
          status: 'active',
          createdAt: now,
          subscriptions: {
            create: {
              id: uuidv7(),
              planId: 'enterprise',
              status: 'active',
              startsAt: now,
              expiresAt: now + BigInt(3650 * 24 * 3600 * 1000),
              charsUsedMonth: 0,
              lastResetMonth: currentMonth,
            },
          },
        },
      });
    }

    // 3. Seed Default System Settings
    const settings = [
      { key: 'bank_name', value: config.bankName },
      { key: 'bank_account', value: config.bankAccount },
      { key: 'bank_account_name', value: config.bankAccountName },
      { key: 'sepay_webhook_secret', value: config.sepayWebhookSecret },
    ];

    for (const s of settings) {
      await prisma.systemSetting.upsert({
        where: { key: s.key },
        create: s,
        update: {},
      });
    }

    isInitialized = true;
  } catch (err: any) {
    console.warn(`Lưu ý khởi tạo Prisma Database: ${err.message}`);
  }
}
