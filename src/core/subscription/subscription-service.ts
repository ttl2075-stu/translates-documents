import crypto from 'node:crypto';
import { query, queryOne, execute } from '../db/database.js';
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
  badge?: string;
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
    const row = await queryOne<any>('SELECT `value` FROM system_settings WHERE `key` = ?', [key]);
    return row ? row.value : defaultValue;
  }

  public async setSystemSetting(key: string, value: string): Promise<void> {
    await execute(
      'INSERT INTO system_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [key, value]
    );
  }

  public async getAllPlans(): Promise<SubscriptionPlan[]> {
    const rows = await query<any>('SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY price_vnd ASC');

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      priceVnd: Number(r.price_vnd),
      durationDays: Number(r.duration_days),
      charLimitMonthly: Number(r.char_limit_monthly),
      maxConcurrentJobs: Number(r.max_concurrent_jobs),
      features: JSON.parse(r.features || '[]'),
      badge: r.badge,
      isActive: Boolean(r.is_active),
    }));
  }

  public async getPlanById(planId: string): Promise<SubscriptionPlan | null> {
    const r = await queryOne<any>('SELECT * FROM subscription_plans WHERE id = ?', [planId]);
    if (!r) return null;

    return {
      id: r.id,
      name: r.name,
      priceVnd: Number(r.price_vnd),
      durationDays: Number(r.duration_days),
      charLimitMonthly: Number(r.char_limit_monthly),
      maxConcurrentJobs: Number(r.max_concurrent_jobs),
      features: JSON.parse(r.features || '[]'),
      badge: r.badge,
      isActive: Boolean(r.is_active),
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
    const price = data.priceVnd !== undefined ? data.priceVnd : plan.priceVnd;
    const limit = data.charLimitMonthly !== undefined ? data.charLimitMonthly : plan.charLimitMonthly;
    const maxJobs = data.maxConcurrentJobs !== undefined ? data.maxConcurrentJobs : plan.maxConcurrentJobs;
    const features = data.features !== undefined ? JSON.stringify(data.features) : JSON.stringify(plan.features);
    const badge = data.badge !== undefined ? data.badge : plan.badge;

    await execute(`
      UPDATE subscription_plans 
      SET name = ?, price_vnd = ?, char_limit_monthly = ?, max_concurrent_jobs = ?, features = ?, badge = ?
      WHERE id = ?
    `, [name, price, limit, maxJobs, features, badge, planId]);

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

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const randomCode = Math.floor(100000 + Math.random() * 900000);
    const orderCode = `TRANS${randomCode}`;
    const createdAt = Date.now();

    await execute(`
      INSERT INTO orders (id, order_code, user_id, plan_id, amount_vnd, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `, [orderId, orderCode, userId, planId, plan.priceVnd, createdAt]);

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
      createdAt,
      qrUrl,
      bankName,
      accountNumber: bankAccount,
      accountName: bankAccountName,
    };
  }

  public async getOrderByCode(orderCode: string): Promise<OrderDetails | null> {
    const r = await queryOne<any>(`
      SELECT o.*, p.name as plan_name 
      FROM orders o
      JOIN subscription_plans p ON o.plan_id = p.id
      WHERE o.order_code = ?
    `, [orderCode]);

    if (!r) return null;

    const bankName = await this.getSystemSetting('bank_name', config.bankName);
    const bankAccount = await this.getSystemSetting('bank_account', config.bankAccount);
    const bankAccountName = await this.getSystemSetting('bank_account_name', config.bankAccountName);
    const mappedBank = bankName;

    const qrUrl = `https://img.vietqr.io/image/${mappedBank}-${bankAccount}-compact2.png?amount=${r.amount_vnd}&addInfo=${r.order_code}&accountName=${encodeURIComponent(bankAccountName)}`;

    return {
      id: r.id,
      orderCode: r.order_code,
      userId: r.user_id,
      planId: r.plan_id,
      planName: r.plan_name,
      amountVnd: Number(r.amount_vnd),
      status: r.status,
      createdAt: Number(r.created_at),
      paidAt: r.paid_at ? Number(r.paid_at) : undefined,
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
    const existingTx = await queryOne('SELECT id FROM sepay_transactions WHERE sepay_id = ?', [data.id]);
    if (existingTx) {
      return { success: true, message: 'Giao dịch đã được ghi nhận trước đó.', duplicate: true };
    }

    // 4. Save transaction to database
    try {
      await execute(`
        INSERT INTO sepay_transactions
        (sepay_id, gateway, transaction_date, account_number, sub_account,
         code, amount_in, amount_out, accumulated, content, reference_code, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        data.id,
        data.gateway || 'Unknown',
        data.transactionDate || new Date().toISOString(),
        data.accountNumber || '',
        data.subAccount || '',
        data.code || null,
        data.transferType === 'in' ? data.transferAmount : 0,
        data.transferType === 'out' ? data.transferAmount : 0,
        data.accumulated || 0,
        data.content || '',
        data.referenceCode || '',
        rawBody,
        Date.now(),
      ]);
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY' || err.message?.includes('Duplicate')) {
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
        const order = await queryOne<any>(
          `SELECT * FROM orders WHERE order_code = ? AND status = 'pending'`,
          [matchedOrderCode]
        );

        if (order && Number(data.transferAmount) >= Number(order.amount_vnd)) {
          await execute(`UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?`, [Date.now(), order.id]);
          await this.activateSubscriptionForUser(order.user_id, order.plan_id);
          console.log(`[SePay] Khớp đơn thành công: ${order.order_code} cho User ${order.user_id}, Gói: ${order.plan_id}`);
        }
      }
    }

    return { success: true, message: 'Giao dịch SePay đã được xử lý thành công.' };
  }

  public async activateSubscriptionForUser(userId: string, planId: string): Promise<void> {
    const plan = await this.getPlanById(planId);
    if (!plan) return;

    const currentMonth = new Date().toISOString().slice(0, 7);
    const existingSub = await queryOne<any>(`
      SELECT * FROM subscriptions 
      WHERE user_id = ? 
      ORDER BY starts_at DESC 
      LIMIT 1
    `, [userId]);

    const now = Date.now();
    const durationMs = plan.durationDays * 24 * 3600 * 1000;

    let startsAt = now;
    let expiresAt = now + durationMs;

    if (existingSub && existingSub.plan_id === planId && Number(existingSub.expires_at) > now) {
      expiresAt = Number(existingSub.expires_at) + durationMs;
      startsAt = Number(existingSub.starts_at);
    }

    const subId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await execute(`
      INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, chars_used_month, last_reset_month)
      VALUES (?, ?, ?, 'active', ?, ?, 0, ?)
    `, [subId, userId, planId, startsAt, expiresAt, currentMonth]);

    const user = await queryOne<any>('SELECT email, name FROM users WHERE id = ?', [userId]);
    if (user && config.smtpHost) {
      try {
        const expiresDateStr = new Date(expiresAt).toLocaleDateString('vi-VN');
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

    const sub = await queryOne<any>(`
      SELECT * FROM subscriptions 
      WHERE user_id = ? 
      ORDER BY starts_at DESC 
      LIMIT 1
    `, [userId]);

    if (sub) {
      if (sub.last_reset_month === currentMonth) {
        await execute(`UPDATE subscriptions SET chars_used_month = chars_used_month + ? WHERE id = ?`, [
          charactersUsed,
          sub.id,
        ]);
      } else {
        await execute(`UPDATE subscriptions SET chars_used_month = ?, last_reset_month = ? WHERE id = ?`, [
          charactersUsed,
          currentMonth,
          sub.id,
        ]);
      }
    }
  }

  public async getAdminStats() {
    const totalUsersRow = await queryOne<any>('SELECT COUNT(*) as count FROM users');
    const totalPaidOrdersRow = await queryOne<any>(`SELECT COUNT(*) as count, COALESCE(SUM(amount_vnd), 0) as total_rev FROM orders WHERE status = 'paid'`);
    const activeSubsRow = await queryOne<any>(`SELECT COUNT(*) as count FROM subscriptions WHERE plan_id != 'free' AND status = 'active' AND expires_at > ?`, [Date.now()]);
    const totalJobsRow = await queryOne<any>('SELECT COUNT(*) as count FROM jobs');

    return {
      totalUsers: Number(totalUsersRow?.count) || 0,
      totalRevenueVnd: Number(totalPaidOrdersRow?.total_rev) || 0,
      totalPaidOrders: Number(totalPaidOrdersRow?.count) || 0,
      activeSubscribers: Number(activeSubsRow?.count) || 0,
      totalJobs: Number(totalJobsRow?.count) || 0,
    };
  }

  public async getAllTransactions(limit: number = 50, offset: number = 0) {
    const txs = await query<any>(`SELECT * FROM sepay_transactions ORDER BY id DESC LIMIT ? OFFSET ?`, [limit, offset]);
    const totalRow = await queryOne<any>('SELECT COUNT(*) as count FROM sepay_transactions');
    return { transactions: txs, total: Number(totalRow?.count) || 0 };
  }

  public async getAllOrders(limit: number = 50, offset: number = 0) {
    const orders = await query<any>(`
      SELECT o.*, u.email as user_email, u.name as user_name, p.name as plan_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN subscription_plans p ON o.plan_id = p.id
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);
    const totalRow = await queryOne<any>('SELECT COUNT(*) as count FROM orders');
    return { orders, total: Number(totalRow?.count) || 0 };
  }
}

export const defaultSubscriptionService = new SubscriptionService();
