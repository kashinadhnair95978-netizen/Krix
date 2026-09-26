-- ============================================
-- Krix AI Pipeline — Supabase Migration
-- Run in the Supabase SQL Editor AFTER schema.sql.
-- Non-destructive: adds new tables/columns/bucket only.
-- ============================================

-- ---------------------------------------------------------------------------
-- 1. Extend existing videos table (columns referenced by the AI worker)
-- ---------------------------------------------------------------------------
ALTER TABLE videos ADD COLUMN IF NOT EXISTS processing_stage VARCHAR(50) NOT NULL DEFAULT 'uploaded';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_segments JSONB;

-- ---------------------------------------------------------------------------
-- 2. Clip candidates — one row per potential clip the model recommends
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clip_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  hook_score REAL NOT NULL DEFAULT 0,
  story_score REAL NOT NULL DEFAULT 0,
  information_score REAL NOT NULL DEFAULT 0,
  emotion_score REAL NOT NULL DEFAULT 0,
  visual_score REAL NOT NULL DEFAULT 0,
  context_independence REAL NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. Generated clips — the rendered, uploadable 9:16 clips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generated_clips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES clip_candidates(id) ON DELETE SET NULL,
  storage_path TEXT,
  thumb_path TEXT,
  duration REAL,
  aspect_ratio VARCHAR(12) DEFAULT '9:16',
  caption_style VARCHAR(50),
  status VARCHAR(50) DEFAULT 'ready',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. Video analysis jobs — live pipeline stage tracking for polling
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS video_analysis_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id TEXT UNIQUE NOT NULL,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  stage VARCHAR(50),
  error_code VARCHAR(100),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. Row Level Security for the new tables
-- ---------------------------------------------------------------------------
ALTER TABLE clip_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_analysis_jobs ENABLE ROW LEVEL SECURITY;

-- clip_candidates: owned through the video
CREATE POLICY "Users can read own clip candidates" ON clip_candidates
  FOR SELECT USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can insert own clip candidates" ON clip_candidates
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can update own clip candidates" ON clip_candidates
  FOR UPDATE USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can delete own clip candidates" ON clip_candidates
  FOR DELETE USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );

-- generated_clips: owned through the video
CREATE POLICY "Users can read own generated clips" ON generated_clips
  FOR SELECT USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can insert own generated clips" ON generated_clips
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can update own generated clips" ON generated_clips
  FOR UPDATE USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can delete own generated clips" ON generated_clips
  FOR DELETE USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );

-- video_analysis_jobs: owned through the video
CREATE POLICY "Users can read own jobs" ON video_analysis_jobs
  FOR SELECT USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
CREATE POLICY "Users can insert own jobs" ON video_analysis_jobs
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clip_candidates_video_id ON clip_candidates(video_id);
CREATE INDEX IF NOT EXISTS idx_generated_clips_video_id ON generated_clips(video_id);
CREATE INDEX IF NOT EXISTS idx_video_analysis_jobs_video_id ON video_analysis_jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_videos_processing_stage ON videos(processing_stage);

-- ---------------------------------------------------------------------------
-- 7. Storage bucket for generated clips (private; owner-only via first path segment)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated_clips', 'generated_clips', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload generated clips" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'generated_clips' AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can read own generated clips" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'generated_clips' AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own generated clips" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'generated_clips' AND auth.uid()::text = (storage.foldername(name))[1]
  );