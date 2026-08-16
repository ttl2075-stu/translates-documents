import crypto from 'node:crypto';
import { prisma, uuidv7 } from '../db/prisma.js';
import { config } from '../../config.js';
import { defaultMailerService } from '../mailer.js';

export interface SubscriptionPlan {
  id: string;
  name: string;
  priceVnd: number;
  durationDays: number;
  charLimitMonthly: number;
  maxConcurrentJobs: number;
  features: string[];
  badge?: string | null;
  isActive: boolean;
}

export interface OrderDetails {
  id: string;
  orderCode: string;
  userId: string;
  planId: string;
  planName: string;
  amountVnd: number;
  status: 'pending' | 'paid' | 'cancelled' | 'expired';
  createdAt: number;
  paidAt?: number;
  qrUrl: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export interface SePayWebhookPayload {
  id: number;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount?: string;
  code?: string | null;
  content: string;
  transferType: 'in' | 'out';
  description?: string;
  transferAmount: number;
  accumulated?: number;
  referenceCode?: string;
}

export class SubscriptionService {
  public async getSystemSetting(key: string, defaultValue: string = ''): Promise<string> {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    return row ? row.value : defaultValue;
  }

  public async setSystemSetting(key: string, value: string): Promise<void> {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  public async getAllPlans(): Promise<SubscriptionPlan[]> {
    const rows = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceVnd: 'asc' },
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      priceVnd: Number(r.priceVnd),
      durationDays: r.durationDays,
      charLimitMonthly: r.charLimitMonthly,
      maxConcurrentJobs: r.maxConcurrentJobs,
      features: JSON.parse(r.features || '[]'),
      badge: r.badge,
      isActive: r.isActive,
    }));
  }

  public async getPlanById(planId: string): Promise<SubscriptionPlan | null> {
    const r = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!r) return null;

    return {
      id: r.id,
      name: r.name,
      priceVnd: Number(r.priceVnd),
      durationDays: r.durationDays,
      charLimitMonthly: r.charLimitMonthly,
      maxConcurrentJobs: r.maxConcurrentJobs,
      features: JSON.parse(r.features || '[]'),
      badge: r.badge,
      isActive: r.isActive,
    };
  }

  public async updatePlan(
    planId: string,
    data: {
      name?: string;
      priceVnd?: number;
      charLimitMonthly?: number;
      maxConcurrentJobs?: number;
      features?: string[];
      badge?: string;
    }
  ): Promise<SubscriptionPlan> {
    const plan = await this.getPlanById(planId);
    if (!plan) throw new Error('Không tìm thấy gói cước.');

    const name = data.name !== undefined ? data.name : plan.name;
    const priceVnd = data.priceVnd !== undefined ? BigInt(data.priceVnd) : BigInt(plan.priceVnd);
    const charLimitMonthly = data.charLimitMonthly !== undefined ? data.charLimitMonthly : plan.charLimitMonthly;
    const maxConcurrentJobs = data.maxConcurrentJobs !== undefined ? data.maxConcurrentJobs : plan.maxConcurrentJobs;
    const features = data.features !== undefined ? JSON.stringify(data.features) : JSON.stringify(plan.features);
    const badge = data.badge !== undefined ? data.badge : plan.badge;

    await prisma.subscriptionPlan.update({
      where: { id: planId },
      data: {
        name,
        priceVnd,
        charLimitMonthly,
        maxConcurrentJobs,
        features,
        badge,
      },
    });

    const updated = await this.getPlanById(planId);
    return updated!;
  }

  public async createOrder(userId: string, planId: string): Promise<OrderDetails> {
    const plan = await this.getPlanById(planId);
    if (!plan) {
      throw new Error('Gói cước không hợp lệ hoặc không tồn tại.');
    }

    if (plan.priceVnd <= 0) {
      throw new Error('Gói miễn phí không cần thanh toán.');
    }

    const orderId = uuidv7();
    const randomCode = Math.floor(100000 + Math.random() * 900000);
    const orderCode = `TRANS${randomCode}`;
    const now = Date.now();

    await prisma.order.create({
      data: {
        id: orderId,
        orderCode,
        userId,
        planId,
        amountVnd: BigInt(plan.priceVnd),
        status: 'pending',
        createdAt: BigInt(now),
      },
    });

    const bankName = await this.getSystemSetting('bank_name', config.bankName);
    const bankAccount = await this.getSystemSetting('bank_account', config.bankAccount);
    const bankAccountName = await this.getSystemSetting('bank_account_name', config.bankAccountName);

    const bankCodeMap: Record<string, string> = {
      MBBank: 'MB',
      MB: 'MB',
      Vietcombank: 'VCB',
      VCB: 'VCB',
      Techcombank: 'TCB',
      TCB: 'TCB',
      BIDV: 'BIDV',
      VietinBank: 'CTG',
      ACB: 'ACB',
      TPBank: 'TPB',
      VPBank: 'VPB',
    };
    const mappedBank = bankCodeMap[bankName] || bankName;

    const qrUrl = `https://img.vietqr.io/image/${mappedBank}-${bankAccount}-compact2.png?amount=${plan.priceVnd}&addInfo=${orderCode}&accountName=${encodeURIComponent(bankAccountName)}`;

    return {
      id: orderId,
      orderCode,
      userId,
      planId: plan.id,
      planName: plan.name,
      amountVnd: plan.priceVnd,
      status: 'pending',
      createdAt: now,
      qrUrl,
      bankName,
      accountNumber: bankAccount,
      accountName: bankAccountName,
    };
  }

  public async getOrderByCode(orderCode: string): Promise<OrderDetails | null> {
    const order = await prisma.order.findUnique({
      where: { orderCode },
      include: { plan: true },
    });

    if (!order) return null;

    const bankName = await this.getSystemSetting('bank_name', config.bankName);
    const bankAccount = await this.getSystemSetting('bank_account', config.bankAccount);
    const bankAccountName = await this.getSystemSetting('bank_account_name', config.bankAccountName);
    const mappedBank = bankName;

    const qrUrl = `https://img.vietqr.io/image/${mappedBank}-${bankAccount}-compact2.png?amount=${order.amountVnd}&addInfo=${order.orderCode}&accountName=${encodeURIComponent(bankAccountName)}`;

    return {
      id: order.id,
      orderCode: order.orderCode,
      userId: order.userId,
      planId: order.planId,
      planName: order.plan.name,
      amountVnd: Number(order.amountVnd),
      status: order.status as any,
      createdAt: Number(order.createdAt),
      paidAt: order.paidAt ? Number(order.paidAt) : undefined,
      qrUrl,
      bankName,
      accountNumber: bankAccount,
      accountName: bankAccountName,
    };
  }

  public async handleSePayWebhook(
    rawBody: string,
    signatureHeader: string = '',
    timestampHeader: string = ''
  ): Promise<{ success: boolean; message: string; duplicate?: boolean }> {
    // 1. Verify HMAC Signature
    const secret = await this.getSystemSetting('sepay_webhook_secret', config.sepayWebhookSecret);
    if (secret && secret.trim().length > 0) {
      const timestamp = Number(timestampHeader || 0);

      if (timestamp > 0 && Math.abs(Date.now() / 1000 - timestamp) > 300) {
        throw new Error('Request expired (vượt quá độ trễ 5 phút cho phép)');
      }

      const expected =
        'sha256=' +
        crypto
          .createHmac('sha256', secret)
          .update(`${timestamp}.${rawBody}`)
          .digest('hex');

      const sigBuf = Buffer.from(signatureHeader || '');
      const expBuf = Buffer.from(expected);

      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new Error('Chữ ký HMAC SePay không hợp lệ');
      }
    }

    // 2. Parse payload
    let data: SePayWebhookPayload;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error('Định dạng JSON payload không hợp lệ.');
    }

    if (!data || !data.id) {
      throw new Error('Thiếu trường id giao dịch trong payload.');
    }

    // 3. Check for Duplicate (Idempotent)
    const existingTx = await prisma.sepayTransaction.findUnique({
      where: { sepayId: BigInt(data.id) },
    });

    if (existingTx) {
      return { success: true, message: 'Giao dịch đã được ghi nhận trước đó.', duplicate: true };
    }

    // 4. Save transaction to database with Prisma
    try {
      await prisma.sepayTransaction.create({
        data: {
          sepayId: BigInt(data.id),
          gateway: data.gateway || 'Unknown',
          transactionDate: data.transactionDate || new Date().toISOString(),
          accountNumber: data.accountNumber || null,
          subAccount: data.subAccount || null,
          code: data.code || null,
          amountIn: BigInt(data.transferType === 'in' ? data.transferAmount : 0),
          amountOut: BigInt(data.transferType === 'out' ? data.transferAmount : 0),
          accumulated: BigInt(data.accumulated || 0),
          content: data.content || null,
          referenceCode: data.referenceCode || null,
          body: data as any,
          createdAt: BigInt(Date.now()),
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002' || err.message?.includes('Unique')) {
        return { success: true, message: 'Giao dịch trùng lặp.', duplicate: true };
      }
      throw err;
    }

    // 5. Match Order
    if (data.transferType === 'in') {
      let matchedOrderCode = data.code;

      if (!matchedOrderCode) {
        const fullText = `${data.content || ''} ${data.description || ''}`;
        const match = fullText.match(/TRANS\d{4,8}/i) || fullText.match(/DH\d{4,8}/i);
        if (match) {
          matchedOrderCode = match[0].toUpperCase();
        }
      }

      if (matchedOrderCode) {
        const order = await prisma.order.findFirst({
          where: { orderCode: matchedOrderCode, status: 'pending' },
        });

        if (order && Number(data.transferAmount) >= Number(order.amountVnd)) {
          await prisma.order.update({
            where: { id: order.id },
            data: { status: 'paid', paidAt: BigInt(Date.now()) },
          });

          await this.activateSubscriptionForUser(order.userId, order.planId);
          console.log(`[SePay] Khớp đơn thành công: ${order.orderCode} cho User ${order.userId}, Gói: ${order.planId}`);
        }
      }
    }

    return { success: true, message: 'Giao dịch SePay đã được xử lý thành công.' };
  }

  public async activateSubscriptionForUser(userId: string, planId: string): Promise<void> {
    const plan = await this.getPlanById(planId);
    if (!plan) return;

    const currentMonth = new Date().toISOString().slice(0, 7);
    const existingSub = await prisma.subscription.findFirst({
      where: { userId },
      orderBy: { startsAt: 'desc' },
    });

    const now = BigInt(Date.now());
    const durationMs = BigInt(plan.durationDays * 24 * 3600 * 1000);

    let startsAt = now;
    let expiresAt = now + durationMs;

    if (existingSub && existingSub.planId === planId && existingSub.expiresAt > now) {
      expiresAt = existingSub.expiresAt + durationMs;
      startsAt = existingSub.startsAt;
    }

    const subId = uuidv7();
    await prisma.subscription.create({
      data: {
        id: subId,
        userId,
        planId,
        status: 'active',
        startsAt,
        expiresAt,
        charsUsedMonth: 0,
        lastResetMonth: currentMonth,
      },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user && config.smtpHost) {
      try {
        const expiresDateStr = new Date(Number(expiresAt)).toLocaleDateString('vi-VN');
        await defaultMailerService.sendCustomEmail({
          to: user.email,
          subject: `[AI Translator] Chúc mừng! Kích hoạt gói ${plan.name} thành công`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
              <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #16a34a; margin: 0;">Kích Hoạt Gói Cước Thành Công!</h2>
                <p style="color: #64748b; margin-top: 6px;">Cảm ơn bạn đã tin tưởng nâng cấp tài khoản</p>
              </div>
              <p>Xin chào <strong>${user.name}</strong>,</p>
              <p>Hệ thống đã ghi nhận thanh toán và tự động kích hoạt gói <strong>${plan.name}</strong> cho tài khoản của bạn.</p>
              
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 18px 0;">
                <p style="margin: 4px 0;"><strong>Gói dịch vụ:</strong> ${plan.name}</p>
                <p style="margin: 4px 0;"><strong>Hạn mức:</strong> ${plan.charLimitMonthly.toLocaleString()} ký tự / tháng</p>
                <p style="margin: 4px 0;"><strong>Thời hạn sử dụng đến:</strong> ${expiresDateStr}</p>
                <p style="margin: 4px 0;"><strong>Luồng dịch đồng thời:</strong> ${plan.maxConcurrentJobs} luồng</p>
              </div>

              <p>Bây giờ bạn có thể trải nghiệm đầy đủ các tính năng dịch thuật tài liệu nâng cao!</p>
              <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
              <p style="font-size: 12px; color: #94a3b8; text-align: center;">AI Document Translator & Markdown SaaS Platform</p>
            </div>
          `,
        });
      } catch (err) {
        console.error('Lỗi khi gửi email kích hoạt subscription:', err);
      }
    }
  }

  public async recordUsage(userId: string, charactersUsed: number): Promise<void> {
    if (!userId || charactersUsed <= 0) return;
    const currentMonth = new Date().toISOString().slice(0, 7);

    const sub = await prisma.subscription.findFirst({
      where: { userId },
      orderBy: { startsAt: 'desc' },
    });

    if (sub) {
      if (sub.lastResetMonth === currentMonth) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { charsUsedMonth: { increment: charactersUsed } },
        });
      } else {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            charsUsedMonth: charactersUsed,
            lastResetMonth: currentMonth,
          },
        });
      }
    }
  }

  public async getAdminStats() {
    const totalUsers = await prisma.user.count();
    const paidOrders = await prisma.order.findMany({
      where: { status: 'paid' },
      select: { amountVnd: true },
    });
    const totalRevenueVnd = paidOrders.reduce((sum, o) => sum + Number(o.amountVnd), 0);
    const totalPaidOrders = paidOrders.length;

    const activeSubscribers = await prisma.subscription.count({
      where: {
        planId: { not: 'free' },
        status: 'active',
        expiresAt: { gt: BigInt(Date.now()) },
      },
    });

    const totalJobs = await prisma.job.count();

    return {
      totalUsers,
      totalRevenueVnd,
      totalPaidOrders,
      activeSubscribers,
      totalJobs,
    };
  }

  public async getAllTransactions(limit: number = 50, offset: number = 0) {
    const txs = await prisma.sepayTransaction.findMany({
      take: limit,
      skip: offset,
      orderBy: { id: 'desc' },
    });

    const total = await prisma.sepayTransaction.count();

    const formatted = txs.map((t) => ({
      ...t,
      id: Number(t.id),
      sepayId: Number(t.sepayId),
      amountIn: Number(t.amountIn),
      amountOut: Number(t.amountOut),
      accumulated: Number(t.accumulated),
      createdAt: Number(t.createdAt),
    }));

    return { transactions: formatted, total };
  }

  public async getAllOrders(limit: number = 50, offset: number = 0) {
    const orders = await prisma.order.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { email: true, name: true } },
        plan: { select: { name: true } },
      },
    });

    const total = await prisma.order.count();

    const formatted = orders.map((o) => ({
      id: o.id,
      order_code: o.orderCode,
      user_id: o.userId,
      user_email: o.user.email,
      user_name: o.user.name,
      plan_id: o.planId,
      plan_name: o.plan.name,
      amount_vnd: Number(o.amountVnd),
      status: o.status,
      created_at: Number(o.createdAt),
      paid_at: o.paidAt ? Number(o.paidAt) : null,
    }));

    return { orders: formatted, total };
  }
}

export const defaultSubscriptionService = new SubscriptionService();
