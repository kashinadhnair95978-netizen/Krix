# Krix — Development Guide & Feature Status

> Purpose of this doc: a single source of truth for what works today, what is
> demo-only, and how to upgrade features and add AI providers/models.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (Auth, Postgres, Storage) · Stripe/Razorpay · OpenAI (Whisper) + any LLM provider.

---

## 1. Current status — TL;DR

| Area | Status |
| --- | --- |
| Supabase Auth (signup/login/logout) | ✅ Real and working |
| File upload → Supabase Storage | ✅ Real and working |
| AI content generation (5 formats) | ✅ Real (only via OpenRouter today) |
| Video list/get/delete + search | ✅ Real |
| Dashboard center + live status polling | ✅ Real |
| Analytics endpoint (real DB numbers) | ✅ Real endpoint |
| Settings profile / AI status / cancel sub | ✅ Real |
| Route protection (middleware) | ✅ Real |
| Transcription (Whisper) | ❌ Broken — needs real `OPENAI_API_KEY` |
| Payments (Stripe + Razorpay) | ❌ Broken — keys are placeholders |
| Geo-IP provider detection | ❌ Broken — MaxMind keys are placeholders |
| "Paste a video link" import | ⚠️ Partial — stores URL as title only, no download |
| API keys / MCP server / `docs.krix.app` | 🟠 Demo only — fake key copied to clipboard |
| Calendar / social scheduler | 🟠 Demo only — React state, not persisted |
| Projects | 🟠 Demo only — hardcoded, in-memory |
| Team | 🟠 Demo only — hardcoded members, no invites |
| Inspiration gallery | 🟠 Demo only — static list |
| Analytics page details (views, virality, etc.) | 🟠 Static numbers |
| ClipAnything / AI Producer / B-Roll / Reframe | 🟠 Marketing tiles only → link to upload |
| AI Editor, captions templates, XML export, thumbnails, brand templates | 🟠 Advertised in README, **no code exists** |

---

## 2. What is genuinely AI?

One real AI feature: **transcript → repurposed content in 5 formats**.

Pipeline (all working except transcription key):

1. `POST /api/upload` → file to Supabase Storage `videos/{userId}/{ts}-file`, video row `status=processing`.
2. `POST /api/process-video` (service-key guarded) → downloads video, calls **OpenAI Whisper** for transcript (needs `OPENAI_API_KEY`), then calls `POST /api/repurpose`.
3. `POST /api/repurpose` → sends transcript to the configured LLM, force-parses JSON, deletes old rows, inserts `twitter/blog/emails/linkedin/shorts` into `repurposed_content`, marks video `completed`.
4. Dashboard polls `/api/videos` every 8s while `processing`.

---

## 3. AI provider system — how to add models

Everything lives in **`src/lib/ai-provider.ts`**. The design is provider + default-model based; add a model by adding/editing an entry.

### How the resolution works

- `getAIConfig()` reads `AI_PROVIDER` (default `auto`).
- `auto` = first provider whose key env var is non-empty wins.
- Explicit = only that provider is considered.
- Model = `{PROVIDER}_MODEL` env → `AI_MODEL` (global override) → `defaultModel` in code.

### The provider registry

```ts
export const AI_PROVIDERS: AIProviderInfo[] = [
  { id: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY',  modelEnv: 'ANTHROPIC_MODEL', defaultModel: 'claude-opus-4-1' },
  { id: 'openai',    keyEnv: 'OPENAI_API_KEY',     modelEnv: 'OPENAI_MODEL',    defaultModel: 'gpt-4o-mini' },
  { id: 'gemini',    keyEnv: 'GEMINI_API_KEY',     modelEnv: 'GEMINI_MODEL',    defaultModel: 'gemini-2.0-flash' },
  { id: 'openrouter',keyEnv: 'OPENROUTER_API_KEY', modelEnv: 'OPENROUTER_MODEL',defaultModel: 'anthropic/claude-3.5-sonnet' },
  { id: 'custom',    keyEnv: 'AI_API_KEY',         modelEnv: 'AI_MODEL',        defaultModel: 'gpt-4o-mini', baseUrl: 'https://api.groq.com/openai/v1' },
];
```

### How generation is dispatched (`generateText`)

| Provider | HTTP path |
| --- | --- |
| `anthropic` | `POST https://api.anthropic.com/v1/messages` |
| `openai` | `POST {base}/chat/completions` (OpenAI endpoint) |
| `openrouter` | `POST https://openrouter.ai/api/v1/chat/completions` |
| `gemini` | `POST .../models/{model}:generateContent` |
| `custom` | `POST {AI_BASE_URL}/chat/completions` |

All responses are normalized, and JSON fences are stripped via `parseAIJSON()` (handles ```` ```json ```` wrapping).

### To add a NEW provider (e.g. Mistral / DeepSeek)

These are OpenAI-compatible, so the fastest path is the **`custom` provider** — set envs only, no code:

```
AI_PROVIDER=custom
AI_API_KEY=<your-key>
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
```

To add a fully first-class provider:

1. Open `src/lib/ai-provider.ts`.
2. Add an entry to `AI_PROVIDERS` (id, label, keyEnv, modelEnv, defaultModel, optional baseUrl).
3. Add a case in `generateText()` that builds the native request (mirror one of the existing generators: `generateAnthropic`, `generateChatCompletions`, `generateGemini`).
4. In `.env.example` and `.env.local`, document/set the new `XXX_API_KEY` + `XXX_MODEL`.
5. Optional: extend `getAIStatus()` (already generic) and the Settings page list is auto-driven by `AI_PROVIDERS`.

### To change/upgrade a MODEL for an existing provider

```
OPENROUTER_MODEL=anthropic/claude-sonnet-4-5      # or any id OpenRouter accepts
OPENAI_MODEL=gpt-5.1                               # or gemini-3-pro …
AI_MODEL=<any>           # global override for whichever provider is active
```

No code change required for model swaps.

---

## 4. Environment variables

| Variable | Purpose | Today |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ real |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client key | ✅ real |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side key | ✅ real |
| `INTERNAL_SERVICE_KEY` | upload→process→repurpose secret | ✅ real |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | the only live LLM | ✅ real |
| `OPENAI_API_KEY` | GPT + **Whisper transcription** | ❌ placeholder |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `AI_API_KEY` | extra LLM options | ❌ placeholder |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe | ❌ placeholder |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay (IN/etc.) | ❌ placeholder |
| `MAXMIND_ACCOUNT_ID` / `MAXMIND_LICENSE_KEY` | geo provider detection | ❌ placeholder |
| `NEXT_PUBLIC_APP_URL` | server-to-server base URL | ✅ set to `http://localhost:3000` |

> ⚠️ Security: `.env.local` currently contains real Supabase keys + the OpenRouter key.
> Do **not** commit real secrets to git; rotate the service-role key if the repo is shared.

---

## 5. Upgrade roadmap (priority order)

### P0 — make the core loop actually complete
1. **Add a real `OPENAI_API_KEY`** → Whisper transcription works → upload → transcribe → AI repurpose → completed starts completing end-to-end.

### P1 — monetize
2. **Stripe + Razorpay keys** → `/api/payments/*` + webhook become live.
3. **MaxMind keys** for real geo-routing (India → Razorpay, rest → Stripe).

### P2 — make demo pages real or remove them
4. **API keys page** — connect "Generate API key" to the `api_keys` table (hashed, `is_active`) and return a real key; expose `GET /v1/...` endpoints (or clearly mark MCP as not-yet-shipped).
5. **Calendar** — persist `ScheduledPost` rows to a `scheduled_posts` table + add a real scheduler/cron.
6. **Projects** — add `projects` table and link videos (`project_id`), replace hardcoded seed.
7. **Team** — add `team_members` table + invite emails via Supabase Auth or Resend; replace hardcoded names.
8. **Analytics details** — compute views/virality/engagement from real events (add `events` table) or remove the static stats.

### P3 — new features (only if you want)
9. Video clipping/reframe/B-roll → these need a real media backend (ffmpeg worker, Replicate/Remotion, or a vendor API).
10. Export to XML (Premiere/DaVinci) → serializable from `repurposed_content`.
11. Thumbnail generator + brand templates → CSS/SVG templates + image API.

---

## 6. Project map (key files)

| Concern | File |
| --- | --- |
| Auth (browser/server utils) | `src/lib/supabase.ts`, `src/lib/auth-utils.ts` |
| Route guard | `src/middleware.ts` |
| AI provider registry + dispatch | `src/lib/ai-provider.ts` |
| Transcription | `src/lib/transcribe.ts` |
| AI generation route | `src/app/api/repurpose/route.ts` |
| Video pipeline route | `src/app/api/process-video/route.ts` |
| Upload route | `src/app/api/upload/route.ts` |
| Analytics route | `src/app/api/analytics/route.ts` |
| Payments | `src/app/api/payments/*`, `src/lib/stripe.ts`, `src/lib/razorpay.ts`, `src/lib/geoip.ts` |
| Dashboard UI | `src/app/dashboard/*`, `src/components/dashboard/*` |
| Landing UI | `src/components/landing/*` |
| DB schema + RLS | `src/components/supabase/schema.sql` |
| Client hooks | `src/lib/hooks.ts` |

---

## 7. Database schema overview

`users`, `videos`, `repurposed_content`, `subscriptions`, `payments`, `usage_logs`, `api_keys` — all RLS-scoped to `auth.uid()`, storage bucket `videos` requires `{userId}/...` prefixes.