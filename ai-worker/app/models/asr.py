"""
Qwen3-ASR wrapper (transformers, official documented API).

Transcription pipeline:
  1. Load ``Qwen/Qwen3-ASR-1.7B-hf`` with AutoProcessor + AutoModelForMultimodalLM.
  2. ``processor.apply_transcription_request(audio, language)`` → ``model.generate``.
  3. ``processor.decode(..., return_format="parsed")`` gives ``{language, transcription}``.
  4. Optionally run ``Qwen/Qwen3-ForcedAligner-0.6B-hf`` for word-level timestamps via
     ``processor.prepare_forced_aligner_inputs`` + ``processor.decode_forced_alignment``.

Timestamps are chunked (the aligner is designed for ~5 minutes of speech) and merged
into contiguous segments with start/end/text.
"""

from __future__ import annotations

from dataclasses import dataclass

from app import config as cfg
from app.config import PipelineError, Segment
from app.models.manager import manager, require_device


@dataclass
class AsrResult:
    text: str
    language: str | None
    segments: list[Segment]
    words: list[dict]
    aligner_used: bool


def load_asr() -> tuple:
    """Load ASR model + processor via the official transformers API."""
    import torch

    from transformers import AutoModelForMultimodalLM, AutoProcessor

    def factory():
        device = require_device(cfg.ASR_DEVICE, "cuda")
        kwargs: dict = {}
        if device == "cuda":
            kwargs["device_map"] = "auto"
            kwargs["dtype"] = torch.bfloat16
        try:
            processor = AutoProcessor.from_pretrained(
                cfg.ASR_MODEL, token=cfg.HF_TOKEN or None
            )
            model = AutoModelForMultimodalLM.from_pretrained(
                cfg.ASR_MODEL, token=cfg.HF_TOKEN or None, **kwargs
            )
        except Exception as exc:
            if "out of memory" in str(exc).lower() or "OOM" in str(exc):
                raise PipelineError(
                    stage="transcription",
                    code="MODEL_OUT_OF_MEMORY",
                    message=f"Out of memory loading ASR model {cfg.ASR_MODEL}: {exc}",
                ) from exc
            raise PipelineError(
                stage="transcription",
                code="MODEL_MISSING",
                message=f"Could not load ASR model {cfg.ASR_MODEL}: {exc}",
            ) from exc
        model.eval()
        return {"model": model, "processor": processor, "device": device}

    return manager.load("asr", factory)


def _load_aligner() -> tuple | None:
    if not cfg.ASR_ENABLE_TIMESTAMPS:
        return None
    import torch

    try:
        from transformers import AutoModelForTokenClassification, AutoProcessor
    except Exception as exc:  # pragma: no cover - import guard
        return None

    def aligner_factory():
        device = require_device(cfg.ASR_DEVICE, "cuda")
        try:
            processor = AutoProcessor.from_pretrained(
                cfg.ASR_ALIGNER_MODEL, token=cfg.HF_TOKEN or None
            )
            model = AutoModelForTokenClassification.from_pretrained(
                cfg.ASR_ALIGNER_MODEL,
                dtype=torch.bfloat16 if device == "cuda" else torch.float32,
                device_map="auto" if device == "cuda" else None,
                token=cfg.HF_TOKEN or None,
            )
        except Exception as exc:
            raise PipelineError(
                stage="transcription",
                code="MODEL_MISSING",
                message=f"Could not load aligner {cfg.ASR_ALIGNER_MODEL}: {exc}",
            ) from exc
        model.eval()
        return {"model": model, "processor": processor, "device": device}

    return manager.load("asr_aligner", aligner_factory)


def transcribe(audio_path: str) -> AsrResult:
    """Transcribe a local audio file (wav/mp3/…). Returns text + timestamped segments."""
    import torch

    bundle = load_asr()
    model = bundle["model"]
    processor = bundle["processor"]

    try:
        inputs = processor.apply_transcription_request(
            audio=audio_path, language=cfg.ASR_LANGUAGE or None
        )
        inputs = inputs.to(model.device, model.dtype)
    except Exception as exc:
        raise PipelineError(
            stage="transcription",
            code="TRANSCRIPTION_FAILED",
            message=f"Failed to prepare audio for transcription: {exc}",
        ) from exc

    try:
        with torch.inference_mode():
            output_ids = model.generate(
                **inputs,
                max_new_tokens=cfg.ASR_MAX_NEW_TOKENS,
                do_sample=False,
            )
    except torch.cuda.OutOfMemoryError as exc:
        raise PipelineError(
            stage="transcription",
            code="MODEL_OUT_OF_MEMORY",
            message=f"Out of memory during transcription: {exc}",
        ) from exc
    except Exception as exc:
        raise PipelineError(
            stage="transcription",
            code="TRANSCRIPTION_FAILED",
            message=f"Transcription failed: {exc}",
        ) from exc

    generated_ids = output_ids[:, inputs["input_ids"].shape[1]:]
    try:
        parsed = processor.decode(generated_ids, return_format="parsed")[0]
    except Exception:
        parsed = {"language": cfg.ASR_LANGUAGE, "transcription": processor.decode(generated_ids)[0]}

    text = (parsed.get("transcription") or "").strip()
    language = parsed.get("language") or (cfg.ASR_LANGUAGE or None)
    if not text:
        raise PipelineError(
            stage="transcription",
            code="TRANSCRIPTION_FAILED",
            message="ASR returned an empty transcription",
        )

    aligner = _load_aligner()
    words: list[dict] = []
    if aligner is not None:
        try:
            words = _align_words(audio_path, text, language, aligner)
        except Exception as exc:
            # Timestamping is best-effort: fall back to plain segments rather than
            # failing the whole job when only timing broke.
            words = []
            print(f"[warn] forced alignment failed, using plain segments: {exc}")

    segments = _build_segments(words, text)
    return AsrResult(
        text=text,
        language=language if language else None,
        segments=segments,
        words=words,
        aligner_used=bool(words),
    )


# ---------------------------------------------------------------------------
# Forced alignment
# ---------------------------------------------------------------------------


def _align_words(
    audio_path: str,
    transcript: str,
    language: str | None,
    aligner: dict,
) -> list[dict]:
    """Align a transcript to audio, chunked to respect the aligner's ~5 min window."""
    import soundfile as sf

    toks = aligner["processor"].tokenizer
    if language not in cfg.ALIGNER_LANGUAGES:
        language = None  # let the processor infer / skip language hints
    if language == "Japanese":
        import nagisa  # noqa: F401  (documented requirement for ja alignment)
    elif language == "Korean":
        import soynlp  # noqa: F401  (documented requirement for ko alignment)

    audio_arr, sr = sf.read(audio_path, dtype="float32", always_2d=True)
    if audio_arr.ndim > 1:
        audio_arr = audio_arr.mean(axis=1)
    total_seconds = len(audio_arr) / sr

    combined: list[dict] = []
    overlap = 1.0
    chunk_seconds = cfg.ASR_ALIGN_CHUNK_SECONDS
    offset = 0.0
    while offset < total_seconds - 0.05:
        end = min(offset + chunk_seconds, total_seconds)
        chunk_audio = audio_arr[int(offset * sr): int(end * sr)]
        chunk_text = _transcript_substring(transcript, offset, end, chunk_seconds)

        words = _align_one_chunk(chunk_audio, sr, chunk_text, language, aligner, offset)
        combined.extend(words)
        offset = end - overlap

    return combined


def _align_one_chunk(
    chunk_audio,
    sr: int,
    transcript: str,
    language: str | None,
    aligner: dict,
    offset_seconds: float,
) -> list[dict]:
    import torch

    processor, model = aligner["processor"], aligner["model"]
    aligner_inputs, word_lists = processor.prepare_forced_aligner_inputs(
        audio=(chunk_audio, sr),
        transcript=transcript,
        language=language,
    )
    aligner_inputs = aligner_inputs.to(model.device, model.dtype)
    with torch.inference_mode():
        outputs = model(**aligner_inputs)

    timestamps = processor.decode_forced_alignment(
        logits=outputs.logits,
        input_ids=aligner_inputs["input_ids"],
        word_lists=word_lists,
        timestamp_token_id=model.config.timestamp_token_id,
    )[0]

    out = []
    for item in timestamps:
        out.append(
            {
                "text": item["text"],
                "start": float(item["start_time"]) + offset_seconds,
                "end": float(item["end_time"]) + offset_seconds,
            }
        )
    return out


def _transcript_substring(
    transcript: str, chunk_start: float, _chunk_end: float, approx_seconds: float
) -> str:
    """Approximately slice a transcript to a chunk.

    Forced alignment needs the text matching the chunk. We approximate by
    splitting into sentences/whitespace windows proportional to time (the aligner
    parses the full text and is robust to a small amount of extra text).
    """
    words = transcript.split()
    if not words:
        return transcript
    # Rough: ~2.5 words per second of speech.
    estimated_words = max(10, int(approx_seconds * 2.5))
    start_index = int((chunk_start / max(approx_seconds, 1.0)) * len(words))
    start_index = max(0, start_index - 4)
    return " ".join(words[start_index: start_index + estimated_words])


# ---------------------------------------------------------------------------
# Segment building
# ---------------------------------------------------------------------------


def _build_segments(words: list[dict], text: str) -> list[Segment]:
    if not words:
        # No timestamps available — approximate one flat segment.
        return [Segment(start=0.0, end=0.0, text=text)]

    segments: list[Segment] = []
    for word in words:
        wtext = word["text"].strip()
        if not wtext:
            continue
        if segments and word["start"] - segments[-1].end < 0.35:
            segments[-1].end = max(segments[-1].end, word["end"])
            segments[-1].text = f"{segments[-1].text} {wtext}".strip()
        else:
            segments.append(
                Segment(start=word["start"], end=word["end"], text=wtext)
            )
    return segments