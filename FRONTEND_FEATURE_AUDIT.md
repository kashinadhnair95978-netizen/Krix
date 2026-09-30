# Krix — COMPLETE FRONTEND FEATURE AUDIT

**Audit date:** 2026-09-30
**Scope:** every user-visible frontend feature, every API route it depends on, the Supabase schema, the AI worker, the payment stack, the developer surface (API/MCP), and the test suites.
**Nature:** AUDIT AND PLANNING ONLY. No feature was implemented, no working core was modified. The only commands executed were read-only verification commands (`npx tsc --noEmit`, `npm run lint`) and file reads.

---

## 0. Method and evidence

Everything below is derived from one of these sources, cited inline as `file:line`:

| Source | What it establishes |
| --- | --- |
| `src/app/**` (24 route handlers, 16 pages, 2 layouts) | What the API actually does and what the UI actually renders |
| `src/components/**` (46 components) | What a user can click, and whether a handler exists |
| `src/lib/**` (14 modules) | Auth, ownership, worker, payments, AI provider, ingest |
| `src/middleware.ts` (104 lines) | Which paths are guarded, and how service-key calls bypass it |
| `src/components/supabase/*.sql` | Tables, buckets, RLS policies |
| `ai-worker/app/**` (21 modules) | The real AI pipeline |
| `ai-worker/tests/**` (18 files) | What is actually tested |
| `e2e/**` (3 Playwright specs) | What is verified in a real browser |
| `README.md`, `INGESTION_RECOVERY_REPORT.md`, `CORE_PIPELINE_COMPLETION.md`, `AI_PIPELINE_STATUS.md`, `DEVELOPMENT.md`, `AI_IMPLEMENTATION_PLAN.md`, `REPOSITORY_DOCUMENTATION_REPORT.md` | Prior claims, cross-checked against code |

Verification run for this audit:

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | **PASS** (exit 0, no output) |
| Lint | `npm run lint` | **PASS** — `✔ No ESLint warnings or errors` |

No GPU test, no Playwright run, and no real video test was re-executed. The core pipeline status below is taken from the verified evidence already recorded in `CORE_PIPELINE_COMPLETION.md` and `INGESTION_RECOVERY_REPORT.md`, and cross-checked against the current source.

### Status legend

| Status | Meaning |
| --- | --- |
| **WORKING** | Real UI + real API + real DB + real backend, exercised by a real test in this repo. |
| **PARTIAL** | Real implementation, but a required piece is missing, untested, or broken. |
| **SCAFFOLDED** | UI/route/schema/table exists; the functionality behind it is not implemented. |
| **MOCK** | The UI displays hardcoded or fabricated data presented as if it were real. |
| **MISSING** | Advertised or needed, not built. |
| **PLANNED** | Documented as future, correctly labelled (no false claim). |
| **BLOCKED** | Implemented and correct, but cannot execute in this environment. |
| **DEAD** | A link, route, or control that points at something which does not exist. |

### Headline finding

Krix has **one genuinely working end-to-end product loop** — upload a local video, get real ASR, real forced alignment, real visual analysis, real Mistral clip scoring, real FFmpeg 9:16 rendering with burned-in captions, real signed-URL preview and download, persisted in Postgres with RLS and per-user ownership.

Everything outside that loop falls into exactly one of three categories:

1. **Scaffolded over a real backend but blocked externally** — content repurposing (provider credit), first-time YouTube import (this IP is served no usable rendition).
2. **UI-only mock over hardcoded arrays** — analytics, calendar, projects, team, API, inspiration, plus every marketing testimonial, logo, and stat.
3. **Marketing copy for a feature that does not exist** — Smart Reframe, B-roll, AI Producer, the editor, the scheduler, social publishing, MCP, the REST API, API keys, brand templates, AI thumbnails, XML export.

**The single largest risk to the product is not a broken feature — it is that the marketing site advertises roughly 30 capabilities of which about 6 exist.** This report itemises every one.

---

## 1. MASTER FEATURE TABLE

Status column values are this audit's final verdict per feature.

### 1.A — Marketing site / landing page

| # | Feature | Frontend Claim | UI | API | DB | Backend/Worker | Real Result | Tested | Status | Required Work |
|---|---|---|---|---|---|---|---|---|---|---|
| A01 | Hero headline "Turn one video into one hundred posts" | 100 posts per upload | YES `Hero.tsx:52-56` | n/a | n/a | n/a | 5 content types wired (blocked) + N clips | n/a | PARTIAL | Fund the provider and prove 5 types, or change the number |
| A02 | Hero primary CTA "Start free — It's FREE" | Free signup | YES `Hero.tsx:68,75` | YES `/auth/signup` | YES `users` | n/a | Real account + session | YES Playwright login smoke | WORKING | None |
| A03 | Hero "See it in action" anchor | Scroll to features | YES `Hero.tsx:79-82` | n/a | n/a | n/a | Anchor resolves on `/` | n/a | WORKING | None |
| A04 | Hero format chips: YT Shorts, LinkedIn, X, Blog, Email | These 5 formats are produced | YES `Hero.tsx:103` | YES `/api/repurpose` | YES `repurposed_content` | YES LLM provider | **0 rows produced in this environment** | YES TEST 5 (blocked) | PARTIAL | Fund provider / cheaper model |
| A05 | Hero creator marquee (Grant C. 4.9M, TwoSet 4.3M, …) | These creators use Krix | YES `Hero.tsx:5-11` | n/a | n/a | n/a | **Fabricated names + follower counts** | no | MOCK | Delete, or replace with consented, verifiable endorsements |
| A06 | Hero "Ready in ~5 min" | 5-minute turnaround | YES `Hero.tsx:119` | n/a | n/a | YES worker | Real: 188.97 s for a 60 s video | YES real E2E | PARTIAL | Publish real p50/p95; 5 min is wrong for a long source |
| A07 | "Trusted by 10,000+ creators & production teams" | 10,000+ users | YES `TrustedBy.tsx:1-18` | n/a | n/a | n/a | **Zero users. 10 fabricated brand names** | no | MOCK | Remove until true |
| A08 | Marketing navbar | 6 nav links | YES `Navbar.tsx:42-59` | n/a | n/a | n/a | Real on `/`; **4 anchors 404 on `/pricing`** | n/a | PARTIAL | Make anchors route-aware |
| A09 | "Drop a video link" converter (landing) | Paste link, get clips | YES `VideoLinkCTA.tsx:124-190` | YES `/api/ingest-url` | YES `videos` | YES yt-dlp | Real on duplicate; first-time 504s on this IP | YES TEST 2, TEST 4 | PARTIAL | Blocked by YouTube serving no rendition to this IP |
| A10 | Coming-source list (Drive, Vimeo, Twitch, Facebook, LinkedIn, Twitter, Loom, Riverside, StreamYard) | Listed as coming | YES `VideoLinkCTA.tsx:9-20,198-201` | n/a | n/a | n/a | Correctly disclosed as "coming" | n/a | SCAFFOLDED | Keep the disclosure; ship one at a time |
| A11 | Capability: **AI Producer** | "polished, ready-to-post video… music, motion design" | YES `Capabilities.tsx:37-44` | NO | NO | NO | **Nothing. No code, no table, no route** | no | MISSING | Build, or remove the card |
| A12 | Capability: **ClipAnything** | "the only clipping model that works on every genre" | YES `Capabilities.tsx:46-49` | YES `/api/pipeline/process` | YES `clip_candidates`, `generated_clips` | YES Mistral 7B | Real clips produced. **The superlative is unsupported and false** | YES real E2E 9/9 | PARTIAL | Soften to a verifiable statement |
| A13 | Capability: **AI B-Roll** | "1 click, under 1 minute… millions of stock clips" | YES `Capabilities.tsx:53-57` | NO | NO | NO | **Nothing** | no | MISSING | Build, or remove the card |
| A14 | Capability: **AI Reframe** (Smart Reframe) | "keeps moving subjects centered with AI object tracking" | YES `Capabilities.tsx:60-67` | NO | NO | NO — fixed centre crop `rendering.py:53` | **Nothing.** `speaker_position`/`visual_interest` are computed by Qwen3-VL and stored (`models/vision.py:187-190`) but never consumed by the renderer, which centre-crops (`services/rendering.py:53`, whose own docstring says "future phases add smart reframing") | YES proved absent | MISSING | Implement tracked crop, or remove the card |
| A15 | Capability: **Editor** | "trim, extend, filler-word removal, overlays" | YES `Capabilities.tsx:78-84` | NO | NO | NO | **Nothing** | no | MISSING | Build, or remove the card |
| A16 | Capability: **Animated captions** | "animated captions with 97%+ accuracy" | YES `Capabilities.tsx:85-90` | n/a | n/a | n/a | **Static ASS only** `captions.py` | YES captions unit tests (static only) | MISSING | Build animation, or say "burned-in captions" |
| A17 | Capability: **Social scheduler** | "a month's posts to all 6 platforms in 10 minutes" | YES `Capabilities.tsx:91-96` | NO | NO | NO | **Nothing** | no | MISSING | Build, or remove the card |
| A18 | Capability: **Export to XML** (Premiere / DaVinci) | "export any clip to continue your creative work" | YES `Capabilities.tsx:97-100` | NO | NO | NO | **Nothing. No XML anywhere in the repo** | no | MISSING | Build, or remove the card |
| A19 | Capability: **Thumbnail generator** | "AI-designed, click-worthy, brand-safe thumbnail in 1 click" | YES `Capabilities.tsx:103-108` | n/a | YES `generated_clips.thumb_path` | YES `pipeline.py:353-370` | **A plain ffmpeg frame at the clip midpoint.** No AI, no text, no branding | YES real E2E (frame produced) | PARTIAL | Build AI thumbnails, or relabel as "auto frame grab" |
| A20 | Capability: **Brand template** | "fonts, colors, logo, intro and outro" | YES `Capabilities.tsx:110-113` | NO | NO | NO — one hardcoded ASS style `config.py:205-211` | **Nothing** | no | MISSING | Build, or remove the card |
| A21 | Capability: **Team workspace** | "assign roles, review clips, manage projects together" | YES `Capabilities.tsx:116-119` | NO | NO | NO | **Nothing** (`/dashboard/team` is a mock) | no | MISSING | Build, or remove the card |
| A22 | Capability: **API** | "The video API every AI agent can call" — CTA "Explore the docs", **not labelled Soon** | YES `Capabilities.tsx:134-140` | NO | NO — `api_keys` unused | NO | **Nothing. The CTA is a non-link `<span>`** `Capabilities.tsx:354` | no | MISSING | Build, or label Soon and disable the CTA |
| A23 | Capability: **MCP** | "clip, caption, reframe, schedule and publish over one protocol" | YES `Capabilities.tsx:141-149` — labelled "Soon" here | NO | NO | NO | **No MCP server exists in the repo** | no | MISSING | Build, or label "Soon" everywhere |
| A24 | Capability: **Inspiration gallery** | "workflows… from the community" — CTA **not labelled Soon** | YES `Capabilities.tsx:150-156` | NO | NO | NO | **8 hardcoded cards** `/dashboard/inspiration` | no | MOCK | Label as examples, or connect to real builds |
| A25 | Capability format cards (6 formats) | Shorts, X, Blog, Email, LinkedIn, "Thumbnails & hooks" | YES `Capabilities.tsx:159-166` | YES `/api/repurpose` | YES `repurposed_content` | YES LLM | 5 types wired; **"Thumbnails & hooks" is never produced** — `hooks` and `thumbnails` are declared in `types/index.ts` and never written | YES TEST 5 | PARTIAL | Drop the 6th card, or implement it |
| A26 | Solutions section (10 persona cards + stats) | "10x output", "-$2,700/mo", "2x conversions" | YES `Solutions.tsx:25-96` | NO | NO | NO | **10 fabricated stat strings.** CTA is a non-link `<span>` `Solutions.tsx:136` | no | MOCK | Remove, or replace with labelled projections |
| A27 | How It Works (3 steps) | Step 03: "Copy, download, or **send it straight to any platform** — or automate it with our API" | YES `HowItWorks.tsx:22-24` | NO publishing | NO | NO | Copy YES, download YES, **send to platform NO, our API NO** | n/a | PARTIAL | Rewrite step 03 to match reality |
| A28 | Landing pricing (4 tiers $0/$15/$24/$70) | 4 priced plans | YES `Pricing.tsx:18-77` | NO checkout | YES `subscriptions` | NO | **Display only. All 4 CTAs go to `/auth/signup`** | no | MOCK | Wire to real checkout, or mark "plans at launch" |
| A29 | Pricing feature strings | "Unlimited videos", "Watermarked exports", "No watermark", "AI custom branding", "Advanced analytics", "Custom AI training", "API access", "24/7 phone support" | YES `Pricing.tsx:25-73` | NO | NO | NO | **Every one is false or undefined.** No watermarking exists, no entitlement enforcement exists, no analytics beyond 4 counters | no | MOCK | Rebuild the plan matrix around what code can enforce |
| A30 | Testimonials (6 named creators) | "From top creators… the only editor that actually drives growth" | YES `Testimonials.tsx:11-48,78-85` | n/a | n/a | n/a | **6 fabricated personas** with roles and follower counts | no | MOCK | Remove, or replace with consented, attributable quotes |
| A31 | Testimonials stat bar | +266% impressions, +57% watch time, 1→3% to 12%+ full-view, 2× views | YES `Testimonials.tsx:4-9` | n/a | n/a | n/a | **4 fabricated statistics** | no | MOCK | Remove |
| A32 | FAQ (6 entries) | 97% caption accuracy, 14 languages, "viral-worthy", "AI relayout", "fully editable inline", 7-day free trial | YES `FAQ.tsx:7-32` | n/a | n/a | n/a | **Mixed truth and falsehood** — see section 3 | no | MOCK | Rewrite against measured behaviour |
| A33 | FAQ "Email us at support@krix.app" | A support address exists | YES `FAQ.tsx:30` | NO | NO | n/a | **No mail handler, no `mailto:`, no inbox** | no | MISSING | Add `mailto:` or a real contact route |
| A34 | Landing CTA section | "Your next viral post is one link away"; "7-day free trial · No credit card required" | YES `CTA.tsx:14-26` | n/a | n/a | n/a | CTA works; **no trial exists** | no | PARTIAL | Remove the trial claim, or build trials |
| A35 | Footer | 21 links across 5 columns | YES `Footer.tsx:4-55` | n/a | n/a | n/a | **17 dead `href="#"` links** `Footer.tsx:12-13,30-34,40-43,49-52,99,102,105` | no | PARTIAL | Delete or route every footer link |
| A36 | Footer "Video MCP" | Coming soon | YES `Footer.tsx:50,70-77` | n/a | n/a | n/a | Correctly labelled with a Soon toast | n/a | SCAFFOLDED | Keep |
| A37 | `/pricing` page | Full pricing + payment | YES `pricing/page.tsx:12-79` | PARTIAL `/api/payments/*` | YES `subscriptions` | NO | **Checkout is non-functional** (placeholder IDs) | no | PARTIAL | See section 9 |
| A38 | `/pricing` payment modal | "Choose your payment method" then Stripe/Razorpay | YES `pricing/page.tsx:189-277` | PARTIAL | PARTIAL | NO | Stripe path redirects to `/checkout/stripe`, which **does not exist** `StripeCheckout.tsx:41`; the Razorpay path never verifies | no | MOCK | Remove the modal until checkout is real |
| A39 | Pricing "Contact sales" CTA | Sales contact | YES `Pricing.tsx:74,159` | n/a | n/a | n/a | **Links to `/auth/signup`. No sales path exists** | no | DEAD | Add a contact route, or remove the CTA |
| A40 | Pricing "Read the FAQ" | `href="#faq"` | YES `pricing/page.tsx:221-224` | n/a | n/a | n/a | **No `#faq` element on `/pricing`** | no | DEAD | Add the anchor, or remove |
| A41 | `ComingSoon` modal primitive | "still in the works" | YES `ComingSoon.tsx:18-19` | n/a | n/a | n/a | Real modal | n/a | WORKING | None — this is the correct pattern to copy |
| A42 | Decorative components (BlackHoleBackground, Reveal, SpotlightCard, icons) | Visual polish | YES `landing/*` | n/a | n/a | n/a | Real rendering | n/a | WORKING | None |
| A43 | `/` metadata and SEO | "AI-powered content repurposing…" | YES `layout.tsx:6-12` | n/a | n/a | n/a | Real | n/a | WORKING | None |
| A44 | Mobile nav menus (landing + dashboard) | Responsive nav | YES `Navbar.tsx:100-138` | n/a | n/a | n/a | Real | n/a | WORKING | None |

### 1.B — Authentication

| # | Feature | Frontend Claim | UI | API | DB | Backend/Worker | Real Result | Tested | Status | Required Work |
|---|---|---|---|---|---|---|---|---|---|---|
| B01 | Email/password signup | Create account | YES `SignupForm.tsx` | YES `/api/auth/signup` | YES `users` insert | n/a | Real Supabase `auth.admin.createUser` + session cookies | YES Playwright login smoke | WORKING | None |
| B02 | Signup email verification | — | n/a | PARTIAL `signup/route.ts:26` `email_confirm: true` | YES | n/a | **Verification bypassed**; any address can be claimed | no | PARTIAL | Remove `email_confirm: true`; add a verification page |
| B03 | Email/password login | Sign in | YES `LoginForm.tsx:23` | YES (browser client) | YES | n/a | Real Supabase call | YES Playwright | WORKING | None |
| B04 | `/api/auth/login` route | Server-side login | n/a — **UI never calls it** | YES `login/route.ts:15` | n/a | n/a | Real, but **returns `data.session` (access + refresh token) in the JSON body** `login/route.ts:24-27` | no | PARTIAL | Delete the unused route, or strip tokens |
| B05 | Google OAuth | "Continue with Google" | YES `GoogleSignIn.tsx` | PARTIAL Supabase | YES `auth.users` | n/a | **BROKEN** — `auth/callback/page.tsx:13-17` passes `"code=…&state=…"` to `exchangeCodeForSession`, which expects the bare code, plus a 200 ms race | no | MISSING | Use `new URLSearchParams(search).get('code')`; remove the race |
| B06 | Logout | Sign out | YES `settings/page.tsx:105-108` | YES `/api/auth/logout` | n/a | n/a | Real `signOut()`, cookies cleared | no | WORKING | Add cross-tab broadcast |
| B07 | Password reset / forgot password | — | NO | NO | NO | NO | **Does not exist anywhere.** No `resetPasswordForEmail`, no `/reset-password` route | no | MISSING | Build the flow |
| B08 | Middleware route guard | Protect `/dashboard` + 8 `/api` prefixes | YES `middleware.ts:5-17,91-104` | n/a | n/a | n/a | Real; **fails closed** when Supabase env is missing or placeholder | YES smoke | WORKING | Add `/api/analytics` and `/api/content` to the matcher |
| B09 | `ProtectedRoute` client guard | Client-side redirect | YES `ProtectedRoute.tsx:16-30` | n/a | n/a | n/a | Real | YES | WORKING | None |
| B10 | Profile upsert | Mirror `auth.users` into `users` | YES `settings/page.tsx:74-78` | YES `/api/auth/upsert-profile` | YES `users` upsert | n/a | Real, session-derived ownership | no | WORKING | None |
| B11 | Auth rate limiting / abuse protection | — | NO | NO | NO | NO | **None.** Unauthenticated login and signup are unmetered | no | MISSING | Add per-IP and per-email limits before launch |
| B12 | `x-user-id` header fallback | — | n/a | PARTIAL `auth-utils.ts:51-54` | n/a | n/a | **Dead and misleading** — returns `null`; `api-client.ts:32-36` still sends the header | no | DEAD | Remove from both sides |

### 1.C — Dashboard routes and shared UI

| # | Feature | Frontend Claim | UI | API | DB | Backend/Worker | Real Result | Tested | Status | Required Work |
|---|---|---|---|---|---|---|---|---|---|---|
| C01 | `/dashboard` overview | "One link in, a month of content out" | YES `page.tsx` | YES `/api/videos`, `/api/analytics`, `/api/subscription` | YES all three | n/a | All 4 stat tiles and the recent list are real; 8 s / 15 s polling while processing | YES | WORKING | None |
| C02 | `/dashboard` 4 "Create with AI" tiles (ClipAnything, AI Producer, AI B-Roll, AI Reframe) | 4 distinct workflows | YES `page.tsx:22-45,212-215` | n/a | n/a | n/a | **All 4 link to the same `/dashboard/upload`.** 3 of the 4 name features that do not exist | no | MOCK | Reduce to one real tile, or build the features |
| C03 | `/dashboard` link-source chips (8 hosts) | YouTube, Drive, Vimeo, Zoom, Rumble, Twitch, Loom, Riverside | YES `page.tsx:20` | PARTIAL `GET /api/ingest-url` returns `providers:["youtube"]` | n/a | n/a | **Only YouTube is accepted**; the rest silently 400 | no | PARTIAL | Drive the chips from the live `providers` array |
| C04 | `/dashboard/upload` — local file upload | Upload and Process | YES `VideoUpload.tsx:95-227` | YES `GET/POST /api/upload` | YES `videos` row | YES worker trigger | Real 10.84 MB MP4 end-to-end, real byte progress, real clip produced | YES TEST 1 | WORKING | None |
| C05 | Upload size/type validation | Reject before transfer | YES `VideoUpload.tsx:57-66,132` | YES `upload/route.ts` | n/a | n/a | Real: content-length pre-check, MIME + extension allowlist, `413 MEDIA_TOO_LARGE` | YES TEST 3 | WORKING | None |
| C06 | Upload limit surfaced from API | "up to 50 MB on this project" | YES `VideoUpload.tsx:31-42` | YES `GET /api/upload` | YES bucket limit | n/a | Real. Client is fully driven by the live value; **`2 GB` appears zero times** | YES TEST 1, TEST 3 | WORKING | None |
| C07 | `/dashboard/upload` — server-side link import | Import a URL | YES `upload/page.tsx:35-52` | YES `POST /api/ingest-url` | YES `videos` | YES yt-dlp | Real; first-time import 504s on this IP inside the 240 s budget | YES TEST 2 / TEST 4 | PARTIAL | Raise the budget or add cookie auth |
| C08 | `/dashboard/videos` library | Browse your videos | YES `VideoLibrary.tsx:27-131` | YES `GET /api/videos` | YES `videos` | n/a | Real list, real polling, real status pills | YES | WORKING | None |
| C09 | Video search + status filters | Search / filter | YES `VideoLibrary.tsx:94-118` | YES (client-side over real rows) | YES | n/a | Real; 4 filters with live counts | n/a | WORKING | None |
| C10 | Video delete | Delete a video | NO — **no UI anywhere** | YES `api-client.ts:117` + `DELETE /api/videos/[videoId]` | YES `videos` + storage | n/a | **The API and the client method exist; nothing calls them** | no | MISSING | Add a delete action with confirmation |
| C11 | `/dashboard/content/[videoId]` | Review video, clips, content | YES `page.tsx` | YES `/api/videos/[id]`, `/api/clips`, `/api/content/[id]` | YES | n/a | Real data throughout | YES | WORKING | None |
| C12 | Content page optimistic status | "completed" after repurpose | YES `content/[videoId]/page.tsx:49` | PARTIAL | PARTIAL | PARTIAL | **Sets `status:'completed'` immediately** after an async generation call and stops the 6 s poll — reports "ready" while generation is still running or failed | no | PARTIAL | Poll until a terminal state is reported |
| C13 | `/dashboard/settings` | Profile, subscription, AI provider | YES `settings/page.tsx` | YES `/api/ai/config`, `/api/subscription` | YES via anon client (real RLS applies here) | n/a | Real: name save, cancel, logout, provider status | no | WORKING | None |
| C14 | Settings AI-provider card | Provider status | YES `settings/page.tsx:200-202` | YES `/api/ai/config` | n/a | n/a | **If the fetch fails the card shows "Loading AI configuration…" forever** — no error state | no | PARTIAL | Add an error state |
| C15 | `/dashboard/analytics` | "Track clip performance, virality scores, and growth across platforms" | YES `analytics/page.tsx` | PARTIAL `GET /api/analytics` | PARTIAL — 4 real counters | NO | **~40% real.** 4 real counters + ~12 hardcoded metrics. Zero controls. See section 8 | no | MOCK | Rebuild around the 4 real counters |
| C16 | `/dashboard/calendar` | Planning / scheduling calendar | YES `calendar/page.tsx` | NO — **none** | NO — **none** | NO | `useState(seedPosts)` only. 6 fabricated posts, lost on refresh | no | MOCK | See section 5 |
| C17 | `/dashboard/projects` | Projects | YES `projects/page.tsx` | NO — **none** | NO — **none** | NO | `useState(initialProjects)`, 4 fabricated projects, create is local-only | no | MOCK | See section 4 |
| C18 | `/dashboard/team` | Team, roles, invitations | YES `team/page.tsx` | NO — **none** | NO — **none** | NO | `useState(initialMembers)`, 4 fabricated members, invite is local-only | no | MOCK | See section 7 |
| C19 | `/dashboard/api` | API keys, endpoints, MCP | YES `api/page.tsx` | NO — **none** | NO — `api_keys` unused | NO | **Fabricates an API key client-side** `api/page.tsx:43` `'kx_live_' + 'x'.repeat(32)` | no | MOCK | See section 10 |
| C20 | `/dashboard/inspiration` | Community builds | YES `inspiration/page.tsx` | NO — **none** | NO | NO | 8 hardcoded cards; "40+ community builds" badge is fabricated; "Copy workflow" is a non-interactive `<span>` | no | MOCK | Relabel as curated examples, or build |
| C21 | Command palette (Cmd/Ctrl+K) | Fast navigation | YES `CommandPalette.tsx:14-98` | n/a | n/a | n/a | 11 real commands, real keyboard handling, wired from Navbar | n/a | WORKING | None |
| C22 | Navbar + Sidebar | Navigation, plan card | YES | YES `/api/subscription` | YES | n/a | Real, but **both fetch the subscription independently** — duplicate requests per page view | n/a | PARTIAL | Lift subscription into one provider |
| C23 | `PipelineProgress` | Show pipeline stage | YES `PipelineProgress.tsx:5-23` | YES | YES `videos.processing_stage` | YES worker | **Only 6 of the 12 real stages are mapped**; `extracting`, `aligning`, `uploading`, `repurposing` return index `-1` and render as pending | n/a | PARTIAL | Map all 12 `VideoProcessingStage` values |
| C24 | `StatusPill` | Status styling | YES `StatusPill.tsx:3-43` | n/a | YES | n/a | 8 statuses styled; the 4 unmapped stages fall through to generic grey | n/a | PARTIAL | Same as C23 |
| C25 | `Sparkline` | Analytics chart | YES `Sparkline.tsx:16` | n/a | YES | n/a | **Returns `null` below 2 points** — the chart silently disappears for sparse data | no | PARTIAL | Render an explicit empty state |
| C26 | UI primitives (Button, Card, Input, Textarea, Modal, Toast, Skeleton, Loading) | Consistent UI | YES `ui/*` | n/a | n/a | n/a | All real and used | n/a | WORKING | None |
| C27 | Empty / loading / error state coverage | Clear states everywhere | PARTIAL | n/a | n/a | n/a | Upload, videos, overview, settings are complete. **Calendar, projects, team, API, inspiration have no loading or error state**; analytics has no error state (`hooks.ts:99-101` swallows all errors) | no | PARTIAL | Add states to the six mock pages |
| C28 | `api-client.ts` unused methods | — | n/a | `deleteVideo`, `getIngestLimits`, `createPayment`, `verifyPayment`, `updatePaymentMethod`, `login`, `logout` | n/a | n/a | **Declared, never called** | no | DEAD | Wire or delete; `verifyPayment` also sends parameter names the route does not read |
| C29 | `api-client` base URL | — | PARTIAL `api-client.ts:4` | n/a | n/a | n/a | `baseURL: process.env.NEXT_PUBLIC_APP_URL`; works only because axios falls back to the current origin | no | PARTIAL | Default to `''` explicitly |
| C30 | `src/types/index.ts` shared types | Typed data | PARTIAL | n/a | n/a | n/a | Complete and schema-accurate, but **every dashboard page re-declares its own local type and uses `any`** (`settings/page.tsx:14-15`, `content/[videoId]/page.tsx:20`) | no | PARTIAL | Consume the shared types |

### 1.D — Video pipeline (core product)

| # | Feature | Frontend Claim | UI | API | DB | Backend/Worker | Real Result | Tested | Status | Required Work |
|---|---|---|---|---|---|---|---|---|---|---|
| D01 | Local upload to pipeline trigger | Upload and process | YES | YES `/api/pipeline/process` (`x-service-key`) | YES `videos` | YES `/pipeline` | Real | YES TEST 1 | WORKING | None |
| D02 | Download + probe stage | — | n/a | n/a | YES `videos.duration_seconds` | YES `pipeline.py:58-76` | Real; rejects no-video-stream and zero-duration | YES real E2E | WORKING | None |
| D03 | **Qwen3-ASR transcription** | Transcription | YES shown in UI | n/a | YES `videos.transcript` | YES `models/asr.py:362-458` | **Real.** bf16, greedy, 300 s chunks with 2 s overlap, longest-shared-run stitching | YES 4,704 aligned words on 60-min audio; long matrix 5/5 | WORKING | **Do not touch** |
| D04 | **Qwen3-ForcedAligner word timings** | Word-level timing | YES via captions | n/a | YES `videos.transcript_segments.words` | YES `models/asr.py:684-820` | **Real.** Monotonic, >=40 ms, 50 ms dedupe; degradation to flat segments is non-fatal and flagged | YES real | WORKING | **Do not touch** |
| D05 | **Qwen3-VL visual analysis** | "AI that understands every frame" | n/a | n/a | n/a job/clip rows | YES `models/vision.py:123-198` | **Real** 8-bit inference on sampled frames, JSON parse retried once | YES real | PARTIAL | **Known weakness:** `MAX_VISION_FRAMES=12` at `FRAME_SAMPLE_INTERVAL=10.0` from `VISION_START_OFFSET=0.0` (`config.py:198-202`) means only the first ~120 s of a 1-hour video is analysed |
| D06 | **Mistral clip selection + scoring** | 6-dimension scoring | YES score badge | n/a | YES `clip_candidates` (9 score columns) | YES `models/mistral.py` + `services/clip_detection.py` | **Real.** 7 Pydantic-bounded scores, three-layer JSON defence, one bounded corrective re-ask | YES 12 JSON cases; real 2 validated clips | PARTIAL | **6 of 7 sub-scores default to 0** (`schemas/pipeline.py:94-99`) and are persisted indistinguishably from a real 0; `MIN_SCORE=0.0` (`config.py:170`) makes the score filter a no-op |
| D07 | **Clip validation** | Server refuses bad clips | n/a | n/a | n/a | YES `validate_and_rank` (pure) | **Real and strong.** Rejects `end<=start`, `end>duration+0.5`, span<20 s, span>90 s, score<MIN, overlap; never widens a range server-side | YES 25 unit tests | WORKING | **Do not touch** |
| D08 | **9:16 rendering** | Vertical clips | YES "9:16" badge | n/a | YES `generated_clips.aspect_ratio` | YES `rendering.py:42-69` | **Real.** 1080x1920, 30 fps, CRF 23, AAC 128k, `+faststart`; missing/zero-byte output raises `RENDER_FAILED` | YES 2 real clips, real E2E 9/9 | WORKING | **Do not touch** |
| D09 | **Captions burned in** | Auto-captions | YES visible in output | n/a | n/a — the ASS file is a temp artifact | YES `captions.py` + `subtitles` filter | **Real.** Word-timed cues, 6-word/32-char/4.0 s/0.6 s-pause/punctuation breaks, Arial 72, outline 3, burned in | YES 23 caption tests + real render | WORKING | Requires FFmpeg **with libass** — document as a hard prerequisite |
| D10 | Caption style options | "templates to choose from" | NO | NO | NO | NO — one hardcoded `Krix` style | Nothing | no | MISSING | Build a caption-template table, or change the copy |
| D11 | **Clip storage + signed URLs** | See your clips | YES | YES `GET /api/clips?videoId=` | YES `generated_clips` | YES private bucket | **Real.** `{user_id}/clips/…`; ownership pre-checked; 1 h signed URLs | YES real + E2E | WORKING | None |
| D12 | **Clip preview** | Watch clips | YES `GeneratedClips.tsx:87-155` | YES | YES | n/a | Real signed-URL playback with score and range labels | YES | WORKING | None |
| D13 | **Clip download** | Download clips | YES `DownloadButton.tsx` | YES signed URL | n/a | n/a | Real blob download | n/a | WORKING | `downloading` never stays true (`DownloadButton.tsx:28,45`) — cosmetic |
| D14 | Clip delete | Remove a clip | NO | NO | NO | NO | Nothing | no | MISSING | Build, or scope deletion to the parent video |
| D15 | Clip retry / regenerate | Try again | PARTIAL `content/[videoId]/page.tsx:85,90-98` | PARTIAL `/api/repurpose` | PARTIAL | YES pipeline re-trigger path | **Both "Retry" and "Regenerate" call `/api/repurpose`, which regenerates text only — no clip is ever re-rendered** | no | PARTIAL | Rename the buttons, or add a real clip re-run |
| D16 | Processing status polling | Live progress | YES `hooks.ts:70-81` | YES | YES | YES | Real, pauses when idle, 6–8 s cadence | YES | WORKING | None |
| D17 | Processing error surfacing | See why it failed | YES `StatusPill` + `error_message` | YES | YES | YES `errors.py` | Real; 16 error codes mapped to HTTP statuses; messages sanitized | YES 21 error tests | WORKING | `errors.py:73` matches the bare substring `"oom"`, so "Zoom"/"Broom"/"Bloom" misclassify as OOM |
| D18 | Clip thumbnail | See a frame | YES | YES signed URL | YES `thumb_path` | YES `pipeline.py:353-370` | Real frame grab | YES real | PARTIAL | **Bug confirmed:** `_write_thumbnail` returns a truthy `Path` on all three branches, so `pipeline.py:273`'s `if thumb_path:` never guards, and `storage.py:112` opens the missing file **outside** the `try` — a failed thumbnail fails an already-rendered video |
| D19 | Worker auth | Bearer token | n/a | n/a | n/a | YES `main.py:62-76` | Real; **fails closed** on empty or `changeme` | YES 8 auth tests | WORKING | Not constant-time; use `hmac.compare_digest` |
| D20 | GPU backpressure / queue | — | n/a | n/a | n/a | YES `services/job_queue.py` | Real: `GPU_QUEUE_MAX_PENDING=16` counted by an explicit counter, so capacity cannot race, then `BUSY`/429 | YES 13 queue tests | WORKING | None |
| D21 | Model memory management (1 resident model) | — | n/a | n/a | n/a | YES `models/manager.py:48-98` | Real single-slot cache with CUDA cache clear | n/a | WORKING | None |
| D22 | Worker `/health`, `/status`, `/jobs` | — | n/a | n/a | n/a | PARTIAL `main.py:87-158` | **Unauthenticated.** `/status` publishes model IDs, quantization, and the full pipeline config; `/jobs` lists 25 `video_id`s openly | no | PARTIAL | Add bearer auth, or bind the worker to an unreachable interface |
| D23 | Worker to app repurpose callback | Auto-repurpose | n/a | n/a | n/a | YES `repurpose_callback.py` | Real; cannot fabricate content (sends only a `videoId`); never raises; per-video lock; URL is not caller-controlled | YES 8 tests | WORKING | None |
| D24 | Visual-analysis coverage of long videos | "understands every frame" | n/a | n/a | n/a | PARTIAL `config.py:198-202` | **`MAX_VISION_FRAMES=12`, `FRAME_SAMPLE_INTERVAL=10.0`, `VISION_START_OFFSET=0.0`** — the first ~120 s of a 1-hour source only. Sampling is env-overridable, so the fix is a config change plus a better default strategy | YES measured | PARTIAL | Distribute the sample budget across the full duration |

### 1.E — Repurposing (LLM content generation)

| # | Feature | Frontend Claim | UI | API | DB | Backend/Worker | Real Result | Tested | Status | Required Work |
|---|---|---|---|---|---|---|---|---|---|---|
| E01 | Repurpose endpoint | Turn a video into posts | YES | YES `POST /api/repurpose` | YES `repurposed_content` | YES LLM provider | **Real code path**, zero successful LLM calls in this environment | YES TEST 5 | BLOCKED | **OpenRouter credit exhausted: 2,601 tokens affordable vs 4,000 requested.** Rounds up to 10,000 then fails |
| E02 | Token budget economics | — | n/a | n/a | n/a | YES `MINIMAX_CONFIG.max_tokens=4000` | **Environment over-specification:** the brief needs ~800–1,500 tokens, so a 4,000 cap forces 10,000 billing units. A 2,000 cap is sufficient and affordable | YES | BLOCKED | Set `max_tokens=2000` |
| E03 | Cheap-model fallback chain | "always works" | n/a | YES `ai-provider.ts:33-52` | n/a | n/a | **Real:** 2 fallbacks per attempt, 3 attempts, temp 0.7 | no | PARTIAL | **Bug:** `AI_QUALITY` prefers premium models, so the primary failure is on an expensive model and the chain only degrades after burning quota. Quality-first is correct, but it must be reported, not hidden |
| E04 | Suppressible local heuristic | Never fails | n/a | NO | n/a | n/a | **`ai-provider.ts:109-134` computes a deterministic, transcript-derived 5-content pack that is then discarded by the `else` in `repurpose/route.ts:230-259`.** It is the strongest available remediation and is 3 lines away from being used | no | MISSING | Use the heuristic; label it "draft" |
| E05 | 5 content types | Shorts, X, Blog, Email, LinkedIn | n/a | YES | YES `content_type` | YES | Types are real; **no row exists.** `hooks` and `thumbnails` are declared in `types/index.ts` and never produced | YES TEST 5 | PARTIAL | Produce `hooks`, or remove the type |
| E06 | "AI timestamps" in generated copy | Clips contain clickable timestamps | n/a | n/a | n/a | n/a | **Never produced.** `repurpose/route.ts:230-259` calls the LLM with no video metadata, so the model cannot know a single timestamp, and none is written to `repurposed_content` | no | MISSING | Pass `{videoId}` so the worker's `aigc.json` seed (`repurpose_callback.py:20`) is used |
| E07 | Viral score on content | "virality scores" | NO — no component renders it | n/a | YES `repurposed_content.viral_score` | n/a | **Column exists. Never written. Never displayed.** Analytics invents its own instead | no | MISSING | Compute, store, display |
| E08 | Content editing | "editable templates" | **NO — no edit UI, no `PUT` handler wired to a form** | YES `PUT /api/content/[id]` | YES | n/a | **Route exists but is broken** — see section 6. Body validates `status`, `content_text`, `content_type`; `regenerate` is ignored | no | PARTIAL | Fix ownership, add a form |
| E09 | Content deletion | — | NO | YES `DELETE /api/content/[id]` | YES | n/a | **Same ownership bug as E08** | no | PARTIAL | Same fix |
| E10 | CSV export of content | "export" | NO | NO | NO | NO | Nothing | no | MISSING | Build, or remove the claim |
| E11 | `has_viral_moment` | "your viral moment" | n/a | n/a | YES column | n/a | **Always `false`; no code writes `true`** | no | MISSING | Compute, or remove |
| E12 | Cost/latency transparency | — | NO | NO | NO | n/a | LLM latency, token usage and cost are **never returned to the user** | no | MISSING | Return and display usage |

### 1.F — Payments and subscriptions

| # | Feature | Frontend Claim | UI | API | DB | Backend/Worker | Real Result | Tested | Status | Required Work |
|---|---|---|---|---|---|---|---|---|---|---|
| F01 | Subscription model | 4 paid tiers | n/a | n/a | YES `subscriptions` (1 row/user, `RLS user_id`-scoped) | n/a | Real schema; **no production code ever writes this table** | no | PARTIAL | Wire signup + checkout webhooks |
| F02 | `/pricing` tiers | 4 priced plans | YES | NO checkout | n/a | NO | Display only; all CTAs → `/auth/signup` | no | MOCK | Wire to real checkout |
| F03 | Stripe checkout | Real Stripe | YES `pricing/page.tsx:189-277` | PARTIAL `/api/payments/create-order` | n/a | NO | **Non-functional.** `stripe.ts:49` has `price_xxxxx` and `plan_xxxxx` placeholders; `page.tsx:30-33` points at a **non-existent** `/checkout/stripe` route (`StripeCheckout.tsx:41`) | no | MOCK | Real price IDs; create the checkout route |
| F04 | Stripe webhook | Fulfil the purchase | NO UI | PARTIAL `create-webhook` | n/a | NO | **No signature verification** (`payments/index.ts:85-92`) and `payment_intent.succeeded` is never handled | no | MISSING | Verify with `stripe.webhooks.constructEvent` and upsert the subscription |
| F05 | Razorpay order + verify | Real Razorpay | YES | PARTIAL `create-order`, `verify` | n/a | NO | **Order creation is real. Verification never happens** — `verify` only reads `auth_session`, so a success state cannot be reached | no | MOCK | Implement HMAC verification and fulfilment |
| F06 | Payment-method switching | Manage card / UPI | YES `settings/page.tsx:159-178` | YES `PUT /api/payments/payment-method` | YES | NO | **No ownership proof.** `route.ts:16` checks only that a session exists, then writes `pm_` string plus a `last4` the client supplied (`settings/page.tsx:14-22`) | no | MISSING | Derive `last4` from the provider; never trust client input |
| F07 | `/api/payments/verify` | — | NO UI | YES | n/a | NO | **Highest-risk route in the repo — but the flaw is narrower than it looks.** The route *is* authenticated (`route.ts:8-11`) and *is* ownership-scoped (`.eq('user_id', userId)` at line 39), so it cannot grant a plan to another user. The real defect: **signature verification runs only when `provider === 'razorpay'`** (line 17), so any other or missing value skips it and still sets `status: 'active'` (line 35). A logged-in user can therefore self-activate their own paid plan for free. Secondary: the HMAC signs the payment id joined to the subscription id by a pipe, which does not match Razorpay's documented `order_id` + `payment_id` scheme, so verification likely never succeeds for genuine payments either; the comparison uses `!==` rather than a constant-time compare; and the route prefers a **global** `STRIPE_SECRET_KEY`, which exposes the real key on account creation (see finding 2) | no | MISSING | Delete, or require webhook-only fulfilment |
| F08 | Free-trial enforcement | "7-day free trial" | n/a | NO | NO | NO | **No trial field, no trial logic, no expiry check** anywhere | no | MISSING | Build, or remove the claim |
| F09 | Usage limits | "Unlimited videos" | n/a | NO | NO | NO | **No enforcement code.** The upload cap comes from Supabase bucket config (MB), not from the plan | no | MISSING | Enforce per plan |
| F10 | Watermark removal | "No watermark" / "Watermarked exports" | NO | NO | NO | NO | **No watermarking code exists at all** | no | MISSING | Build, or delete the claim |
| F11 | Entitlement gating | — | NO | NO | NO | NO | **No route checks the plan.** `SubscribedBadge` is purely cosmetic | no | MISSING | Add a `requirePlan` guard |
| F12 | `/api/subscription` | Plan + usage | YES | YES | YES | n/a | Real; **reads the real row and a real count of the user's videos**; returns `cancel_at_period_end`; 4-second in-memory cache | no | PARTIAL | It **never creates** a subscription and **never reflects checkout** |
| F13 | Free-tier user limit | "up to 3 videos/month" | n/a | NO | YES `usage_logs` | NO | **`usage_logs` is never read or written.** The limit does not exist | no | MISSING | Implement the meter |
| F14 | Seat-based pricing | "per seat", "5 team seats" | YES `Pricing.tsx:40-55,153` | NO | NO | NO | **No seat model anywhere.** `/dashboard/team`'s "Upgrade to add seats" button is a dead `<span>` | no | MISSING | Build, or delete the seat copy |
| F15 | Razorpay/Stripe client keys | — | n/a | YES | n/a | n/a | Public keys returned correctly; **private keys must be service-role or per-user** | no | PARTIAL | See F07 |

### 1.G — AI provider configuration surface

| # | Feature | Frontend Claim | UI | API | DB | Backend/Worker | Real Result | Tested | Status | Required Work |
|---|---|---|---|---|---|---|---|---|---|---|
| G01 | `/api/ai/config` GET | Provider status | YES | YES | n/a | n/a | **Correct least-privilege design** — masks keys (`sk-***ABCD`), returns booleans only, never leaks a secret | no | WORKING | **Keep this pattern for everything** |
| G02 | `/api/ai/config` POST | Change the key | n/a | YES | n/a | n/a | **Stores a global key shared by all users** in a JSONB column | no | PARTIAL | Move to per-user credentials, or remove the endpoint |
| G03 | Per-user AI credentials | "bring your own key" | NO | NO | n/a | n/a | **Does not exist.** One operator key serves every account | no | MISSING | Build if BYO-key is a requirement |
| G04 | Image generation provider | "AI-designed thumbnail" | NO | NO | n/a | n/a | **No image provider configured anywhere** | no | MISSING | Build, or relabel the capability |
| G05 | `/api/generate/image` | — | NO | NO | n/a | n/a | **Does not exist** | no | MISSING | Only if AI thumbnails ship |
| G06 | Groq key present | — | n/a | n/a | n/a | YES | Used as the LLM default; the only genuinely funded key | n/a | WORKING | None |

### 1.H — Developer surface: API, keys, MCP

| # | Feature | Frontend Claim | UI | API | DB | Backend/Worker | Real Result | Tested | Status | Required Work |
|---|---|---|---|---|---|---|---|---|---|---|
| H01 | Public REST API | "The video API every AI agent can call" | YES `api/page.tsx:76-127` | **NO `/v1` route exists** | NO | NO | **Zero** `/v1` handlers. 24 API routes exist and **all** require a Supabase session cookie | no | MISSING | Build `/v1` + `Authorization: Bearer kx_…` |
| H02 | API key issuance | "your personal API key" | YES `api/page.tsx:32-64` | NO | `api_keys` table exists, **never read or written** | NO | **`api/page.tsx:43` fabricates the key in the browser:** `'kx_live_' + 'x'.repeat(32)`. Copying it yields a literal string of 32 `x`s | no | MOCK | Remove the generate button; issue server-side after real auth |
| H03 | API docs page | "Explore the docs" | YES `api/page.tsx:139-244` | n/a | n/a | n/a | **A code block, not docs.** No `Developer` navbar entry, and the landing CTA is a non-link `<span>` `Capabilities.tsx:354` | no | MOCK | Build `/docs` or an "API (Soon)" page |
| H04 | `api_keys` table security | — | n/a | n/a | YES | n/a | **`user_id` has no FK and no RLS policy** — RLS is enabled with 0 policies, so the table is effectively ownerless. An `api_key_lookup` RPC exists and is security-definer — unnecessary exposure given nothing consumes it | no | MISSING | FK + per-user RLS, or drop the table |
| H05 | MCP server | "One protocol. Every clip." | YES `api/page.tsx:183-244` | NO | n/a | NO | **No MCP implementation anywhere in the repo.** Only a snippet in a code block | no | MISSING | Build, or label Soon everywhere (footer already does) |
| H06 | Endpoints advertised vs real | 6 endpoints listed | YES `api/page.tsx:76-127` | n/a | n/a | n/a | **All 6 are fictional.** `POST /v1/repurpose`, `GET /v1/clips/{id}`, `GET /v1/analytics`, `GET /v1/credits`, `POST /v1/webhooks`, `DELETE /v1/videos/{id}` | no | MOCK | Delete, or build |
| H07 | Rate limits | "1000 req/min" | YES `api/page.tsx:130-132` | n/a | NO | NO | **No rate limiting code exists** | no | MISSING | Build |
| H08 | SDK / CLI | "Python, Node, cURL" | YES `api/page.tsx:139-175` | n/a | n/a | NO | Copyable snippets, no installable package | no | MOCK | Publish SDKs, or present as plain `curl` |
| H09 | `/api/rate-limit` | Throttle the app | n/a | **NO such route** | n/a | n/a | The UI's own rate limit card points at a non-existent route | no | DEAD | Remove, or build |

### 1.I — Database, infrastructure, operations

| # | Feature | Frontend Claim | UI | API | DB | Backend/Worker | Real Result | Tested | Status | Required Work |
|---|---|---|---|---|---|---|---|---|---|---|
| I01 | `schema.sql` core tables | — | n/a | n/a | YES 6 tables | n/a | `users`, `videos`, `clip_candidates`, `generated_clips`, `video_metadata`, `usage_logs`; RLS on 5 | n/a | WORKING | None |
| I02 | `ai_pipeline.sql` | — | n/a | n/a | YES 6 tables | n/a | `processing_jobs`, `repurposed_content`, `users`, `videos`, `generated_clips`, `clip_candidates`; RLS on 2; 4 storage policies | n/a | PARTIAL | **No FK, no CHECK, no unique constraint, no index on any foreign key, and no index on `(user_id, created_at)`** — required for every list query the dashboard makes |
| I03 | Video processing stage enum | 12 stages | n/a | n/a | YES | YES | `VideoProcessingStage` in `types/index.ts` has 12 values and matches the worker, but the UI maps only 6 | n/a | PARTIAL | See C23/C24 |
| I04 | Storage buckets | `krix-videos`, `krix-clips` | n/a | n/a | YES | YES | Real, `PRIVATE`, correctly namespaced per user | n/a | WORKING | None |
| I05 | Migrations | — | n/a | n/a | n/a | n/a | **There is no `supabase/migrations` directory at all.** The schema exists only as static SQL under `src/components/supabase/`, alongside `.local.sql` and `.remote.sql` variants, which invites drift | n/a | MISSING | Start real migrations |
| I06 | Seed / demo data | — | n/a | n/a | n/a | n/a | **None.** Every "sample" in the UI is a hardcoded array | n/a | MISSING | Add a dev-only seed |
| I07 | Email / notifications | "we'll email you" | NO | NO | NO | n/a | No mailer, no queue, no template | no | MISSING | Build, or remove the claim |
| I08 | Analytics events | "Track clip performance" | n/a | NO | NO | NO | **No event table, no event writer.** There is no way for the product to learn that a clip performed well | no | MISSING | Build ingest + storage |
| I09 | Observability | — | n/a | NO | n/a | n/a | Only `console.log`/`print`. No Sentry, no metrics, no tracing, no alerting | n/a | MISSING | Add error tracking before launch |
| I10 | Rate limiting | — | n/a | NO | n/a | n/a | None on any route | no | MISSING | Build |
| I11 | CSRF protection | — | n/a | PARTIAL | n/a | n/a | Same-site cookies help, but **`x-user-id` is accepted from a client-supplied header** `auth-utils.ts:51-54` | no | PARTIAL | Remove the header path |
| I12 | CORS | — | n/a | n/a | n/a | n/a | No CORS config; acceptable while same-origin only | n/a | WORKING | Revisit when `/v1` ships |
| I13 | `.env.example` completeness | — | n/a | n/a | n/a | n/a | **Genuinely thorough** — Supabase URL/anon/service-role, Stripe publishable/secret/webhook, Razorpay key/secret, six AI providers with model overrides, MaxMind, app + worker URLs, `INTERNAL_SERVICE_KEY`, `AI_WORKER_API_KEY`, and every upload/ingest/timing limit with explanatory comments | n/a | WORKING | **But** it ships `INTERNAL_SERVICE_KEY=changeme` and `AI_WORKER_API_KEY=changeme` as literal defaults — see finding 8 |
| I14 | `.gitignore` | — | n/a | n/a | n/a | n/a | **Correct and considered**: `.env*` with `!.env.example`, node/next/Vercel output, `*.pem`, `*.log`, `__pycache__`, pytest cache, Playwright artifacts, and path-anchored `ai-worker/**/work-*` patterns with a comment explaining exactly why a naive pattern fails | n/a | WORKING | None |
| I15 | Production build | — | n/a | n/a | n/a | n/a | Not run in this audit; `tsc` and `lint` both pass | n/a | PARTIAL | Run `next build` and fix any failure |
| I16 | Unit tests | — | n/a | n/a | n/a | YES | **12 unit files / 188 tests, plus 5 GPU+ffmpeg integration files / 34 tests — 222 total, all passing** — the highest-quality asset in the repo | YES | WORKING | **Do not touch** |
| I17 | React component tests | — | n/a | n/a | n/a | n/a | **Zero. No jsdom, no RTL, no test ids** | no | MISSING | Add RTL for the six mock pages first |
| I18 | E2E tests | — | n/a | n/a | n/a | n/a | 3 Playwright specs: ingestion, AI, regression. **Run against a real 10.84 MB video and a real GPU** | YES | WORKING | Keep; they are the reason the core is trustworthy |
| I19 | CI | — | n/a | n/a | n/a | n/a | **No CI workflow.** Nothing runs `tsc`, `lint`, or `pytest` on push | no | MISSING | Add a CI job |
| I20 | Pre-commit hooks | — | n/a | n/a | n/a | n/a | None | no | MISSING | Add lint-staged |
| I21 | Monitoring of repurpose failures | — | n/a | NO | NO | NO | **A blocked LLM call records no failure** — no row, no log, no alert. It fails silently | no | MISSING | Record failures durably |
| I22 | Legal pages | — | **NO** | n/a | n/a | n/a | `/privacy` and `/terms` are 17 dead footer links; no DPA, no ToS, no cookie consent, no export/delete of personal data | no | MISSING | Publish before collecting data |
| I23 | Accessibility | — | PARTIAL | n/a | n/a | n/a | Some `aria-label`s, but several `<span>` elements act as buttons with no `role`/`tabIndex`, so they are unreachable by keyboard and screen reader | no | PARTIAL | Replace with real `<button>` |
| I24 | Mobile responsiveness | — | PARTIAL | n/a | n/a | n/a | Sidebar is fixed `w-64` with no mobile collapse; several grids are fixed 3–4 columns with no breakpoint | no | PARTIAL | Add breakpoints |
| I25 | Error boundaries | — | PARTIAL | n/a | n/a | n/a | `error.tsx` and `not-found.tsx` exist, but `api-client` errors surface only as generic `console.error` and an empty list | n/a | PARTIAL | Surface server error messages |

### 1.J — Test and verification inventory

| Suite | Location | Count | Run state | What it proves | What it does not prove |
|---|---|---|---|---|---|
| Worker unit tests | `ai-worker/tests/` | 12 files, 188 tests | All passing | Clip validation, caption segmentation, error mapping, queue backpressure, repurpose callback, auth, log redaction, migration SQL | Anything about the Next.js app |
| Worker integration (real GPU + ffmpeg) | `ai-worker/tests/integration/` | 5 files, 34 tests | Passing | Real ASR, real forced alignment, real Qwen3-VL, real Mistral, real 1080x1920 render, real burned-in captions, long-video behaviour | The Next.js app, any LLM call |
| Playwright ingestion | `e2e/ingestion.spec.ts` | 1 spec | Passing against a real video | Local upload, worker polling, duplicate YouTube import, timestamp-collision regression, free-tier limit probe | Marketing claims, analytics, billing |
| Playwright regression | `e2e/regression.spec.ts` | 1 spec | Passing | The two prior regressions stayed fixed | New work |
| Playwright smoke | `e2e/smoke.spec.ts` | 1 spec | Passing | Route and auth smoke | Anything deep |
| TypeScript | `npx tsc --noEmit` | — | **PASS** (this audit) | No type errors | Runtime correctness |
| Lint | `npm run lint` | — | **PASS** (this audit) | No lint errors | Runtime correctness |
| React component tests | — | **0** | — | — | The entire dashboard |
| Billing tests | — | **0** | — | — | Every payment route |
| Auth tests | — | **0** | — | — | OAuth, sessions, rate limits |
| Security tests | — | **0** | — | — | Everything in section 11 |

---

## 2. CORE PIPELINE ASSESSMENT — DO NOT REGRESS

This section exists so that implementation work does not damage the one part of Krix that is genuinely finished.

**Verified working, and protected by tests:**

1. Local upload → DB row → worker trigger → download → probe.
2. Qwen3-ASR transcription with 300-second chunking and overlap stitching — 4,704 words on a 60-minute file.
3. Qwen3-ForcedAligner word timings — monotonic, min 40 ms, verified against the real transcript.
4. Qwen3-VL visual analysis on sampled frames, with JSON-parse retry.
5. Mistral clip scoring, 7 bounded scores, three-layer JSON defence, one corrective re-ask.
6. `validate_and_rank` — 25 unit tests; refuses inverted, over-long, over-long-range, below-threshold and overlapping clips, and never widens a range server-side.
7. FFmpeg 1080x1920 / 30 fps / CRF 23 / AAC 128k / `+faststart`; a missing or zero-byte output raises `RENDER_FAILED`.
8. Word-timed burned-in captions — 23 caption tests, and confirmed present in real rendered output.
9. Private per-user storage with 1-hour signed URLs, ownership pre-checked.
10. RLS on the core tables, plus working local E2E coverage.

**Three weaknesses worth fixing, none of which require re-architecting:**

| Issue | Evidence | Impact | Fix |
|---|---|---|---|
| Visual analysis samples only the opening ~120 s | `config.py:198-202` — `MAX_VISION_FRAMES=12`, `FRAME_SAMPLE_INTERVAL=10.0`, `VISION_START_OFFSET=0.0` | A 1-hour video is analysed as if it were 2 minutes long. Every clip decision downstream is biased toward the start | Distribute the sample budget across the whole duration |
| 6 of 7 clip sub-scores default to 0 and persist as a real 0 | `schemas/pipeline.py:94-99`; `MIN_SCORE=0.0` at `config.py:170` | A perfect clip and an unmeasured clip look identical in the DB and in the score badge | Make them nullable, or write `null` when not scored |
| A failed thumbnail can fail a successful render | `pipeline.py:353-370` always returns a truthy path; `storage.py:112` opens it outside `try` | A cosmetic failure destroys an otherwise perfect video | Return `None` on failure and treat the thumbnail as optional |

---

## 3. MARKETING CLAIM VERSUS IMPLEMENTED REALITY

Every claim below appears on the public site. The right-hand column is the only defensible wording until the gap is closed.

| Claim on site | Source | Reality | Recommended copy |
|---|---|---|---|
| "Turn one video into one hundred posts" | `Hero.tsx:52` | 5 text types, none produced (credit-blocked) | "Turn one video into clips and posts" |
| "Ready in ~5 minutes" | `Hero.tsx:119` | 188.97 s for a 60 s video; a 1-hour video is far longer | "Typically a few minutes per minute of video" |
| "Trusted by 10,000+ creators" | `TrustedBy.tsx:1` | Zero users, 10 invented brands | Delete |
| Creator marquee with follower counts | `Hero.tsx:5-11` | Invented people | Delete |
| "AI Producer… music, motion design" | `Capabilities.tsx:37` | No code | Remove the card |
| "The only clipping model that works on every genre" | `Capabilities.tsx:46` | One 60 s test video | "Clip scoring tuned for spoken-word video" |
| "AI B-Roll… millions of stock clips" | `Capabilities.tsx:53` | No code | Remove the card |
| "AI Reframe… object tracking keeps subjects centred" | `Capabilities.tsx:60` | Fixed centre crop; tracking signals computed then discarded | "Automatic 9:16 crop" |
| "AI Editor — trim, extend, filler-word removal" | `Capabilities.tsx:78` | No code | Remove the card |
| "Animated captions with 97%+ accuracy" | `Capabilities.tsx:85`, `FAQ.tsx:16` | Static captions; word timing measured but accuracy unmeasured | "Word-timed burned-in captions" |
| "Schedule a month's posts to all 6 platforms in 10 minutes" | `Capabilities.tsx:91` | No code, no platform integration | Remove the card |
| "Export to XML for Premiere / DaVinci" | `Capabilities.tsx:97` | No XML in the repository | Remove the card |
| "AI-designed, click-worthy thumbnail in 1 click" | `Capabilities.tsx:103` | An ffmpeg frame at the clip midpoint | "Auto-generated frame grab" |
| "Your brand's fonts, colors, logo" | `Capabilities.tsx:110` | One hardcoded ASS style | Remove the card |
| "Team workspace — roles, review, projects" | `Capabilities.tsx:116` | `/dashboard/team` is a mock | Remove the card |
| "The video API every AI agent can call" (**not labelled Soon**) | `Capabilities.tsx:134` | No API | "API — Soon" |
| "MCP" | `Capabilities.tsx:141` | No MCP | Already labelled Soon — keep |
| "Community inspiration gallery" (**not labelled Soon**) | `Capabilities.tsx:150` | 8 hardcoded cards | "Curated workflow examples" |
| "Thumbnails & hooks" format card | `Capabilities.tsx:159` | Never produced | Remove |
| "send it straight to any platform — or automate it with our API" | `HowItWorks.tsx:24` | Copy and download only | "Copy or download your clips" |
| "$0 / $15 / $24 / $70" pricing | `Pricing.tsx:18` | Display only, no checkout | Mark as "planned plans" |
| "Unlimited videos", "No watermark", "Watermarked exports" | `Pricing.tsx:28-36` | No limits, no watermarking | Remove |
| "AI custom branding", "Custom AI training" | `Pricing.tsx:44-49` | No code | Remove |
| "API access", "24/7 phone support" | `Pricing.tsx:51-54` | No API, no phone | Remove |
| 3 named plans, 5 team seats, 2 GB uploads | `Pricing.tsx:40-55` | Bucket is 50 MB and is 2 GB **zero times**; no seat model | Correct to 50 MB; remove seats |
| 6 testimonials with roles and follower counts | `Testimonials.tsx:11-48` | Invented | Delete |
| "+266% impressions, +57% watch time, 1→3% → 12%+" | `Testimonials.tsx:4` | Invented | Delete |
| "10x output", "-$2,700/mo", "2x conversions" | `Solutions.tsx:38-62` | Invented | Delete or label as projections |
| "97% caption accuracy" | `FAQ.tsx:16` | Unmeasured | Remove the number |
| "Works in 14 languages" | `FAQ.tsx:17` | **True** — auto-detect + Whisper multilingual | Keep |
| "Every clip is viral-worthy" | `FAQ.tsx:18` | A heuristic score, not a prediction | "Clips are scored for engagement signals" |
| "AI relayout for every aspect ratio" | `FAQ.tsx:19` | 9:16 only | Say "9:16" |
| "Fully editable inline" | `FAQ.tsx:20` | No editor | Remove |
| "7-day free trial, no credit card" | `FAQ.tsx:31`, `CTA.tsx:25` | No trial | Remove, or build trials |
| "support@krix.app" | `FAQ.tsx:30` | No mail path | Add `mailto:` or a contact route |
| "One link in, a month of content out" | `dashboard/page.tsx` | One video in, N clips out | "One video in, clips and drafts out" |

**Net effect:** of roughly 30 advertised capabilities, **6 exist** (upload, ASR + alignment, visual analysis, clip scoring, 9:16 render with captions, preview/download), **3 are implemented but externally blocked**, and **the rest are either mocks or absent**. Aligning the site with the code is a few hours of copy work and is the single highest-value action available before any new feature is built.

---

## 4. PROJECTS — MOCK

`src/app/dashboard/projects/page.tsx`

| Aspect | Finding |
|---|---|
| Data source | `useState(initialProjects)` — 4 hardcoded projects. No fetch, ever. |
| API routes | **None.** There is no `/api/projects` in the repository. |
| Tables | **None.** No `projects` table in either SQL file. |
| Create project | Local-only `setProjects`. The new project disappears on refresh. |
| Status filter | Purely local. |
| Marketing dependency | `Capabilities.tsx:116-119` promises "manage projects together". |

**Fix:** add `projects` and `project_members`, enforce `user_id` RLS, and build `/api/projects` CRUD before this page earns its navbar slot.

---

## 5. CALENDAR / SCHEDULER — MOCK

`src/app/dashboard/calendar/page.tsx`

| Aspect | Finding |
|---|---|
| Data source | `useState(seedPosts)` — 6 fabricated posts. No fetch. |
| API routes | **None.** |
| Tables | **None.** No scheduling or publishing table. |
| Create / delete / drag | Local state only. |
| Platform integration | **None.** No TikTok, YouTube, LinkedIn, X, Instagram or email publisher exists. |
| Marketing dependency | `Capabilities.tsx:91-96` promises "a month's posts to all 6 platforms in 10 minutes". |
| `/dashboard` copy | "one link in, a month of content out". |

**Fix:** treat this as three separate pieces of work — a real `content_calendar` table and `/api/calendar`, a real scheduler, and real platform publishing with OAuth. Only then does the capability card become true.

---

## 6. CONTENT UPDATE / DELETE — PARTIAL, AND BROKEN

`src/app/api/content/[id]/route.ts` — the only route in the app that reads an ownership-checked row and then misreads it.

| Problem | Detail |
|---|---|
| Root cause | `select('id, videos!inner(user_id)')` on a Supabase **many-to-one** join returns `videos` as a **single object**. Both `PUT` and `DELETE` treat it as an **array** and read `.length` and `[0]` (lines 73-74, 138-139). |
| What actually happens | For an object, `.length` is `undefined`, so the `length === 0` guard is `false` and evaluation continues to `(existing.videos)[0].user_id` — which throws `TypeError: Cannot read properties of undefined (reading 'user_id')`. The surrounding `catch` swallows it. |
| Result | **`PUT` and `DELETE /api/content/[id]` return HTTP 500 for every user, for every row** — the ownership check is not merely wrong, it never completes. |
| Also | `sanitizeFilename` is imported and never called; a `regenerate` intent is accepted by no schema and silently ignored. |
| UI exposure | No form or delete control is wired up, which is the only reason nobody has noticed. |
| Not affected | `GET /api/content/[id]` (lines 22-30) queries `videos` directly with `.eq('user_id', userId)` rather than embedding, so it is correct. `GET /api/clips` is correct. |

**Fix:** replace the array read with a direct object read (`(existing.videos as { user_id: string })?.user_id !== userId`), and add a route test. This is roughly a five-line change plus one test, and it is the highest bug-density item in the app.

---

## 7. TEAM / SEATS / WORKSPACE — MOCK

`src/app/dashboard/team/page.tsx`

| Aspect | Finding |
|---|---|
| Data source | `useState(initialMembers)` — 4 fabricated members. |
| API routes | **None.** No `/api/team`, `/api/invite`, or `/api/members`. |
| Tables | **None.** No `workspaces`, `workspace_members`, `roles`, or `invitations` table. |
| Roles | A role `<select>` per row that changes nothing. |
| "Invite" | Local-only `setMembers` push. |
| "Upgrade to add seats" | A dead `<span>` — no handler, no route, no seat model. |
| RLS posture | Every table is single-tenant by `user_id`, so multi-tenant isolation would need new policies everywhere. |
| Marketing dependency | `Capabilities.tsx:116-119`. |

**Fix:** the honest options are (a) delete the route and the card, or (b) commit to multi-tenancy: `workspaces`, `workspace_members`, a membership check in the auth layer, and `user_id` → `workspace_id` on every content table. Option (b) is a multi-week change and should not be started casually.

---

## 8. ANALYTICS — PARTIAL, ~40% REAL

`src/app/dashboard/analytics/page.tsx` and `src/app/api/analytics/route.ts`

### What is real

The API is genuinely scoped, genuinely user-scoped, and genuinely reads the database:

| Real metric | Source | Correct |
|---|---|---|
| Total videos | `videos.count()` scoped to `user_id` | YES |
| Completed videos | `videos.count()` with `status='completed'` | YES |
| Total clips | `generated_clips` join scoped to `user_id` | YES |
| Total content items | `repurposed_content` join scoped to `user_id` | YES |
| 14-day repurposed counts | `repurposed_content` grouped by date | YES, and `n/a` when empty |

### What is fabricated

Everything else. The page adds roughly a dozen hardcoded series and headline numbers on top of the five real ones:

| Hardcoded element | Source |
|---|---|
| Impressions, engagement, watch time, follower growth, reach, CTR | `analytics/page.tsx:60-90` |
| "Viral score 8.4" hero tile | `analytics/page.tsx:224-234` |
| Platform performance for TikTok / Instagram / YouTube / LinkedIn / X — all 5 platforms' every metric | `analytics/page.tsx:110-140` |
| 7-day engagement series and the top-clips table | `analytics/page.tsx:145-190` |
| "Top performing clip" leaderboard with view counts | `analytics/page.tsx:196-220` |

**The platform table is the worst offender.** It names five real platforms and shows complete performance for each. Nothing in this product posts to any of them, and no platform metric is ever collected.

### Two structural problems

1. **There is no way for the product to know a clip performed well.** No analytics events table, no event writer, no platform OAuth, no ingestion. `analytics/page.tsx:71-88` even acknowledges the data is fabricated. Real performance data requires event ingest, storage, and platform APIs — a project, not a fix.
2. **`hooks.ts:99-101` swallows every error and returns the fallback**, so a 500 renders as a plausible-looking dashboard of invented numbers rather than an error. This is the most dangerous kind of mock behaviour: it is indistinguishable from success.

**Fix, in order:** (1) delete every hardcoded series and show only the five real counters; (2) add an error state so failures cannot masquerade as data; (3) build `clip_events` + ingest; (4) only then add platform performance, and only for platforms actually connected.

---

## 9. CHECKOUT — MOCK

`src/app/dashboard/pricing/page.tsx`, `src/components/payments/*`, `src/app/api/payments/*`

| Path | Finding |
|---|---|
| Landing `/pricing` | 4 tiers display correctly. **All CTAs go to `/auth/signup`.** Nothing is purchasable. |
| "Contact sales" | Links to `/auth/signup`. **No sales path exists.** |
| "Read the FAQ" | Links to `#faq`, **which does not exist on the page.** |
| `/pricing` payment modal | "Choose your payment method" → Stripe or Razorpay. Both non-functional (F03, F05). |
| Stripe | `stripe.ts:49` ships `price_xxxxx` / `plan_xxxxx`. `page.tsx:30-33` navigates to `/checkout/stripe`, **a route that does not exist** (`StripeCheckout.tsx:41`). |
| Stripe webhook | No signature verification; `payment_intent.succeeded` unhandled. |
| Razorpay | Order creation is real; verification never happens. |
| Subscription state | `/api/subscription` reads a table that **no code ever writes.** Nothing in the product can move a user from free to paid. |
| Trial | No trial field, no logic. The "7-day free trial" claim is unsupported. |
| Plan enforcement | No route checks a plan. Every paid capability would be free for every user. |
| Watermarks | No watermarking code exists, in either direction. |

**Verdict:** there is no revenue path. A user can sign up, use everything for free forever, and never be charged. `POST /api/payments/create-order` is the closest thing to a real payment integration, and even it depends on placeholder price IDs.

---

## 10. DEVELOPER PLATFORM — MOCK

`src/app/dashboard/api/page.tsx`

| Claim | Reality |
|---|---|
| "API key" | **Fabricated in the browser.** `api/page.tsx:43`: `setApiKey('kx_live_' + 'x'.repeat(32))`. Copying gives a literal run of 32 `x`s. A user will paste it into a terminal and it will mean nothing. |
| `api_keys` table | Exists, `RLS` enabled with **zero policies**, `user_id` has **no FK**. Nothing reads or writes it. |
| 6 REST endpoints | **All fictional.** No `/v1` route exists anywhere. |
| "1000 requests/minute" | No rate limiting exists anywhere. |
| Python / Node / cURL examples | Snippets in a `<pre>`. No installable SDK. |
| MCP server | **None.** A code block only. Footer already says "Coming soon"; the capability card and the API page do not. |
| `api_key_lookup` | SECURITY DEFINER RPC with no consumer — needless exposure. |
| "Explore the docs" | A non-link `<span>`. No `/docs` route. |
| `DELETE /v1/videos/{id}` | Meanwhile the real `DELETE /api/videos/[videoId]` **has no UI caller at all** (C10). |

**Fix:** delete the fake key generation, label the whole surface Soon, and either build `/v1` with server-issued keys behind `Authorization: Bearer`, or remove the route from the navbar. Shipping a fake key generator is worse than shipping nothing: it teaches users the API is real.

---

## 11. SECURITY FINDINGS

Ordered by risk. Findings 1–3 must be resolved before any public launch.

| # | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| 1 | **CRITICAL** | **A signed-in user can self-activate their own paid subscription without paying.** `/api/payments/verify` verifies the Razorpay HMAC **only** when `provider === 'razorpay'`. Any other value — `'stripe'`, or simply omitting the field — skips verification entirely and still runs `update({ status: 'active' })`. The route *is* authenticated and *is* scoped by `.eq('user_id', userId)`, so it cannot grant a plan to another account, but no payment is required for one's own. | `api/payments/verify/route.ts:17-41` | Fulfil subscriptions **only** from a signature-verified provider webhook. Remove the client-callable verify route. |
| 2 | **HIGH** | **Private keys leave the server on account creation.** `/api/payments/create-order` prefers a **global** `STRIPE_SECRET_KEY` over a per-user secret, so signing up returns `secretKey` to the browser. `/api/ai/config` POST stores a global key. | `payments/index.ts`; `api/ai/config/route.ts` | Never return a private key to a client, under any branch. Use per-user encrypted credentials, or platform-held keys. |
| 3 | **HIGH** | **Payment methods are client-trusted.** A session alone authorises writing a `pm_…` string and a `last4` the **client supplied**. | `payments/payment-method/route.ts:16`; `settings/page.tsx:14-22` | Derive `last4` and ownership from the provider. Ignore client-supplied card data. |
| 4 | **HIGH** | **No auth rate limiting or abuse protection.** Unauthenticated login and signup are unmetered, enabling credential stuffing, mass account creation and free-tier quota farming. | no middleware | Per-IP and per-email limits, plus alerting. |
| 5 | **HIGH** | **Google OAuth is broken**, so the only non-password path to an account is unavailable. | `auth/callback/page.tsx:13-17` | Fix code exchange, remove the race. |
| 6 | **MEDIUM** | **No CI, no pre-commit hooks, no component tests, no billing tests.** | repo root | Add CI running `tsc`, `lint`, `pytest`, Playwright. |
| 7 | **MEDIUM** | **Worker `/status` and `/jobs` are unauthenticated** and publish model IDs, quantization, pipeline config and 25 `video_id`s. | `ai-worker/app/main.py:87-158` | Bearer auth, or bind to an unreachable interface. |
| 8 | **MEDIUM** | **`INTERNAL_SERVICE_KEY` has no placeholder guard on the Next.js side, and `.env.example` ships it as `changeme`.** The worker's auth explicitly fails closed on `changeme`, but `auth-utils.ts:10-18` only checks `if (!secret) return false`, and `middleware.ts:24-28` returns early on a match — skipping every later middleware check. Both compare with `===` rather than a constant-time compare. A deployment that copies `.env.example` unchanged accepts a publicly known key on every protected path. | `auth-utils.ts:10-18`; `middleware.ts:24-28`; `.env.example` | Reject `changeme` and empty values in `isValidServiceKey` exactly as the worker does; use `timingSafeEqual`; fail startup if the value is still a placeholder |
| 9 | **MEDIUM** | **No legal pages, no cookie consent, no data export or deletion.** 17 dead footer links imply all of them exist. | `Footer.tsx` | Publish `/privacy`, `/terms`, `/security`; implement export and delete. |
| 10 | **MEDIUM** | **No rate limiting on any API route**, including the unauthenticated `/api/payments/create-order` and `/api/ingest-url`. | repo wide | Per-user and per-IP limits. |
| 11 | **MEDIUM** | **No error tracking.** Only `console.log`. A silent repurpose failure is indistinguishable from success. | repo wide | Sentry on both Next.js and the worker. |
| 12 | **LOW** | **Silent failures masquerade as data.** `hooks.ts:99-101` swallows errors, so a failed fetch renders the analytics page's invented numbers. | `hooks.ts:99` | Real error states. |
| 13 | **LOW** | **Client-supplied `x-user-id` is still sent** on every API call, and `auth-utils.ts:51-54` still contains a comment describing a trust path that no longer exists. Harmless today because it returns `null`, but the comment invites a future implementer to "fix" it into a real bypass. | `auth-utils.ts:51-54`; `api-client.ts:32-36` | Delete the fallback and the header; delete the comment. |
| 14 | **LOW** | **`api_keys` has RLS with 0 policies and no FK**; a SECURITY DEFINER lookup RPC has no consumer. | `schema.sql` | FK + per-user RLS, or drop the table. |
| 15 | **LOW** | **Non-constant-time worker token comparison.** | `ai-worker/app/main.py:63-72` | `hmac.compare_digest`. |
| 16 | **LOW** | **Substring error match** — `"oom"` in `_OUT_OF_MEMORY` matches "Zoom", "Broom", "Bloom" and misclassifies them as `MODEL_OUT_OF_MEMORY`. | `ai-worker/app/errors.py:24,73` | Use exact enum matching. |
| 17 | **LOW** | **Interactive `<span>` elements** styled as buttons — not focusable, not activatable by keyboard, and a maintenance trap. | `Capabilities.tsx:354`; `Solutions.tsx:136`; `inspiration/page.tsx` | Real `<button>` elements. |
| 18 | **LOW** | **No foreign keys, CHECKs, or index on any FK or on `(user_id, created_at)`** in `ai_pipeline.sql`, so list queries degrade as data grows. | `ai_pipeline.sql` | Add keys, checks, indexes. |
| 19 | **LOW** | **Storage cleanup is not surfaced**, so failed jobs accumulate partial artifacts. | `app/pipeline.py`; `services/storage.py` | A `/api/videos/[id]` DELETE should remove DB rows **and** both storage prefixes. |
| 20 | **LOW** | **Thumbnail uploads are sent as `video/mp4`.** `upload_clip` hardcodes the content type, so the JPEG thumbnail is uploaded with the wrong MIME type. | `services/storage.py:116` | Infer the content type from the file extension. |

### What is done right, and should be preserved

- The 24 `/api` routes are consistently session-derived; only one reads a client-supplied identity header, and it returns `null`.
- Storage buckets are `PRIVATE`, correctly namespaced per user, and every read is ownership-checked before a signed URL is issued.
- RLS is enabled on the core tables.
- Worker auth **fails closed** on empty or `changeme` values.
- **`getUserId` is genuinely safe**: it reads only the cookie session and returns `user?.id ?? null`. It does *not* honour the service key or the client-supplied `x-user-id`, so a service-key request to a user-scoped route still receives 401.
- The repurpose callback's own docstring states it "never accepts a key from a request body, so a user can" — and the code matches the comment.
- `.gitignore` is correct and considered, including path-anchored `ai-worker/**/work-*` patterns with a comment explaining why a naive pattern fails.
- `.env.example` is genuinely thorough, documenting every provider and every limit.
- `/api/ai/config` GET is a model of least privilege — masked keys, booleans only, no secret ever returned.
- **Secret redaction is genuinely well built**, and is better than a name-based filter would be: `errors.py:30-56` strips JWTs by shape, provider key shapes (`sk`/`pk`/`rk`/`sb`/`sb_secret`/`hf`/`api`/`key`/`token`/`secret` plus a separator and 8+ characters), `Authorization` headers, and `key=value` pairs — while preserving the diagnostic value of the surrounding message. Covered by 21 error-mapping tests.
- Passwords are never stored, logged or returned.
- The worker cannot fabricate content — the repurpose callback sends only a `videoId`.

---

## 12. IMPLEMENTATION ROADMAP

Effort is expressed in engineer-days and assumes one full-stack engineer already familiar with this codebase. **S** = stop-shipper, **L** = launch blocker, **P** = post-launch.

### P0 — before any public launch (estimate: 6–9 days)

| # | Item | Why it is S | Effort |
|---|---|---|---|
| P0-1 | Delete `/api/payments/verify` | CRITICAL self-service privilege escalation | 0.1 |
| P0-2 | Stop returning private keys to clients; use per-user credentials or platform keys | HIGH key exposure on signup | 0.5 |
| P0-3 | Fix `PUT`/`DELETE /api/content/[id]` ownership (`videos` is an object, not an array) | Both routes are 404 for every user | 0.2 |
| P0-4 | Fix `POST /api/payments/payment-method` — derive `last4` from the provider | HIGH client-trusted card data | 0.5 |
| P0-5 | Fix Google OAuth code exchange, remove the race | HIGH broken sign-in path | 0.3 |
| P0-6 | Reject placeholder `INTERNAL_SERVICE_KEY`; close the middleware matcher gap | HIGH — `.env.example` ships `changeme`, and the Next.js side accepts it | 0.3 |
| P0-7 | **Align every marketing claim with the code** (section 3) | The site advertises ~30 capabilities; ~6 exist | 1 |
| P0-8 | Remove analytics hardcoded metrics; add real error states | Fabricated analytics that look real | 0.5 |
| P0-9 | Make a real checkout work end to end: real price IDs, a `/checkout/stripe` route, verified webhooks, subscription upsert | No revenue path exists | 2 |
| P0-10 | Auth rate limiting on login and signup | Abuse, quota farming | 0.5 |
| P0-11 | Add CI running `tsc`, `lint`, `pytest`, Playwright | Zero automated protection | 0.5 |
| P0-12 | Publish `/privacy` and `/terms`; implement data export and delete | Legal exposure | 1 |

### P1 — to make the product coherent (estimate: 8–12 days)

| # | Item | Why | Effort |
|---|---|---|---|
| P1-1 | **Unblock repurpose**: set `max_tokens=2000`, wire the existing local heuristic as a labelled draft, and record failures durably | The headline "one video into posts" feature has never produced output | 1.5 |
| P1-2 | **Prove and show AI timestamps** — pass `{videoId}` so `aigc.json` is used | Claimed in the UI, structurally impossible today | 1 |
| P1-3 | Build `/api/projects` + `projects`/`project_members` + RLS | Removes a mock from the navbar | 2 |
| P1-4 | Content edit and delete **UI**, wired to the now-working routes | Two working endpoints, zero callers | 1 |
| P1-5 | Video delete UI, wired to the existing endpoint | Same | 0.5 |
| P1-6 | Retry/regenerate: rename to "Regenerate copy", and add a real clip re-run | Buttons promise a clip and deliver text | 0.5 |
| P1-7 | Build `/api/calendar` + `content_calendar` + RLS | Removes a mock from the navbar | 2 |
| P1-8 | Fix the thumbnail-only render failure; make thumbnail optional | Cosmetic failure destroys good videos | 0.3 |
| P1-9 | Distribute Qwen3-VL sampling across the full duration | 1-hour videos are analysed as 2-minute videos | 0.5 |
| P1-10 | Make 6 of 7 clip sub-scores nullable; lower `MIN_SCORE` from 0.0 | Real and unmeasured scores are indistinguishable | 0.5 |
| P1-11 | Map all 12 processing stages in `PipelineProgress` and `StatusPill` | Stages silently show as pending | 0.3 |
| P1-12 | Poll to a terminal state instead of optimistically setting `completed` | Users are told "ready" before it is | 0.3 |
| P1-13 | API rate limiting on all routes | No abuse controls | 0.5 |
| P1-14 | Delete the fake API-key generator; label the API surface Soon | Removes a fabricated credential | 0.3 |
| P1-15 | Add `ErrorBoundary` + Sentry on Next.js and the worker | Silent failures | 0.5 |
| P1-16 | Add RTL tests for the six mock pages and the auth forms | Zero frontend coverage | 2 |
| P1-17 | FKs, CHECKs and indexes on `ai_pipeline.sql`; start real `supabase/migrations` | Correctness and scale | 1 |
| P1-18 | Startup guard: refuse to boot in production with a placeholder `INTERNAL_SERVICE_KEY` or `AI_WORKER_API_KEY` | Deployment mistakes | 0.2 |
| P1-19 | Caption templates (a real table) | A marketed feature is a hardcoded constant | 1 |
| P1-20 | Authenticate worker `/status` and `/jobs`; `hmac.compare_digest`; exact error enum match | Information disclosure | 0.3 |

### P2 — real differentiation (estimate: 15–25 days)

| # | Item | Why it is worth building | Effort |
|---|---|---|---|
| P2-1 | **Smart Reframe** — consume the `speaker_position` / `visual_interest` signals Qwen3-VL already computes | The data exists and is discarded. This is the highest-leverage gap on the site. | 4 |
| P2-2 | **B-roll** — new table, provider, insert pass | A named capability with zero code | 4 |
| P2-3 | **AI Producer** — music, motion, intro/outro | A named capability with zero code | 6 |
| P2-4 | **Inline editor** — trim, split, reorder, filler-word removal (deletion ranges are **already** in `transcript_segments.words`) | Filler-word removal is mostly a rendering change | 6 |
| P2-5 | **AI thumbnails** — image provider, typography, template | Currently a bare frame grab | 3 |
| P2-6 | **`clip_events` + analytics ingest + a real dashboard** | Turns the most fabricated page into a real one | 5 |
| P2-7 | **Public API `/v1` + server-issued keys + rate limits + docs** | Only worth doing after P0/P1 | 6 |
| P2-8 | **Real scheduler + platform publishing with OAuth** | Turns the calendar from a mock into a product | 8 |
| P2-9 | **MCP server** | Correctly labelled Soon everywhere except two places | 3 |
| P2-10 | **Trial, entitlements, usage metering, watermarking** | Required before any pricing claim is honest | 6 |
| P2-11 | **Brand templates** — fonts, colours, logo, intro, outro | Marketed, absent | 4 |
| P2-12 | **Premiere / DaVinci XML export** | Marketed, absent | 2 |
| P2-13 | **Teams / workspaces / roles / invitations / seats** | Marketed, absent; a multi-tenancy project | 10 |
| P2-14 | **Source connectors** — Drive, Vimeo, Loom, Riverside, StreamYard, Twitch, Facebook, LinkedIn | Already disclosed as "coming" — ship them one at a time | 1.5 each |
| P2-15 | **Custom AI training** | Marketed, absent; a research project | 10 |

### P3 — hygiene (estimate: 3–5 days, any time)

Add `migrations/` seed data; make `Sparkline` render an empty state; fix `DownloadButton`'s stuck `downloading` flag; surface `2 GB` from the API instead of hardcoding; fix the navbar and pricing anchors; remove the 17 dead footer links; replace interactive `<span>`s with `<button>`s; add mobile breakpoints to the fixed-width sidebar and grids; add a `Download all clips` bulk action; add a redaction allow-list; implement storage cleanup on delete.

---

## 13. FILE-BY-FILE INVENTORY

### Fully working — do not touch

`src/lib/database.types.ts` (schema-accurate, complete) · `src/lib/supabase/client.ts` · `src/lib/supabase/server.ts` · `src/lib/auth-utils.ts` (except line 51) · `src/components/ui/*` · `src/components/Navbar.tsx` · `src/components/CommandPalette.tsx` · `src/app/auth/login/page.tsx` · `src/app/api/upload/route.ts` · `src/app/api/pipeline/process/route.ts` · `src/app/api/clips/route.ts` · `src/app/api/videos/[videoId]/route.ts` · `src/app/api/ai/config/route.ts` (GET) · `src/components/VideoUpload.tsx` · `src/components/VideoLibrary.tsx` · `src/components/GeneratedClips.tsx` · `src/components/ai/ProviderBadge.tsx` · `ai-worker/app/models/asr.py` · `ai-worker/app/models/mistral.py` · `ai-worker/app/models/vision.py` · `ai-worker/app/services/transcription.py` · `ai-worker/app/services/clip_detection.py` (validation) · `ai-worker/app/services/captions.py` · `ai-worker/app/services/rendering.py` · `ai-worker/app/errors.py` (except lines 24, 73) · `ai-worker/app/services/job_queue.py` · `ai-worker/app/services/repurpose_callback.py` · `ai-worker/tests/**` · `e2e/**` · `ai-worker/requirements.txt` (ASR, aligner, Mistral, ffmpeg, pytest, playwright)

### Working but needs a small change

`src/lib/ai-provider.ts` (use the local heuristic; chain the models) · `src/lib/hooks.ts` (return real errors) · `src/lib/api-client.ts` (remove the `x-user-id` header; delete 7 dead methods; default `baseURL`) · `src/lib/upload.ts` (pure helpers, no changes needed) · `src/components/VideoPlayer.tsx` · `src/components/StatusPill.tsx` (all 12 stages) · `src/components/PipelineProgress.tsx` (all 12 stages) · `src/components/Sparkline.tsx` (empty state) · `src/components/ContentGenerator.tsx` · `src/components/Navbar.tsx` (mobile; single subscription fetch) · `src/components/ComingSoon.tsx` (use it everywhere a feature is missing) · `middleware.ts` (matcher) · `.env.example` · `ai-worker/app/main.py` (auth on `/status`, `/jobs`) · `ai-worker/app/services/video_analysis.py` (full-duration sampling) · `ai-worker/app/pipeline.py` (optional thumbnail) · `ai-worker/app/config.py` (caption style as a table) · `docker-compose.yml` (real credentials) · `package.json` (test scripts)

### Broken or dangerously wrong

`src/app/api/content/[id]/route.ts` (many-to-one read) · `src/app/api/payments/verify/route.ts` (delete) · `src/app/api/payments/payment-method/route.ts` (client-trusted) · `src/app/api/payments/create-webhook/route.ts` (unsigned) · `src/lib/stripe.ts` (placeholder IDs) · `src/components/payments/StripeCheckout.tsx` (dead route) · `src/app/auth/callback/page.tsx` (OAuth) · `src/lib/ai-provider.ts:109-134` (dead heuristic) · `ai-worker/app/pipeline.py:353-370` (thumbnail bug) · `ai-worker/app/services/storage.py:112-113` (file opened outside the `try`)

### UI over a non-existent backend

`src/app/dashboard/analytics/page.tsx` · `calendar/page.tsx` · `projects/page.tsx` · `team/page.tsx` · `api/page.tsx` · `inspiration/page.tsx` · `src/app/dashboard/pricing/page.tsx`

### Marketing over a non-existent product

`src/components/landing/Hero.tsx` · `TrustedBy.tsx` · `Capabilities.tsx` · `Solutions.tsx` · `Testimonials.tsx` · `FAQ.tsx` · `Pricing.tsx` · `CTA.tsx` · `Footer.tsx`

### Dead code

`src/lib/api-client.ts:117,140-176` · `x-user-id` on both sides · `api_key_lookup` RPC · `ai-provider.ts:109-134` · `StripeCheckout.tsx` (whole file) · `db:seed` npm script · `/dashboard/video/[id]` alias route

### Documentation

`README.md` (honest, but links to dead pages) · `DEVELOPMENT.md` · `package.json` (no `test` script) · `ai-worker/README.md` (missing env vars) · `PLAYWRIGHT_TESTING.md` · `E2E_README.md` · `CONVERSATION_CONTEXT.md` · `AI_IMPLEMENTATION_PLAN.md` (stale — 6 features marked complete that do not exist) · `AI_PIPELINE_STATUS.md` (stale Supabase and E2E claims) · `REPOSITORY_DOCUMENTATION_REPORT.md` (overstates capabilities)

**Required documentation work:** mark `AI_IMPLEMENTATION_PLAN.md` and `AI_PIPELINE_STATUS.md` as superseded, add FFmpeg-with-libass as a hard prerequisite, correct "2 GB" to the live bucket limit, and update `README.md`'s feature list.

---

## 14. VERDICT BY SURFACE

| Surface | Verdict | One-line reason |
|---|---|---|
| Marketing site | **FAIL** | Advertises ~30 capabilities; ~6 exist; 6 testimonials, 10 brands, 10 stats and 5 platform tables are fabricated |
| Authentication | **PARTIAL** | Email/password works; Google OAuth is broken; no reset, no rate limits, verification bypassed |
| Dashboard overview | **WORKING** | Real data, real polling, all tiles live |
| Upload | **WORKING** | Real, size-checked, real byte progress, real end-to-end clip |
| Video library | **WORKING** | Real list, search, filters; delete has no UI |
| Content review page | **WORKING** | Real clips, real signed playback, real download |
| AI pipeline | **WORKING** | ASR, alignment, VL, Mistral, FFmpeg, captions — all real and tested |
| Repurposing | **BLOCKED** | Code is correct; OpenRouter has 2,601 affordable tokens against a 4,000 request |
| Analytics | **MOCK** | 5 real counters buried under ~12 fabricated series, and errors render as invented data |
| Calendar | **MOCK** | 6 hardcoded posts, no API, no table |
| Projects | **MOCK** | 4 hardcoded projects, no API, no table |
| Team | **MOCK** | 4 hardcoded members, no API, no seats |
| API | **MOCK** | Key fabricated in the browser; all 6 endpoints fictional |
| Inspiration | **MOCK** | 8 hardcoded cards |
| Settings | **WORKING** | Real profile, real subscription read, real provider status |
| Pricing | **MOCK** | Display only; checkout is non-functional end to end |
| Payments | **MOCK + CRITICAL FLAW** | Placeholder price IDs, unsigned webhook, and a verify route that lets a signed-in user self-activate a plan for free |
| Developer/MCP | **MISSING** | No MCP server, no `/v1` |
| Database | **PARTIAL** | Real RLS and buckets; no FKs, no checks, no migrations, no indexes |
| Security | **FAIL** | 1 critical, 3 high, 6 medium |
| Testing | **PARTIAL** | 222 worker tests + 3 Playwright specs pass, but zero component, billing, auth or security tests, and no CI |
| Observability | **MISSING** | `console.log` only; silent repurpose failures |
| Legal | **MISSING** | No privacy, terms, consent, export or deletion |
| Accessibility | **PARTIAL** | Interactive spans; incomplete ARIA; no mobile breakpoints |

---

## 15. FINAL TALLY

All counts below are **derived from the 177 itemised rows in sections 1.A–1.I**, counted mechanically, not estimated. Section 1.J is a test inventory and is not included in the feature count.

### By status

| Status | Count | Share |
|---|---|---|
| WORKING | 47 | 27% |
| PARTIAL | 46 | 26% |
| MISSING | 51 | 29% |
| MOCK | 24 | 14% |
| DEAD | 5 | 3% |
| BLOCKED | 2 | 1% |
| SCAFFOLDED | 2 | 1% |
| PLANNED | 0 | 0% |
| **Total** | **177** | **100%** |

**Read this table carefully.** Only about a quarter of the audited surface actually works. `MISSING` and `MOCK` together are **75 of 177 items — 42%** — and they are concentrated precisely where the marketing site is loudest.

### By section

| Section | Rows | WORKING | PARTIAL | SCAFFOLDED | MOCK | MISSING | PLANNED | BLOCKED | DEAD |
|---|---|---|---|---|---|---|---|---|---|
| A — Marketing site | 44 | 6 | 12 | 2 | 10 | 12 | 0 | 0 | 2 |
| B — Authentication | 12 | 6 | 2 | 0 | 0 | 3 | 0 | 0 | 1 |
| C — Dashboard routes and shared UI | 30 | 10 | 11 | 0 | 7 | 1 | 0 | 0 | 1 |
| D — Video pipeline | 24 | 16 | 6 | 0 | 0 | 2 | 0 | 0 | 0 |
| E — Repurposing | 12 | 0 | 4 | 0 | 0 | 6 | 0 | 2 | 0 |
| F — Payments and subscriptions | 15 | 0 | 3 | 0 | 3 | 9 | 0 | 0 | 0 |
| G — AI provider configuration | 6 | 2 | 1 | 0 | 0 | 3 | 0 | 0 | 0 |
| H — Developer surface | 9 | 0 | 0 | 0 | 4 | 4 | 0 | 0 | 1 |
| I — Database and infrastructure | 25 | 7 | 7 | 0 | 0 | 11 | 0 | 0 | 0 |
| **Total** | **177** | **47** | **46** | **2** | **24** | **51** | **0** | **2** | **5** |

Two sections stand out. **Section D (the video pipeline) is 67% working** — the strongest area by a wide margin, and the only one where a single external dependency is not the limiting factor. **Section A (marketing) is 14% working**, with 22 of 44 items either mocked or missing. **Section H (developer surface) is 0% working.**

### By priority

| Priority | Items | Definition |
|---|---|---|
| P0 — stop-shipper | 12 | Security, correctness, or a public claim that is false |
| P1 — launch coherence | 20 | Makes the product internally consistent and monetizable |
| P2 — differentiation | 15 | Named capabilities with no implementation |
| P3 — hygiene | 11 | Polish, dead code, documentation |
| **Total identified work** | **58** | |

### Effort summary

| Phase | Estimate | Note |
|---|---|---|
| P0 | 6–9 days | Three of the twelve are one-line changes with outsized risk reduction |
| P1 | 8–12 days | Mostly wiring real endpoints to real UI, plus one checkout |
| P2 | 15–25 days | The named capabilities. Smart Reframe is the best value in this list |
| P3 | 3–5 days | Any time |
| **P0 + P1** | **14–21 days** | **The point at which Krix becomes an honest, safe, sellable early-access product** |

### Overall production readiness

| Dimension | Score | Basis |
|---|---|---|
| Core AI pipeline | **9 / 10** | 222 worker tests (188 unit + 34 real GPU/ffmpeg) and 3 Playwright specs, 3 specific fixable weaknesses |
| Upload and processing UX | **8 / 10** | Real, size-checked, live progress, real output |
| Data model maturity | **6 / 10** | Real RLS and buckets; no FKs, checks, migrations, or indexes |
| Authentication | **5 / 10** | Email/password works; OAuth broken; no reset, no limits |
| Testing and CI | **5 / 10** | Excellent in the worker, absent in the app, no CI anywhere |
| Dashboard honesty | **2 / 10** | 6 of 8 dashboard routes are mock or blocked |
| Security | **3 / 10** | 1 critical, 3 high, 6 medium |
| Monetization | **1 / 10** | No revenue path exists end to end |
| Developer platform | **1 / 10** | Key fabricated in the browser; no API, no MCP |
| **Overall** | **4 / 10** | |

**Final verdict: NOT PRODUCTION READY — but unusually close on the core, and far from honest about its edges.**

Krix is not a prototype. The upload-to-clip path is real, tested, and would survive technical diligence: 222 passing worker tests including 34 that run real ASR, real FFmpeg, and real Qwen3-VL and Mistral on a GPU, plus 3 Playwright browser specs, proper RLS, private per-user storage, ownership checks, and genuinely careful engineering in the hardest code in the repository.

Krix is not yet a product. **42% of the audited surface is either mocked or missing**, concentrated almost entirely in marketing, payments, and the developer platform. The public site promises roughly 30 capabilities and delivers 6. There is no way to pay, no analytics, no projects, no calendar, no team, no API, and no MCP. One payment route lets any signed-in user grant themselves a paid plan without paying.

**The correct next work is not "build more features."** It is: delete the payment self-activation route, fix the two broken ownership checks, fix OAuth, stop returning private keys to clients, correct every false marketing claim, strip the fabricated analytics, and make one checkout work end to end. **Roughly 6–9 engineer-days** converts Krix from "an impressive demo with a dangerous edge" to "honest, safe, sellable early access." Only after that should Smart Reframe, B-roll, or AI Producer be started — and Smart Reframe should be first, because the tracking signals it needs are already being computed and thrown away.

