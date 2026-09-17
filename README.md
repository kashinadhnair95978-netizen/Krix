# Krix

✅ **COMPLETE AI Content Repurposing SaaS** — Turn 1 video into 100 posts.

Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase + Stripe/Razorpay (geo-aware) + any AI provider (Claude, GPT, Gemini, OpenRouter, OpenAI-compatible).

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in your Supabase, Stripe, Razorpay, OpenAI, Anthropic keys

# 3. Set up the database
# Open Supabase SQL Editor and run supabase/schema.sql

# 4. Run the dev server
npm run dev
# Open http://localhost:3000

# 5. Build & deploy
npm run build
npm run start
```

## 📁 Project Structure

```
src/
├── app/                  # App Router pages & API routes
│   ├── page.tsx          # Landing page
│   ├── auth/             # Signup, login, callback
│   ├── dashboard/        # Dashboard, upload, videos, content, settings
│   ├── pricing/          # Pricing + geo-aware payment selector
│   └── api/              # Auth, upload, repurpose, payments, subscription...
├── components/
│   ├── landing/          # Hero, Problem, Solution, HowItWorks, Pricing, Testimonials, FAQ, CTA
│   ├── dashboard/        # Navbar, Sidebar, VideoUpload, VideoLibrary, RepurposedContent, ContentEditor, DownloadButton
│   ├── auth/             # SignupForm, LoginForm, ProtectedRoute
│   ├── payment/          # StripeCheckout, RazorpayCheckout, PaymentSelector
│   └── ui/               # Button, Card, Input, Textarea, Modal, Loading
├── lib/                  # supabase, stripe, razorpay, geoip, api-client, hooks, utils, auth-utils
├── types/                # TypeScript interfaces
└── middleware.ts         # Route protection
supabase/schema.sql       # Full database schema + RLS + storage
```

## 🔑 Environment Variables

See `.env.example` for the full list:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase auth, database, storage |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe payments |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay payments (India) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI (GPT) content generation · also Whisper transcription |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude content generation |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Google Gemini content generation |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | OpenRouter (any model) content generation |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | Any OpenAI-compatible endpoint (Groq, Together, Ollama, LM Studio…) |
| `AI_PROVIDER` | `auto` (default) or `anthropic` \| `openai` \| `gemini` \| `openrouter` \| `custom` |
| `MAXMIND_ACCOUNT_ID` / `MAXMIND_LICENSE_KEY` | Geo-IP country detection |
| `NEXT_PUBLIC_APP_URL` | App base URL |

## 🌍 Geo-Aware Payments

Users are geo-located via MaxMind GeoIP. Indian subcontinent users (IN, BD, LK, PK) are routed to **Razorpay**; everyone else goes to **Stripe**. The provider is auto-detected at `/api/payments/provider` and used by the `PaymentSelector` component.

## 🤖 AI Pipeline

Works with **any AI provider** — Claude, OpenAI, Google Gemini, OpenRouter, or any OpenAI-compatible endpoint (Groq, Together, Ollama, LM Studio…). Set `AI_PROVIDER` to one of `anthropic | openai | gemini | openrouter | custom`, or leave it as `auto` to use the first API key found. Override the model per-provider (e.g. `OPENAI_MODEL`) or globally with `AI_MODEL`.

1. **Upload** → file to Supabase Storage, row created in `videos`
2. **Process** (`/api/process-video`) → transcription
3. **Repurpose** (`/api/repurpose`) → the configured AI provider generates tweets, blog outline, emails, LinkedIn posts, short hooks using the transcript
4. **Review** → edit/copy/download outputs in the dashboard

## 🧪 Database

`supabase/schema.sql` creates `users`, `subscriptions`, `videos`, `repurposed_content`, `payments`, `usage_logs`, `api_keys` with Row Level Security and the `videos` storage bucket.

## 🏁 Deployment (Vercel)

```bash
npm i -g vercel
vercel login
vercel
```

Set all env vars in the Vercel dashboard. Configure webhooks:

```bash
# Stripe
stripe listen --forward-to https://yourdomain.com/api/payments/webhook
# Razorpay: Dashboard → Settings → Webhooks → https://yourdomain.com/api/payments/webhook
```