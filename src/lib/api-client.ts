import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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

export const apiClient = {
  // Auth
  signup: (email: string, password: string, name: string) =>
    api.post('/api/auth/signup', { email, password, name }),
  login: (email: string, password: string) =>
    api.post('/api/auth/login', { email, password }),
  logout: () => api.post('/api/auth/logout'),

  // Videos
  uploadVideo: (formData: FormData) =>
    api.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  getVideos: () => api.get('/api/videos'),
  getVideoById: (videoId: string) => api.get(`/api/videos/${videoId}`),
  deleteVideo: (videoId: string) => api.delete(`/api/videos/${videoId}`),

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