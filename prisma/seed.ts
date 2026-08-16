import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

function generateUUIDv7(): string {
  const bytes = crypto.randomBytes(16);
  const now = Date.now();

  bytes[0] = (now / 0x10000000000) & 0xff;
  bytes[1] = (now / 0x100000000) & 0xff;
  bytes[2] = (now / 0x1000000) & 0xff;
  bytes[3] = (now / 0x10000) & 0xff;
  bytes[4] = (now / 0x100) & 0xff;
  bytes[5] = now & 0xff;

  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return [
    bytes.subarray(0, 4).toString('hex'),
    bytes.subarray(4, 6).toString('hex'),
    bytes.subarray(6, 8).toString('hex'),
    bytes.subarray(8, 10).toString('hex'),
    bytes.subarray(10, 16).toString('hex'),
  ].join('-');
}

async function main() {
  console.log('🌱 Bắt đầu seed dữ liệu CSDL Prisma (MySQL + UUIDv7)...');

  // 1. Subscription Plans
  console.log('📦 1/3. Khởi tạo danh sách gói cước...');
  const plans = [
    {
      id: 'free',
      name: 'Gói Khởi Đầu (Free)',
      priceVnd: BigInt(0),
      durationDays: 3650,
      charLimitMonthly: 20000,
      maxConcurrentJobs: 1,
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

  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { id: p.id },
      create: p,
      update: {
        name: p.name,
        priceVnd: p.priceVnd,
        charLimitMonthly: p.charLimitMonthly,
        maxConcurrentJobs: p.maxConcurrentJobs,
        features: p.features,
        badge: p.badge,
        isActive: p.isActive,
      },
    });
  }

  // 2. Admin User
  console.log('👤 2/3. Khởi tạo tài khoản Quản trị viên (Admin)...');
  const adminEmail = 'admin@translator.local';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const adminId = generateUUIDv7();
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
            id: generateUUIDv7(),
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
    console.log(`   👉 Tạo tài khoản admin thành công: ${adminEmail} / Admin@123456 (UUIDv7: ${adminId})`);
  } else {
    console.log(`   👉 Tài khoản admin (${adminEmail}) đã tồn tại.`);
  }

  // 3. System Settings
  console.log('⚙️  3/3. Khởi tạo cấu hình VietQR & SePay...');
  const settings = [
    { key: 'bank_name', value: process.env.BANK_NAME || 'MBBank' },
    { key: 'bank_account', value: process.env.BANK_ACCOUNT || '0988888888' },
    { key: 'bank_account_name', value: process.env.BANK_ACCOUNT_NAME || 'TRANSLATE SAAS CO' },
    { key: 'sepay_webhook_secret', value: process.env.SEPAY_WEBHOOK_SECRET || '' },
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: s,
      update: {},
    });
  }

  console.log('✨ Seed CSDL hoàn tất 100%!');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khi seed CSDL:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
