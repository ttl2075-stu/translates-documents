import { Router, Response } from 'express';
import { prisma } from '../../core/db/prisma.js';
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
    const search = ((req.query.search as string) || '').trim();
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const whereClause: any = {};
    if (search) {
      whereClause.OR = [
        { email: { contains: search } },
        { name: { contains: search } },
      ];
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        subscriptions: {
          orderBy: { startsAt: 'desc' },
          take: 1,
          include: { plan: true },
        },
      },
    });

    const total = await prisma.user.count({ where: whereClause });

    const formattedUsers = users.map((u) => {
      const activeSub = u.subscriptions[0];
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        created_at: Number(u.createdAt),
        plan_id: activeSub?.planId || 'free',
        plan_name: activeSub?.plan?.name || 'Gói Khởi Đầu',
        sub_status: activeSub?.status || 'active',
        expires_at: activeSub?.expiresAt ? Number(activeSub.expiresAt) : null,
        chars_used_month: activeSub?.charsUsedMonth || 0,
        char_limit_monthly: activeSub?.plan?.charLimitMonthly || 20000,
      };
    });

    res.json({ success: true, users: formattedUsers, total });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Update User (status, role, or manual subscription assignment)
adminRouter.put('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const targetUserId = req.params.id;
    const { status, role, planId, extendDays } = req.body;

    const user = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng.' });
    }

    if (targetUserId === req.user!.id && (status === 'banned' || role === 'user')) {
      return res.status(400).json({ success: false, error: 'Không thể tự khóa tài khoản hoặc hủy quyền quản trị của chính mình.' });
    }

    const updateData: any = {};
    if (status) updateData.status = status;
    if (role) updateData.role = role;

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: targetUserId },
        data: updateData,
      });
    }

    if (planId) {
      await defaultSubscriptionService.activateSubscriptionForUser(targetUserId, planId);
    }

    if (extendDays && Number(extendDays) > 0) {
      const days = Number(extendDays);
      const sub = await prisma.subscription.findFirst({
        where: { userId: targetUserId },
        orderBy: { startsAt: 'desc' },
      });
      if (sub) {
        const base = Math.max(Date.now(), Number(sub.expiresAt) || Date.now());
        const newExpires = BigInt(base + days * 86400000);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { expiresAt: newExpires, status: 'active' },
        });
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
    const plans = await defaultSubscriptionService.getAllPlans(true);
    res.json({ success: true, plans });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

adminRouter.post('/plans', async (req, res) => {
  try {
    const { id, name, priceVnd, durationDays, charLimitMonthly, maxConcurrentJobs, allowBackgroundJobs, allowAiFormatReview, features, badge } = req.body;
    if (!id || !name) {
      return res.status(400).json({ success: false, error: 'Vui lòng cung cấp mã gói (ID) và tên gói.' });
    }

    const created = await defaultSubscriptionService.createPlan({
      id,
      name,
      priceVnd: Number(priceVnd) || 0,
      durationDays: Number(durationDays) || 30,
      charLimitMonthly: Number(charLimitMonthly) || 100000,
      maxConcurrentJobs: Number(maxConcurrentJobs) || 1,
      allowBackgroundJobs: Boolean(allowBackgroundJobs),
      allowAiFormatReview: Boolean(allowAiFormatReview),
      features: Array.isArray(features) ? features : [],
      badge,
    });

    res.json({ success: true, message: 'Thêm gói cước mới thành công!', plan: created });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
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

adminRouter.delete('/plans/:id', async (req, res) => {
  try {
    const planId = req.params.id;
    await defaultSubscriptionService.deletePlan(planId);
    res.json({ success: true, message: `Đã xóa/vô hiệu hóa gói cước "${planId}" thành công!` });
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
    const rows = await prisma.systemSetting.findMany();
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
