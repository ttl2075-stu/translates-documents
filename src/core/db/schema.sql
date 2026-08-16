-- ==========================================================
-- AI Document Translator & SaaS Platform - MySQL Database Schema
-- Character Set: utf8mb4 / utf8mb4_unicode_ci
-- ==========================================================

CREATE DATABASE IF NOT EXISTS translate_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE translate_saas;

-- 1. Users Table (Hỗ trợ đăng ký thường & Google OAuth)
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

-- 2. Subscription Plans
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

-- 3. Subscriptions (Active & Historic)
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

-- 4. Payment Orders
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

-- 5. SePay Transactions (Production-ready with Idempotent unique key)
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

-- 6. Background Jobs
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

-- 7. System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    `key` VARCHAR(100) PRIMARY KEY,
    `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
