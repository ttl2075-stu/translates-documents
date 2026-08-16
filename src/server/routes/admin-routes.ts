import { Router, Response } from 'express';
import { query, queryOne, execute } from '../../core/db/database.js';
import { defaultSubscriptionService } from '../../core/subscription/subscription-service.js';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../../core/auth/auth-middleware.js';
import { defaultAuthService } from '../../core/auth/auth-service.js';

export const adminRouter = Router();

// Protect all admin routes
adminRouter.use(requireAuth, requireAdmin);

// 1. Overview Statistics
adminRouter.get('/stats', async (_req, res) => {
  try {
    const stats = await defaultSubscriptionService.getAdminStats();
    res.json({ success: true, stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. List & Search Users
adminRouter.get('/users', async (req, res) => {
  try {
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    let sql = `
      SELECT u.id, u.email, u.name, u.role, u.status, u.created_at,
             s.plan_id, p.name as plan_name, s.status as sub_status, s.expires_at, s.chars_used_month, p.char_limit_monthly
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id AND s.id = (
        SELECT id FROM subscriptions WHERE user_id = u.id ORDER BY starts_at DESC LIMIT 1
      )
      LEFT JOIN subscription_plans p ON s.plan_id = p.id
    `;

    let params: any[] = [];
    if (search) {
      sql += ` WHERE u.email LIKE ? OR u.name LIKE ?`;
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const users = await query<any>(sql, params);
    const totalRow = await queryOne<any>('SELECT COUNT(*) as count FROM users');

    res.json({ success: true, users, total: Number(totalRow?.count) || 0 });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Update User (status, role, or manual subscription assignment)
adminRouter.put('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetUserId = req.params.id;
    const { status, role, planId, extendDays } = req.body;

    const user = await queryOne<any>('SELECT * FROM users WHERE id = ?', [targetUserId]);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng.' });
    }

    if (targetUserId === req.user!.id && (status === 'banned' || role === 'user')) {
      return res.status(400).json({ success: false, error: 'Không thể tự khóa tài khoản hoặc hủy quyền quản trị của chính mình.' });
    }

    if (status) {
      await execute('UPDATE users SET status = ? WHERE id = ?', [status, targetUserId]);
    }
    if (role) {
      await execute('UPDATE users SET role = ? WHERE id = ?', [role, targetUserId]);
    }

    if (planId) {
      await defaultSubscriptionService.activateSubscriptionForUser(targetUserId, planId);
    }

    if (extendDays && Number(extendDays) > 0) {
      const days = Number(extendDays);
      const sub = await queryOne<any>('SELECT id, expires_at FROM subscriptions WHERE user_id = ? ORDER BY starts_at DESC LIMIT 1', [targetUserId]);
      if (sub) {
        const base = Math.max(Date.now(), Number(sub.expires_at) || Date.now());
        const newExpires = base + days * 86400000;
        await execute('UPDATE subscriptions SET expires_at = ?, status = ? WHERE id = ?', [newExpires, 'active', sub.id]);
      }
    }

    const updatedUser = await defaultAuthService.getUserById(targetUserId);
    res.json({
      success: true,
      message: 'Cập nhật tài khoản người dùng thành công!',
      ...updatedUser,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 4. Get & Edit Plans
adminRouter.get('/plans', async (_req, res) => {
  try {
    const plans = await defaultSubscriptionService.getAllPlans();
    res.json({ success: true, plans });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

adminRouter.put('/plans/:id', async (req, res) => {
  try {
    const planId = req.params.id;
    const updated = await defaultSubscriptionService.updatePlan(planId, req.body);
    res.json({ success: true, message: 'Cập nhật thông tin gói cước thành công!', plan: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 5. SePay Transactions & Orders
adminRouter.get('/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const result = await defaultSubscriptionService.getAllTransactions(limit, offset);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

adminRouter.get('/orders', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const result = await defaultSubscriptionService.getAllOrders(limit, offset);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. System Settings
adminRouter.get('/settings', async (_req, res) => {
  try {
    const rows = await query<any>('SELECT * FROM system_settings');
    const settings: Record<string, string> = {};
    for (const r of rows) {
      if (r.key === 'sepay_webhook_secret' && r.value) {
        settings[r.key] = r.value ? `${r.value.slice(0, 4)}...${r.value.slice(-4)}` : '';
      } else {
        settings[r.key] = r.value;
      }
    }
    res.json({ success: true, settings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

adminRouter.post('/settings', async (req, res) => {
  try {
    const { bankName, bankAccount, bankAccountName, sepayWebhookSecret } = req.body;
    if (bankName) await defaultSubscriptionService.setSystemSetting('bank_name', bankName.trim());
    if (bankAccount) await defaultSubscriptionService.setSystemSetting('bank_account', bankAccount.trim());
    if (bankAccountName) await defaultSubscriptionService.setSystemSetting('bank_account_name', bankAccountName.trim());
    if (sepayWebhookSecret !== undefined && sepayWebhookSecret.trim().length > 0 && !sepayWebhookSecret.includes('...')) {
      await defaultSubscriptionService.setSystemSetting('sepay_webhook_secret', sepayWebhookSecret.trim());
    }

    res.json({ success: true, message: 'Cập nhật cấu hình hệ thống thành công!' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});
