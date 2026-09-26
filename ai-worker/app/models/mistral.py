"""
Mistral-7B-Instruct wrapper — fits 8 GB VRAM with 4-bit NF4 BitsAndBytes.

Baseline only. No fine-tuning in this milestone (that comes later via a Krix
clip-quality dataset + LoRA/QLoRA). Configuration is centralized in config.py so
the model can be swapped by env vars alone.
"""

from __future__ import annotations

import json

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


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise PipelineError(
            stage="finding_clips",
            code="LLM_INVALID_JSON",
            message="Mistral did not return a JSON object",
        )
    try:
        return json.loads(text[start: end + 1])
    except json.JSONDecodeError as exc:
        raise PipelineError(
            stage="finding_clips",
            code="LLM_INVALID_JSON",
            message=f"Mistral returned unparseable JSON: {exc}",
        ) from exc


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
    inputs = tokenizer(text, return_tensors="pt", truncation=True).to(model.device)

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
    """Generate then strictly parse JSON. Retries once on parse failure."""
    raw = generate(system, user)
    try:
        return _extract_json(raw)
    except PipelineError:
        # One deterministic retry for wild markdown/fence formatting.
        raw = generate(system, user, max_tokens=cfg.MISTRAL_MAX_NEW_TOKENS)
        return _extract_json(raw)