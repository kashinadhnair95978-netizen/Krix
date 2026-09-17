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
  status: 'processing' | 'completed' | 'failed';
  error_message?: string;
  created_at: string;
  updated_at: string;
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