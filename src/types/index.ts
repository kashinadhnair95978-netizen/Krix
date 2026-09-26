export interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  country_code: string;
  timezone: string;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan: 'basic' | 'pro' | 'enterprise';
  status: 'active' | 'canceled' | 'paused';
  payment_method: 'stripe' | 'razorpay';
  payment_id: string;
  recurring_id: string;
  current_period_start: string;
  current_period_end: string;
  monthly_price: number;
  currency: string;
}

export interface Video {
  id: string;
  user_id: string;
  title: string;
  original_url: string;
  storage_path: string;
  duration_seconds: number;
  transcript: string;
  transcript_segments?: TranscriptSegments | null;
  processing_stage?:
    | 'uploaded'
    | 'queued'
    | 'transcribing'
    | 'analyzing'
    | 'finding_clips'
    | 'rendering'
    | 'completed'
    | 'failed'
    | string;
  status: 'processing' | 'completed' | 'failed';
  error_message?: string;
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

export interface RepurposedContent {
  id: string;
  video_id: string;
  content_type:
    | 'shorts'
    | 'tweets'
    | 'blog'
    | 'emails'
    | 'linkedin'
    | 'thumbnails'
    | 'hooks';
  content_text: string;
  content_url?: string;
  is_edited: boolean;
  created_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  payment_method: 'stripe' | 'razorpay';
  status: 'pending' | 'success' | 'failed';
  invoice_url?: string;
  created_at: string;
}

export type Plan = 'basic' | 'pro' | 'enterprise';