from __future__ import annotations

import base64
import logging
import os
import time
from collections import defaultdict
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger("speech-router")
logging.basicConfig(level=logging.INFO)

APP_VERSION = "0.2.0"
REQUEST_TIMEOUT_SECONDS = float(os.getenv("SPEECH_ROUTER_TIMEOUT_SECONDS", "45"))
MAX_AUDIO_BYTES = int(os.getenv("SPEECH_ROUTER_MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))  # 10 MB
MAX_TTS_CHARS = int(os.getenv("SPEECH_ROUTER_MAX_TTS_CHARS", "2000"))

# ---------------------------------------------------------------------------
# Circuit-breaker state (in-process; suitable for single-worker deployments)
# ---------------------------------------------------------------------------
_CIRCUIT_FAILURE_THRESHOLD = int(os.getenv("CIRCUIT_FAILURE_THRESHOLD", "5"))
_CIRCUIT_COOLDOWN_SECONDS = float(os.getenv("CIRCUIT_COOLDOWN_SECONDS", "30"))

_circuit_failures: dict[str, int] = defaultdict(int)
_circuit_open_until: dict[str, float] = {}


def _circuit_check(provider_url: str) -> None:
    """Raise 503 if the circuit for this provider is open."""
    until = _circuit_open_until.get(provider_url, 0.0)
    if time.monotonic() < until:
        raise HTTPException(status_code=503, detail=f"Provider circuit open: {provider_url}")


def _circuit_success(provider_url: str) -> None:
    _circuit_failures[provider_url] = 0
    _circuit_open_until.pop(provider_url, None)


def _circuit_failure(provider_url: str) -> None:
    _circuit_failures[provider_url] += 1
    if _circuit_failures[provider_url] >= _CIRCUIT_FAILURE_THRESHOLD:
        _circuit_open_until[provider_url] = time.monotonic() + _CIRCUIT_COOLDOWN_SECONDS
        logger.warning("Circuit opened for %s", provider_url)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
_bearer_scheme = HTTPBearer(auto_error=False)
_ROUTER_API_KEY = os.getenv("ROUTER_API_KEY", "").strip()


def _check_auth(credentials: HTTPAuthorizationCredentials | None) -> None:
    if not _ROUTER_API_KEY:
        # Key not configured — auth disabled (dev mode)
        return
    if credentials is None or credentials.credentials != _ROUTER_API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


class SpeechToIntentRequest(BaseModel):
    audio_base64: str = Field(..., description="Base64-encoded audio payload")
    language: str = Field(default="en")
    wake_phrase: str | None = Field(default=None)
    org_id: str | None = Field(default=None)
    user_id: str | None = Field(default=None)
    context: dict[str, Any] | None = Field(default=None)

    @field_validator("audio_base64")
    @classmethod
    def validate_audio_size(cls, v: str) -> str:
        try:
            raw = base64.b64decode(v, validate=True)
        except Exception as exc:
            raise ValueError("audio_base64 must be valid base64") from exc
        if len(raw) > MAX_AUDIO_BYTES:
            raise ValueError(f"Audio payload exceeds {MAX_AUDIO_BYTES // (1024*1024)} MB limit")
        return v


class SpeechToIntentResponse(BaseModel):
    transcript: str
    intent: dict[str, Any]
    provider: dict[str, str]


class TtsRequest(BaseModel):
    text: str
    voice: str | None = Field(default="en_nz")
    format: str | None = Field(default="wav")

    @field_validator("text")
    @classmethod
    def validate_text_length(cls, v: str) -> str:
        if len(v) > MAX_TTS_CHARS:
            raise ValueError(f"text exceeds {MAX_TTS_CHARS} character limit")
        return v


class TtsResponse(BaseModel):
    audio_base64: str
    audio_mime_type: str
    provider: str


app = FastAPI(title="FieldOps Speech Router", version=APP_VERSION)


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


async def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None) -> dict[str, Any]:
    _circuit_check(url)
    timeout = httpx.Timeout(REQUEST_TIMEOUT_SECONDS)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload, headers=headers or {})
        if response.status_code >= 400:
            _circuit_failure(url)
            raise HTTPException(status_code=502, detail=f"Upstream failure from {url}: HTTP {response.status_code}")
        try:
            data = response.json()
            _circuit_success(url)
            return data
        except Exception as exc:
            _circuit_failure(url)
            raise HTTPException(status_code=502, detail=f"Invalid JSON response from {url}") from exc
    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        _circuit_failure(url)
        raise HTTPException(status_code=504, detail=f"Provider timeout: {url}") from exc
    except httpx.RequestError as exc:
        _circuit_failure(url)
        raise HTTPException(status_code=502, detail=f"Provider unreachable: {url}") from exc


@app.get("/health")
async def health() -> dict[str, Any]:
    now = time.monotonic()
    provider_status: dict[str, str] = {}
    for url, open_until in _circuit_open_until.items():
        provider_status[url] = "open" if now < open_until else "closed"
    return {
        "ok": True,
        "service": "speech-router",
        "version": APP_VERSION,
        "mode": "modular-self-hosted",
        "auth": "enabled" if _ROUTER_API_KEY else "disabled",
        "stack": {
            "wakeword": os.getenv("WAKEWORD_PROVIDER", "sherpa-onnx/openwakeword"),
            "stt": os.getenv("STT_PROVIDER", "faster-whisper"),
            "intent": os.getenv("INTENT_PROVIDER", "vllm"),
            "tts": os.getenv("TTS_PROVIDER", "kokoro-onnx"),
        },
        "circuits": provider_status,
    }


@app.post("/v1/speech-to-intent", response_model=SpeechToIntentResponse)
async def speech_to_intent(
    payload: SpeechToIntentRequest,
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> SpeechToIntentResponse:
    _check_auth(credentials)
    stt_url = _required_env("STT_URL")
    intent_url = _required_env("INTENT_URL")
    stt_api_key = os.getenv("STT_API_KEY", "").strip()
    intent_api_key = os.getenv("INTENT_API_KEY", "").strip()

    stt_headers = {"Authorization": f"Bearer {stt_api_key}"} if stt_api_key else {}
    intent_headers = {"Authorization": f"Bearer {intent_api_key}"} if intent_api_key else {}

    stt_result = await _post_json(
        stt_url,
        {
            "audio_base64": payload.audio_base64,
            "language": payload.language,
            "org_id": payload.org_id,
            "user_id": payload.user_id,
        },
        headers=stt_headers,
    )

    transcript = str(stt_result.get("transcript") or stt_result.get("text") or "").strip()
    if not transcript:
        raise HTTPException(status_code=502, detail="STT provider returned empty transcript")

    intent_result = await _post_json(
        intent_url,
        {
            "text": transcript,
            "language": payload.language,
            "wake_phrase": payload.wake_phrase,
            "org_id": payload.org_id,
            "user_id": payload.user_id,
            "context": payload.context or {},
        },
        headers=intent_headers,
    )

    if "intent" in intent_result and isinstance(intent_result["intent"], dict):
        intent = intent_result["intent"]
    else:
        intent = intent_result

    return SpeechToIntentResponse(
        transcript=transcript,
        intent=intent,
        provider={
            "stt": os.getenv("STT_PROVIDER", "faster-whisper"),
            "intent": os.getenv("INTENT_PROVIDER", "vllm"),
        },
    )


@app.post("/v1/tts", response_model=TtsResponse)
async def tts(
    payload: TtsRequest,
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> TtsResponse:
    _check_auth(credentials)
    tts_url = _required_env("TTS_URL")
    tts_api_key = os.getenv("TTS_API_KEY", "").strip()
    tts_headers = {"Authorization": f"Bearer {tts_api_key}"} if tts_api_key else {}

    tts_result = await _post_json(
        tts_url,
        {
            "text": payload.text,
            "voice": payload.voice,
            "format": payload.format,
        },
        headers=tts_headers,
    )

    audio_base64 = str(tts_result.get("audio_base64") or "").strip()
    if not audio_base64:
        raise HTTPException(status_code=502, detail="TTS provider returned empty audio payload")

    return TtsResponse(
        audio_base64=audio_base64,
        audio_mime_type=str(tts_result.get("audio_mime_type") or "audio/wav"),
        provider=str(tts_result.get("provider") or os.getenv("TTS_PROVIDER", "kokoro-onnx")),
    )
