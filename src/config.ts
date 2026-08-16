import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  port: number;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  concurrency: number;
  maxChunkSize: number;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openaiModel: process.env.OPENAI_MODEL || 'deepseek-chat',
  concurrency: parseInt(process.env.TRANSLATION_CONCURRENCY || '3', 10),
  maxChunkSize: parseInt(process.env.MAX_CHUNK_SIZE || '1200', 10),
};

export function updateRuntimeConfig(newConfig: Partial<AppConfig>): AppConfig {
  if (newConfig.openaiApiKey !== undefined) config.openaiApiKey = newConfig.openaiApiKey;
  if (newConfig.openaiBaseUrl !== undefined) config.openaiBaseUrl = newConfig.openaiBaseUrl;
  if (newConfig.openaiModel !== undefined) config.openaiModel = newConfig.openaiModel;
  if (newConfig.concurrency !== undefined) config.concurrency = newConfig.concurrency;
  if (newConfig.maxChunkSize !== undefined) config.maxChunkSize = newConfig.maxChunkSize;
  return config;
}
