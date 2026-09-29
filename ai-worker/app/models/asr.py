"""
Qwen3-ASR + Qwen3-ForcedAligner wrappers (transformers, official documented API).

Transcription pipeline:
  1. Load ``Qwen/Qwen3-ASR-1.7B-hf`` with AutoProcessor + AutoModelForMultimodalLM.
  2. ``processor.apply_transcription_request(audio, language)`` → ``model.generate``.
  3. ``processor.decode(..., return_format="parsed")`` gives ``{language, transcription}``.
  4. Optionally run ``Qwen/Qwen3-ForcedAligner-0.6B-hf`` for word-level timestamps via
     ``processor.prepare_forced_aligner_inputs`` + ``processor.decode_forced_alignment``.

Long-audio handling
-------------------
Generation is bounded, so a 60-minute video cannot be transcribed in one
``model.generate`` call without truncating. :func:`transcribe` therefore
**chunks the audio** (see :func:`plan_chunks`), transcribes each chunk
separately with a chunk-scaled token budget, stitches the transcripts back into
one continuous transcript while removing duplicated boundary text, and then
aligns each chunk's *own* text against that *same* audio slice. Because the
audio and the text for a chunk come from the identical window, timestamps are
exact — no word-rate heuristic is involved.

All chunk arithmetic and transcript stitching are pure functions so they can be
unit-tested without torch, a GPU or an audio file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app import config as cfg
from app.config import PipelineError, Segment
from app.models.manager import free_gpu_cache as free_cache
from app.models.manager import manager, require_device

# Minimum useful transcript length, in characters, for a chunk to be kept.
MIN_CHUNK_TEXT_CHARS = 2

# The smallest duration a real word is ever given. The forced aligner can report
# start == end for very short tokens, and a zero-length segment is unusable for
# captions (and invalid for the SegmentOut schema, which needs end > start).
MIN_WORD_SECONDS = 0.04


@dataclass
class Chunk:
    """A planned audio window, in seconds, with the audio it contains."""

    index: int
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass
class ChunkResult:
    """Per-chunk ASR output before stitching."""

    chunk: Chunk
    text: str
    language: str | None = None
    words: list[dict] = field(default_factory=list)


@dataclass
class AsrResult:
    text: str
    language: str | None
    segments: list[Segment]
    words: list[dict]
    aligner_used: bool
    chunk_count: int = 1
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Pure chunk planning / stitching helpers (unit-tested, no torch required)
# ---------------------------------------------------------------------------


def plan_chunks(
    duration: float,
    *,
    chunk_seconds: float | None = None,
    overlap_seconds: float | None = None,
) -> list[Chunk]:
    """Split ``duration`` seconds into overlapping windows.

    Chunks never exceed ``chunk_seconds`` and always make forward progress; the
    final chunk is trimmed to the end of the audio. A duration of zero (or a
    non-positive chunk size) yields a single zero-length chunk so callers always
    get a usable plan.
    """
    chunk_seconds = chunk_seconds if chunk_seconds is not None else cfg.ASR_CHUNK_SECONDS
    overlap_seconds = (
        overlap_seconds if overlap_seconds is not None else cfg.ASR_CHUNK_OVERLAP_SECONDS
    )
    step = max(1.0, float(chunk_seconds))
    overlap = min(max(0.0, float(overlap_seconds)), step / 2.0)
    stride = max(1.0, step - overlap)

    if duration <= 0:
        return [Chunk(index=0, start=0.0, end=0.0)]

    chunks: list[Chunk] = []
    start = 0.0
    index = 0
    while start < duration - 1e-3:
        end = min(start + step, duration)
        chunks.append(Chunk(index=index, start=round(start, 3), end=round(end, 3)))
        index += 1
        if end >= duration - 1e-3:
            break
        start += stride
    return chunks


def chunk_token_budget(chunk: Chunk) -> int:
    """Generation budget for one chunk: scaled to its length, hard-capped.

    Scaling to the chunk length is what makes long videos work — the cap is only
    a safety net against a pathological decode, not the primary limit.
    """
    scaled = int(chunk.duration * max(1.0, cfg.ASR_TOKENS_PER_SECOND))
    ceiling = max(64, int(cfg.ASR_MAX_NEW_TOKENS))
    return max(64, min(ceiling, scaled if scaled > 0 else ceiling))


def needs_chunking(duration: float, *, chunk_seconds: float | None = None) -> bool:
    """True when ``duration`` cannot be transcribed in a single pass."""
    chunk_seconds = chunk_seconds if chunk_seconds is not None else cfg.ASR_CHUNK_SECONDS
    return duration > float(chunk_seconds)


_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or "")]


def _boundary_overlap(previous: str, following: str) -> int:
    """Length of the shared token run at the end of ``previous`` / start of ``following``.

    This is the duplicated text a chunk overlap produces (the tail of one chunk
    repeated at the head of the next). Returns 0 when there is no overlap.
    """
    prev_tokens = _tokens(previous)
    next_tokens = _tokens(following)
    if not prev_tokens or not next_tokens:
        return 0
    max_overlap = min(len(prev_tokens), len(next_tokens))
    for size in range(max_overlap, 0, -1):
        if prev_tokens[-size:] == next_tokens[:size]:
            return size
    return 0


# Characters that mean the previous chunk was cut mid-word (hyphenation), so no
# space should be inserted when the two halves are re-joined.
_MID_WORD_TAIL = ("-", "\u2010", "\u2013", "\u2014")


def strip_overlap(previous: str, following: str) -> str:
    """Drop the duplicated boundary text that a chunk overlap introduces."""
    overlap = _boundary_overlap(previous, following)
    if overlap == 0:
        return following.strip()
    next_tokens = _tokens(following)
    if len(next_tokens) == overlap:
        # The whole new chunk was already said — keep the first copy only.
        return ""
    # Find where the duplicated run ends in the original string and cut there.
    for index, match in enumerate(_TOKEN_RE.finditer(following), start=1):
        if index == overlap + 1:
            return following[match.start():].strip()
    return ""


def _join(previous: str, following: str) -> str:
    """Join two already-deduplicated chunk transcripts."""
    if not previous:
        return following
    if previous.endswith(_MID_WORD_TAIL):
        # A hyphenated word was split across the chunk boundary.
        return f"{previous}{following}"
    return f"{previous} {following}"


def merge_chunk_texts(texts: list[str]) -> str:
    """Join per-chunk transcripts into one continuous transcript.

    Empty chunks are skipped. The first chunk is kept verbatim; each later chunk
    has its duplicated boundary text removed before being appended.
    """
    merged = ""
    for raw in texts:
        chunk_text = (raw or "").strip()
        if not chunk_text:
            continue
        if not merged:
            merged = chunk_text
            continue
        remainder = strip_overlap(merged, chunk_text)
        if not remainder:
            continue
        merged = _join(merged, remainder)
    return re.sub(r"\s+", " ", merged).strip()


def dedupe_words(words: list[dict], *, tolerance: float = 0.05) -> list[dict]:
    """Remove overlapping/duplicated word timings produced by chunk overlaps.

    Words are expected sorted by start time. A word is dropped when it repeats a
    previous word with (almost) the same text inside ``tolerance`` seconds.
    """
    ordered = sorted(words, key=lambda w: float(w.get("start", 0.0)))
    out: list[dict] = []
    for word in ordered:
        text = str(word.get("text", "")).strip()
        if not text:
            continue
        start = float(word.get("start", 0.0))
        if out:
            last = out[-1]
            same = str(last.get("text", "")).strip().lower() == text.lower()
            if same and start - float(last.get("end", start)) <= tolerance:
                # Keep the wider of the two timings, then stop.
                last["end"] = max(float(last.get("end", start)), float(word.get("end", start)))
                continue
        out.append(dict(word, text=text))
    return out


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------


def load_asr() -> tuple:
    """Load the ASR model + processor via the official transformers API."""
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
    except Exception:  # pragma: no cover - import guard
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


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------


def read_audio(audio_path: str):
    """Read a wav file as float32 mono. Returns ``(samples, sample_rate)``."""
    import soundfile as sf

    try:
        samples, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
    except Exception as exc:
        raise PipelineError(
            stage="transcription",
            code="CORRUPT_MEDIA",
            message=f"Could not decode audio for transcription: {exc}",
        ) from exc
    if samples.ndim > 1:
        samples = samples.mean(axis=1)
    return samples, int(sample_rate)


def slice_audio(samples, sample_rate: int, start: float, end: float):
    """Return the ``[start, end)`` sample window, in seconds."""
    i0 = max(0, int(round(start * sample_rate)))
    i1 = min(len(samples), int(round(end * sample_rate)))
    if i1 <= i0:
        return samples[0:0]
    return samples[i0:i1]


def audio_duration(samples, sample_rate: int) -> float:
    return len(samples) / float(sample_rate) if sample_rate else 0.0


def write_wav(path: str, samples, sample_rate: int) -> str:
    """Write float32 mono samples to a wav file (used for chunk alignment)."""
    import soundfile as sf

    sf.write(path, samples, sample_rate, subtype="PCM_16")
    return path


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------


def transcribe(audio_path: str) -> AsrResult:
    """Transcribe a local audio file (wav/mp3/...).

    Chunks long audio, stitches the transcripts, then aligns each chunk's own
    text to that same audio window for exact word timestamps. Returns text +
    timestamped segments + word timings.

    A single failing chunk is retried in smaller pieces, and a failure that is
    confined to one chunk is recorded rather than losing the whole video: as long
    as *some* chunks produced speech the transcript is returned with a warning.
    Alignment is likewise best-effort — if the forced aligner cannot be used the
    pipeline degrades to flat segments instead of failing the video.
    """
    samples, sample_rate = read_audio(audio_path)
    duration = audio_duration(samples, sample_rate)
    chunks = plan_chunks(duration)

    results: list[ChunkResult] = []
    warnings: list[str] = []
    for chunk in chunks:
        label = f"{chunk.start:.1f}-{chunk.end:.1f}s"
        try:
            text, language = _transcribe_one_chunk(audio_path, samples, sample_rate, chunk)
        except PipelineError as exc:
            if exc.code in ("MODEL_OUT_OF_MEMORY", "MODEL_MISSING", "CUDA_UNAVAILABLE"):
                raise  # a global problem — retrying sub-windows cannot help
            warnings.append(f"chunk {chunk.index} ({label}) failed: {exc.message}")
            recovered, language = _recover_chunk(
                audio_path, samples, sample_rate, chunk, warnings, chunk.index
            )
            if not recovered:
                continue
            text = recovered
        if len(text) < MIN_CHUNK_TEXT_CHARS:
            # Silence / no speech in this window — keep it out of the transcript.
            print(f"[asr] chunk {chunk.index} produced no text ({label})")
            continue
        results.append(ChunkResult(chunk=chunk, text=text, language=language))

    if not results:
        detail = "; ".join(warnings)
        raise PipelineError(
            stage="transcription",
            code="TRANSCRIPTION_FAILED",
            message=(
                "ASR returned no usable speech for this video"
                + (f" ({detail})" if detail else "")
            ),
        )

    text = merge_chunk_texts([r.text for r in results])
    if not text:
        raise PipelineError(
            stage="transcription",
            code="TRANSCRIPTION_FAILED",
            message="ASR returned an empty transcription",
        )
    language = next((r.language for r in results if r.language), cfg.ASR_LANGUAGE or None)

    words: list[dict] = []
    if cfg.ASR_ENABLE_TIMESTAMPS:
        try:
            words = align_chunks(samples, sample_rate, results, language=language)
        except PipelineError as exc:
            # Safe fallback: the transcript is still valuable without timings.
            warnings.append(f"forced alignment unavailable, using flat segments: {exc.message}")
            manager.unload()
            free_cache()
        if words:
            # Timestamps must never run past the end of the media.
            limit = duration if duration > 0 else float("inf")
            words = [w for w in words if w["end"] <= limit + 0.5]
        if words:
            # The aligner returns bare words, so punctuation and casing will never
            # match the ASR text exactly. Only warn when words are genuinely
            # *missing* content, not when they merely differ in punctuation.
            aligned = _tokens(" ".join(w["text"] for w in words))
            expected = _tokens(text)
            missing = [t for t in expected if t not in set(aligned)]
            if missing and len(aligned) < len(expected) * 0.5:
                warnings.append(
                    f"word timings only cover part of the transcript "
                    f"({len(aligned)} of {len(expected)} words)"
                )
    segments = build_segments(words, text, duration)
    return AsrResult(
        text=text,
        language=language,
        segments=segments,
        words=words,
        aligner_used=bool(words),
        chunk_count=len(chunks),
        warnings=warnings,
    )


def _recover_chunk(
    audio_path: str,
    samples,
    sample_rate: int,
    chunk: Chunk,
    warnings: list[str],
    index: int,
) -> tuple[str, str | None]:
    """Re-try a failed chunk as two halves, then four quarters.

    Long windows are the usual reason a chunk fails (truncation, OOM during
    generation), so halving usually recovers it. Returns ``(text, language)``
    with the merged halves, or ``("", None)`` if nothing could be recovered.
    """
    if duration_of(chunk) <= 0:
        return "", None
    parts: list[tuple[str, str | None]] = []
    step = cfg.ASR_CHUNK_SECONDS / 2.0
    cursor = chunk.start
    while cursor < chunk.end - 1e-3:
        end = min(chunk.end, cursor + step)
        half = Chunk(index=index, start=cursor, end=end)
        try:
            text, language = _transcribe_one_chunk(audio_path, samples, sample_rate, half)
        except PipelineError as exc:
            if exc.code in ("MODEL_OUT_OF_MEMORY", "MODEL_MISSING", "CUDA_UNAVAILABLE"):
                raise
            warnings.append(
                f"chunk {index} sub-window {cursor:.1f}-{end:.1f}s failed: {exc.message}"
            )
            return "", None
        if text:
            parts.append((text, language))
        cursor = end
    return merge_chunk_texts([p[0] for p in parts]), next((p[1] for p in parts if p[1]), None)


def _transcribe_one_chunk(
    audio_path: str, samples, sample_rate: int, chunk: Chunk
) -> tuple[str, str | None]:
    """Run one ASR pass over a single audio window. Returns ``(text, language)``."""
    import torch

    bundle = load_asr()
    model = bundle["model"]
    processor = bundle["processor"]

    budget = chunk_token_budget(chunk)
    try:
        if duration_of(chunk) <= 0:
            window = audio_path
        else:
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                temp_path = tmp.name
            write_wav(temp_path, slice_audio(samples, sample_rate, chunk.start, chunk.end), sample_rate)
            window = temp_path
        try:
            inputs = processor.apply_transcription_request(
                audio=window, language=cfg.ASR_LANGUAGE or None
            )
            inputs = inputs.to(model.device, model.dtype)
        finally:
            if window is not audio_path:
                import os

                try:
                    os.unlink(window)
                except OSError:
                    pass

        with torch.inference_mode():
            output_ids = model.generate(
                **inputs,
                max_new_tokens=budget,
                do_sample=False,
            )
    except torch.cuda.OutOfMemoryError as exc:
        raise PipelineError(
            stage="transcription",
            code="MODEL_OUT_OF_MEMORY",
            message=f"Out of memory during transcription: {exc}",
        ) from exc
    except PipelineError:
        raise
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
    return text, language


def duration_of(chunk: Chunk) -> float:
    return chunk.duration


# ---------------------------------------------------------------------------
# Forced alignment
# ---------------------------------------------------------------------------


def align_chunks(
    samples,
    sample_rate: int,
    results: list[ChunkResult],
    *,
    language: str | None,
    max_chunk_seconds: float | None = None,
) -> list[dict]:
    """Align each chunk's own transcript to that same audio window.

    Each window is further split to respect the aligner's design limit, and the
    text for a sub-window is re-sliced by *character proportion* of the chunk
    text, which is a far better match than the old global word-rate heuristic
    because the text is now known to belong to exactly this audio.

    Any failure is non-fatal: the caller falls back to flat segments.
    """
    if not results:
        return []
    aligner = _load_aligner()
    if aligner is None:
        return []
    if language is not None and language not in cfg.ALIGNER_LANGUAGES:
        language = None
    _check_language_dependencies(language)

    max_chunk = max_chunk_seconds if max_chunk_seconds is not None else cfg.ASR_ALIGN_CHUNK_SECONDS
    combined: list[dict] = []
    for result in results:
        window = slice_audio(samples, sample_rate, result.chunk.start, result.chunk.end)
        if window.size == 0:
            continue
        for sub in _split_text(result.text, max_chunk):
            text, sub_start, sub_end = sub
            if not text:
                continue
            piece = slice_audio(window, sample_rate, sub_start, sub_end)
            if piece.size == 0:
                continue
            words = _align_one_chunk(
                piece, sample_rate, text, language, aligner, result.chunk.start + sub_start
            )
            combined.extend(words)
    return dedupe_words(combined)

def _check_language_dependencies(language: str | None) -> None:
    if language == "Japanese":
        try:
            import nagisa  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            raise PipelineError(
                stage="transcription",
                code="MODEL_MISSING",
                message="Japanese forced alignment needs the 'nagisa' package: "
                f"{exc}. Install it or set ASR_ENABLE_TIMESTAMPS=false.",
            ) from exc
    elif language == "Korean":
        try:
            import soynlp  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            raise PipelineError(
                stage="transcription",
                code="MODEL_MISSING",
                message="Korean forced alignment needs the 'soynlp' package: "
                f"{exc}. Install it or set ASR_ENABLE_TIMESTAMPS=false.",
            ) from exc


def _split_text(text: str, max_chunk_seconds: float) -> list[tuple[str, float, float]]:
    """Split a chunk transcript into ``(text, start, end)`` windows.

    The transcript is cut on sentence-ish boundaries, then the resulting pieces
    are grouped so no window exceeds ``max_chunk_seconds`` of audio. Grouping is
    proportional to piece length because a longer piece takes longer to say.
    """
    text = (text or "").strip()
    if not text or max_chunk_seconds <= 0:
        return [(text, 0.0, 0.0)] if text else []

    pieces = [p.strip() for p in re.split(r"(?<=[.!?])\s+", text) if p.strip()]
    if not pieces:
        pieces = [text]

    total_chars = sum(len(p) for p in pieces) or 1
    total_seconds = 0.0
    groups: list[tuple[list[str], float]] = []
    current: list[str] = []
    current_chars = 0
    for piece in pieces:
        piece_seconds = (len(piece) / total_chars) * max_chunk_seconds
        if current and (current_chars + len(piece)) / total_chars * max_chunk_seconds > max_chunk_seconds:
            groups.append((current, total_seconds))
            total_seconds += current_chars / total_chars * max_chunk_seconds
            current = []
            current_chars = 0
        current.append(piece)
        current_chars += len(piece)
    if current:
        groups.append((current, total_seconds))

    # Convert cumulative char positions into audio seconds, and give the final
    # group the remainder of the chunk.
    out: list[tuple[str, float, float]] = []
    consumed_chars = 0
    for index, (group_pieces, _) in enumerate(groups):
        group_chars = sum(len(p) for p in group_pieces)
        start = consumed_chars / total_chars
        consumed_chars += group_chars
        end = consumed_chars / total_chars if index < len(groups) - 1 else 1.0
        out.append((" ".join(group_pieces), start, max(end, start + 1e-3)))
    return out


def _align_one_chunk(
    chunk_audio,
    sr: int,
    transcript: str,
    language: str | None,
    aligner: dict,
    offset_seconds: float,
) -> list[dict]:
    """One forced-alignment forward pass over a known (audio, text) pair."""
    import tempfile

    import torch

    processor, model = aligner["processor"], aligner["model"]

    # The processor accepts a path/URL/array, NOT an (array, sample_rate) tuple,
    # and it resamples to the feature extractor's 16 kHz itself. Handing it a real
    # WAV file is the only form that is correct for any input sample rate.
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            temp_path = tmp.name
        write_wav(temp_path, chunk_audio, sr)
        aligner_inputs, word_lists = processor.prepare_forced_aligner_inputs(
            audio=temp_path,
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
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError(
            stage="transcription",
            code="TRANSCRIPTION_FAILED",
            message=f"Forced alignment failed: {exc}",
        ) from exc
    finally:
        if temp_path:
            import os

            try:
                os.unlink(temp_path)
            except OSError:
                pass

    out: list[dict] = []
    for item in timestamps or []:
        try:
            start = float(item["start_time"]) + offset_seconds
            end = float(item["end_time"]) + offset_seconds
        except (KeyError, TypeError, ValueError) as exc:
            raise PipelineError(
                stage="transcription",
                code="TRANSCRIPTION_FAILED",
                message=f"Aligner returned an unexpected timestamp record: {item!r}",
            ) from exc
        if start < 0:
            start = 0.0
        # The aligner occasionally returns start == end for very short tokens
        # ("a", "I"). A zero-length word would fail the SegmentOut schema and
        # produce an unusable caption, so give every word a real duration.
        end = max(end, start + MIN_WORD_SECONDS)
        text_value = str(item.get("text", "")).strip()
        if not text_value:
            continue
        out.append({"text": text_value, "start": start, "end": end})
    return monotonic_words(out)

def monotonic_words(words: list[dict]) -> list[dict]:
    """Sort by start time and clamp overlaps so segments never run backwards."""
    if not words:
        return []
    ordered = sorted(words, key=lambda w: (float(w["start"]), float(w["end"])))
    out: list[dict] = []
    for word in ordered:
        start = max(0.0, float(word["start"]))
        # A zero-length word is unusable for captions, so never emit one.
        end = max(float(word["end"]), start + MIN_WORD_SECONDS)
        if out:
            previous_end = float(out[-1]["end"])
            if start < previous_end:
                # Overlap: keep it non-negative, never let one word run into the
                # next one's start.
                start = previous_end
                end = max(end, start + MIN_WORD_SECONDS)
        out.append({"text": word["text"], "start": round(start, 3), "end": round(end, 3)})
    return out


# ---------------------------------------------------------------------------
# Segment building
# ---------------------------------------------------------------------------


def build_segments(words: list[dict], text: str, duration: float = 0.0) -> list[Segment]:
    """Group word timings into readable segments.

    Without word timings the whole transcript becomes ONE segment covering the
    known audio duration. The end is never 0 — a zero end would fail the
    ``SegmentOut`` schema (``end > 0``) and turn a soft fallback into a 500.
    """
    if not words:
        end = round(float(duration), 3) if duration and duration > 0 else 1.0
        return [Segment(start=0.0, end=end, text=text)]

    segments: list[Segment] = []
    for word in words:
        wtext = str(word.get("text", "")).strip()
        if not wtext:
            continue
        start = float(word.get("start", 0.0))
        end = max(start + 0.05, float(word.get("end", start + 0.2)))
        if segments and start - segments[-1].end < 0.35:
            segments[-1].end = max(segments[-1].end, end)
            segments[-1].text = f"{segments[-1].text} {wtext}".strip()
        else:
            segments.append(Segment(start=start, end=end, text=wtext))
    return segments
