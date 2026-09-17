# 🎬 Krix

> **Turn 1 video into 100 posts.** An AI content repurposing SaaS — upload a video once and get tweets, blogs, emails, LinkedIn posts, and shorts written for every platform — automatically.

**Built by [Kashinadh Nair](https://github.com/kashinadhnair95978-netizen)** · Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase + Stripe/Razorpay + any AI provider (Claude, GPT, Gemini, OpenRouter, OpenAI-compatible).

---

## ✨ Features

### AI Content Repurposing
- **1 video in → a month of content out** — upload once and get ready-to-post material for every platform.
- **6 output formats generated automatically:**
  - **YouTube Shorts** — highlight clips captioned and ready to upload
  - **Twitter / X** — a dozen tweet variations written in your voice
  - **Blog posts** — SEO-friendly outlines and first drafts from the transcript
  - **Email sequences** — a five-email nurture sequence
  - **LinkedIn posts** — professional hooks and insights
  - **Thumbnails & hooks** — click-worthy visuals and opening lines
- **Automatic transcription** — every video is transcribed (OpenAI Whisper) and repurposed from the transcript.

### AI Editing Models
- **AI Producer** — turn raw footage into a polished, ready-to-post video (captions, transitions, music, motion design).
- **ClipAnything** — turn any video into viral shorts, hook-first clip selection, auto-captions at 97% accuracy.
- **AI B-Roll** — context-aware stock footage or custom uploads in 1 click.
- **AI Reframe** — resize for every platform in 1 click with AI subject tracking.

### Editor & Tools
- **AI Editor** — text-based and timeline editing, trim, extend, filler-word removal, overlays.
- **Animated captions** — 97%+ accuracy with templates.
- **Social scheduler** — schedule a month of posts to YouTube, TikTok, Instagram, X, Facebook, LinkedIn.
- **Export to XML** — continue editing in Premiere Pro or DaVinci Resolve.
- **Thumbnail generator** — drop a link, get a YouTube thumbnail in 1 click.
- **Brand templates** — fonts, colors, logo, intro/outro in 1 click.
- **Team workspace** — assign roles, review clips, manage projects together.

### Dashboard (per user)
- **Center** — one-page overview: paste a link or upload a file, AI create tiles, stats, and recent clips with live status polling (processing → completed → failed).
- **Create new** — drag-and-drop upload (MP4, MOV, WebM, up to 2 GB) with optional title.
- **My projects / My clips** — video library sorted by status.
- **Content review** — edit, copy, and download each repurposed asset inline per video.
- **Analytics** — views, posts-per-week, videos processed, watch growth sparkline, top platforms, virality score, engagement, and best-time-to-post.
- **Calendar** — social posting schedule.
- **API & MCP** — generate an API key, server-to-server endpoints, and an MCP server for AI agents (`clip`, `schedule`, `publish`).
- **Inspiration** — community gallery of workflows and automations.
- **Team** — role assignment and collaborative review.
- **Settings** — account and preferences.

### Payments & Plans (geo-aware)
- **Basic** $29/mo, **Pro** $59/mo (most popular), **Enterprise** $99/mo — monthly or annual (save 20%).
- **Geo-detected payment provider** — visitors in the Indian subcontinent (IN, BD, LK, PK) are routed to **Razorpay**; everyone else pays with **Stripe**.
- Secure checkout flows, payment verification, and webhooks to keep subscriptions in sync.

### Any AI provider
- Works with **Claude, OpenAI, Google Gemini, OpenRouter, or any OpenAI-compatible endpoint** (Groq, Together, Ollama, LM Studio…).
- `AI_PROVIDER=auto` automatically uses the first API key found — no code changes to switch.

### Security
- Row Level Security (RLS) in Supabase scopes every query to `auth.uid()` — users can only read/edit their own data.
- Route protection via `middleware.ts`; internal server-to-server calls authenticated with a shared `INTERNAL_SERVICE_KEY`.

---

## 🎯 Solutions (who it's for)

| Audience | What Krix does |
| --- | --- |
| **Creators** | 10x output — fastest way to your next million views without burnout |
| **Podcasters** | 5x clips/day — consistent posting for growth in weeks |
| **Advertisers** | 50+ ad creative variants from assets you already have |
| **Real estate** | More leads through shorts — become the top-selling realtor |
| **Media & entertainment** | Streamline video workflows, 10x audience reach |
| **Agencies** | Scale and save ~$2,700/mo in editing costs per client |
| **Church** | Digitize sermons, reach more people, grow donations |
| **Marketers** | On-brand content at scale — every marketer a pro video editor |
| **Livestreamers** | Drive traffic back to livestreams with shorts |
| **E-commerce** | Sell more with viral shorts and more product exposure |

---

## ⚙️ How it works (internals)

### User flow
1. **Sign up / log in** — email + password (Supabase Auth). New users are auto-logged-in after signup.
2. **Upload** — paste a video link (YouTube, Drive, Vimeo, Zoom, Rumble, Twitch, Loom, Riverside) or upload a file (MP4/MOV/WebM) from the dashboard.
3. **Process** — the video is stored, transcribed, and repurposed automatically.
4. **Review & publish** — edit/copy/download outputs in the dashboard, schedule posts, or automate via API/MCP.

### Architecture
```
Browser
  │  Next.js App Router (React client components)
  ▼
API routes (src/app/api/**)        Next.js middleware (route guard)
  ├─ /api/auth/*        signup · login · logout
  ├─ /api/upload        file → Supabase Storage, video row created
  ├─ /api/process-video transcribe (Whisper) → trigger repurpose  [service-key auth]
  ├─ /api/repurpose     AI generates 6 formats → saved to DB     [service-key or user auth]
  ├─ /api/videos        list / get / delete videos
  ├─ /api/content       list / update / delete repurposed content
  ├─ /api/analytics     dashboard KPIs
  ├─ /api/payments/*    provider (geo) · create · stripe · razorpay · verify · webhook
  ├─ /api/subscription  plans · payment-method
  └─ /api/ai/config     active AI provider status
  ▼
Supabase  (Postgres + Auth + Storage, RLS)             external AI providers
```

### Data flow (video → content)
1. `POST /api/upload` writes the file to Supabase Storage under `{userId}/{timestamp}-file` and inserts a row in `videos` with status **processing**.
2. `POST /api/process-video` (called server-to-server with `x-service-key`) downloads a signed URL, sends the bytes to OpenAI **Whisper**, and saves the transcript back to the `videos` row.
3. `POST /api/repurpose` calls the configured AI provider with the transcript, asks for valid JSON containing `twitter`, `blog`, `emails`, `linkedin`, and `shorts`, parses it, deletes old rows, and inserts fresh ones into `repurposed_content`.
4. The video is marked **completed**; the dashboard polls `/api/videos` every 8s while anything is processing and updates live via `StatusPill`.

### Database schema (`src/components/supabase/schema.sql`)
- **`users`** — profile: email, full name, avatar, country, timezone.
- **`videos`** — uploads: title, storage path, duration, transcript, status, error message.
- **`repurposed_content`** — generated assets, one row per format per video (`shorts | tweets | blog | emails | linkedin | thumbnails | hooks`), with `is_edited` and platform/publish tracking.
- **`subscriptions`** — plan (`basic | pro | enterprise`), status, Stripe/Razorpay IDs, period, price, currency.
- **`payments`** — amounts, provider, external payment ID, invoice/receipt URLs, status.
- **`usage_logs`** — per-month video/api/storage usage (`UNIQUE(user_id, month)`).
- **`api_keys`** — hashed server-to-server/API keys with `is_active`.
- **Row Level Security** is enabled on all tables; policies allow each user to select/insert/update/delete only their own rows (content is linked through owned videos). Storage bucket `videos` follows the same `{userId}/...` ownership pattern.

### AI provider resolution (`src/lib/ai-provider.ts`)
- `AI_PROVIDER` selects **anthropic | openai | gemini | openrouter | custom**, or `auto` to use the first configured key.
- `generateText()` dispatches to the provider SDK/endpoint; all responses are normalized and force-parsed as JSON via `parseAIJSON` (handles ` ```json ` fences).

### Payments flow
1. `/api/payments/provider` geolocates the visitor (MaxMind GeoIP) and returns `stripe` or `razorpay`.
2. The `PaymentSelector` renders the matching checkout component.
3. Checkout calls `/api/payments/create`; the provider charges the customer; `/api/payments/verify` confirms; `/api/payments/webhook` syncs the subscription server-side (idempotent on `recurring_id`).

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in your Supabase, Stripe, Razorpay, OpenAI, Anthropic keys

# 3. Set up the database
# Open Supabase SQL Editor and run src/components/supabase/schema.sql

# 4. Run the dev server
npm run dev
# Open http://localhost:3000

# 5. Build & deploy
npm run build
npm run start
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
| `NEXT_PUBLIC_APP_URL` | App base URL (used for server-to-server calls) |
| `INTERNAL_SERVICE_KEY` | Shared secret for upload → process-video → repurpose calls |

## 📁 Project Structure

```
src/
├── app/                  # App Router pages & API routes
│   ├── page.tsx          # Landing page
│   ├── auth/             # Signup, login, callback
│   ├── dashboard/        # Center, upload, videos, content, analytics, calendar, projects, inspiration, api, team, settings
│   ├── pricing/          # Plans + geo-aware payment selector
│   └── api/              # auth, upload, process-video, repurpose, videos, content, analytics, payments, subscription, ai
├── components/
│   ├── landing/          # Hero, Solutions, Capabilities, HowItWorks, Pricing, Testimonials, FAQ, CTA, Footer…
│   ├── dashboard/        # Navbar, Sidebar, VideoUpload, VideoLibrary, RepurposedContent, ContentEditor, DownloadButton, StatusPill…
│   ├── supabase/payment/ # PaymentSelector, StripeCheckout, RazorpayCheckout
│   ├── auth/             # SignupForm, LoginForm, ProtectedRoute
│   └── ui/               # Button, Card, Input, Textarea, Modal, Loading, Toast, Skeleton
├── lib/                  # supabase, ai-provider, transcribe, stripe, razorpay, geoip, api-client, auth-utils, hooks, utils
├── types/                # TypeScript interfaces (User, Video, Subscription, RepurposedContent, Payment…)
└── middleware.ts         # Route protection (dashboard/API) + service-key bypass
src/components/supabase/schema.sql   # Full database schema + RLS + storage
```

## 🧪 Database

`schema.sql` creates `users`, `subscriptions`, `videos`, `repurposed_content`, `payments`, `usage_logs`, `api_keys` with Row Level Security and the `videos` storage bucket — see [Database schema](#database-schema-srccomponentssupabaseschemasql) above.

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

---

© 2026 **Kashinadh Nair** — Krix. All rights reserved.