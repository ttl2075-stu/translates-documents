import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { prisma, uuidv7 } from '../db/prisma.js';
import { config } from '../../config.js';
import { defaultMailerService } from '../mailer.js';

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  googleId?: string | null;
  hasPassword?: boolean;
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
  allowBackgroundJobs: boolean;
  allowAiFormatReview: boolean;
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
   * Verifies Google One-Tap / Identity Services ID Token (JWT)
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
   * Logs in or creates a new user from verified Google profile data (with UUIDv7)
   */
  public async loginWithGoogleProfile(profile: {
    googleId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }): Promise<AuthResult> {
    const cleanEmail = profile.email.trim().toLowerCase();

    // Check if user exists by email or googleId
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ email: cleanEmail }, { googleId: profile.googleId }],
      },
    });

    if (user) {
      if (user.status === 'banned') {
        throw new Error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
      }

      // Link googleId or update avatar if not linked yet
      if (!user.googleId || (profile.avatarUrl && !user.avatarUrl)) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: profile.googleId,
            avatarUrl: user.avatarUrl || profile.avatarUrl || null,
          },
        });
      }
    } else {
      // Automatically register new user with UUIDv7
      const userId = uuidv7();
      const now = BigInt(Date.now());
      const currentMonth = new Date().toISOString().slice(0, 7);
      const expiresAt = now + BigInt(3650 * 24 * 3600 * 1000);

      user = await prisma.user.create({
        data: {
          id: userId,
          email: cleanEmail,
          passwordHash: null,
          name: profile.name.trim(),
          googleId: profile.googleId,
          avatarUrl: profile.avatarUrl || null,
          role: 'user',
          status: 'active',
          createdAt: now,
          subscriptions: {
            create: {
              id: uuidv7(),
              planId: 'free',
              status: 'active',
              startsAt: now,
              expiresAt,
              charsUsedMonth: 0,
              lastResetMonth: currentMonth,
            },
          },
        },
      });
    }

    const userDTO: UserDTO = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      googleId: user.googleId,
      hasPassword: Boolean(user.passwordHash && user.passwordHash.length > 0),
      role: user.role as any,
      status: user.status as any,
      createdAt: Number(user.createdAt),
    };

    const subscription = await this.getUserSubscription(user.id);
    const token = this.signToken(userDTO);

    return { user: userDTO, subscription, token };
  }

  /**
   * Links a Google account to an already logged-in user
   */
  public async linkGoogleAccount(userId: string, idToken: string): Promise<UserDTO> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('Không tìm thấy tài khoản người dùng.');
    }

    let googleProfile: { googleId: string; email: string; name: string; avatarUrl?: string };

    try {
      const client = this.getGoogleClient();
      const ticket = await client.verifyIdToken({
        idToken,
        audience: config.googleClientId ? [config.googleClientId] : undefined,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub) {
        throw new Error('Token không chứa ID Google hợp lệ.');
      }
      googleProfile = {
        googleId: payload.sub,
        email: payload.email || '',
        name: payload.name || '',
        avatarUrl: payload.picture,
      };
    } catch {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!res.ok) throw new Error('Xác thực token Google thất bại.');
      const data = (await res.json()) as any;
      googleProfile = {
        googleId: data.sub,
        email: data.email || '',
        name: data.name || '',
        avatarUrl: data.picture,
      };
    }

    // Check if this Google account is already linked to another user
    const existing = await prisma.user.findFirst({
      where: { googleId: googleProfile.googleId },
    });

    if (existing && existing.id !== userId) {
      throw new Error(`Tài khoản Google này đã được liên kết với một tài khoản khác (${existing.email}).`);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        googleId: googleProfile.googleId,
        avatarUrl: user.avatarUrl || googleProfile.avatarUrl || null,
      },
    });

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      avatarUrl: updated.avatarUrl,
      googleId: updated.googleId,
      hasPassword: Boolean(updated.passwordHash && updated.passwordHash.length > 0),
      role: updated.role as any,
      status: updated.status as any,
      createdAt: Number(updated.createdAt),
    };
  }

  /**
   * Unlinks Google account from user (only allowed if user has a password)
   */
  public async unlinkGoogleAccount(userId: string): Promise<UserDTO> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Không tìm thấy người dùng.');

    if (!user.passwordHash) {
      throw new Error('Bạn chưa đặt mật khẩu cho tài khoản. Vui lòng tạo mật khẩu trước khi hủy liên kết Google để tránh mất quyền truy cập.');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { googleId: null },
    });

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      avatarUrl: updated.avatarUrl,
      googleId: null,
      hasPassword: true,
      role: updated.role as any,
      status: updated.status as any,
      createdAt: Number(updated.createdAt),
    };
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

    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      throw new Error('Email này đã được đăng ký trên hệ thống.');
    }

    const userId = uuidv7();
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const now = BigInt(Date.now());
    const currentMonth = new Date().toISOString().slice(0, 7);
    const expiresAt = now + BigInt(3650 * 24 * 3600 * 1000);

    const user = await prisma.user.create({
      data: {
        id: userId,
        email: cleanEmail,
        passwordHash,
        name: name.trim(),
        role: 'user',
        status: 'active',
        createdAt: now,
        subscriptions: {
          create: {
            id: uuidv7(),
            planId: 'free',
            status: 'active',
            startsAt: now,
            expiresAt,
            charsUsedMonth: 0,
            lastResetMonth: currentMonth,
          },
        },
      },
    });

    const userDTO: UserDTO = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      googleId: user.googleId,
      hasPassword: true,
      role: user.role as any,
      status: user.status as any,
      createdAt: Number(user.createdAt),
    };

    const subscription = await this.getUserSubscription(userId);
    const token = this.signToken(userDTO);

    return { user: userDTO, subscription, token };
  }

  public async login(email: string, password: string): Promise<AuthResult> {
    const cleanEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      throw new Error('Email hoặc mật khẩu không chính xác.');
    }

    if (user.status === 'banned') {
      throw new Error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
    }

    if (!user.passwordHash) {
      throw new Error('Tài khoản này được tạo bằng Google. Vui lòng bấm Đăng nhập bằng Google hoặc bấm Quên mật khẩu để thiết lập mật khẩu.');
    }

    const isMatch = bcrypt.compareSync(password, user.passwordHash);
    if (!isMatch) {
      throw new Error('Email hoặc mật khẩu không chính xác.');
    }

    const userDTO: UserDTO = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      googleId: user.googleId,
      hasPassword: true,
      role: user.role as any,
      status: user.status as any,
      createdAt: Number(user.createdAt),
    };

    const subscription = await this.getUserSubscription(user.id);
    const token = this.signToken(userDTO);

    return { user: userDTO, subscription, token };
  }

  public async getUserSubscription(userId: string): Promise<UserSubscriptionDTO> {
    const currentMonth = new Date().toISOString().slice(0, 7);

    let sub = await prisma.subscription.findFirst({
      where: { userId },
      orderBy: { startsAt: 'desc' },
      include: { plan: true },
    });

    if (!sub) {
      const subId = uuidv7();
      const now = BigInt(Date.now());
      const expiresAt = now + BigInt(3650 * 24 * 3600 * 1000);

      sub = await prisma.subscription.create({
        data: {
          id: subId,
          userId,
          planId: 'free',
          status: 'active',
          startsAt: now,
          expiresAt,
          charsUsedMonth: 0,
          lastResetMonth: currentMonth,
        },
        include: { plan: true },
      });
    }

    // Check month reset
    if (sub.lastResetMonth !== currentMonth) {
      sub = await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          charsUsedMonth: 0,
          lastResetMonth: currentMonth,
        },
        include: { plan: true },
      });
    }

    let status = sub.status;
    if (sub.planId !== 'free' && Number(sub.expiresAt) < Date.now()) {
      status = 'expired';
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'expired' },
      });
    }

    let features: string[] = [];
    try {
      features = JSON.parse(sub.plan.features || '[]');
    } catch {
      features = [];
    }

    return {
      planId: sub.planId,
      planName: sub.plan.name,
      badge: sub.plan.badge || '',
      status: status as any,
      startsAt: Number(sub.startsAt),
      expiresAt: Number(sub.expiresAt),
      charsUsedMonth: sub.charsUsedMonth,
      charLimitMonthly: sub.plan.charLimitMonthly,
      maxConcurrentJobs: sub.plan.maxConcurrentJobs,
      allowBackgroundJobs: Boolean(sub.plan.allowBackgroundJobs),
      allowAiFormatReview: Boolean(sub.plan.allowAiFormatReview),
      features,
    };
  }

  public async getUserById(userId: string): Promise<{ user: UserDTO; subscription: UserSubscriptionDTO } | null> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const userDTO: UserDTO = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      googleId: user.googleId,
      hasPassword: Boolean(user.passwordHash && user.passwordHash.length > 0),
      role: user.role as any,
      status: user.status as any,
      createdAt: Number(user.createdAt),
    };

    const subscription = await this.getUserSubscription(userId);
    return { user: userDTO, subscription };
  }

  public async updateProfile(userId: string, data: { name?: string; currentPassword?: string; newPassword?: string }): Promise<UserDTO> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Không tìm thấy tài khoản người dùng.');

    let newName = user.name;
    if (data.name && data.name.trim().length > 0) {
      newName = data.name.trim();
    }

    let updatedHash = user.passwordHash;

    if (data.newPassword) {
      if (user.passwordHash) {
        if (!data.currentPassword) {
          throw new Error('Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu mới.');
        }
        const isMatch = bcrypt.compareSync(data.currentPassword, user.passwordHash);
        if (!isMatch) {
          throw new Error('Mật khẩu hiện tại không chính xác.');
        }
      }
      if (data.newPassword.length < 6) {
        throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
      }
      const salt = bcrypt.genSaltSync(10);
      updatedHash = bcrypt.hashSync(data.newPassword, salt);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        name: newName,
        passwordHash: updatedHash,
      },
    });

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      avatarUrl: updated.avatarUrl,
      googleId: updated.googleId,
      hasPassword: Boolean(updated.passwordHash && updated.passwordHash.length > 0),
      role: updated.role as any,
      status: updated.status as any,
      createdAt: Number(updated.createdAt),
    };
  }

  public async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (!user) {
      return {
        success: true,
        message: 'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi đến hộp thư của bạn.',
      };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = BigInt(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: otp,
        resetTokenExpires: expires,
      },
    });

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

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user || !user.resetToken || user.resetToken !== cleanOtp) {
      throw new Error('Mã xác thực không chính xác.');
    }

    if (!user.resetTokenExpires || Number(user.resetTokenExpires) < Date.now()) {
      throw new Error('Mã xác thực đã hết hạn (quá 15 phút). Vui lòng yêu cầu mã mới.');
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        resetToken: null,
        resetTokenExpires: null,
      },
    });

    return {
      success: true,
      message: 'Đặt lại mật khẩu thành công! Bây giờ bạn có thể đăng nhập bằng mật khẩu mới.',
    };
  }
}

export const defaultAuthService = new AuthService();
