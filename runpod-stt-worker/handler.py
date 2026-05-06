"""
FieldOps Manager — RunPod Serverless STT Worker
Faster-Whisper distil-large-v3 transcription endpoint.

Input payload:
  {
    "input": {
      "audio_b64": "<base64-encoded audio>",   # required
      "mime_type":  "audio/webm",              # optional, hint only
      "language":   "en"                       # optional, default "en"
    }
  }

Output (success):
  {
    "transcript":   "...",
    "language":     "en",
    "duration_s":   4.2,
    "processing_ms": 312
  }

Output (error):
  { "error": "reason" }

Environment variables:
  WHISPER_MODEL      — model name (default: distil-large-v3)
  WHISPER_DEVICE     — cuda | cpu (default: cuda)
  WHISPER_COMPUTE    — float16 | int8 (default: float16)
  MAX_AUDIO_SECONDS  — reject clips longer than this (default: 120)
  MAX_AUDIO_B64_MB   — reject base64 payload larger than this MB (default: 25)
"""

import base64
import io
import logging
import os
import tempfile
import time
from typing import Any

import runpod

# ---------------------------------------------------------------------------
# Load model once at container start (warm state)
# ---------------------------------------------------------------------------
_log = logging.getLogger("stt-worker")
logging.basicConfig(level=logging.INFO)

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "distil-large-v3")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "float16")
MAX_AUDIO_SECONDS = int(os.environ.get("MAX_AUDIO_SECONDS", "120"))
MAX_AUDIO_B64_MB = float(os.environ.get("MAX_AUDIO_B64_MB", "25"))

_log.info("Loading Faster-Whisper model: %s on %s/%s", WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE)

try:
    from faster_whisper import WhisperModel
    _model = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
    _log.info("Model loaded successfully.")
except Exception as exc:
    _log.error("Failed to load model: %s", exc)
    _model = None


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------
def handler(event: dict[str, Any]) -> dict[str, Any]:
    job_inp = event.get("input", {})

    # Accept both key names: speech-router sends "audio_base64"; direct callers may use "audio_b64"
    audio_b64: str = job_inp.get("audio_base64") or job_inp.get("audio_b64", "")
    language: str = job_inp.get("language", "en")

    # ---- validation -------------------------------------------------------
    if not audio_b64:
        return {"error": "audio_b64 is required"}

    b64_size_mb = len(audio_b64) / (1024 * 1024)
    if b64_size_mb > MAX_AUDIO_B64_MB:
        return {"error": f"payload too large: {b64_size_mb:.1f} MB (limit {MAX_AUDIO_B64_MB} MB)"}

    if _model is None:
        return {"error": "Whisper model not available — check container logs"}

    # ---- decode -----------------------------------------------------------
    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception:
        return {"error": "audio_b64 is not valid base64"}

    # ---- transcribe -------------------------------------------------------
    t0 = time.monotonic()
    try:
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=True) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()

            segments, info = _model.transcribe(
                tmp.name,
                language=language if language else None,
                beam_size=5,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
            )

            if info.duration > MAX_AUDIO_SECONDS:
                return {"error": f"audio too long: {info.duration:.1f}s (limit {MAX_AUDIO_SECONDS}s)"}

            transcript = " ".join(seg.text.strip() for seg in segments).strip()
            duration_s = round(info.duration, 2)
    except Exception as exc:
        _log.exception("Transcription failed")
        return {"error": f"transcription error: {str(exc)}"}

    processing_ms = round((time.monotonic() - t0) * 1000)
    _log.info(
        "Transcribed %.1fs of audio in %dms: %r",
        duration_s, processing_ms, transcript[:80]
    )

    return {
        "transcript": transcript,
        "language": info.language,
        "duration_s": duration_s,
        "processing_ms": processing_ms,
    }


# ---------------------------------------------------------------------------
# Entrypoint — must be at module level so RunPod can start the handler loop
# whether the container runs this file directly (CMD) or imports it.
# ---------------------------------------------------------------------------
runpod.serverless.start({"handler": handler})
