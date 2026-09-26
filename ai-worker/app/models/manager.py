"""
ModelManager — VRAM-safe model lifecycle.

Krix runs on an NVIDIA RTX 4060 (8 GB VRAM). Loading Qwen3-ASR + Qwen3-VL +
Mistral 7B at once does not fit, so this manager guarantees that only ONE heavy
model (and its processor) is resident at any time. Loading a new model
automatically frees the previous one and empties the CUDA cache.

All inference paths go through the manager, which also serializes access with a
thread lock (FastAPI runs background jobs on worker threads).
"""

from __future__ import annotations

import gc
import threading
from typing import Any, Callable

from app.config import PipelineError


def cuda_available() -> bool:
    """True if a CUDA-capable torch build + GPU exists. False (never raises) otherwise."""
    try:
        import torch

        return torch.cuda.is_available()
    except ModuleNotFoundError:
        return False


def require_device(device: str, requested: str) -> str:
    """Validate a requested device. Returns the model to use."""
    if device == "cpu":
        return "cpu"
    if not cuda_available():
        if requested == "cuda":
            raise PipelineError(
                stage="models",
                code="CUDA_UNAVAILABLE",
                message="CUDA was requested (requested device='cuda') but torch reports no CUDA device. "
                "Install a CUDA-enabled torch build or set the device to 'cpu'.",
            )
        return "cpu"
    return device


def free_gpu_cache() -> None:
    try:
        import torch

        if not torch.cuda.is_available():
            return
        gc.collect()
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
    except ModuleNotFoundError:
        return


ModelFactory = Callable[[], Any]


class ModelManager:
    """Holds at most one loaded model. Load a model, use it, then load the next."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._current: str | None = None
        self._model: Any = None
        self._factory: ModelFactory | None = None

    # -- lifecycle ---------------------------------------------------------

    def load(self, name: str, factory: ModelFactory) -> Any:
        with self._lock:
            if self._current == name and self._model is not None:
                return self._model
            self._unload()
            self._model = factory()
            self._current = name
            return self._model

    def _unload(self) -> None:
        model, self._model = self._model, None
        if model is not None:
            try:
                if hasattr(model, "to"):
                    model.to("cpu")
            except Exception:
                pass
            del model
        free_gpu_cache()
        self._current = None

    def unload(self) -> None:
        with self._lock:
            self._unload()

    @property
    def current(self) -> str | None:
        return self._current

    def __enter__(self) -> "ModelManager":
        return self

    def __exit__(self, *_args: Any) -> None:
        self.unload()


# Global manager shared by every service.
manager = ModelManager()