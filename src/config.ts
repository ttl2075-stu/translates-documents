import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  port: number;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  concurrency: number;
  maxChunkSize: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  jwtSecret: string;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPass: string;
  dbName: string;
  sepayWebhookSecret: string;
  bankName: string;
  bankAccount: string;
  bankAccountName: string;
  siteUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  googleCallbackUrl: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openaiModel: process.env.OPENAI_MODEL || 'deepseek-chat',
  concurrency: parseInt(process.env.TRANSLATION_CONCURRENCY || '3', 10),
  maxChunkSize: parseInt(process.env.MAX_CHUNK_SIZE || '1200', 10),
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || 'AI Document Translator <noreply@translator.local>',
  jwtSecret: process.env.JWT_SECRET || 'trans-saas-jwt-secret-key-change-in-production-2026',
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: parseInt(process.env.DB_PORT || '3306', 10),
  dbUser: process.env.DB_USER || 'root',
  dbPass: process.env.DB_PASS || '',
  dbName: process.env.DB_NAME || 'translate_saas',
  sepayWebhookSecret: process.env.SEPAY_WEBHOOK_SECRET || '',
  bankName: process.env.BANK_NAME || 'MBBank',
  bankAccount: process.env.BANK_ACCOUNT || '0988888888',
  bankAccountName: process.env.BANK_ACCOUNT_NAME || 'TRANSLATE SAAS CO',
  siteUrl: process.env.SITE_URL || 'http://localhost:3000',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
};

export function updateRuntimeConfig(newConfig: Partial<AppConfig>): AppConfig {
  if (newConfig.openaiApiKey !== undefined) config.openaiApiKey = newConfig.openaiApiKey;
  if (newConfig.openaiBaseUrl !== undefined) config.openaiBaseUrl = newConfig.openaiBaseUrl;
  if (newConfig.openaiModel !== undefined) config.openaiModel = newConfig.openaiModel;
  if (newConfig.concurrency !== undefined) config.concurrency = newConfig.concurrency;
  if (newConfig.maxChunkSize !== undefined) config.maxChunkSize = newConfig.maxChunkSize;
  if (newConfig.smtpHost !== undefined) config.smtpHost = newConfig.smtpHost;
  if (newConfig.smtpPort !== undefined) config.smtpPort = newConfig.smtpPort;
  if (newConfig.smtpSecure !== undefined) config.smtpSecure = newConfig.smtpSecure;
  if (newConfig.smtpUser !== undefined) config.smtpUser = newConfig.smtpUser;
  if (newConfig.smtpPass !== undefined) config.smtpPass = newConfig.smtpPass;
  if (newConfig.smtpFrom !== undefined) config.smtpFrom = newConfig.smtpFrom;
  if (newConfig.jwtSecret !== undefined) config.jwtSecret = newConfig.jwtSecret;
  if (newConfig.dbHost !== undefined) config.dbHost = newConfig.dbHost;
  if (newConfig.dbPort !== undefined) config.dbPort = newConfig.dbPort;
  if (newConfig.dbUser !== undefined) config.dbUser = newConfig.dbUser;
  if (newConfig.dbPass !== undefined) config.dbPass = newConfig.dbPass;
  if (newConfig.dbName !== undefined) config.dbName = newConfig.dbName;
  if (newConfig.sepayWebhookSecret !== undefined) config.sepayWebhookSecret = newConfig.sepayWebhookSecret;
  if (newConfig.bankName !== undefined) config.bankName = newConfig.bankName;
  if (newConfig.bankAccount !== undefined) config.bankAccount = newConfig.bankAccount;
  if (newConfig.bankAccountName !== undefined) config.bankAccountName = newConfig.bankAccountName;
  if (newConfig.siteUrl !== undefined) config.siteUrl = newConfig.siteUrl;
  if (newConfig.googleClientId !== undefined) config.googleClientId = newConfig.googleClientId;
  if (newConfig.googleClientSecret !== undefined) config.googleClientSecret = newConfig.googleClientSecret;
  if (newConfig.googleCallbackUrl !== undefined) config.googleCallbackUrl = newConfig.googleCallbackUrl;
  return config;
}
