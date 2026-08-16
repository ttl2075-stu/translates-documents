import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, queryOne, execute } from '../db/database.js';
import { config } from '../../config.js';
import { defaultMailerService } from '../mailer.js';

import { OAuth2Client } from 'google-auth-library';

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: 'user' | 'admin';
  status: 'active' | 'banned';
  createdAt: number;
}

export interface UserSubscriptionDTO {
  planId: string;
  planName: string;
  badge: string;
  status: 'active' | 'expired';
  startsAt: number;
  expiresAt: number;
  charsUsedMonth: number;
  charLimitMonthly: number;
  maxConcurrentJobs: number;
  features: string[];
}

export interface AuthResult {
  user: UserDTO;
  subscription: UserSubscriptionDTO;
  token: string;
}

export class AuthService {
  private googleClient: OAuth2Client | null = null;

  private getGoogleClient(): OAuth2Client {
    if (!this.googleClient) {
      this.googleClient = new OAuth2Client(
        config.googleClientId,
        config.googleClientSecret,
        config.googleCallbackUrl
      );
    }
    return this.googleClient;
  }

  private generateId(prefix = 'usr'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  private signToken(user: UserDTO): string {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      config.jwtSecret,
      { expiresIn: '30d' }
    );
  }

  public verifyToken(token: string): { id: string; email: string; name: string; role: 'user' | 'admin' } | null {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as any;
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Generates standard Google OAuth 2.0 consent URL for redirect flow
   */
  public getGoogleAuthUrl(): string {
    if (!config.googleClientId) {
      throw new Error('Chưa cấu hình GOOGLE_CLIENT_ID trong tệp .env');
    }
    const client = this.getGoogleClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'],
      prompt: 'select_account',
    });
  }

  /**
   * Handles Google OAuth Authorization Code callback
   */
  public async handleGoogleCallback(code: string): Promise<AuthResult> {
    const client = this.getGoogleClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    let ticket: any = null;
    if (tokens.id_token) {
      ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.googleClientId,
      });
    }

    const payload = ticket?.getPayload();
    if (!payload || !payload.email) {
      // Fallback to userInfo API
      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const userinfo = (await userinfoRes.json()) as any;
      return this.loginWithGoogleProfile({
        googleId: userinfo.sub,
        email: userinfo.email,
        name: userinfo.name || userinfo.email.split('@')[0],
        avatarUrl: userinfo.picture,
      });
    }

    return this.loginWithGoogleProfile({
      googleId: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      avatarUrl: payload.picture,
    });
  }

  /**
   * Verifies Google One-Tap / Identity Services ID Token (JWT) sent directly from frontend
   */
  public async verifyGoogleIdToken(idToken: string): Promise<AuthResult> {
    if (!idToken || typeof idToken !== 'string') {
      throw new Error('Token xác thực Google không hợp lệ.');
    }

    try {
      const client = this.getGoogleClient();
      const ticket = await client.verifyIdToken({
        idToken,
        audience: config.googleClientId ? [config.googleClientId] : undefined,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        throw new Error('Không thể đọc thông tin người dùng từ Google Token.');
      }

      return this.loginWithGoogleProfile({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        avatarUrl: payload.picture,
      });
    } catch (err: any) {
      // Fallback verification via Google tokeninfo API endpoint
      const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!tokenInfoRes.ok) {
        throw new Error('Xác thực tài khoản Google thất bại: ' + err.message);
      }
      const data = (await tokenInfoRes.json()) as any;
      if (!data.email) {
        throw new Error('Không tìm thấy email trong tài khoản Google.');
      }

      return this.loginWithGoogleProfile({
        googleId: data.sub,
        email: data.email,
        name: data.name || data.email.split('@')[0],
        avatarUrl: data.picture,
      });
    }
  }

  /**
   * Logs in or creates a new user from verified Google profile data
   */
  public async loginWithGoogleProfile(profile: {
    googleId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }): Promise<AuthResult> {
    const cleanEmail = profile.email.trim().toLowerCase();

    // Check if user exists by email or google_id
    let userRow = await queryOne<any>('SELECT * FROM users WHERE email = ? OR google_id = ?', [cleanEmail, profile.googleId]);

    if (userRow) {
      if (userRow.status === 'banned') {
        throw new Error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
      }

      // Update google_id or avatar if missing
      if (!userRow.google_id || (profile.avatarUrl && !userRow.avatar_url)) {
        await execute('UPDATE users SET google_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?', [
          profile.googleId,
          profile.avatarUrl || null,
          userRow.id,
        ]);
      }
    } else {
      // Register new user automatically with Free subscription
      const userId = this.generateId('usr');
      const createdAt = Date.now();

      await execute(
        'INSERT INTO users (id, email, password_hash, name, google_id, avatar_url, role, status, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)',
        [userId, cleanEmail, profile.name.trim(), profile.googleId, profile.avatarUrl || null, 'user', 'active', createdAt]
      );

      // Create Free Plan
      const currentMonth = new Date().toISOString().slice(0, 7);
      const subId = this.generateId('sub');
      const expiresAt = Date.now() + 3650 * 24 * 3600 * 1000;

      await execute(
        'INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, chars_used_month, last_reset_month) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [subId, userId, 'free', 'active', Date.now(), expiresAt, 0, currentMonth]
      );

      userRow = await queryOne<any>('SELECT * FROM users WHERE id = ?', [userId]);
    }

    const user: UserDTO = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      avatarUrl: userRow.avatar_url,
      role: userRow.role,
      status: userRow.status,
      createdAt: Number(userRow.created_at),
    };

    const subscription = await this.getUserSubscription(user.id);
    const token = this.signToken(user);

    return { user, subscription, token };
  }

  public async register(email: string, password: string, name: string): Promise<AuthResult> {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Địa chỉ email không hợp lệ.');
    }
    if (!password || password.length < 6) {
      throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
    }
    if (!name || name.trim().length === 0) {
      name = cleanEmail.split('@')[0];
    }

    const existingUser = await queryOne('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existingUser) {
      throw new Error('Email này đã được đăng ký trên hệ thống.');
    }

    const userId = this.generateId('usr');
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const createdAt = Date.now();

    await execute(
      'INSERT INTO users (id, email, password_hash, name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, cleanEmail, passwordHash, name.trim(), 'user', 'active', createdAt]
    );

    // Create Free Subscription
    const currentMonth = new Date().toISOString().slice(0, 7);
    const subId = this.generateId('sub');
    const expiresAt = Date.now() + 3650 * 24 * 3600 * 1000;

    await execute(
      'INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, chars_used_month, last_reset_month) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [subId, userId, 'free', 'active', Date.now(), expiresAt, 0, currentMonth]
    );

    const user: UserDTO = {
      id: userId,
      email: cleanEmail,
      name: name.trim(),
      role: 'user',
      status: 'active',
      createdAt,
    };

    const subscription = await this.getUserSubscription(userId);
    const token = this.signToken(user);

    return { user, subscription, token };
  }

  public async login(email: string, password: string): Promise<AuthResult> {
    const cleanEmail = email.trim().toLowerCase();

    const row = await queryOne<any>('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (!row) {
      throw new Error('Email hoặc mật khẩu không chính xác.');
    }

    if (row.status === 'banned') {
      throw new Error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
    }

    const isMatch = bcrypt.compareSync(password, row.password_hash);
    if (!isMatch) {
      throw new Error('Email hoặc mật khẩu không chính xác.');
    }

    const user: UserDTO = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      createdAt: Number(row.created_at),
    };

    const subscription = await this.getUserSubscription(user.id);
    const token = this.signToken(user);

    return { user, subscription, token };
  }

  public async getUserSubscription(userId: string): Promise<UserSubscriptionDTO> {
    const currentMonth = new Date().toISOString().slice(0, 7);

    let sub = await queryOne<any>(`
      SELECT s.*, p.name as plan_name, p.badge, p.char_limit_monthly, p.max_concurrent_jobs, p.features
      FROM subscriptions s
      JOIN subscription_plans p ON s.plan_id = p.id
      WHERE s.user_id = ?
      ORDER BY s.starts_at DESC
      LIMIT 1
    `, [userId]);

    if (!sub) {
      // Auto-assign Free plan if missing
      const subId = this.generateId('sub');
      const expiresAt = Date.now() + 3650 * 24 * 3600 * 1000;
      await execute(`
        INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, chars_used_month, last_reset_month)
        VALUES (?, ?, 'free', 'active', ?, ?, 0, ?)
      `, [subId, userId, Date.now(), expiresAt, currentMonth]);

      sub = await queryOne<any>(`
        SELECT s.*, p.name as plan_name, p.badge, p.char_limit_monthly, p.max_concurrent_jobs, p.features
        FROM subscriptions s
        JOIN subscription_plans p ON s.plan_id = p.id
        WHERE s.id = ?
      `, [subId]);
    }

    // Check if new month -> reset chars_used_month
    if (sub.last_reset_month !== currentMonth) {
      await execute(`
        UPDATE subscriptions 
        SET chars_used_month = 0, last_reset_month = ?
        WHERE id = ?
      `, [currentMonth, sub.id]);
      sub.chars_used_month = 0;
      sub.last_reset_month = currentMonth;
    }

    // Check expiration for paid plans
    let status = sub.status;
    if (sub.plan_id !== 'free' && Number(sub.expires_at) < Date.now()) {
      status = 'expired';
      await execute('UPDATE subscriptions SET status = ? WHERE id = ?', ['expired', sub.id]);
    }

    let features: string[] = [];
    try {
      features = JSON.parse(sub.features || '[]');
    } catch {
      features = [];
    }

    return {
      planId: sub.plan_id,
      planName: sub.plan_name,
      badge: sub.badge || '',
      status: status as 'active' | 'expired',
      startsAt: Number(sub.starts_at),
      expiresAt: Number(sub.expires_at),
      charsUsedMonth: Number(sub.chars_used_month) || 0,
      charLimitMonthly: Number(sub.char_limit_monthly) || 20000,
      maxConcurrentJobs: Number(sub.max_concurrent_jobs) || 1,
      features,
    };
  }

  public async getUserById(userId: string): Promise<{ user: UserDTO; subscription: UserSubscriptionDTO } | null> {
    const row = await queryOne<any>('SELECT id, email, name, role, status, created_at FROM users WHERE id = ?', [userId]);
    if (!row) return null;

    const user: UserDTO = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      createdAt: Number(row.created_at),
    };

    const subscription = await this.getUserSubscription(userId);
    return { user, subscription };
  }

  public async updateProfile(userId: string, data: { name?: string; currentPassword?: string; newPassword?: string }): Promise<UserDTO> {
    const row = await queryOne<any>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!row) throw new Error('Không tìm thấy tài khoản người dùng.');

    let newName = row.name;
    if (data.name && data.name.trim().length > 0) {
      newName = data.name.trim();
    }

    if (data.newPassword) {
      if (!data.currentPassword) {
        throw new Error('Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu mới.');
      }
      const isMatch = bcrypt.compareSync(data.currentPassword, row.password_hash);
      if (!isMatch) {
        throw new Error('Mật khẩu hiện tại không chính xác.');
      }
      if (data.newPassword.length < 6) {
        throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
      }
      const salt = bcrypt.genSaltSync(10);
      const newHash = bcrypt.hashSync(data.newPassword, salt);
      await execute('UPDATE users SET name = ?, password_hash = ? WHERE id = ?', [newName, newHash, userId]);
    } else {
      await execute('UPDATE users SET name = ? WHERE id = ?', [newName, userId]);
    }

    return {
      id: row.id,
      email: row.email,
      name: newName,
      role: row.role,
      status: row.status,
      createdAt: Number(row.created_at),
    };
  }

  public async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await queryOne<any>('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    if (!user) {
      return {
        success: true,
        message: 'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi đến hộp thư của bạn.',
      };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 15 * 60 * 1000;

    await execute('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [otp, expires, user.id]);

    if (config.smtpHost) {
      try {
        await defaultMailerService.sendCustomEmail({
          to: cleanEmail,
          subject: 'Mã xác nhận đặt lại mật khẩu - AI Document Translator',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
              <h2 style="color: #2563eb; margin-top: 0;">Khôi phục mật khẩu</h2>
              <p>Xin chào <strong>${user.name}</strong>,</p>
              <p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản tại <strong>AI Document Translator</strong>.</p>
              <div style="margin: 24px 0; padding: 16px; background: #f8fafc; border: 1px dashed #cbd5e1; text-align: center; border-radius: 8px;">
                <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Mã xác thực của bạn</p>
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a;">${otp}</span>
              </div>
              <p style="font-size: 13px; color: #64748b;">Mã này có hiệu lực trong vòng <strong>15 phút</strong>. Vui lòng không chia sẻ mã này cho bất kỳ ai.</p>
              <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 20px 0;" />
              <p style="font-size: 12px; color: #94a3b8; text-align: center;">AI Document Translator & Markdown SaaS Platform</p>
            </div>
          `,
        });
      } catch (err: any) {
        console.error('Lỗi khi gửi email reset mật khẩu:', err);
      }
    } else {
      console.log(`[DEV OTP] Mã xác nhận đặt lại mật khẩu cho ${cleanEmail} là: ${otp}`);
    }

    return {
      success: true,
      message: 'Mã xác thực đã được gửi đến email của bạn. Vui lòng kiểm tra hộp thư (hoặc mục Spam).',
    };
  }

  public async resetPassword(email: string, otp: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();

    if (!newPassword || newPassword.length < 6) {
      throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
    }

    const user = await queryOne<any>('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (!user || !user.reset_token || user.reset_token !== cleanOtp) {
      throw new Error('Mã xác thực không chính xác.');
    }

    if (Number(user.reset_token_expires) < Date.now()) {
      throw new Error('Mã xác thực đã hết hạn (quá 15 phút). Vui lòng yêu cầu mã mới.');
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(newPassword, salt);

    await execute('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [
      newHash,
      user.id,
    ]);

    return {
      success: true,
      message: 'Đặt lại mật khẩu thành công! Bây giờ bạn có thể đăng nhập bằng mật khẩu mới.',
    };
  }
}

export const defaultAuthService = new AuthService();
