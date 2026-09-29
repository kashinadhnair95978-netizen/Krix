import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Wall-clock ceiling for the two ingestion calls.
 *
 * Without it a stalled request (server buffering a large body, dead proxy, no
 * answer from storage) leaves the button reading "Uploading..." forever with no
 * result and no error. With it the user gets a real, actionable message and can
 * retry. Large files get proportionally more time.
 */
const UPLOAD_BASE_TIMEOUT_MS = 5 * 60 * 1000;
const UPLOAD_PER_MB_MS = 15 * 1000;
const UPLOAD_MAX_TIMEOUT_MS = 30 * 60 * 1000;

function uploadTimeoutFor(bytes: number): number {
  const t = UPLOAD_BASE_TIMEOUT_MS + (bytes / (1024 * 1024)) * UPLOAD_PER_MB_MS;
  return Math.min(Math.round(t), UPLOAD_MAX_TIMEOUT_MS);
}

const INGEST_URL_TIMEOUT_MS = 20 * 60 * 1000;

// Attach user id header from session if available
if (typeof window !== 'undefined') {
  api.interceptors.request.use((config) => {
    const userId = (window as any).__USER_ID__;
    if (userId) {
      config.headers['x-user-id'] = userId;
    }
    return config;
  });
}

export interface IngestLimits {
  maxBytes: number;
  maxMegabytes?: number;
  appMaxBytes?: number;
  storageMaxBytes?: number;
  providers?: string[];
  maxDurationSeconds?: number;
}

export interface IngestResult {
  success: boolean;
  videoId: string;
  status: string;
  deduplicated?: boolean;
  /** Why a duplicate was returned: active | completed | failed | downloading. */
  duplicateState?: 'active' | 'completed' | 'failed' | 'downloading';
  retryAfterSeconds?: number;
  lastError?: string;
  pipelineTriggered?: boolean;
  originalUrl?: string;
  message?: string;
}

/** Normalize a server error body into a message worth showing a user. */
export function ingestErrorMessage(
  err: unknown,
  fallback: string
): string {
  const e = err as {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { message?: string; error?: string } };
  };
  if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') {
    return `${fallback} The request timed out before the server answered. The import may still be running on the server — check your library before starting another one.`;
  }
  if (!e?.response) {
    return `${fallback} Could not reach the server. Check your connection — if you retry, check your library first so you do not import the same video twice.`;
  }
  return e.response.data?.message || fallback;
}

export const apiClient = {
  // Auth
  signup: (email: string, password: string, name: string) =>
    api.post('/api/auth/signup', { email, password, name }),
  login: (email: string, password: string) =>
    api.post('/api/auth/login', { email, password }),
  logout: () => api.post('/api/auth/logout'),

  // Videos
  /**
   * `onUploadProgress` drives a real progress bar. `timeout` is what stops a
   * hung request from being indistinguishable from a slow one.
   */
  uploadVideo: (
    formData: FormData,
    onUploadProgress?: (percent: number) => void
  ) => {
    const file = formData.get('file');
    const bytes = file instanceof File ? file.size : 0;
    return api.post<IngestResult>('/api/upload', formData, {
      // Let the browser set the multipart boundary itself.
      headers: { 'Content-Type': undefined },
      timeout: uploadTimeoutFor(bytes),
      onUploadProgress: onUploadProgress
        ? (e) => {
            if (e.total) {
              onUploadProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
            }
          }
        : undefined,
    });
  },
  getUploadLimits: () => api.get<IngestLimits>('/api/upload'),
  getVideos: () => api.get('/api/videos'),
  getVideoById: (videoId: string) => api.get(`/api/videos/${videoId}`),
  deleteVideo: (videoId: string) => api.delete(`/api/videos/${videoId}`),

  /**
   * Server-side remote-video import. The browser only ever sends the URL — the
   * download happens in the Next.js server process.
   */
  ingestUrl: (url: string) =>
    api.post<IngestResult>('/api/ingest-url', { url }, { timeout: INGEST_URL_TIMEOUT_MS }),
  getIngestLimits: () => api.get<IngestLimits>('/api/ingest-url'),

  // AI clips
  getGeneratedClips: (videoId: string) =>
    api.get(`/api/clips`, { params: { videoId } }),

  // Repurposing
  repurposeVideo: (videoId: string) => api.post('/api/repurpose', { videoId }),
  getContent: (videoId: string) => api.get(`/api/content/${videoId}`),
  updateContent: (contentId: string, content: any) =>
    api.put(`/api/content/${contentId}`, content),
  deleteContent: (contentId: string) =>
    api.delete(`/api/content/${contentId}`),

  // Payments
  createPayment: (plan: string, country: string) =>
    api.post('/api/payments/create', { plan, country }),
  verifyPayment: (paymentId: string, signature: string) =>
    api.post('/api/payments/verify', { paymentId, signature }),

  // Subscription
  getSubscription: () => api.get('/api/subscription'),
  updatePaymentMethod: (paymentMethodId: string) =>
    api.put('/api/subscription/payment-method', { paymentMethodId }),
  cancelSubscription: () => api.post('/api/subscription'),
};
