"""
Qwen3-VL-4B-Instruct wrapper for visual context analysis.

Used discipline: extract a handful of representative frames with ffmpeg (see
services/video_analysis.py) and describe them here — we never feed full video
lengths or every frame to the model. Returns structured observations with the
timestamp attached server-side (we know which frame we sampled).

Fits 8 GB VRAM via 8-bit BitsAndBytes by default; ``fp16`` is available for
stronger GPUs (fewer frames).
"""

from __future__ import annotations

import json

from app import config as cfg
from app.config import PipelineError
from app.models.manager import free_gpu_cache, manager, require_device


def load_vision() -> tuple:
    """Load Qwen3-VL with 8-bit quantization by default."""
    import torch

    def factory():
        device = require_device(cfg.VISION_DEVICE, "cuda")
        kwargs: dict = {}
        if device == "cuda":
            kwargs["dtype"] = torch.float16

        quantization = cfg.VISION_QUANTIZATION
        if quantization == "8bit":
            try:
                from transformers import BitsAndBytesConfig

                kwargs["quantization_config"] = BitsAndBytesConfig(load_in_8bit=True)
                kwargs["device_map"] = "auto"
            except Exception as exc:
                raise PipelineError(
                    stage="analyzing",
                    code="MODEL_MISSING",
                    message=f"bitsandbytes not available for 8-bit vision loading: {exc}",
                ) from exc
        elif device == "cuda":
            kwargs["device_map"] = "auto"

        try:
            from transformers import AutoModelForMultimodalLM, AutoProcessor

            processor = AutoProcessor.from_pretrained(
                cfg.VISION_MODEL, token=cfg.HF_TOKEN or None
            )
            model = AutoModelForMultimodalLM.from_pretrained(
                cfg.VISION_MODEL, token=cfg.HF_TOKEN or None, **kwargs
            )
        except Exception as exc:
            msg = str(exc).lower()
            if "out of memory" in msg or "oom" in msg:
                raise PipelineError(
                    stage="analyzing",
                    code="MODEL_OUT_OF_MEMORY",
                    message=f"Out of memory loading vision model {cfg.VISION_MODEL}: {exc}",
                ) from exc
            raise PipelineError(
                stage="analyzing",
                code="MODEL_MISSING",
                message=f"Could not load vision model {cfg.VISION_MODEL}: {exc}",
            ) from exc

        model.eval()
        return {"model": model, "processor": processor, "device": device}

    return manager.load("vision", factory)


DESCRIBE_PROMPT = """You are analyzing one frame from a short-form video clip candidate.

Return STRICT JSON only (no markdown, no commentary) with these keys:
- "description": one sentence describing who/what is on screen ("Single speaker talking directly to camera")
- "speaker_count": integer 0..10
- "speaker_position": "center" | "left" | "right" | "upper" | "lower" | "none"
- "scene_type": "podcast" | "tutorial" | "vlog" | "interview" | "screen_content" | "broll" | "monologue" | "other"
- "visual_interest": float 0.0..1.0 (how visually engaging this shot would be in a vertical clip)

Example:
{"description": "Single speaker talking directly to camera", "speaker_count": 1, "speaker_position": "center", "scene_type": "podcast", "visual_interest": 0.8}"""


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise PipelineError(
            stage="analyzing",
            code="VISION_FAILED",
            message="Vision model did not return valid JSON",
        )
    try:
        return json.loads(text[start: end + 1])
    except json.JSONDecodeError as exc:
        raise PipelineError(
            stage="analyzing",
            code="VISION_FAILED",
            message=f"Vision model returned unparseable JSON: {exc}",
        ) from exc


def _clamp(value, low: float, high: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number:  # NaN
        return default
    return max(low, min(high, number))


def describe_frame(timestamp: float, image) -> dict:
    """Describe one PIL image, returning an observation dict for that timestamp.

    Retries once on a JSON parse failure (a small 4B model occasionally wraps
    its answer in prose). Retrying is far cheaper than failing the stage.
    """
    import torch

    bundle = load_vision()
    processor, model = bundle["processor"], bundle["model"]

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": DESCRIBE_PROMPT},
            ],
        }
    ]

    last_error: PipelineError | None = None
    for attempt in range(2):
        try:
            inputs = processor.apply_chat_template(
                messages,
                add_generation_prompt=True,
                tokenize=True,
                return_dict=True,
                return_tensors="pt",
            ).to(model.device)
            with torch.inference_mode():
                outputs = model.generate(**inputs, max_new_tokens=cfg.VISION_MAX_NEW_TOKENS)
            generated = outputs[0][inputs["input_ids"].shape[1]:]
            text = processor.decode(generated, skip_special_tokens=True)
        except torch.cuda.OutOfMemoryError as exc:
            raise PipelineError(
                stage="analyzing",
                code="MODEL_OUT_OF_MEMORY",
                message=f"Out of memory during visual analysis: {exc}",
            ) from exc
        except PipelineError as exc:
            last_error = exc
            continue
        except Exception as exc:
            raise PipelineError(
                stage="analyzing",
                code="VISION_FAILED",
                message=f"Visual analysis failed: {exc}",
            ) from exc

        try:
            data = _extract_json(text)
        except PipelineError as exc:
            last_error = exc
            continue

        description = str(data.get("description", "") or "").strip()
        # "observation" is the documented field name for the visual observation;
        # it mirrors "description" so both shapes are valid.
        return {
            "timestamp": round(float(timestamp), 3),
            "observation": description,
            "description": description,
            "speaker_count": int(_clamp(data.get("speaker_count"), 0, 50, 0)),
            "speaker_position": data.get("speaker_position"),
            "scene_type": data.get("scene_type"),
            "visual_interest": round(_clamp(data.get("visual_interest"), 0.0, 1.0, 0.0), 3),
        }

    raise last_error or PipelineError(
        stage="analyzing",
        code="VISION_FAILED",
        message="Visual analysis failed after retry",
    )


def unload() -> None:
    manager.unload()
    free_gpu_cache()