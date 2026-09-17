-- ============================================
-- Repurpose Engine — Supabase Database Schema
-- Run this in the Supabase SQL Editor
-- ============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  full_name VARCHAR(255),
  avatar_url TEXT,
  country_code VARCHAR(2),
  timezone VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  email_verified_at TIMESTAMP
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  payment_method VARCHAR(50),
  payment_id VARCHAR(255),
  recurring_id VARCHAR(255),
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  monthly_price DECIMAL(10, 2),
  currency VARCHAR(3),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, recurring_id)
);

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255),
  original_url TEXT,
  storage_path TEXT,
  duration_seconds INT,
  transcript TEXT,
  status VARCHAR(50) DEFAULT 'processing',
  processing_started_at TIMESTAMP,
  processing_ended_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Repurposed Content table
CREATE TABLE IF NOT EXISTS repurposed_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  content_type VARCHAR(50),
  content_text TEXT,
  content_url TEXT,
  is_edited BOOLEAN DEFAULT FALSE,
  edited_by_user_at TIMESTAMP,
  posted_to_platform VARCHAR(50),
  posted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id),
  amount DECIMAL(10, 2),
  currency VARCHAR(3),
  payment_method VARCHAR(50),
  external_payment_id VARCHAR(255),
  status VARCHAR(50),
  invoice_url TEXT,
  receipt_url TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Usage Logs table
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_processed_count INT DEFAULT 1,
  api_calls INT DEFAULT 0,
  storage_used_mb DECIMAL(10, 2),
  month VARCHAR(7),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, month)
);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) UNIQUE,
  name VARCHAR(100),
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE repurposed_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Users: can read/update only their own data
CREATE POLICY "Users can read own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can read own videos" ON videos
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own videos" ON videos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own videos" ON videos
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own videos" ON videos
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can read own subscriptions" ON subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions" ON subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Repurposed content: access through owned videos
CREATE POLICY "Users can read own content" ON repurposed_content
  FOR SELECT USING (
    video_id IN (
      SELECT id FROM videos WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own content" ON repurposed_content
  FOR INSERT WITH CHECK (
    video_id IN (
      SELECT id FROM videos WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own content" ON repurposed_content
  FOR UPDATE USING (
    video_id IN (
      SELECT id FROM videos WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own content" ON repurposed_content
  FOR DELETE USING (
    video_id IN (
      SELECT id FROM videos WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_repurposed_content_video_id ON repurposed_content(video_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);

-- ============================================
-- Storage buckets
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('videos', 'videos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload videos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read own videos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own videos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]
  );