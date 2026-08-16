import { Request, Response, NextFunction } from 'express';
import { defaultAuthService, UserDTO, UserSubscriptionDTO } from './auth-service.js';

export interface AuthenticatedRequest extends Request {
  user?: UserDTO;
  subscription?: UserSubscriptionDTO;
}

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.query && typeof req.query.token === 'string') {
    return req.query.token;
  }
  if (req.headers['x-access-token'] && typeof req.headers['x-access-token'] === 'string') {
    return req.headers['x-access-token'];
  }
  return null;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Yêu cầu đăng nhập để thực hiện thao tác này.',
      code: 'AUTH_REQUIRED',
    });
  }

  const decoded = defaultAuthService.verifyToken(token);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.',
      code: 'INVALID_TOKEN',
    });
  }

  const userWithSub = await defaultAuthService.getUserById(decoded.id);
  if (!userWithSub || userWithSub.user.status === 'banned') {
    return res.status(401).json({
      success: false,
      error: 'Tài khoản không tồn tại hoặc đã bị khóa.',
      code: 'ACCOUNT_DISABLED',
    });
  }

  req.user = userWithSub.user;
  req.subscription = userWithSub.subscription;
  next();
}

export async function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    const decoded = defaultAuthService.verifyToken(token);
    if (decoded) {
      const userWithSub = await defaultAuthService.getUserById(decoded.id);
      if (userWithSub && userWithSub.user.status !== 'banned') {
        req.user = userWithSub.user;
        req.subscription = userWithSub.subscription;
      }
    }
  }
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Bạn không có quyền quản trị để truy cập tài nguyên này.',
      code: 'FORBIDDEN_ADMIN',
    });
  }
  next();
}

export function checkSubscriptionQuota(estimatedChars: number = 0) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.subscription) {
      return res.status(401).json({
        success: false,
        error: 'Vui lòng đăng nhập để sử dụng tính năng dịch.',
      });
    }

    const sub = req.subscription;
    if (sub.status === 'expired' && sub.planId !== 'free') {
      return res.status(403).json({
        success: false,
        error: 'Gói đăng ký của bạn đã hết hạn. Vui lòng gia hạn gói để tiếp tục sử dụng dịch vụ.',
        code: 'SUBSCRIPTION_EXPIRED',
      });
    }

    const remaining = Math.max(0, sub.charLimitMonthly - sub.charsUsedMonth);
    if (estimatedChars > 0 && estimatedChars > remaining && sub.planId !== 'enterprise') {
      return res.status(403).json({
        success: false,
        error: `Tài liệu cần dịch (${estimatedChars.toLocaleString()} ký tự) vượt quá hạn mức còn lại trong tháng (${remaining.toLocaleString()} ký tự). Vui lòng nâng cấp gói cước để dịch không giới hạn.`,
        code: 'QUOTA_EXCEEDED',
        quota: {
          limit: sub.charLimitMonthly,
          used: sub.charsUsedMonth,
          remaining,
        },
      });
    }

    next();
  };
}
