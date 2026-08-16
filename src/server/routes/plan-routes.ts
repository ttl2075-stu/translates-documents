import { Router, Response } from 'express';
import { defaultSubscriptionService } from '../../core/subscription/subscription-service.js';
import { requireAuth, AuthenticatedRequest } from '../../core/auth/auth-middleware.js';

export const planRouter = Router();

// Get public subscription plans list
planRouter.get('/', async (_req, res) => {
  try {
    const plans = await defaultSubscriptionService.getAllPlans();
    res.json({ success: true, plans });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create payment order for subscription upgrade
planRouter.post('/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, error: 'Vui lòng chọn gói cước cần nâng cấp.' });
    }

    const order = await defaultSubscriptionService.createOrder(userId, planId);
    res.json({
      success: true,
      message: 'Khởi tạo đơn hàng thanh toán thành công!',
      order,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get order details
planRouter.get('/orders/:orderCode', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await defaultSubscriptionService.getOrderByCode(req.params.orderCode);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng.' });
    }

    if (order.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Bạn không có quyền xem đơn hàng này.' });
    }

    res.json({ success: true, order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Polling order status (fast check for payment completion)
planRouter.get('/orders/:orderCode/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const order = await defaultSubscriptionService.getOrderByCode(req.params.orderCode);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng.' });
    }

    if (order.userId !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Bạn không có quyền xem đơn hàng này.' });
    }

    res.json({
      success: true,
      orderCode: order.orderCode,
      status: order.status,
      paidAt: order.paidAt,
      isPaid: order.status === 'paid',
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
