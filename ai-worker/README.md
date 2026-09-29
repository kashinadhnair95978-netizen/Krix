# Krix AI Worker

Local, self-hosted AI video pipeline for Krix. The Next.js app uploads a video to
Supabase Storage, then calls `POST /pipeline` here with `{video_id, user_id,
storage_path}`; the worker downloads the video, transcribes it, analyzes it,
picks clip candidates, renders 9:16 vertical clips with burned captions, and
uploads the results back to Supabase. Nothing leaves your machine except the
final clips.

- **Transcription** — `Qwen/Qwen3-ASR-1.7B-hf` + forced alignment
  (`Qwen/Qwen3-ForcedAligner-0.6B-hf`) for word-level timestamps.
- **Visual analysis** — `Qwen/Qwen3-VL-4B-Instruct` (8-bit) on sampled frames.
- **Clip selection** — `mistralai/Mistral-7B-Instruct-v0.3` (4-bit NF4) proposes
  candidates; every proposal is validated server-side (bounds, duration, score,
  overlap). The score is the **Krix Clip Quality Score** — an estimate, not a
  virality guarantee.
- **Rendering** — FFmpeg 9:16 center-crop + ASS caption burn-in (H.264 + AAC).

Fits an **NVIDIA RTX 4060 Laptop GPU (8 GB VRAM)**: only one heavy model is ever
resident — models are unloaded between stages.

---

## Requirements

- **Python 3.12 or 3.14.** The whole stack has been run for real on **Python 3.14.3** (torch 2.14.0+cu126, transformers 5.17.0, bitsandbytes 0.50.2) on an RTX 4060 — see [`../CORE_PIPELINE_COMPLETION.md`](../CORE_PIPELINE_COMPLETION.md). 3.12 works too; the older "3.14 is not supported" note in earlier revisions was wrong.
- NVIDIA GPU with **≥ 8 GB VRAM** and CUDA drivers; PyTorch CUDA build.
- **FFmpeg (full build with libass)** for captions. On Windows,
  `winget install Gyan.FFmpeg` then point `FFMPEG_PATH`/`FFPROBE_PATH` at the
  `bin\` binaries in `ai-worker/.env` if they are not on PATH.
- `torchvision` is **required** — the Qwen3-VL processor imports it to build
  pixel tensors, and the failure is an `ImportError` at model-load time, not at
  install time. It is in `requirements.txt`.
- Supabase project with the migration applied (see root [`README.md`](../README.md) → Quick Start step 3, run `ai_pipeline.sql` after `schema.sql`). Check the SQL before applying it —
  `pytest tests/test_migration_sql.py` catches trigger/table ordering bugs and
  stage-vocabulary drift between the SQL, the TypeScript types and this worker.

> Japanese/Korean alignment: install `nagisa` / `soynlp` if you align those
> languages (see `requirements.txt` notes).

---

## Quick start

```bash
cd ai-worker

# 1. Create the venv (3.12 or 3.14)
py -3.14 -m venv .venv           # or: py -3.12 -m venv .venv
.venv\Scripts\activate           # Windows
# source .venv/bin/activate      # macOS/Linux

# 2. Install dependencies (CUDA-enabled torch is pulled by default index;
#    for a custom CUDA wheel: pip install torch --index-url https://download.pytorch.org/whl/cu124)
pip install -r requirements.txt

# 3. Configure
copy .env.example .env           # Windows
# cp .env.example .env           # macOS/Linux
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_WORKER_API_KEY, FFMPEG_PATH...

# 4. Run
uvicorn app.main:app --host 127.0.0.1 --port 8741 --reload
```

The four models are downloaded on first use into your Hugging Face cache
(`HF_HOME`). Approximate download sizes: Qwen3-ASR-1.7B ~4 GB,
ForcedAligner-0.6B ~1.2 GB, Qwen3-VL-4B ~8.9 GB, Mistral-7B-v0.3 ~14.5 GB
(quantized down to 8-bit / 4-bit in VRAM, not on disk). `work/download.log`
records a completed download of all four.

## Testing

`app.config` is pure-stdlib and the heavy ML imports are lazy, so the default run
needs no GPU and no models:

```bash
cd ai-worker
python -m pytest            # 204 unit/API tests, ~53s, 28 real-hardware tests skipped
```

The real-hardware suites are opt-in via environment flags, because they download
and run actual models:

```bash
# PowerShell
$env:RUN_REAL_ASR="1"  ; python -m pytest tests/integration/test_real_asr_gpu.py
$env:RUN_REAL_VL="1"   ; python -m pytest tests/integration/test_real_vl_mistral_gpu.py
$env:RUN_REAL_LONG="1" ; python -m pytest tests/integration/test_real_long_video_gpu.py
$env:RUN_REAL_E2E="1"  ; python -m pytest tests/integration/test_real_e2e_gpu.py
python -m pytest tests/integration/test_real_ffmpeg.py    # no flag needed
```

| Suite | Tests | What it proves |
| --- | --- | --- |
| `test_real_asr_gpu.py` | 8 | Real Qwen3-ASR + ForcedAligner word timings |
| `test_real_vl_mistral_gpu.py` | 7 | Real 8-bit Qwen3-VL and 4-bit Mistral, both inside 7 GB |
| `test_real_long_video_gpu.py` | 5 | Real 1/10/30/60-minute transcription and chunk stitching |
| `test_real_ffmpeg.py` | 5 | Real probe, extraction, frame sampling, 9:16 render |
| `test_real_e2e_gpu.py` | 9 | **All six pipeline stages in order on a real 60s video** |

`test_real_e2e_gpu.py` redirects only the Supabase writes to a local directory
(the AI migration cannot be applied from a machine with no DDL access), so
everything else in that run is a real model or a real ffmpeg call.

Also available:

```bash
# Static checks on ../src/components/supabase/ai_pipeline.sql (runs in the default
# suite as tests/test_migration_sql.py — no DDL access needed)
python -m pytest tests/test_migration_sql.py
```

The default suite covers caption building (including word-level cue grouping),
clip-candidate validation, dedupe, the bounded corrective retry, FFmpeg command
generation, storage ownership checks, the structured error contract, the
single-GPU queue, the repurpose callback, and API auth.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET/POST` | `/health` | none | liveness (answers while the GPU is busy) |
| `GET` | `/status` | none | worker + model/pipeline config + queue snapshot |
| `GET` | `/jobs` | none | queue snapshot + recent jobs |
| `GET` | `/jobs/{job_id}` | none | one job; top-level `status` mirrors the **job** status |
| `POST` | `/pipeline` | bearer | run the full pipeline in the background (returns immediately) |
| `POST` | `/transcribe` | bearer | debug: ASR on a local audio path |
| `POST` | `/analyze-video` | bearer | debug: VL analysis on a local video path |
| `POST` | `/find-clips` | bearer | debug: Mistral clip proposals |
| `POST` | `/render-clip` | bearer | debug: render one clip from local files |

Auth = `Authorization: Bearer <AI_WORKER_API_KEY>`. Set `AI_WORKER_AUTH=false`
only for local development without auth.

`POST /pipeline` returns `{"status":"started","job_id":...}` immediately and runs
the work on the single GPU queue in the background. Poll `/jobs/{job_id}`. When
the backlog (`GPU_QUEUE_MAX_PENDING`, running **plus** waiting) is full it
returns HTTP 429 `BUSY` rather than queueing without limit.

## Environment variables

Everything is optional except `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`AI_WORKER_API_KEY`. See `.env.example` for the full list with inline comments:

- **Server** — `AI_WORKER_HOST` (127.0.0.1), `AI_WORKER_PORT` (8741), `AI_WORKER_AUTH`, `AI_WORKER_API_KEY`.
- **Supabase** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_VIDEOS_BUCKET` (videos), `SUPABASE_CLIPS_BUCKET` (generated_clips).
- **FFmpeg** — `FFMPEG_PATH`, `FFPROBE_PATH` (leave `ffmpeg`/`ffprobe` when on PATH).
- **Models** — `ASR_MODEL`, `ASR_ALIGNER_MODEL`, `VISION_MODEL`, `VISION_QUANTIZATION`, `MISTRAL_MODEL`, `MISTRAL_QUANTIZATION`, per-stage `*_DEVICE`.
- **Long-audio chunking** — `ASR_CHUNK_SECONDS` (300), `ASR_CHUNK_OVERLAP_SECONDS` (2), `ASR_TOKENS_PER_SECOND` (8), `ASR_MAX_NEW_TOKENS` (4096, a **per-chunk** ceiling), `ASR_ALIGN_CHUNK_SECONDS` (240).
- **GPU queue** — `GPU_QUEUE_MAX_PENDING` (16, running + waiting), `GPU_QUEUE_STATUS_LIMIT` (25), `GPU_LEASE_TIMEOUT` (3600).
- **Automatic repurposing** — `REPURPOSE_ON_COMPLETE` (true), `KRIX_APP_URL` / `APP_BASE_URL`, `INTERNAL_SERVICE_KEY` (must match the Next.js root env), `REPURPOSE_TIMEOUT` (300). Without `INTERNAL_SERVICE_KEY` the callback is disabled and the worker logs why.
- **Pipeline tuning** — `MAX_CLIPS`, `MIN_CLIP_DURATION`, `MAX_CLIP_DURATION`, `FRAME_SAMPLE_INTERVAL`, `MAX_VISION_FRAMES`, `VISION_START_OFFSET`.
- **Rendering** — `RENDER_WIDTH`/`HEIGHT` (1080×1920), `RENDER_FPS`, `RENDER_CRF`, `RENDER_AUDIO_BITRATE`.
- **Captions** — one default style, fully configurable via `CAPTION_*`.
- **Misc** — `AI_WORKER_WORK_DIR`, `AI_WORKER_KEEP_ARTIFACTS`, `HF_HOME`, `HF_TOKEN`, `SUPABASE_TIMEOUT`.

## How the pipeline runs

```
job dir
  download video (owned by {video_id, user_id})
  ffprobe -> duration / has_audio
  extract_audio -> 16 kHz WAV
  Qwen3-ASR transcription, chunked (ASR_CHUNK_SECONDS) with 2s overlap
    per-chunk token budget; overlapping words de-duplicated; word offsets rebased
  forced alignment per chunk -> word timestamps -> transcript_segments (jsonb)
    failed chunks retried at half size, then fall back to flat segments (warnings)
    videos.transcript / transcript_segments written; processing_stage=transcribing
  sample frames (interval, max frames)
  Qwen3-VL -> visual observations            processing_stage=analyzing
  Mistral -> candidate JSON -> validate_and_rank   processing_stage=finding_clips
    one bounded corrective retry if every proposal violates the duration bounds
    clip_candidates inserted
  for top clips: word-grouped ASS captions (clip-relative) + FFmpeg 9:16 render
    -> upload mp4 + thumbnail -> generated_clips rows   processing_stage=rendering
  finalize: videos.status=completed, processing_stage=completed
  optional: POST {KRIX_APP_URL}/api/repurpose with x-service-key  (non-fatal)
```

The GPU queue serializes jobs: exactly one heavy model is resident, and
`/health` and `/status` keep answering while a job holds the GPU.

Any failure is normalized to a structured error:
`{"status":"failed","stage":..., "error_code":..., "message":...}` and stored on
the video/job row (codes live in `app/schemas/pipeline.py`).

## Layout

```
app/
├── config.py            # env-driven configuration (all models/pipeline knobs)
├── main.py              # FastAPI service
├── pipeline.py          # end-to-end orchestrator
├── schemas/pipeline.py  # Pydantic models + error contract
├── models/
│   ├── manager.py       # load one model at a time, free GPU between stages
│   ├── asr.py           # Qwen3-ASR + chunking + forced alignment
│   ├── vision.py        # Qwen3-VL frame description (8-bit)
│   └── mistral.py       # Mistral chat + strict JSON (4-bit NF4)
└── services/
    ├── audio.py         # ffprobe / ffmpeg extraction / frame sampling
    ├── transcription.py # transcript structures
    ├── video_analysis.py
    ├── clip_detection.py# prompt + pure validation + bounded retry
    ├── captions.py      # word grouping + ASS/SRT builders (pure)
    ├── rendering.py     # FFmpeg 9:16 command builder + runner
    ├── job_queue.py     # single-GPU serialization + bounded backlog
    ├── repurpose_callback.py  # worker -> Next.js callback (non-fatal)
    └── storage.py       # Supabase reads/writes (ownership-checked)
```

## Security notes

- The worker holds Supabase's **service role key** — it MUST live server-side only.
- Every operation is scoped to the `{video_id, user_id}` pair in the request;
  a user's clips/storage are never readable or writable by another user.
- The Next.js boundary (`/api/pipeline/process`, `/api/clips`) is the only
  client-facing surface; the browser never talks to this worker directly.
- `AI_WORKER_AUTH` failure mode is fail-closed when a key is set in `.env.example` (`changeme` is rejected).
- The repurpose callback authenticates with the shared `INTERNAL_SERVICE_KEY`,
  never with a user-supplied credential, and a failure there is logged and
  ignored rather than failing a video that has already rendered successfully.