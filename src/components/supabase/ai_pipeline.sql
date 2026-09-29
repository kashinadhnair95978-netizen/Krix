-- ============================================
-- Krix AI Pipeline — Supabase Migration
-- Run in the Supabase SQL Editor AFTER schema.sql.
--
-- Idempotent: safe to run more than once. Every CREATE POLICY is preceded by a
-- DROP POLICY IF EXISTS, every column/index/bucket uses IF NOT EXISTS, and the
-- updated_at triggers are created with CREATE OR REPLACE. Re-running this file
-- is a no-op instead of an error.
--
-- Verified against the live project on 2026-09-27: `videos` already had
-- duration_seconds, transcript, status, processing_started_at,
-- processing_ended_at, error_message, created_at and updated_at. It did NOT have
-- processing_stage or transcript_segments, and clip_candidates,
-- generated_clips, video_analysis_jobs and the generated_clips bucket were all
-- absent — which is what this migration adds.
-- ============================================

-- ---------------------------------------------------------------------------
-- 0. updated_at maintenance
-- The AI worker talks to Supabase over PostgREST only, so it cannot call
-- now(). These triggers are what keep updated_at honest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_videos_updated_at ON videos;
CREATE TRIGGER trg_videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- NOTE: the video_analysis_jobs trigger is created in section 4, immediately
-- after that table exists. Creating it here would fail on a database where the
-- table has not been created yet.

-- ---------------------------------------------------------------------------
-- 1. Extend existing videos table (columns referenced by the AI worker)
-- ---------------------------------------------------------------------------
ALTER TABLE videos ADD COLUMN IF NOT EXISTS processing_stage VARCHAR(50) NOT NULL DEFAULT 'uploaded';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS transcript_segments JSONB;

-- A backfill so existing rows are not left on the default forever.
UPDATE videos SET processing_stage = 'completed'
WHERE status = 'completed' AND processing_stage = 'uploaded';

-- Keep stage values aligned with the worker's stage list. The worker writes
-- exactly: transcribing, analyzing, finding_clips, rendering, completed, failed
-- (plus the 'uploaded' column default). 'finding_clips' is the name the worker
-- uses for the Mistral stage - do NOT rename it to 'detecting' here, or every
-- job fails this constraint the moment it reaches clip selection.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'videos_processing_stage_check'
  ) THEN
    ALTER TABLE videos ADD CONSTRAINT videos_processing_stage_check
      CHECK (processing_stage IN (
        'uploaded', 'queued', 'extracting', 'transcribing', 'aligning',
        'analyzing', 'finding_clips', 'rendering', 'uploading', 'repurposing',
        'completed', 'failed'
      ));
  END IF;
END $$;

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
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT clip_candidates_time_check CHECK (end_time > start_time)
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

-- The jobs updated_at trigger belongs here, not in section 0: the table has to
-- exist before a trigger can be attached to it.
DROP TRIGGER IF EXISTS trg_video_analysis_jobs_updated_at ON video_analysis_jobs;
CREATE TRIGGER trg_video_analysis_jobs_updated_at
  BEFORE UPDATE ON video_analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security for the new tables
-- ---------------------------------------------------------------------------
ALTER TABLE clip_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_analysis_jobs ENABLE ROW LEVEL SECURITY;

-- clip_candidates: owned through the video
DROP POLICY IF EXISTS "Users can read own clip candidates" ON clip_candidates;
CREATE POLICY "Users can read own clip candidates" ON clip_candidates
  FOR SELECT USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can insert own clip candidates" ON clip_candidates;
CREATE POLICY "Users can insert own clip candidates" ON clip_candidates
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can update own clip candidates" ON clip_candidates;
CREATE POLICY "Users can update own clip candidates" ON clip_candidates
  FOR UPDATE USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can delete own clip candidates" ON clip_candidates;
CREATE POLICY "Users can delete own clip candidates" ON clip_candidates
  FOR DELETE USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );

-- generated_clips: owned through the video
DROP POLICY IF EXISTS "Users can read own generated clips" ON generated_clips;
CREATE POLICY "Users can read own generated clips" ON generated_clips
  FOR SELECT USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can insert own generated clips" ON generated_clips;
CREATE POLICY "Users can insert own generated clips" ON generated_clips
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can update own generated clips" ON generated_clips;
CREATE POLICY "Users can update own generated clips" ON generated_clips
  FOR UPDATE USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can delete own generated clips" ON generated_clips;
CREATE POLICY "Users can delete own generated clips" ON generated_clips
  FOR DELETE USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );

-- video_analysis_jobs: owned through the video
DROP POLICY IF EXISTS "Users can read own jobs" ON video_analysis_jobs;
CREATE POLICY "Users can read own jobs" ON video_analysis_jobs
  FOR SELECT USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can insert own jobs" ON video_analysis_jobs;
CREATE POLICY "Users can insert own jobs" ON video_analysis_jobs
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can update own jobs" ON video_analysis_jobs;
CREATE POLICY "Users can update own jobs" ON video_analysis_jobs
  FOR UPDATE USING (
    video_id IN (SELECT id FROM videos WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clip_candidates_video_id ON clip_candidates(video_id);
CREATE INDEX IF NOT EXISTS idx_generated_clips_video_id ON generated_clips(video_id);
CREATE INDEX IF NOT EXISTS idx_video_analysis_jobs_video_id ON video_analysis_jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_video_analysis_jobs_job_id ON video_analysis_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_videos_processing_stage ON videos(processing_stage);
CREATE INDEX IF NOT EXISTS idx_videos_user_status ON videos(user_id, status);

-- ---------------------------------------------------------------------------
-- 7. Storage bucket for generated clips (private; owner-only via first path segment)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated_clips', 'generated_clips', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload generated clips" ON storage.objects;
CREATE POLICY "Users can upload generated clips" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'generated_clips' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can read own generated clips" ON storage.objects;
CREATE POLICY "Users can read own generated clips" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'generated_clips' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete own generated clips" ON storage.objects;
CREATE POLICY "Users can delete own generated clips" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'generated_clips' AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- 8. Automatic repurposing support
-- The worker's post-pipeline callback is idempotent by (video_id, content_type),
-- so a retried callback overwrites instead of duplicating.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'repurposed_content'
  ) THEN
    EXECUTE '
      CREATE UNIQUE INDEX IF NOT EXISTS idx_repurposed_content_video_type
      ON repurposed_content (video_id, content_type)
    ';
  END IF;
END $$;
