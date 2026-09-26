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

- **Python 3.12** (3.14 is NOT supported yet by the ML stack — torch/transformers/bitsandbytes). Install 3.12 and create the venv with it.
- NVIDIA GPU with **≥ 8 GB VRAM** and CUDA drivers; PyTorch CUDA build.
- **FFmpeg (full build with libass)** for captions. On Windows,
  `winget install Gyan.FFmpeg` then point `FFMPEG_PATH`/`FFPROBE_PATH` at the
  `bin\` binaries in `ai-worker/.env` if they are not on PATH.
- Supabase project with the migration applied (see root [`README.md`](../README.md) → Quick Start step 3, run `ai_pipeline.sql` after `schema.sql`).

> Japanese/Korean alignment: install `nagisa` / `soynlp` if you align those
> languages (see `requirements.txt` notes).

---

## Quick start

```bash
cd ai-worker

# 1. Create the venv with Python 3.12
py -3.12 -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux

# 2. Install dependencies (CUDA-enabled torch is pulled by default index;
#    for a custom CUDA wheel: pip install torch --index-url https://download.pytorch.org/whl/cu124)
pip install -r requirements.txt

# 3. Configure
copy .env.example .env          # Windows
# cp .env.example .env          # macOS/Linux
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_WORKER_API_KEY, FFMPEG_PATH...

# 4. Run
uvicorn app.main:app --host 127.0.0.1 --port 8741 --reload
```

First pipeline run downloads the models into your Hugging Face cache
(~2 GB ASR + ~3 GB vision + ~4 GB Mistral download, then quantized in VRAM).
You can point `HF_HOME` at a specific cache dir.

## Testing

`app.config` is pure-stdlib and the heavy ML imports are lazy, so unit tests run
fast with no GPU/models:

```bash
cd ai-worker
python -m pytest
```

Tests cover caption building, clip-candidate validation/dedupe, FFmpeg command
generation, storage ownership checks, the structured error contract, and API
auth.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET/POST` | `/health` | none | liveness |
| `GET` | `/status` | none | worker + model/pipeline config |
| `POST` | `/pipeline` | bearer | run the full pipeline in the background (returns immediately) |
| `POST` | `/transcribe` | bearer | debug: ASR on a local audio path |
| `POST` | `/analyze-video` | bearer | debug: VL analysis on a local video path |
| `POST` | `/find-clips` | bearer | debug: Mistral clip proposals |
| `POST` | `/render-clip` | bearer | debug: render one clip from local files |

Auth = `Authorization: Bearer <AI_WORKER_API_KEY>`. Set `AI_WORKER_AUTH=false`
only for local development without auth.

## Environment variables

Everything is optional except `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`AI_WORKER_API_KEY`. See `.env.example` for the full list with inline comments:

- **Server** — `AI_WORKER_HOST` (127.0.0.1), `AI_WORKER_PORT` (8741), `AI_WORKER_AUTH`, `AI_WORKER_API_KEY`.
- **Supabase** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_VIDEOS_BUCKET` (videos), `SUPABASE_CLIPS_BUCKET` (generated_clips).
- **FFmpeg** — `FFMPEG_PATH`, `FFPROBE_PATH` (leave `ffmpeg`/`ffprobe` when on PATH).
- **Models** — `ASR_MODEL`, `ASR_ALIGNER_MODEL`, `VISION_MODEL`, `VISION_QUANTIZATION`, `MISTRAL_MODEL`, `MISTRAL_QUANTIZATION`, per-stage `*_DEVICE`.
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
  Qwen3-ASR transcription
  forced alignment -> word timestamps -> transcript_segments (jsonb)
    videos.transcript / transcript_segments written; processing_stage=transcribing
  sample frames (interval, max frames)
  Qwen3-VL -> visual observations            processing_stage=analyzing
  Mistral -> candidate JSON -> validate_and_rank   processing_stage=finding_clips
    clip_candidates inserted
  for top clips: ASS captions (clip-relative) + FFmpeg 9:16 render
    -> upload mp4 + thumbnail -> generated_clips rows   processing_stage=rendering
  finalize: videos.status=completed, processing_stage=completed
```

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
│   ├── asr.py           # Qwen3-ASR + forced alignment
│   ├── vision.py        # Qwen3-VL frame description
│   └── mistral.py       # Mistral chat + strict JSON
└── services/
    ├── audio.py         # ffprobe / ffmpeg extraction / frame sampling
    ├── transcription.py # transcript structures
    ├── video_analysis.py
    ├── clip_detection.py# prompts + pure validation
    ├── captions.py      # ASS/SRT builders (pure)
    ├── rendering.py     # FFmpeg 9:16 command builder + runner
    └── storage.py       # Supabase reads/writes (ownership-checked)
```

## Security notes

- The worker holds Supabase's **service role key** — it MUST live server-side only.
- Every operation is scoped to the `{video_id, user_id}` pair in the request;
  a user's clips/storage are never readable or writable by another user.
- The Next.js boundary (`/api/pipeline/process`, `/api/clips`) is the only
  client-facing surface; the browser never talks to this worker directly.
- `AI_WORKER_AUTH` failure mode is fail-closed when a key is set in `.env.example` (`changeme` is rejected).