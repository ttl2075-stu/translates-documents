import { Router, Request, Response } from 'express';
import { defaultSubscriptionService } from '../../core/subscription/subscription-service.js';

export const webhookRouter = Router();

/**
 * SePay Webhook Endpoint
 * Receives POST notification upon bank transfer arrival
 */
webhookRouter.post('/sepay', async (req: Request, res: Response) => {
  try {
    let rawBody = '';
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf-8');
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else {
      rawBody = JSON.stringify(req.body || {});
    }

    if (!rawBody || rawBody.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Empty body' });
    }

    const signature = (req.headers['x-sepay-signature'] as string) || '';
    const timestamp = (req.headers['x-sepay-timestamp'] as string) || '';

    const result = await defaultSubscriptionService.handleSePayWebhook(rawBody, signature, timestamp);

    // SePay expects HTTP 200 with {"success": true}
    res.status(200).json({ success: true, message: result.message });
  } catch (error: any) {
    console.error('Lỗi xử lý SePay Webhook:', error);
    // If auth failed (HMAC/Expired), return 401
    if (error.message.includes('HMAC') || error.message.includes('expired')) {
      return res.status(401).json({ success: false, message: error.message });
    }
    // Return 500 for other unexpected errors
    res.status(500).json({ success: false, message: error.message });
  }
});
