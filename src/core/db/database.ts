import mysql, { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '../../config.js';
import bcrypt from 'bcryptjs';

let poolInstance: Pool | null = null;
let isInitialized = false;

/**
 * Returns the MySQL connection pool
 */
export function getDbPool(): Pool {
  if (poolInstance) {
    return poolInstance;
  }

  poolInstance = mysql.createPool({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPass,
    database: config.dbName,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    charset: 'utf8mb4',
  });

  return poolInstance;
}

/**
 * Alias for getDbPool()
 */
export function getDatabase(): Pool {
  return getDbPool();
}

/**
 * Helper to run a SELECT query and return rows
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const pool = getDbPool();
  const [rows] = await pool.query<RowDataPacket[] & T[]>(sql, params);
  return rows as T[];
}

/**
 * Helper to run a SELECT query and return the first row (or null)
 */
export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Helper to run INSERT, UPDATE, DELETE query
 */
export async function execute(sql: string, params: any[] = []): Promise<ResultSetHeader> {
  const pool = getDbPool();
  const [result] = await pool.execute<ResultSetHeader>(sql, params);
  return result;
}

/**
 * Automatically creates database (if not exists), all tables, and seeds initial data
 */
export async function initDatabase(): Promise<void> {
  if (isInitialized) return;

  // 1. Create database if it doesn't exist using root connection without specific database
  try {
    const tempConn = await mysql.createConnection({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPass,
    });
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await tempConn.end();
  } catch (err: any) {
    console.warn(`Lưu ý kết nối MySQL: ${err.message}`);
  }

  const pool = getDbPool();

  // 2. Initialize Tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(100) PRIMARY KEY,
      email VARCHAR(191) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NULL,
      name VARCHAR(255) NOT NULL,
      avatar_url TEXT NULL,
      google_id VARCHAR(100) NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'user',
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      reset_token VARCHAR(50) NULL,
      reset_token_expires BIGINT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_user_google (google_id),
      INDEX idx_user_status (status),
      INDEX idx_user_created (created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Auto-migration for existing users table (add google_id and avatar_url if not exist)
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN google_id VARCHAR(100) NULL AFTER name;`);
  } catch (_) {}
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN avatar_url TEXT NULL AFTER name;`);
  } catch (_) {}
  try {
    await pool.query(`ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL;`);
  } catch (_) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      price_vnd BIGINT NOT NULL,
      duration_days INT NOT NULL DEFAULT 30,
      char_limit_monthly INT NOT NULL,
      max_concurrent_jobs INT NOT NULL DEFAULT 1,
      features TEXT NOT NULL,
      badge VARCHAR(100) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id VARCHAR(100) PRIMARY KEY,
      user_id VARCHAR(100) NOT NULL,
      plan_id VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      starts_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      chars_used_month INT NOT NULL DEFAULT 0,
      last_reset_month VARCHAR(20) NOT NULL,
      INDEX idx_sub_user (user_id),
      INDEX idx_sub_plan (plan_id),
      INDEX idx_sub_status_expires (status, expires_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(100) PRIMARY KEY,
      order_code VARCHAR(100) NOT NULL UNIQUE,
      user_id VARCHAR(100) NOT NULL,
      plan_id VARCHAR(50) NOT NULL,
      amount_vnd BIGINT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      paid_at BIGINT NULL,
      INDEX idx_order_user (user_id),
      INDEX idx_order_code (order_code),
      INDEX idx_order_status (status),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sepay_transactions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      sepay_id BIGINT NOT NULL UNIQUE,
      gateway VARCHAR(100) NOT NULL,
      transaction_date VARCHAR(50) NOT NULL,
      account_number VARCHAR(100) NULL,
      sub_account VARCHAR(250) NULL,
      code VARCHAR(250) NULL,
      amount_in BIGINT NOT NULL DEFAULT 0,
      amount_out BIGINT NOT NULL DEFAULT 0,
      accumulated BIGINT NOT NULL DEFAULT 0,
      content TEXT NULL,
      reference_code VARCHAR(255) NULL,
      body JSON NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_sepay_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id VARCHAR(100) PRIMARY KEY,
      user_id VARCHAR(100) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      adapter_id VARCHAR(100) NOT NULL,
      adapter_name VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL,
      progress_percent INT NOT NULL DEFAULT 0,
      options_json TEXT NOT NULL,
      recipient_email VARCHAR(255) NULL,
      email_sent TINYINT(1) DEFAULT 0,
      total_chunks INT DEFAULT 0,
      cached_chunks INT DEFAULT 0,
      duration_ms INT DEFAULT 0,
      raw_content LONGTEXT NULL,
      translated_content LONGTEXT NULL,
      error_message TEXT NULL,
      created_at BIGINT NOT NULL,
      completed_at BIGINT NULL,
      INDEX idx_jobs_user_created (user_id, created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      \`key\` VARCHAR(100) PRIMARY KEY,
      \`value\` TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 3. Seed Subscription Plans
  const [planRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM subscription_plans');
  if ((planRows as any)[0].count === 0) {
    const plans = [
      [
        'free',
        'Gói Khởi Đầu (Free)',
        0,
        3650,
        20000,
        1,
        JSON.stringify(['Dịch tối đa 20.000 ký tự / tháng', 'Bảo toàn Markdown, Code, TXT', 'Công thức KaTeX và Bảng biểu', 'Tốc độ tiêu chuẩn']),
        'Miễn phí',
        1,
      ],
      [
        'pro',
        'Gói Chuyên Nghiệp (Pro)',
        99000,
        30,
        500000,
        3,
        JSON.stringify([
          'Dịch 500.000 ký tự / tháng (~300 trang sách)',
          'Tất cả định dạng Markdown, JSON, TXT, Docs',
          'Tiến trình dịch nền tự động (Background Jobs)',
          'Tự động gửi file kết quả qua Email',
          'Xử lý đồng thời 3 luồng tốc độ cao',
          'Trợ lý tinh chỉnh câu văn & Linter định dạng',
        ]),
        'Phổ biến nhất',
        1,
      ],
      [
        'enterprise',
        'Gói Doanh Nghiệp (Enterprise)',
        299000,
        30,
        3000000,
        10,
        JSON.stringify([
          'Dịch 3.000.000 ký tự / tháng (~1.800 trang)',
          'Mọi tính năng của gói Pro',
          'Ưu tiên hàng đợi dịch siêu tốc (High Priority)',
          'Không giới hạn dung lượng tải lên mỗi file',
          'Hỗ trợ tích hợp Custom LLM API & Model riêng',
          'Hỗ trợ kỹ thuật 24/7 qua Zalo & Email',
        ]),
        'Cao cấp',
        1,
      ],
    ];

    for (const p of plans) {
      await pool.execute(
        'INSERT INTO subscription_plans (id, name, price_vnd, duration_days, char_limit_monthly, max_concurrent_jobs, features, badge, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        p
      );
    }
  }

  // 4. Seed Default Admin User
  const [userRows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) as count FROM users');
  if ((userRows as any)[0].count === 0) {
    const adminId = 'usr_admin_default';
    const adminEmail = 'admin@translator.local';
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('Admin@123456', salt);
    const now = Date.now();

    await pool.execute(
      'INSERT INTO users (id, email, password_hash, name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [adminId, adminEmail, passwordHash, 'Hệ Thống Quản Trị', 'admin', 'active', now]
    );

    const currentMonth = new Date().toISOString().slice(0, 7);
    await pool.execute(
      'INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, chars_used_month, last_reset_month) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [`sub_admin`, adminId, 'enterprise', 'active', now, now + 3650 * 24 * 3600 * 1000, 0, currentMonth]
    );
  }

  // 5. Seed Default System Settings
  await pool.execute(
    'INSERT INTO system_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `key` = `key`',
    ['bank_name', config.bankName]
  );
  await pool.execute(
    'INSERT INTO system_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `key` = `key`',
    ['bank_account', config.bankAccount]
  );
  await pool.execute(
    'INSERT INTO system_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `key` = `key`',
    ['bank_account_name', config.bankAccountName]
  );
  await pool.execute(
    'INSERT INTO system_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `key` = `key`',
    ['sepay_webhook_secret', config.sepayWebhookSecret]
  );

  isInitialized = true;
}
