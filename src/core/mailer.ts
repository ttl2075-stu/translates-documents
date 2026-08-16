import nodemailer from 'nodemailer';
import { config } from '../config.js';

export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface SendDocumentEmailOptions {
  recipientEmail: string;
  filename: string;
  translatedContent: string;
  sourceLang?: string;
  targetLang?: string;
  stats: {
    durationMs: number;
    totalChunks: number;
    cachedChunks?: number;
    totalChars?: number;
  };
}

export class MailerService {
  private getTransporter(overrideConfig?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
  }) {
    const host = overrideConfig?.host || config.smtpHost;
    const port = overrideConfig?.port || config.smtpPort;
    const secure = overrideConfig?.secure !== undefined ? overrideConfig.secure : config.smtpSecure;
    const user = overrideConfig?.user || config.smtpUser;
    const pass = overrideConfig?.pass || config.smtpPass;

    if (!host) {
      throw new Error('Chưa cấu hình SMTP Host của Mail Server.');
    }

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      tls: {
        rejectUnauthorized: false, // Allows self-signed certificates in local / intranet environments
      },
    });
  }

  /**
   * Tests SMTP Mail Server connection
   */
  async testConnection(customConfig?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const transporter = this.getTransporter(customConfig);
      await transporter.verify();
      return {
        success: true,
        message: 'Kết nối tới SMTP Mail Server thành công!',
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Không thể kết nối Mail Server: ${error.message}`,
      };
    }
  }

  /**
   * Sends the translated document file as an attachment to the recipient's email
   */
  async sendDocumentEmail(options: SendDocumentEmailOptions): Promise<EmailDeliveryResult> {
    const { recipientEmail, filename, translatedContent, sourceLang = 'auto', targetLang = 'vi', stats } = options;

    if (!recipientEmail || !recipientEmail.includes('@')) {
      return { success: false, error: 'Địa chỉ email người nhận không hợp lệ.' };
    }

    try {
      const transporter = this.getTransporter();
      const durationSec = (stats.durationMs / 1000).toFixed(1);
      const cacheNote = stats.cachedChunks ? ` (${stats.cachedChunks}/${stats.totalChunks} đoạn từ Cache ⚡)` : '';

      const htmlContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; color: #1e293b;">
          <div style="background-color: #2563eb; padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700;">AI Document Translator</h1>
            <p style="margin: 6px 0 0 0; font-size: 13px; opacity: 0.9;">Bản dịch tài liệu của bạn đã hoàn tất</p>
          </div>
          
          <div style="padding: 24px;">
            <p style="margin-top: 0; font-size: 14px; line-height: 1.6;">Xin chào,</p>
            <p style="font-size: 14px; line-height: 1.6;">Tiến trình dịch tài liệu chạy trong nền của bạn đã hoàn thành thành công. File tài liệu đã dịch được đính kèm trực tiếp trong email này.</p>
            
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Tên file:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${filename}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Ngôn ngữ:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${sourceLang} &rarr; ${targetLang}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Số phần (Chunks):</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${stats.totalChunks} đoạn${cacheNote}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;">Thời gian xử lý:</td>
                  <td style="padding: 6px 0; font-weight: 600; text-align: right;">${durationSec}s</td>
                </tr>
              </table>
            </div>

            <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 0;">
              Vui lòng xem file đính kèm để mở hoặc lưu tài liệu. Cảm ơn bạn đã sử dụng hệ thống!
            </p>
          </div>

          <div style="background-color: #f1f5f9; padding: 12px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
            Email tự động từ AI Document Translator Server &bull; Không cần trả lời email này
          </div>
        </div>
      `;

      const info = await transporter.sendMail({
        from: config.smtpFrom,
        to: recipientEmail,
        subject: `[AI Translator] Bản dịch hoàn tất: ${filename}`,
        html: htmlContent,
        attachments: [
          {
            filename,
            content: Buffer.from(translatedContent, 'utf-8'),
          },
        ],
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error: any) {
      console.error('Lỗi khi gửi email bản dịch:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sends arbitrary notification or transactional email
   */
  async sendCustomEmail(options: { to: string; subject: string; html: string; text?: string }): Promise<EmailDeliveryResult> {
    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: config.smtpFrom,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error: any) {
      console.error('Lỗi khi gửi email:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

export const defaultMailerService = new MailerService();

