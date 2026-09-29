export interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  country_code: string;
  timezone: string;
  created_at: string;
}

/**
 * Column types mirror src/components/supabase/schema.sql (and the
 * ai_pipeline.sql additions) exactly. The database uses plain VARCHAR(50)
 * columns, so these are string unions widened with `| string` where the database
 * does not constrain the value — a narrower type here is schema drift and makes
 * a real row fail to typecheck.
 */

export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'paused'
  | 'trialing'
  | 'past_due'
  | 'incomplete'
  | 'unpaid'
  | (string & {});

export interface Subscription {
  id: string;
  user_id: string;
  plan: string;
  /** VARCHAR(50) DEFAULT 'active' in the database. */
  status: SubscriptionStatus;
  /** Nullable in the database. */
  payment_method: string | null;
  /** Nullable in the database. */
  payment_id: string | null;
  /** Nullable in the database. */
  recurring_id: string | null;
  /** Nullable in the database. */
  current_period_start: string | null;
  /** Nullable in the database. */
  current_period_end: string | null;
  /** cancel_at_period_end BOOLEAN DEFAULT FALSE */
  cancel_at_period_end: boolean;
  /** DECIMAL(10,2), nullable in the database. Supabase returns it as a string. */
  monthly_price: number | string | null;
  /** VARCHAR(3), nullable in the database. */
  currency: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Must stay in sync with `videos_processing_stage_check` in
 * src/components/supabase/ai_pipeline.sql. `finding_clips` is the name the AI
 * worker writes for the Mistral clip-selection stage.
 */
export type VideoProcessingStage =
  | 'uploaded'
  | 'queued'
  | 'extracting'
  | 'transcribing'
  | 'aligning'
  | 'analyzing'
  | 'finding_clips'
  | 'rendering'
  | 'uploading'
  | 'repurposing'
  | 'completed'
  | 'failed';

export interface Video {
  id: string;
  user_id: string;
  title: string;
  original_url: string;
  storage_path: string;
  duration_seconds: number;
  transcript: string;
  /** Added by ai_pipeline.sql. */
  transcript_segments?: TranscriptSegments | null;
  /** Added by ai_pipeline.sql, CHECK-constrained to VideoProcessingStage. */
  processing_stage?: VideoProcessingStage | null;
  status: 'processing' | 'completed' | 'failed';
  processing_started_at?: string | null;
  processing_ended_at?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptSegments {
  language?: string | null;
  segments?: { start: number; end: number; text: string }[];
  words?: { text: string; start: number; end: number }[];
}

export interface ClipCandidate {
  id: string;
  video_id: string;
  start_time: number;
  end_time: number;
  score: number;
  hook_score: number;
  story_score: number;
  information_score: number;
  emotion_score: number;
  visual_score: number;
  context_independence: number;
  reason?: string | null;
}

export interface GeneratedClip {
  id: string;
  video_id: string;
  candidate_id: string | null;
  storage_path: string | null;
  thumb_path: string | null;
  duration: number | null;
  aspect_ratio: string | null;
  caption_style: string | null;
  status: string;
  created_at: string;
  video_url?: string | null;
  thumb_url?: string | null;
  clip_candidates?: ClipCandidate | ClipCandidate[] | null;
}

/**
 * repurposed_content.content_type is a nullable VARCHAR(50) in the database.
 * The union documents the values the app writes; `| (string & {})` keeps
 * unknown stored values from breaking typechecking.
 */
export type RepurposeContentType =
  | 'shorts'
  | 'tweets'
  | 'blog'
  | 'emails'
  | 'linkedin'
  | 'thumbnails'
  | 'hooks'
  | (string & {});

export interface RepurposedContent {
  id: string;
  video_id: string;
  content_type: RepurposeContentType | null;
  content_text: string | null;
  content_url: string | null;
  is_edited: boolean;
  edited_by_user_at: string | null;
  posted_to_platform: string | null;
  posted_at: string | null;
  created_at: string;
}

/**
 * payments uses external_payment_id (not payment_id) and DECIMAL(10,2) amounts,
 * which supabase-js returns as strings.
 */
export interface Payment {
  id: string;
  user_id: string;
  subscription_id: string | null;
  amount: number | string | null;
  currency: string | null;
  payment_method: string | null;
  external_payment_id: string | null;
  status: string | null;
  invoice_url: string | null;
  receipt_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type Plan = 'basic' | 'pro' | 'enterprise';