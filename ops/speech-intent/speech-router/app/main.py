from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import time
from collections import defaultdict
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger("speech-router")
logging.basicConfig(level=logging.INFO)

APP_VERSION = "0.2.0"
REQUEST_TIMEOUT_SECONDS = float(os.getenv("SPEECH_ROUTER_TIMEOUT_SECONDS", "45"))
MAX_AUDIO_BYTES = int(os.getenv("SPEECH_ROUTER_MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))  # 10 MB
MAX_TTS_CHARS = int(os.getenv("SPEECH_ROUTER_MAX_TTS_CHARS", "2000"))
INTENT_MODEL = os.getenv("INTENT_MODEL", "llama3.1:8b-instruct-q4_K_M")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
ALLOW_OPENAI_RUNTIME = os.getenv("ALLOW_OPENAI_RUNTIME", "false").strip().lower() == "true"
OPENAI_REDACTION_REQUIRED = os.getenv("OPENAI_REDACTION_REQUIRED", "true").strip().lower() == "true"
OPENAI_ALLOWED_PURPOSES = {
    p.strip().lower()
    for p in os.getenv("OPENAI_ALLOWED_PURPOSES", "research,training").split(",")
    if p.strip()
}
BLOCKED_OPENAI_HOSTS = ("api.openai.com", "openai.com")

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


def _assert_runtime_url_policy(name: str, url: str) -> None:
    lower_url = url.lower()
    if not ALLOW_OPENAI_RUNTIME and any(host in lower_url for host in BLOCKED_OPENAI_HOSTS):
        raise HTTPException(
            status_code=403,
            detail=f"Blocked runtime egress for {name}: OpenAI endpoints are disabled in production speech flows",
        )


def _is_openai_url(url: str) -> bool:
    return any(host in url.lower() for host in BLOCKED_OPENAI_HOSTS)


def _pseudonymize(value: str | None) -> str:
    if not value:
        return ""
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]
    return f"id_{digest}"


def _redact_text(value: str) -> str:
    redacted = value
    redacted = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[REDACTED_EMAIL]", redacted)
    redacted = re.sub(r"(?:(?:\+?64|0)[\s-]?(?:2\d|[34679]))[\d\s-]{5,}", "[REDACTED_PHONE]", redacted)
    redacted = re.sub(r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b", "[REDACTED_DATE]", redacted)
    redacted = re.sub(r"\b\d{7,}\b", "[REDACTED_ID]", redacted)
    redacted = re.sub(
        r"\b\d{1,4}\s+[A-Za-z0-9\s]+\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Way)\b",
        "[REDACTED_ADDRESS]",
        redacted,
        flags=re.IGNORECASE,
    )
    return redacted


def _redact_obj(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, list):
        return [_redact_obj(v) for v in value]
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for k, v in value.items():
            lk = str(k).lower()
            if lk in {"name", "full_name", "email", "phone", "address", "dob", "date_of_birth", "document_number"}:
                redacted[k] = f"[REDACTED_{lk.upper()}]"
            else:
                redacted[k] = _redact_obj(v)
        return redacted
    return value


def _enforce_openai_purpose(payload: SpeechToIntentRequest) -> str:
    purpose = str((payload.context or {}).get("openai_purpose") or "").strip().lower()
    if purpose not in OPENAI_ALLOWED_PURPOSES:
        raise HTTPException(
            status_code=403,
            detail="OpenAI runtime requires context.openai_purpose with approved value: research or training",
        )
    return purpose


def _openai_messages(transcript: str, payload: SpeechToIntentRequest, purpose: str) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are a research/training-only intent classifier for patrol voice commands. "
                "Return strict JSON with keys: intent, confidence, needs_confirmation, summary, entities."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "purpose": purpose,
                    "language": payload.language,
                    "wake_phrase": _redact_text(payload.wake_phrase or ""),
                    "org_ref": _pseudonymize(payload.org_id),
                    "user_ref": _pseudonymize(payload.user_id),
                    "context": _redact_obj(payload.context or {}),
                    "transcript": transcript,
                },
                ensure_ascii=True,
                separators=(",", ":"),
            ),
        },
    ]


def _intent_prompt(transcript: str, payload: SpeechToIntentRequest) -> str:
    # Keep the schema minimal and deterministic for easier downstream policy checks.
    return (
        "You are an intent classifier for patrol voice commands. "
        "Return strict JSON with keys: intent, confidence, needs_confirmation, summary, entities. "
        "confidence is a number between 0 and 1. needs_confirmation is true/false. "
        "entities is an object.\n"
        f"language={payload.language}\n"
        f"wake_phrase={payload.wake_phrase or ''}\n"
        f"org_id={payload.org_id or ''}\n"
        f"user_id={payload.user_id or ''}\n"
        f"context={json.dumps(payload.context or {}, separators=(',', ':'))}\n"
        f"transcript={transcript}"
    )


def _extract_intent(intent_result: dict[str, Any]) -> dict[str, Any]:
    if "intent" in intent_result and isinstance(intent_result["intent"], dict):
        return intent_result["intent"]

    # Ollama /api/generate format commonly returns {"response": "..."}
    response_text = str(intent_result.get("response") or "").strip()
    if not response_text and isinstance(intent_result.get("choices"), list) and intent_result["choices"]:
        choice = intent_result["choices"][0] or {}
        message = choice.get("message") if isinstance(choice, dict) else None
        if isinstance(message, dict):
            response_text = str(message.get("content") or "").strip()
    if not response_text and isinstance(intent_result.get("message"), dict):
        response_text = str(intent_result["message"].get("content") or "").strip()

    if response_text:
        try:
            parsed = json.loads(response_text)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        return {
            "intent": "advisory_unknown",
            "confidence": 0.0,
            "needs_confirmation": True,
            "summary": response_text,
            "entities": {},
        }

    # Last-resort normalized shape
    return {
        "intent": "advisory_unknown",
        "confidence": 0.0,
        "needs_confirmation": True,
        "summary": "Intent provider returned an unexpected payload",
        "entities": {},
        "raw": intent_result,
    }


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
        "egress_policy": {
            "openai_runtime": "allowed" if ALLOW_OPENAI_RUNTIME else "blocked",
            "openai_redaction_required": OPENAI_REDACTION_REQUIRED,
            "openai_allowed_purposes": sorted(OPENAI_ALLOWED_PURPOSES),
            "intent_model": INTENT_MODEL,
            "openai_model": OPENAI_MODEL,
        },
        "stack": {
            "wakeword": os.getenv("WAKEWORD_PROVIDER", "sherpa-onnx/openwakeword"),
            "stt": os.getenv("STT_PROVIDER", "faster-whisper"),
            "intent": os.getenv("INTENT_PROVIDER", "ollama"),
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
    _assert_runtime_url_policy("STT_URL", stt_url)
    _assert_runtime_url_policy("INTENT_URL", intent_url)
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

    openai_intent = _is_openai_url(intent_url)
    if openai_intent:
        purpose = _enforce_openai_purpose(payload)
        openai_transcript = _redact_text(transcript) if OPENAI_REDACTION_REQUIRED else transcript
        intent_payload: dict[str, Any] = {
            "model": OPENAI_MODEL,
            "messages": _openai_messages(openai_transcript, payload, purpose),
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
    else:
        intent_payload = {
            "model": INTENT_MODEL,
            "prompt": _intent_prompt(transcript, payload),
            "stream": False,
            "format": "json",
        }

    intent_result = await _post_json(
        intent_url,
        intent_payload,
        headers=({**intent_headers, "X-Data-Redacted": "true"} if openai_intent and OPENAI_REDACTION_REQUIRED else intent_headers),
    )
    intent = _extract_intent(intent_result)

    return SpeechToIntentResponse(
        transcript=transcript,
        intent=intent,
        provider={
            "stt": os.getenv("STT_PROVIDER", "faster-whisper"),
            "intent": os.getenv("INTENT_PROVIDER", "ollama"),
        },
    )


@app.post("/v1/tts", response_model=TtsResponse)
async def tts(
    payload: TtsRequest,
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> TtsResponse:
    _check_auth(credentials)
    tts_url = _required_env("TTS_URL")
    _assert_runtime_url_policy("TTS_URL", tts_url)
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
