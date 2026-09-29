"""
Mistral-7B-Instruct wrapper — fits 8 GB VRAM with 4-bit NF4 BitsAndBytes.

Baseline only. No fine-tuning in this milestone (that comes later via a Krix
clip-quality dataset + LoRA/QLoRA). Configuration is centralized in config.py so
the model can be swapped by env vars alone.
"""

from __future__ import annotations

import json
import re

from app import config as cfg
from app.config import PipelineError
from app.models.manager import manager, require_device


def load_mistral() -> tuple:
    """Load Mistral 7B Instruct 4-bit (NF4) on CUDA, fp16 fallback for CPU."""
    import torch

    def factory():
        device = require_device(cfg.MISTRAL_DEVICE, "cuda")
        kwargs: dict = {}

        quantization = cfg.MISTRAL_QUANTIZATION
        if device == "cuda":
            kwargs["dtype"] = torch.bfloat16
            if quantization == "4bit":
                try:
                    from transformers import BitsAndBytesConfig

                    kwargs["quantization_config"] = BitsAndBytesConfig(
                        load_in_4bit=True,
                        bnb_4bit_quant_type="nf4",
                        bnb_4bit_compute_dtype=torch.bfloat16,
                        bnb_4bit_use_double_quant=True,
                    )
                    kwargs["device_map"] = "auto"
                except Exception as exc:
                    raise PipelineError(
                        stage="finding_clips",
                        code="MODEL_MISSING",
                        message=(
                            "bitsandbytes is required for 4-bit Mistral loading. "
                            f"Install it or set MISTRAL_QUANTIZATION=fp16 (won't fit 8GB): {exc}"
                        ),
                    ) from exc
            elif quantization == "8bit":
                try:
                    from transformers import BitsAndBytesConfig

                    kwargs["quantization_config"] = BitsAndBytesConfig(load_in_8bit=True)
                    kwargs["device_map"] = "auto"
                except Exception as exc:
                    raise PipelineError(
                        stage="finding_clips",
                        code="MODEL_MISSING",
                        message=f"bitsandbytes required for 8-bit loading: {exc}",
                    ) from exc
            else:
                kwargs["device_map"] = "auto"
        else:
            kwargs["dtype"] = torch.float32

        try:
            from transformers import AutoModelForCausalLM, AutoTokenizer

            tokenizer = AutoTokenizer.from_pretrained(
                cfg.MISTRAL_MODEL, token=cfg.HF_TOKEN or None
            )
            if tokenizer.pad_token is None:
                tokenizer.pad_token = tokenizer.eos_token
            model = AutoModelForCausalLM.from_pretrained(
                cfg.MISTRAL_MODEL, token=cfg.HF_TOKEN or None, **kwargs
            )
        except Exception as exc:
            msg = str(exc).lower()
            if "out of memory" in msg or "oom" in msg:
                raise PipelineError(
                    stage="finding_clips",
                    code="MODEL_OUT_OF_MEMORY",
                    message=f"Out of memory loading Mistral {cfg.MISTRAL_MODEL}: {exc}",
                ) from exc
            raise PipelineError(
                stage="finding_clips",
                code="MODEL_MISSING",
                message=f"Could not load Mistral {cfg.MISTRAL_MODEL}: {exc}",
            ) from exc

        model.eval()
        return {"model": model, "tokenizer": tokenizer, "device": device}

    return manager.load("mistral", factory)


def _strip_code_fence(text: str) -> str:
    """Return the body of a ```/```json fenced block, or the text unchanged.

    Handles fences that appear after leading prose as well as fences that wrap
    the whole reply, and tolerates a missing/odd language tag.
    """
    stripped = text.strip()
    if "```" not in stripped:
        return stripped
    # Keep the first fenced block only: the model sometimes repeats itself.
    parts = stripped.split("```")
    for part in parts[1:]:
        body = part
        # Drop an optional language tag on the opening fence line.
        if "\n" in body:
            first, rest = body.split("\n", 1)
            if first.strip().lower() in ("", "json", "javascript", "js"):
                body = rest
            elif not first.strip().startswith(("{", "[", '"')):
                # Not a language tag and not JSON - keep looking.
                continue
        else:
            # A single-line fence such as ```{"clips": []}```
            body = body.strip()
        body = body.strip()
        if body:
            return body
    return stripped


def _iter_json_candidates(text: str):
    """Yield progressively looser substrings that might contain one JSON value.

    A 7B model does not reliably stop after its JSON object. It commonly keeps
    writing - a second object, a summary sentence, a markdown heading - and
    those bytes can contain braces of their own. Naively slicing from the
    first ``{`` to the *last* ``}`` therefore glues the real object together
    with trailing commentary and produces ``Extra data`` at parse time.

    Each candidate is decoded with :func:`json.JSONDecoder.raw_decode`, which
    stops at the end of the first complete value and ignores whatever follows.
    """
    decoder = json.JSONDecoder()
    seen: set[str] = set()

    def _try(candidate: str):
        if candidate in seen:
            return None
        seen.add(candidate)
        try:
            value, _ = decoder.raw_decode(candidate.lstrip())
        except json.JSONDecodeError:
            return None
        return value

    # 1. Whole text (fast path, and the only one that works for clean output).
    whole = _try(text)
    if whole is not None:
        return whole

    # 2. Fenced body, if any.
    unfenced = _strip_code_fence(text)
    if unfenced != text:
        whole = _try(unfenced)
        if whole is not None:
            return whole

    # 3. Every ``{`` in the text, decoded positionally. raw_decode stops at the
    #    first balanced object, so leading prose and trailing chatter are
    #    discarded without ever corrupting the object itself.
    for match in re.finditer(r"[\{\[]", unfenced):
        value = _try(unfenced[match.start():])
        if isinstance(value, (dict, list)):
            return value

    raise PipelineError(
        stage="finding_clips",
        code="LLM_INVALID_JSON",
        message=(
            "Mistral did not return a parseable JSON value "
            f"(first 200 chars: {text[:200]!r})"
        ),
    )


def _extract_json(text: str) -> dict:
    """Parse the first complete JSON object from a model reply.

    Tolerates markdown fences and trailing commentary, but never invents or
    repairs values: whatever the model produced is what gets validated by the
    caller. Structure and clip semantics are enforced downstream by Pydantic
    and :func:`clip_detection.validate_and_rank`.
    """
    value = _iter_json_candidates(text or "")
    if isinstance(value, list):
        # Some responses put the clip array at the top level.
        value = {"clips": value}
    if not isinstance(value, dict):
        raise PipelineError(
            stage="finding_clips",
            code="LLM_INVALID_JSON",
            message=(
                f"Mistral returned JSON of type {type(value).__name__}, expected an object"
            ),
        )
    return value



def generate(system: str, user: str, *, max_tokens: int | None = None) -> str:
    """Single chat completion against the loaded Mistral model."""
    import torch

    bundle = load_mistral()
    model, tokenizer = bundle["model"], bundle["tokenizer"]

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)

    # Hard-cap the prompt. Mistral-7B-v0.3 has a 32k context, but a long video
    # transcript plus 12 visual observations can approach it, and an
    # over-long prompt is the easiest way to OOM an 8 GB card.
    max_input = max(1024, int(cfg.MISTRAL_MAX_INPUT_TOKENS))
    truncated = len(tokenizer(text, add_special_tokens=False)["input_ids"]) > max_input
    if truncated:
        print(f"[mistral] prompt exceeded {max_input} tokens — truncating transcript")
    inputs = tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=max_input,
    ).to(model.device)

    try:
        with torch.inference_mode():
            outputs = model.generate(
                **inputs,
                max_new_tokens=max_tokens or cfg.MISTRAL_MAX_NEW_TOKENS,
                do_sample=False,
                temperature=None,
                top_p=None,
            )
    except torch.cuda.OutOfMemoryError as exc:
        raise PipelineError(
            stage="finding_clips",
            code="MODEL_OUT_OF_MEMORY",
            message=f"Out of memory during clip analysis: {exc}",
        ) from exc
    except Exception as exc:
        raise PipelineError(
            stage="finding_clips",
            code="PIPELINE_INTERNAL",
            message=f"Mistral generation failed: {exc}",
        ) from exc

    generated = outputs[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True).strip()


def generate_json(system: str, user: str) -> dict:
    """Generate, then strictly parse JSON. Bounded retry on parse failure.

    The retry is deliberately *constrained* rather than a plain re-roll: the
    model is told exactly what was wrong and is asked for the object and
    nothing else. Parsing is never relaxed to make a bad reply acceptable -
    ``_extract_json`` already tolerates fences and trailing prose, so the only
    remaining causes of failure are genuinely unparseable output, which one
    corrected attempt is allowed to fix.
    """
    raw = generate(system, user)
    try:
        return _extract_json(raw)
    except PipelineError as first:
        print(f"[mistral] JSON parse failed ({first.message[:160]}); retrying once")

    repair = (
        f"{user}\n\n"
        "IMPORTANT: your previous reply could not be parsed as JSON. "
        "Reply with the single JSON object ONLY: start with {{, end with }}, "
        "and add no explanation, commentary or extra keys before or after it."
    )
    raw = generate(system, repair, max_tokens=cfg.MISTRAL_MAX_NEW_TOKENS)
    try:
        return _extract_json(raw)
    except PipelineError as second:
        raise PipelineError(
            stage="finding_clips",
            code="LLM_INVALID_JSON",
            message=(
                f"{second.message} (retry output: {raw[:200]!r})"
            ),
        ) from second