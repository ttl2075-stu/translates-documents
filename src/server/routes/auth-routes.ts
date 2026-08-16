import { Router, Response } from 'express';
import { defaultAuthService } from '../../core/auth/auth-service.js';
import { requireAuth, AuthenticatedRequest } from '../../core/auth/auth-middleware.js';
import { config } from '../../config.js';

export const authRouter = Router();

// Register new account
authRouter.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const result = await defaultAuthService.register(email, password, name);
    res.json({
      success: true,
      message: 'Đăng ký tài khoản thành công!',
      ...result,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Login
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await defaultAuthService.login(email, password);
    res.json({
      success: true,
      message: 'Đăng nhập thành công!',
      ...result,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get current profile & subscription info
authRouter.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const data = await defaultAuthService.getUserById(userId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy thông tin tài khoản.' });
    }
    res.json({
      success: true,
      user: data.user,
      subscription: data.subscription,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update profile name / change password
authRouter.put('/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, currentPassword, newPassword } = req.body;
    const updatedUser = await defaultAuthService.updateProfile(userId, { name, currentPassword, newPassword });
    res.json({
      success: true,
      message: 'Cập nhật thông tin thành công!',
      user: updatedUser,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Get Google Client ID for frontend GIS button
authRouter.get('/google/client-id', (_req, res) => {
  res.json({
    success: true,
    clientId: config.googleClientId || '',
    enabled: Boolean(config.googleClientId && config.googleClientId.length > 0),
  });
});

// Authenticate via Google ID Token (from Google One-Tap or Google Sign-In Button)
authRouter.post('/google', async (req, res) => {
  try {
    const { idToken, credential } = req.body;
    const tokenToVerify = idToken || credential;
    if (!tokenToVerify) {
      return res.status(400).json({ success: false, error: 'Thiếu Google ID Token/Credential.' });
    }

    const result = await defaultAuthService.verifyGoogleIdToken(tokenToVerify);
    res.json({
      success: true,
      message: 'Đăng nhập bằng tài khoản Google thành công!',
      ...result,
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// OAuth 2.0 Redirect flow: initiate login
authRouter.get('/google', (_req, res) => {
  try {
    const authUrl = defaultAuthService.getGoogleAuthUrl();
    res.redirect(authUrl);
  } catch (error: any) {
    res.status(500).send(`<h3>Lỗi cấu hình Google OAuth</h3><p>${error.message}</p>`);
  }
});

// OAuth 2.0 Redirect flow: handle Google callback
authRouter.get('/google/callback', async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.redirect('/app?auth_error=' + encodeURIComponent('Không nhận được mã xác thực từ Google.'));
    }

    const result = await defaultAuthService.handleGoogleCallback(code);
    // Redirect back to application with JWT token in URL query parameter
    res.redirect(`/app?auth_token=${encodeURIComponent(result.token)}`);
  } catch (error: any) {
    res.redirect(`/app?auth_error=${encodeURIComponent(error.message || 'Đăng nhập Google thất bại')}`);
  }
});

// Request OTP / Reset password link
authRouter.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await defaultAuthService.requestPasswordReset(email);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Verify OTP and reset password
authRouter.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const result = await defaultAuthService.resetPassword(email, otp, newPassword);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

