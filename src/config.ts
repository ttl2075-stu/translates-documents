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
  return config;
}
