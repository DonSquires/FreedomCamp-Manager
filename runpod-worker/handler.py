"""
RunPod Serverless Worker — FieldOps AI Engine (Bob)
Uses official runpod Python SDK which handles heartbeats, job fetching, and result posting.

OLLAMA_BASE_URL resolution order:
    1. OLLAMA_EXTERNAL_URL — point at an external Ollama (Railway, VPS, etc.)
    2. OLLAMA_BASE_URL     — explicit base URL
    3. OLLAMA_HOST         — host or full URL for Ollama

Requires Ollama >= 0.3.x for /api/chat support (pinned in Dockerfile via OLLAMA_VERSION).
"""

import os
import json
import re
import shutil
import base64
import hashlib
import urllib.parse
import tempfile
import subprocess
import time
import requests
import runpod


def normalize_ollama_base(raw_value):
    raw = str(raw_value or "").strip().rstrip("/")
    if not raw:
        return ""

    if raw.startswith(("http://", "https://")):
        return raw

    parsed = urllib.parse.urlparse(f"http://{raw}")
    hostname = parsed.hostname
    if not hostname:
        return f"http://{raw}"

    host = f"[{hostname}]" if ":" in hostname and not hostname.startswith("[") else hostname
    auth = ""
    if parsed.username:
        auth = parsed.username
        if parsed.password:
            auth += f":{parsed.password}"
        auth += "@"

    netloc = parsed.netloc
    if parsed.port is None:
        netloc = f"{auth}{host}:11434"

    return urllib.parse.urlunparse((parsed.scheme or "http", netloc, parsed.path, "", parsed.query, "")).rstrip("/")


def normalize_service_base(raw_value, default_port=None):
    raw = str(raw_value or "").strip().rstrip("/")
    if not raw:
        return ""

    if raw.startswith(("http://", "https://")):
        return raw

    parsed = urllib.parse.urlparse(f"http://{raw}")
    hostname = parsed.hostname
    if not hostname:
        return f"http://{raw}"

    host = f"[{hostname}]" if ":" in hostname and not hostname.startswith("[") else hostname
    auth = ""
    if parsed.username:
        auth = parsed.username
        if parsed.password:
            auth += f":{parsed.password}"
        auth += "@"

    netloc = parsed.netloc
    if parsed.port is None and default_port is not None:
        netloc = f"{auth}{host}:{default_port}"

    return urllib.parse.urlunparse((parsed.scheme or "http", netloc, parsed.path, "", parsed.query, "")).rstrip("/")

# Resolve external Ollama endpoint. This worker no longer supports local Ollama mode.
_ext = os.environ.get("OLLAMA_EXTERNAL_URL", "").strip().rstrip("/")
_base = os.environ.get("OLLAMA_BASE_URL", "").strip().rstrip("/")
_host = os.environ.get("OLLAMA_HOST", "").strip().rstrip("/")
OLLAMA_BASE = normalize_ollama_base(_ext if _ext else _base if _base else _host)
if not OLLAMA_BASE:
    raise RuntimeError("OLLAMA_EXTERNAL_URL, OLLAMA_BASE_URL, or OLLAMA_HOST must be set to an external Ollama endpoint")


def parse_bool_env(name, default=False):
    raw = str(os.environ.get(name, "")).strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _candidate_variant_urls(base_url):
    normalized = normalize_ollama_base(base_url)
    if not normalized:
        return []

    variants = [normalized]
    parsed = urllib.parse.urlparse(normalized)
    host = parsed.hostname or ""
    if not host:
        return variants

    auth = ""
    if parsed.username:
        auth = parsed.username
        if parsed.password:
            auth += f":{parsed.password}"
        auth += "@"

    host_label = f"[{host}]" if ":" in host and not host.startswith("[") else host
    path = parsed.path or ""

    if parsed.scheme == "http" and parsed.port == 11434:
        variants.append(f"https://{auth}{host_label}{path}".rstrip("/"))
        variants.append(f"http://{auth}{host_label}{path}".rstrip("/"))
    elif parsed.scheme == "https" and parsed.port is None:
        variants.append(f"http://{auth}{host_label}:11434{path}".rstrip("/"))

    return variants


def build_ollama_candidates():
    sources = [
        OLLAMA_BASE,
        normalize_ollama_base(os.environ.get("OLLAMA_CHAT_BASE_URL", "")),
        normalize_ollama_base(os.environ.get("REQUIRED_OLLAMA_BASE_URL", "")),
        normalize_ollama_base(os.environ.get("INFERENCE_OLLAMA_BASE_URL", "")),
    ]
    candidates = []
    for source in sources:
        for variant in _candidate_variant_urls(source):
            if variant and variant not in candidates:
                candidates.append(variant)
    return candidates


OLLAMA_BASE_CANDIDATES = build_ollama_candidates()
OLLAMA_MODEL        = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
OLLAMA_VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "llama3.2-vision:11b")
BOB_ATTITUDE_PROFILE = os.environ.get("BOB_ATTITUDE_PROFILE", "operational").strip().lower()
BOB_ATTITUDE_INSTRUCTIONS = os.environ.get("BOB_ATTITUDE_INSTRUCTIONS", "").strip()
TIMEOUT_S           = int(os.environ.get("OLLAMA_TIMEOUT_MS", "120000")) // 1000
OLLAMA_RETRY_ATTEMPTS = max(1, int(os.environ.get("OLLAMA_RETRY_ATTEMPTS", "3")))
OLLAMA_RETRY_BACKOFF_MS = max(0, int(os.environ.get("OLLAMA_RETRY_BACKOFF_MS", "500")))
OLLAMA_TLS_VERIFY = parse_bool_env("OLLAMA_TLS_VERIFY", True)
TRAINING_MEMORY_PATH = os.environ.get("TRAINING_MEMORY_PATH", os.path.join(os.path.dirname(__file__), "training_memory.json"))
MAX_RUNTIME_NOTES = 8
OPENAI_REFERENCE_GATE_ENABLED = os.environ.get("OPENAI_REFERENCE_GATE_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
ALLOW_OPENAI_REFERENCE_PROVIDER = os.environ.get("ALLOW_OPENAI_REFERENCE_PROVIDER", "false").strip().lower() in {"1", "true", "yes", "on"}
ALLOW_OPENAI_RUNTIME = os.environ.get("ALLOW_OPENAI_RUNTIME", "true").strip().lower() in {"1", "true", "yes", "on"}
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini").strip()
OPENAI_ALLOWED_PURPOSES = {
    item.strip().lower()
    for item in os.environ.get("OPENAI_ALLOWED_PURPOSES", "research,training").split(",")
    if item.strip()
}
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

print(f"[worker] FieldOps AI Worker (Python/runpod) starting")
print(f"[worker] OLLAMA_BASE: {OLLAMA_BASE} (external)")
print(f"[worker] OLLAMA_BASE_CANDIDATES: {OLLAMA_BASE_CANDIDATES}")
print(f"[worker] OLLAMA_MODEL: {OLLAMA_MODEL}")
print(f"[worker] OLLAMA_VISION_MODEL: {OLLAMA_VISION_MODEL}")
print(f"[worker] OLLAMA_RETRY_ATTEMPTS: {OLLAMA_RETRY_ATTEMPTS}")
print(f"[worker] OLLAMA_TLS_VERIFY: {OLLAMA_TLS_VERIFY}")
print(f"[worker] BOB_ATTITUDE_PROFILE: {BOB_ATTITUDE_PROFILE}")
print(f"[worker] OPENAI_REFERENCE_GATE_ENABLED: {OPENAI_REFERENCE_GATE_ENABLED}")
print(f"[worker] ALLOW_OPENAI_REFERENCE_PROVIDER: {ALLOW_OPENAI_REFERENCE_PROVIDER}")
print(f"[worker] ALLOW_OPENAI_RUNTIME: {ALLOW_OPENAI_RUNTIME}")
print(f"[worker] OPENAI_ALLOWED_PURPOSES: {sorted(OPENAI_ALLOWED_PURPOSES)}")

_WORKING_OLLAMA_BASE = None

ATTITUDE_PRESETS = {
    "operational": "Tone: calm, decisive, and practical. Prioritize concise operational steps and clear outcomes.",
    "supportive": "Tone: warm, reassuring, and respectful. Reduce stress while still giving direct, actionable guidance.",
    "strict": "Tone: compliance-first, firm, and unambiguous. Highlight policy and safety constraints early.",
    "coach": "Tone: instructive and developmental. Explain brief reasoning and teach the user the next best action.",
}


def default_training_memory():
    return {
        "version": "2026-04-23",
        "bob": {
            "identity": "Bob is the internal AI assistant for FieldOps Manager. Prefer repo-grounded, concise, actionable answers over generic advice.",
            "rules": [
                "Check system_state.json before making architecture assumptions.",
                "Do not invent modules, routes, tables, services, or migrations.",
                "Prefer internal evidence such as build logs, lint logs, repo code, and stored intel over cloud-dependent advice.",
                "State exact acceptance gates when asked; do not substitute generic QA criteria.",
            ],
        },
        "dr_bob": {
            "identity": "Dr Bob is the blocking reviewer before implementation begins.",
            "rules": [
                "Challenge ungrounded modules, data models, routes, services, and migrations.",
                "Block plans that do not prove tenant isolation, org scoping, or validation steps when those are relevant.",
                "Return concrete blockers, evidence, and required actions rather than generic project risks.",
            ],
        },
        "build_review": {
            "review_order": [
                "critical blockers",
                "performance risks",
                "reliability risks",
                "privacy checks",
                "14-day remediation plan",
            ],
            "acceptance_gate": [
                "zero lint errors before release",
                "successful builds",
                "chunk strategy for large routes",
                "review scores of at least 9 across 3 consecutive runs",
                "no outbound dependency in the training loop",
            ],
            "evidence_sources": [
                "build logs",
                "lint logs",
                "repository code context",
                "system_state.json",
                "internal training intel",
            ],
            "failure_patterns": [
                "generic QA checklists instead of repo-specific acceptance gates",
                "hallucinated modules or architecture",
                "advice that depends on outbound cloud services for self-contained review work",
                "missing tenant isolation or org-scoping concerns when architecture is involved",
            ],
        },
        "review_protocol": {
            "blockers": [
                "src/modules or other modules proposed without grounding in system_state.json or repo files",
                "invented data models, routes, migrations, services, or package-manager assumptions",
                "missing validation or missing executable checks before completion",
                "architecture that ignores org scoping or tenant isolation requirements",
                "contradictions with repo topology or build/deploy reality",
            ],
            "required_checks": [
                "read system_state.json first",
                "cite grounded repo evidence",
                "require validation steps after implementation",
                "use approve, needs-revision, or block decisions with concrete findings",
            ],
        },
    }


def load_training_memory():
    memory = default_training_memory()
    try:
        with open(TRAINING_MEMORY_PATH, "r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        if isinstance(loaded, dict):
            memory.update({k: v for k, v in loaded.items() if v is not None})
    except Exception as exc:
        print(f"[worker] Training memory load fallback — {exc}")
    return memory


TRAINING_MEMORY = load_training_memory()
RUNTIME_TRAINING_NOTES = []


def _resolve_user_id(inp):
    if not isinstance(inp, dict):
        return ""

    candidates = [
        inp.get("user_id"),
        inp.get("actor_user_id"),
        (inp.get("context") or {}).get("user_id") if isinstance(inp.get("context"), dict) else None,
    ]
    for candidate in candidates:
        value = str(candidate or "").strip()
        if value:
            return value
    return ""


def load_user_bob_memory(user_id):
    if not user_id or not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return []

    try:
        encoded_user = urllib.parse.quote(user_id, safe="")
        url = (
            f"{SUPABASE_URL}/rest/v1/bob_user_memory"
            f"?user_id=eq.{encoded_user}&select=context_key,context_value,last_interaction"
            f"&order=last_interaction.desc&limit=25"
        )
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        }
        response = requests.get(url, headers=headers, timeout=10)
        if not response.ok:
            return []
        data = response.json()
        return data if isinstance(data, list) else []
    except Exception as exc:
        print(f"[worker] bob_user_memory load failed: {exc}")
        return []


def persist_user_memory_hint(user_id, context_key, context_value):
    if not user_id or not context_key or not context_value:
        return
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return

    payload = {
        "user_id": user_id,
        "context_key": context_key,
        "context_value": context_value,
        "last_interaction": datetime_now_iso(),
    }

    try:
        url = f"{SUPABASE_URL}/rest/v1/bob_user_memory?on_conflict=user_id,context_key"
        headers = {
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        }
        requests.post(url, headers=headers, json=payload, timeout=10)
    except Exception as exc:
        print(f"[worker] bob_user_memory upsert failed: {exc}")


def format_user_memory_context(memory_rows):
    if not memory_rows:
        return ""

    preferred_sites = []
    common_phrases = []
    shift_types = []

    for row in memory_rows:
        key = str(row.get("context_key") or "").lower()
        value = str(row.get("context_value") or "").strip()
        if not value:
            continue
        if key.startswith("preferred_site"):
            preferred_sites.append(value)
        elif key.startswith("common_phrase"):
            common_phrases.append(value)
        elif key.startswith("past_shift_type"):
            shift_types.append(value)

    lines = []
    if preferred_sites:
        lines.append("Preferred sites: " + ", ".join(preferred_sites[:5]))
    if common_phrases:
        lines.append("Common phrases: " + ", ".join(common_phrases[:5]))
    if shift_types:
        lines.append("Past shift types: " + ", ".join(shift_types[:5]))

    return "\n".join(lines)


def datetime_now_iso():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def detect_role(action, inp):
    text = str(inp.get("message") or inp.get("prompt") or "").strip().lower()
    role = str(inp.get("role") or "").strip().lower()
    if role in {"dr_bob", "dr-bob", "reviewer"}:
        return "dr_bob"
    if action == "review":
        return "dr_bob"
    if text.startswith("dr bob:") or "blocking reviewer" in text or "adversarial architecture review" in text:
        return "dr_bob"
    return "bob"


def wants_openai_provider(inp):
    provider = str(inp.get("provider") or "").strip().lower()
    model = str(inp.get("model") or "").strip().lower()
    return provider in {"openai", "chatgpt"} or model.startswith("gpt-")


def resolve_openai_purpose(inp):
    direct = str(inp.get("openai_purpose") or inp.get("purpose") or "").strip().lower()
    if direct:
        return direct
    context = inp.get("context") or {}
    if isinstance(context, dict):
        return str(context.get("openai_purpose") or context.get("purpose") or "").strip().lower()
    return ""


def openai_policy_gate(inp):
    if not wants_openai_provider(inp):
        return True, ""

    if not OPENAI_REFERENCE_GATE_ENABLED:
        return True, ""

    if ALLOW_OPENAI_REFERENCE_PROVIDER:
        return True, ""

    if not ALLOW_OPENAI_RUNTIME:
        return False, "OpenAI provider is disabled: ALLOW_OPENAI_RUNTIME=false"

    purpose = resolve_openai_purpose(inp)
    if not purpose:
        return False, "OpenAI provider requires openai_purpose (research or training)"

    if purpose not in OPENAI_ALLOWED_PURPOSES:
        return False, f"OpenAI provider purpose '{purpose}' is not allowed. Allowed: {sorted(OPENAI_ALLOWED_PURPOSES)}"

    return True, ""


def remember_training_note(message):
    note = " ".join(str(message or "").split()).strip()
    if not note:
        return 0
    RUNTIME_TRAINING_NOTES.append(note[:800])
    del RUNTIME_TRAINING_NOTES[:-MAX_RUNTIME_NOTES]
    return len(RUNTIME_TRAINING_NOTES)


def contains_any(text, phrases):
    lowered = str(text or "").lower()
    return any(phrase in lowered for phrase in phrases)


def render_list(title, items):
    lines = [f"{title}:"]
    for item in items:
        lines.append(f"- {item}")
    return "\n".join(lines)


def render_build_review_answer():
    data = TRAINING_MEMORY["build_review"]
    return "\n\n".join([
        render_list("Grounded review order", data["review_order"]),
        render_list("Go-live acceptance gate", data["acceptance_gate"]),
        render_list("Evidence sources", data["evidence_sources"]),
        render_list("Failure patterns to avoid", data["failure_patterns"]),
    ])


def render_dr_bob_answer():
    data = TRAINING_MEMORY["review_protocol"]
    return "\n\n".join([
        render_list("Blocker findings to look for", data["blockers"]),
        render_list("Checks required before approval", data["required_checks"]),
    ])


def answer_from_training_memory(message, role):
    lowered = str(message or "").lower()
    if contains_any(lowered, [
        "build review",
        "go-live",
        "acceptance criteria",
        "acceptance gate",
        "lint requirements",
        "review order",
        "evidence sources",
        "failure patterns",
        "score threshold",
        "consecutive runs",
        "training loop",
    ]):
        return render_build_review_answer()

    if role == "dr_bob" and contains_any(lowered, [
        "blocker",
        "blocking reviewer",
        "before approving",
        "before implementation",
        "what checks",
        "truth protocol",
        "system_state.json",
        "tenant isolation",
        "ungrounded",
    ]):
        return render_dr_bob_answer()

    return None


def build_system_prompt(role, incoming_prompt=None):
    incoming_prompt = str(incoming_prompt or "").strip()
    identity_key = "dr_bob" if role == "dr_bob" else "bob"
    identity = TRAINING_MEMORY[identity_key]["identity"]
    rules = TRAINING_MEMORY[identity_key]["rules"]
    sections = [identity, render_list("Non-negotiable rules", rules)]

    if role == "dr_bob":
        sections.append(render_list("Review protocol", TRAINING_MEMORY["review_protocol"]["required_checks"]))
    else:
        sections.append(render_list("Build-review acceptance gate", TRAINING_MEMORY["build_review"]["acceptance_gate"]))

    if RUNTIME_TRAINING_NOTES:
        sections.append(render_list("Recent runtime training notes", RUNTIME_TRAINING_NOTES[-3:]))

    attitude_line = ATTITUDE_PRESETS.get(BOB_ATTITUDE_PROFILE, ATTITUDE_PRESETS["operational"])
    sections.append("Attitude profile:\n- " + attitude_line)
    if BOB_ATTITUDE_INSTRUCTIONS:
        sections.append("Attitude override:\n- " + BOB_ATTITUDE_INSTRUCTIONS)

    if incoming_prompt:
        sections.append("Caller override:\n" + incoming_prompt)

    return "\n\n".join(sections)

BOB_SYSTEM = (
    "You are Bob, the AI assistant for FieldOps Manager — a freedom camping "
    "enforcement platform in New Zealand. Be concise and actionable."
)


def _messages_to_prompt(messages):
    """Flatten chat messages for Ollama /api/generate fallback."""
    chunks = []
    for m in messages or []:
        role = str(m.get("role", "user")).upper()
        content = str(m.get("content", "")).strip()
        if content:
            chunks.append(f"{role}: {content}")
    chunks.append("ASSISTANT:")
    return "\n\n".join(chunks)


def ollama_chat(messages, model=None, temperature=0.7):
    global _WORKING_OLLAMA_BASE

    # Prefer /api/chat, but fall back to /api/generate for older Ollama builds.
    # Probe multiple configured hosts so one stale URL does not break Bob/Dr Bob.
    candidates = []
    if _WORKING_OLLAMA_BASE:
        candidates.append(_WORKING_OLLAMA_BASE)
    for candidate in OLLAMA_BASE_CANDIDATES:
        normalized = normalize_ollama_base(candidate)
        if normalized and normalized not in candidates:
            candidates.append(normalized)

    if not candidates:
        raise RuntimeError("No Ollama endpoint candidates configured")

    chat_payload = {
        "model": model or OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature},
    }
    generate_payload = {
        "model": model or OLLAMA_MODEL,
        "prompt": _messages_to_prompt(messages),
        "stream": False,
        "options": {"temperature": temperature},
    }

    last_error = None
    attempted_hosts = []

    for ollama_host in candidates:
        attempted_hosts.append(ollama_host)
        for attempt in range(1, OLLAMA_RETRY_ATTEMPTS + 1):
            try:
                resp = requests.post(
                    f"{ollama_host}/api/chat",
                    json=chat_payload,
                    timeout=TIMEOUT_S,
                    verify=OLLAMA_TLS_VERIFY,
                )

                if resp.status_code == 404:
                    gen_resp = requests.post(
                        f"{ollama_host}/api/generate",
                        json=generate_payload,
                        timeout=TIMEOUT_S,
                        verify=OLLAMA_TLS_VERIFY,
                    )
                    if gen_resp.status_code == 404:
                        last_error = f"{ollama_host} returned 404 for /api/chat and /api/generate"
                        break

                    gen_resp.raise_for_status()
                    gen_data = gen_resp.json()
                    gen_content = gen_data.get("response", "")
                    if not gen_content:
                        raise ValueError("Ollama /api/generate returned empty content")

                    _WORKING_OLLAMA_BASE = ollama_host
                    return {"content": gen_content, "model": gen_data.get("model", model or OLLAMA_MODEL)}

                resp.raise_for_status()
                data = resp.json()
                content = data.get("message", {}).get("content", "")
                if not content:
                    raise ValueError("Ollama returned empty content")

                _WORKING_OLLAMA_BASE = ollama_host
                return {"content": content, "model": data.get("model", model or OLLAMA_MODEL)}
            except Exception as exc:
                last_error = f"{ollama_host} attempt {attempt}/{OLLAMA_RETRY_ATTEMPTS}: {exc}"
                if attempt < OLLAMA_RETRY_ATTEMPTS:
                    time.sleep((OLLAMA_RETRY_BACKOFF_MS / 1000.0) * attempt)

    raise RuntimeError(
        "Failed to reach a working Ollama endpoint. "
        f"Attempted: {attempted_hosts}. Last error: {last_error}"
    )


def openai_chat(messages, model=None, temperature=0.7):
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    payload = {
        "model": model or OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
    }

    resp = requests.post(
        f"{OPENAI_BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=TIMEOUT_S,
    )

    if resp.status_code >= 400:
        raise RuntimeError(f"OpenAI HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise ValueError("OpenAI returned no choices")

    content = ((choices[0] or {}).get("message") or {}).get("content")
    if not content:
        raise ValueError("OpenAI returned empty content")

    return {"content": content, "model": data.get("model", model or OPENAI_MODEL)}


def ollama_vision_chat(prompt, image_b64, model=None, temperature=0.2):
    """Send an image + prompt to the vision model. image_b64 is a base64-encoded image string."""
    chat_payload = {
        "model": model or OLLAMA_VISION_MODEL,
        "messages": [{"role": "user", "content": prompt, "images": [image_b64]}],
        "stream": False,
        "options": {"temperature": temperature},
    }

    resp = requests.post(
        f"{OLLAMA_BASE}/api/chat",
        json=chat_payload,
        timeout=TIMEOUT_S,
    )

    if resp.status_code == 404:
        generate_payload = {
            "model": model or OLLAMA_VISION_MODEL,
            "prompt": prompt,
            "images": [image_b64],
            "stream": False,
            "options": {"temperature": temperature},
        }
        gen_resp = requests.post(
            f"{OLLAMA_BASE}/api/generate",
            json=generate_payload,
            timeout=TIMEOUT_S,
        )
        gen_resp.raise_for_status()
        gen_data = gen_resp.json()
        gen_content = gen_data.get("response", "")
        if not gen_content:
            raise ValueError("Vision /api/generate returned empty content")
        return {"content": gen_content, "model": gen_data.get("model", model or OLLAMA_VISION_MODEL)}

    resp.raise_for_status()
    data = resp.json()
    content = data.get("message", {}).get("content", "")
    if not content:
        raise ValueError("Vision model returned empty content")
    return {"content": content, "model": data.get("model", model or OLLAMA_VISION_MODEL)}


def _language_to_espeak_voice(language):
    lang = str(language or "en-NZ").strip().lower()
    if lang.startswith("mi"):
        return "en-nz"
    if lang.startswith("ja"):
        return "ja"
    if lang.startswith("zh"):
        return "zh"
    if lang.startswith("ko"):
        return "ko"
    if lang.startswith("fr"):
        return "fr"
    if lang.startswith("de"):
        return "de"
    if lang.startswith("es"):
        return "es"
    return "en-nz"


def _style_to_speech_tone(style):
    key = str(style or "default").strip().lower()
    if key in {"urgent", "alert"}:
        return {"rate": 190, "pitch": 1.05}
    if key in {"calm", "reassuring"}:
        return {"rate": 145, "pitch": 0.95}
    if key in {"brief", "concise"}:
        return {"rate": 175, "pitch": 1.0}
    return {"rate": 160, "pitch": 1.0}


def synthesize_with_espeak(text, language="en-NZ", voice_profile=None, style="default"):
    voice_profile = voice_profile or {}
    tone = _style_to_speech_tone(style)

    rate = int(max(90, min(260, float(voice_profile.get("rate", tone["rate"])))) )
    # espeak-ng pitch is 0..99, convert from normalized 0..2 if provided
    normalized_pitch = float(voice_profile.get("pitch", tone["pitch"]))
    espeak_pitch = int(max(0, min(99, normalized_pitch * 50)))
    voice = str(voice_profile.get("voice_name") or _language_to_espeak_voice(language)).strip()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_file:
        wav_path = wav_file.name

    try:
        cmd = [
            "espeak-ng",
            "-v", voice,
            "-s", str(rate),
            "-p", str(espeak_pitch),
            "-w", wav_path,
            text,
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=20)
        with open(wav_path, "rb") as rf:
            audio_b64 = base64.b64encode(rf.read()).decode("ascii")
        return {
            "ok": True,
            "audio_base64": audio_b64,
            "audio_mime_type": "audio/wav",
            "voice_params": {
                "rate": rate,
                "pitch": normalized_pitch,
                "voice_name": voice,
                "lang": language,
                "style": style,
            },
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    finally:
        try:
            os.unlink(wav_path)
        except Exception:
            pass


def generate_briefing_video_artifact(inp):
    fmt = str(inp.get("format") or "mp4").strip().lower()
    fmt = "webm" if fmt == "webm" else "mp4"
    quality = str(inp.get("quality") or "medium").strip().lower()

    duration_seconds = 12 if quality == "high" else 6 if quality == "low" else 9
    bitrate = "1800k" if quality == "high" else "850k" if quality == "low" else "1250k"
    model_used = "ffmpeg-color-renderer-v1" if shutil.which("ffmpeg") else "deterministic-manifest-v1"

    manifest = {
        "title": str(inp.get("title") or "Operational Briefing Pack").strip(),
        "notes": str(inp.get("notes") or "").strip(),
        "org_id": str(inp.get("org_id") or "unknown-org").strip(),
        "incident_id": str(inp.get("incident_id") or "").strip() or None,
        "breach_id": str(inp.get("breach_id") or "").strip() or None,
        "quality": quality,
        "format": fmt,
        "duration_seconds": duration_seconds,
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "model_used": model_used,
    }

    if shutil.which("ffmpeg"):
        with tempfile.TemporaryDirectory(prefix="briefing-video-") as temp_dir:
            output_path = os.path.join(temp_dir, f"briefing.{fmt}")
            ffmpeg_cmd = [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"color=c=0x0f172a:s=1280x720:d={duration_seconds}",
            ]
            if fmt == "webm":
                ffmpeg_cmd.extend(["-c:v", "libvpx-vp9", "-b:v", bitrate, "-pix_fmt", "yuv420p", output_path])
            else:
                ffmpeg_cmd.extend(["-c:v", "libx264", "-b:v", bitrate, "-pix_fmt", "yuv420p", output_path])

            subprocess.run(ffmpeg_cmd, check=True, capture_output=True, timeout=25)
            with open(output_path, "rb") as rf:
                blob = rf.read()

        digest = hashlib.sha256(blob).hexdigest()
        return {
            "success": True,
            "provider": "runpod-ffmpeg",
            "model_used": model_used,
            "duration_seconds": duration_seconds,
            "output_hash": digest,
            "output_url": f"runpod-artifact://{digest}.{fmt}",
            "artifact_manifest": manifest,
            "video_base64": base64.b64encode(blob).decode("ascii"),
            "mime_type": "video/webm" if fmt == "webm" else "video/mp4",
        }

    manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
    digest = hashlib.sha256(manifest_bytes).hexdigest()
    return {
        "success": True,
        "provider": "runpod-manifest",
        "model_used": model_used,
        "duration_seconds": duration_seconds,
        "output_hash": digest,
        "output_url": f"runpod-artifact://{digest}.{fmt}",
        "artifact_manifest": manifest,
        "video_base64": base64.b64encode(manifest_bytes).decode("ascii"),
        "mime_type": "application/json",
        "fallback_note": "ffmpeg unavailable; returned deterministic manifest artifact",
    }


def _xml_escape(value):
    text = str(value or "")
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def generate_picture_artifact(inp):
    title = _xml_escape(inp.get("title") or "FieldOps Briefing")
    prompt = _xml_escape(inp.get("prompt") or inp.get("message") or "Operational summary")
    svg = f"""<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"720\" viewBox=\"0 0 1280 720\">\n  <defs>\n    <linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n      <stop offset=\"0%\" stop-color=\"#0f172a\"/>\n      <stop offset=\"100%\" stop-color=\"#1e293b\"/>\n    </linearGradient>\n  </defs>\n  <rect width=\"1280\" height=\"720\" fill=\"url(#g)\"/>\n  <rect x=\"48\" y=\"48\" width=\"1184\" height=\"624\" rx=\"20\" fill=\"#0b1220\" stroke=\"#334155\"/>\n  <text x=\"88\" y=\"140\" fill=\"#e2e8f0\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"48\" font-weight=\"700\">{title}</text>\n  <text x=\"88\" y=\"220\" fill=\"#94a3b8\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"30\">Prompt</text>\n  <foreignObject x=\"88\" y=\"250\" width=\"1100\" height=\"360\">\n    <div xmlns=\"http://www.w3.org/1999/xhtml\" style=\"color:#cbd5e1;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.35;\">{prompt}</div>\n  </foreignObject>\n</svg>"""

    blob = svg.encode("utf-8")
    digest = hashlib.sha256(blob).hexdigest()
    return {
        "success": True,
        "provider": "runpod-svg-renderer",
        "output_hash": digest,
        "output_url": f"runpod-artifact://{digest}.svg",
        "image_base64": base64.b64encode(blob).decode("ascii"),
        "mime_type": "image/svg+xml",
    }


def transcribe_with_whisper(audio_base64, audio_mime_type="audio/wav", language="en"):
    whisper_url = normalize_service_base(os.environ.get("WHISPER_SERVICE_URL", ""))
    if not whisper_url or not audio_base64:
        return {"success": False, "provider": "whisper", "error": "whisper unavailable"}

    payload = {
        "audio_base64": str(audio_base64),
        "audio_mime_type": str(audio_mime_type or "audio/wav"),
        "language": str(language or "en"),
    }

    for whisper_path in ["/infer/transcribe", "/transcribe"]:
        try:
            resp = requests.post(f"{whisper_url}{whisper_path}", json=payload, timeout=60)
            if not resp.ok:
                continue
            data = resp.json()
            transcript = data.get("transcript") or data.get("text")
            if transcript:
                return {"success": True, "provider": "whisper", "transcript": transcript}
        except Exception:
            continue

    return {"success": False, "provider": "whisper", "error": "no transcript"}


def handler(job):
    inp = job.get("input") or {}
    action = inp.get("action", "chat")
    print(f"[worker] action={action} job={job.get('id','?')}")
    role = detect_role(action, inp)

    openai_allowed, openai_gate_message = openai_policy_gate(inp)
    if not openai_allowed:
        return {
            "success": False,
            "error": openai_gate_message,
            "provider": "policy-enforcer",
            "openai_reference_gate_enabled": OPENAI_REFERENCE_GATE_ENABLED,
            "allow_openai_reference_provider": ALLOW_OPENAI_REFERENCE_PROVIDER,
            "allow_openai_runtime": ALLOW_OPENAI_RUNTIME,
            "openai_allowed_purposes": sorted(OPENAI_ALLOWED_PURPOSES),
            "openai_purpose": resolve_openai_purpose(inp),
        }

    if action == "ping":
        try:
            probe = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=10)
            available = [m.get("name") for m in probe.json().get("models", [])]
            ollama_ok = True
        except Exception as pe:
            available = []
            ollama_ok = False
        return {
            "success": True,
            "message": "AI Engine online" if ollama_ok else "AI Engine online — Ollama unreachable",
            "ollama_reachable": ollama_ok,
            "ollama_base": OLLAMA_BASE,
            "models_available": available,
            "model": OLLAMA_MODEL,
            "training_memory_loaded": True,
            "training_memory_version": TRAINING_MEMORY.get("version"),
            "runtime_training_notes": len(RUNTIME_TRAINING_NOTES),
            "openai_reference_gate_enabled": OPENAI_REFERENCE_GATE_ENABLED,
            "allow_openai_reference_provider": ALLOW_OPENAI_REFERENCE_PROVIDER,
            "allow_openai_runtime": ALLOW_OPENAI_RUNTIME,
            "openai_allowed_purposes": sorted(OPENAI_ALLOWED_PURPOSES),
            "provider": "ollama",
        }

    if action == "training_note":
        note = inp.get("note") or inp.get("message") or inp.get("prompt") or ""
        note_count = remember_training_note(note)
        return {
            "success": True,
            "message": "Training note accepted for this warm worker.",
            "training_memory_loaded": True,
            "runtime_training_notes": note_count,
            "provider": "worker-memory",
        }

    if action == "chat":
        message = inp.get("message")
        if not message:
            return {"success": False, "error": "message required"}
        direct = answer_from_training_memory(message, role)
        if direct:
            return {
                "success": True,
                "response": direct,
                "message": direct,
                "model": OLLAMA_MODEL,
                "provider": "training-memory",
            }

        user_id = _resolve_user_id(inp)
        user_memory_rows = load_user_bob_memory(user_id)
        user_memory_context = format_user_memory_context(user_memory_rows)
        system_prompt = build_system_prompt(role, inp.get("system_prompt") or BOB_SYSTEM)
        if user_memory_context:
            system_prompt = system_prompt + "\n\nPersistent user memory:\n" + user_memory_context

        messages = [
            {"role": "system", "content": system_prompt},
            *(inp.get("history") or []),
            {"role": "user", "content": message},
        ]
        use_openai = wants_openai_provider(inp)
        result = openai_chat(messages, inp.get("model"), inp.get("temperature", 0.7)) if use_openai else ollama_chat(messages, inp.get("model"), inp.get("temperature", 0.7))
        provider_name = "openai" if use_openai else "ollama"

        if user_id:
            persist_user_memory_hint(user_id, "common_phrase_latest", str(message).strip()[:180])
            lowered = str(message).lower()
            if "night shift" in lowered:
                persist_user_memory_hint(user_id, "past_shift_type_latest", "night")
            elif "day shift" in lowered:
                persist_user_memory_hint(user_id, "past_shift_type_latest", "day")

            site_match = str(message).strip()
            site_capture = None
            site_pattern = re.search(r"\b(?:at|site|address)\b\s+(.+)$", site_match, re.IGNORECASE)
            if site_pattern and site_pattern.group(1).strip():
                site_capture = site_pattern.group(1).strip()[:180]
            if site_capture:
                persist_user_memory_hint(user_id, "preferred_site_latest", site_capture)

        return {
            "success": True,
            "response": result["content"],
            "message": result["content"],
            "model": result["model"],
            "provider": provider_name,
            "memory_applied": bool(user_memory_context),
            "memory_items": len(user_memory_rows),
            "openai_purpose": resolve_openai_purpose(inp) if use_openai else None,
        }

    if action == "plan":
        objective = str(inp.get("objective") or inp.get("task") or inp.get("message") or "").strip()
        if not objective:
            return {"success": False, "error": "objective or task required"}

        result = ollama_chat([
            {
                "role": "system",
                "content": "You are Bob, an operations planner. Return only JSON: {summary, milestones:[{title,owner,eta}], risks:[{risk,mitigation}], next_actions:[string]}",
            },
            {"role": "user", "content": objective},
        ], inp.get("model"), 0.2)

        structured = None
        try:
            m = re.search(r"\{[\s\S]*\}", result["content"])
            if m:
                structured = json.loads(m.group(0))
        except Exception:
            pass

        return {
            "success": True,
            "plan": structured or result["content"],
            "raw_response": result["content"],
            "provider": "ollama-planner",
            "model": result["model"],
        }

    if action == "review":
        message = inp.get("message") or inp.get("prompt")
        if not message:
            return {"success": False, "error": "message or prompt required"}
        messages = [
            {"role": "system", "content": build_system_prompt("dr_bob", inp.get("system_prompt"))},
            {"role": "user", "content": message},
        ]
        use_openai = wants_openai_provider(inp)
        result = openai_chat(messages, inp.get("model"), inp.get("temperature", 0.2)) if use_openai else ollama_chat(messages, inp.get("model"), inp.get("temperature", 0.2))
        return {
            "success": True,
            "response": result["content"],
            "message": result["content"],
            "model": result["model"],
            "provider": "openai-review" if use_openai else "ollama-review",
            "openai_purpose": resolve_openai_purpose(inp) if use_openai else None,
        }

    if action == "assess":
        text = inp.get("symptom") or inp.get("description") or inp.get("imageDescription")
        if not text:
            return {"success": False, "error": "symptom or description required"}
        type_ = inp.get("type", "general")
        context = inp.get("context") or {}
        sys_map = {
            "smoke": (
                "You are a NZ environmental compliance officer AI. Assess a smoke or fire nuisance complaint under "
                "the Resource Management Act 1991 (RMA) and council bylaws. "
                "Consider: time of day, complaint duration, proximity to residential zones, and fire risk. "
                "Determine if the smoke constitutes an unreasonable nuisance under RMA s.326. "
                "Respond in JSON: {severity, summary, assessment, recommendation, actions, legal_basis, rma_section}"
            ),
            "biosecurity": (
                "You are a NZ biosecurity officer AI. Assess the described plant or pest for biosecurity risk "
                "under the Biosecurity Act 1993. Identify species if possible, particularly NZ pest plants "
                "(Nassella neesiana, climbing spindle berry, etc.). Rate the risk level and required action. "
                "Respond in JSON: {risk_level, summary, dominant_species, species, density_estimate, recommended_action, compliance_notes}"
            ),
            "noise": (
                "You are a NZ noise control officer AI using the Noise Control Assessment Matrix. "
                "Assess the noise complaint and score using the three-factor matrix: "
                "volume_score (0=no noise, 1=barely audible, 2=clearly audible, 3=loud, 4=extremely loud), "
                "time_score (depends on time category: night=higher, day=lower), "
                "tone_score (0=no tonal quality, 1=some, 2=strong tonal quality). "
                "Matrix total >= 5 means exceeds district plan limits. "
                "Also identify noise_type (music/party/machinery/barking_dog/other) and noise_source. "
                "Respond ONLY in JSON: "
                "{volume_score, time_score, tone_score, noise_type, noise_source, "
                "recommended_action, exceeds_district_plan, rationale, severity}"
            ),
            "ptt": (
                "You are a PTT (Push-to-Talk) radio diagnostic AI for field operations. "
                "Diagnose the described PTT issue and provide structured troubleshooting steps. "
                "Consider: connection issues, codec mismatches, server latency, authentication failures, "
                "firewall/NAT traversal, audio device issues. "
                "Respond in JSON: {root_cause, urgency, troubleshooting_steps, likely_fix, escalation_required}"
            ),
            "platform": (
                "You are an infrastructure health diagnosis AI for the FieldOps Manager platform. "
                "Diagnose the described symptom in the context of a Supabase + RunPod + Vite React SPA stack. "
                "Respond in JSON: {severity, root_cause, diagnosis, remediation_steps, escalation_required}"
            ),
        }
        type_system = sys_map.get(type_, "You are a structured assessment AI. Assess the described issue and respond in JSON with severity, summary, recommendation, and actions.")
        # For noise, include time_category from context to help matrix scoring
        user_content = text
        if type_ == "noise" and context:
            extras = []
            if context.get("time_category"):
                extras.append(f"Time category: {context['time_category']}")
            if context.get("observed_db"):
                extras.append(f"Observed dB(A): {context['observed_db']}")
            if context.get("location_context"):
                extras.append(f"Location: {context['location_context']}")
            if extras:
                user_content = "\n".join(extras) + "\n\nOfficer transcript/notes: " + text
        result = ollama_chat([
            {"role": "system", "content": type_system},
            {"role": "user", "content": user_content},
        ], inp.get("model"), 0.3)
        structured = None
        try:
            m = re.search(r"\{[\s\S]*\}", result["content"])
            if m:
                structured = json.loads(m.group(0))
        except Exception:
            pass
        return {"success": True, "type": type_, "assessment": structured or result["content"],
                "raw_response": result["content"], "model": result["model"], "provider": "ollama"}

    if action == "translate":
        text = inp.get("text")
        if not text:
            return {"success": False, "error": "text required"}
        # Full locale-code to language name mapping matching edge function
        langs = {
            # Short codes
            "zh": "Chinese (Simplified)", "ja": "Japanese", "ko": "Korean",
            "mi": "Te Reo Māori", "fr": "French", "de": "German", "es": "Spanish",
            "hi": "Hindi", "ar": "Arabic", "ru": "Russian", "th": "Thai",
            "vi": "Vietnamese", "ms": "Malay", "id": "Indonesian",
            "ur": "Urdu", "bn": "Bengali", "sw": "Swahili", "pa": "Punjabi",
            "tl": "Filipino (Tagalog)", "pt": "Portuguese",
            # Full locale codes
            "en-NZ": "New Zealand English", "en-AU": "Australian English",
            "en-GB": "British English", "en-US": "American English",
            "zh-CN": "Simplified Chinese (Mandarin)", "zh-TW": "Traditional Chinese",
            "hi-IN": "Hindi", "pa-IN": "Punjabi", "tl-PH": "Filipino (Tagalog)",
            "mi-NZ": "Te Reo Māori", "ko-KR": "Korean", "ja-JP": "Japanese",
            "es-ES": "Spanish", "fr-FR": "French", "de-DE": "German",
            "ar-SA": "Arabic", "pt-BR": "Brazilian Portuguese",
            "ru-RU": "Russian", "th-TH": "Thai", "vi-VN": "Vietnamese",
            "ms-MY": "Malay", "id-ID": "Indonesian", "ur-PK": "Urdu",
            "bn-BD": "Bengali", "sw-KE": "Swahili",
        }
        target = inp.get("target_language", "en")
        # Try exact match first, then short prefix (e.g. 'zh-CN' -> try 'zh')
        target_name = langs.get(target) or langs.get(target.split("-")[0]) or target
        source_language = inp.get("source_language")
        source_name = langs.get(source_language) or langs.get((source_language or "").split("-")[0]) or source_language if source_language else None
        sys_msg = (
            f"You are a professional real-time translator for a field operations security platform. "
            f"Translate to {target_name}. Preserve operational meaning, terminology, and tone exactly. "
            f"Return ONLY the translated text with no commentary, labels, or explanations."
        )
        user_content = (f"Translate from {source_name} to {target_name}:\n\n{text}"
                        if source_name else f"Translate to {target_name}:\n\n{text}")
        result = ollama_chat([
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": user_content},
        ], inp.get("model"), 0.1)
        return {"success": True, "translation": result["content"], "translated_text": result["content"],
                "target_language": target, "model": result["model"], "provider": "ollama"}

    if action == "speak":
        text = str(inp.get("text") or inp.get("message") or "").strip()
        if not text:
            return {"success": False, "error": "text required"}

        language = str(inp.get("language") or "en-NZ")
        style = str(inp.get("style") or "default")
        voice_profile = inp.get("voice_profile") or {}

        tts = synthesize_with_espeak(text, language=language, voice_profile=voice_profile, style=style)
        if tts.get("ok"):
            return {
                "success": True,
                "spoken_text": text,
                "audio_base64": tts.get("audio_base64"),
                "audio_mime_type": tts.get("audio_mime_type", "audio/wav"),
                "voice_params": tts.get("voice_params"),
                "provider": "espeak-ng",
            }

        return {
            "success": True,
            "spoken_text": text,
            "client_action": "web_speech_synthesis",
            "voice_params": {
                "lang": language,
                "style": style,
                **(voice_profile if isinstance(voice_profile, dict) else {}),
            },
            "warning": f"Local TTS synthesis unavailable: {tts.get('error', 'unknown error')}",
            "provider": "client-fallback",
        }

    if action == "transcribe":
        audio_base64 = str(inp.get("audio_base64") or "").strip()
        audio_mime_type = str(inp.get("audio_mime_type") or "audio/webm").strip()
        language = str(inp.get("language") or "en").strip()
        whisper_url = normalize_service_base(os.environ.get("WHISPER_SERVICE_URL", ""))

        if audio_base64 and whisper_url:
            try:
                whisper_payload = {
                    "audio_base64": audio_base64,
                    "audio_mime_type": audio_mime_type,
                    "language": language,
                }
                whisper_paths = ["/infer/transcribe", "/transcribe"]
                for whisper_path in whisper_paths:
                    w_resp = requests.post(
                        f"{whisper_url}{whisper_path}",
                        json=whisper_payload,
                        timeout=60,
                    )
                    if not w_resp.ok:
                        continue
                    w_data = w_resp.json()
                    transcript = w_data.get("transcript") or w_data.get("text")
                    if transcript:
                        return {
                            "success": True,
                            "transcript": transcript,
                            "language": language,
                            "provider": "whisper",
                        }
            except Exception as w_err:
                print(f"[worker] Whisper service unavailable: {w_err}")

        return {
            "success": True,
            "transcript": "",
            "language": language,
            "client_action": "web_speech_recognition",
            "message": "No Whisper service configured/reachable. Use browser Web Speech API for transcription.",
            "provider": "client-fallback",
        }

    if action == "render_media_pack":
        objective = str(inp.get("objective") or inp.get("message") or inp.get("prompt") or "Operational briefing").strip()
        title = str(inp.get("title") or "Operational Media Pack").strip()
        language = str(inp.get("language") or "en-NZ")

        plan_result = ollama_chat([
            {
                "role": "system",
                "content": "Create a concise operational media brief. Return ONLY JSON: {narration, image_prompt, video_notes, key_points:[string]}",
            },
            {"role": "user", "content": objective},
        ], inp.get("model"), 0.2)

        media_plan = None
        try:
            m = re.search(r"\{[\s\S]*\}", plan_result["content"])
            if m:
                media_plan = json.loads(m.group(0))
        except Exception:
            media_plan = None

        narration = str((media_plan or {}).get("narration") or objective)
        image_prompt = str((media_plan or {}).get("image_prompt") or objective)
        video_notes = str((media_plan or {}).get("video_notes") or objective)

        picture = generate_picture_artifact({"title": title, "prompt": image_prompt})
        video = generate_briefing_video_artifact({
            "title": title,
            "notes": video_notes,
            "quality": inp.get("quality") or "medium",
            "format": inp.get("format") or "mp4",
            "org_id": inp.get("org_id"),
            "incident_id": inp.get("incident_id"),
            "breach_id": inp.get("breach_id"),
        })

        tts = synthesize_with_espeak(
            narration,
            language=language,
            voice_profile=inp.get("voice_profile") or {},
            style=str(inp.get("style") or "default"),
        )

        audio = {
            "success": bool(tts.get("ok")),
            "provider": "espeak-ng" if tts.get("ok") else "client-fallback",
            "spoken_text": narration,
            "audio_base64": tts.get("audio_base64"),
            "audio_mime_type": tts.get("audio_mime_type", "audio/wav"),
            "warning": None if tts.get("ok") else f"Local TTS unavailable: {tts.get('error', 'unknown error')}",
        }

        whisper_check = transcribe_with_whisper(
            audio.get("audio_base64") or "",
            audio.get("audio_mime_type") or "audio/wav",
            inp.get("transcribe_language") or "en",
        )

        return {
            "success": True,
            "provider": "bob-media-pack",
            "plan": media_plan or plan_result["content"],
            "picture": picture,
            "video": video,
            "audio": audio,
            "whisper_link": whisper_check,
        }

    if action == "generate_briefing_video":
        try:
            return generate_briefing_video_artifact(inp)
        except Exception as exc:
            return {"success": False, "error": f"Briefing video generation failed: {exc}", "provider": "runpod-video"}

    if action == "tender_generate":
        # Generate tender application or response sections via Ollama
        generation_type = str(inp.get("generation_type") or "response").lower()
        context = inp.get("context") or {}
        org_context = inp.get("organization_context") or {}

        extracted_text = str(context.get("extracted_text") or "")[:6000]
        issuing_body = str(context.get("issuing_body") or "")
        key_services = context.get("key_services") or []
        key_requirements = context.get("key_requirements") or []
        key_dates = context.get("key_dates") or []
        reference_number = str(context.get("reference_number") or "")
        due_date = str(context.get("due_date") or "")
        org_name = str(org_context.get("name") or "Iron Eagle Security Limited")
        psa_licence = str(org_context.get("psa_licence") or "")
        nzbn = str(org_context.get("nzbn") or "")

        gen_label = "tender application" if generation_type == "application" else "tender response"
        services_str = ", ".join(str(s) for s in key_services) if key_services else "security services"
        reqs_str = "; ".join(str(r) for r in key_requirements) if key_requirements else ""
        org_line = f"Organisation: {org_name}" + (f" | PSA Licence: {psa_licence}" if psa_licence else "") + (f" | NZBN: {nzbn}" if nzbn else "")

        system = (
            "You are a professional tender writer for a New Zealand security and enforcement company. "
            "Write a complete, professional, and compelling " + gen_label + " in the voice of the organisation. "
            "Use NZ English. Be specific, confident, and compliance-focused. "
            "Structure the response as a JSON object with these exact section keys: "
            "{cover_letter, executive_summary, services_offered, pricing_notes, "
            "team_qualifications, health_and_safety, declaration}"
        )
        user_parts = [
            f"Tender document type: {gen_label}",
            f"Issuing body: {issuing_body}" if issuing_body else None,
            f"Reference number: {reference_number}" if reference_number else None,
            f"Due date: {due_date}" if due_date else None,
            f"Key services: {services_str}",
            f"Key requirements: {reqs_str}" if reqs_str else None,
            org_line,
        ]
        if extracted_text:
            user_parts.append(f"\nTender document extract (first 6000 chars):\n{extracted_text}")
        user_parts.append("\nGenerate all seven sections as JSON.")

        user_msg = "\n".join(p for p in user_parts if p)
        model = inp.get("model") or os.environ.get("OLLAMA_MODEL_WRITING") or OLLAMA_MODEL
        result = ollama_chat([
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ], model, 0.5)
        structured = None
        try:
            m = re.search(r"\{[\s\S]*\}", result["content"])
            if m:
                structured = json.loads(m.group(0))
        except Exception:
            pass
        sections = structured if isinstance(structured, dict) else {
            "cover_letter": result["content"],
            "executive_summary": "",
            "services_offered": "",
            "pricing_notes": "",
            "team_qualifications": "",
            "health_and_safety": "",
            "declaration": "",
        }
        return {
            "success": True,
            "sections": sections,
            "provider": "ollama",
            "model_used": result["model"],
            "references_used": False,
        }

    if action == "tender_train":
        # Record tender outcome as a training note (warm-worker memory only)
        payload = inp.get("payload") or inp
        outcome = str(payload.get("outcome") or "unknown")
        issuing_body = str(payload.get("issuing_body") or "")
        key_services = payload.get("key_services") or []
        outcome_notes = str(payload.get("outcome_notes") or "")
        rejection_reason = str(payload.get("rejection_reason") or "")

        note_parts = [
            f"Tender outcome: {outcome}",
            f"Issuing body: {issuing_body}" if issuing_body else None,
            f"Services: {', '.join(str(s) for s in key_services)}" if key_services else None,
            f"Outcome notes: {outcome_notes}" if outcome_notes else None,
            f"Rejection reason: {rejection_reason}" if rejection_reason else None,
        ]
        note = " | ".join(p for p in note_parts if p)
        note_count = remember_training_note(f"Tender training: {note}")
        return {
            "success": True,
            "message": "Tender training note recorded for this warm worker.",
            "runtime_training_notes": note_count,
            "provider": "worker-memory",
        }

    if action == "self_heal":
        # Analyse a bug report and produce a structured self-healing plan
        report = inp.get("report") or {}
        summary = str(report.get("summary") or inp.get("summary") or inp.get("description") or "").strip()
        if not summary:
            return {"success": False, "error": "report.summary or description required"}

        severity = str(report.get("severity") or "medium")
        issue_type = str(report.get("issue_type") or "bug")
        current_page = str(report.get("current_page") or "unknown")
        user_role = str(report.get("user_role") or "unknown")
        steps = str(report.get("steps_to_reproduce") or "")
        expected = str(report.get("expected_behavior") or "")
        actual = str(report.get("actual_behavior") or "")
        ci_status = str(report.get("ci_status") or "unavailable")
        console_errors = report.get("console_errors") or []
        nav = report.get("navigation") or []

        console_str = "\n".join(f"- [{e.get('level','error')}] {e.get('message','')}" for e in console_errors[-5:]) or "(none)"
        nav_str = "\n".join(f"- {n.get('path','?')} @ {n.get('timestamp','?')}" for n in nav[-5:]) or "(none)"

        user_msg = (
            f"Bug Report Analysis for FieldOps Manager (NZ freedom camping enforcement platform)\n\n"
            f"Type: {issue_type} | Severity: {severity} | Page: {current_page} | Role: {user_role}\n\n"
            f"Issue: {summary}\n"
            + (f"Steps: {steps}\n" if steps else "")
            + (f"Expected: {expected}\n" if expected else "")
            + (f"Actual: {actual}\n" if actual else "")
            + f"\nRecent Console Errors:\n{console_str}\n\nRecent Navigation:\n{nav_str}\n\nCI Status:\n{ci_status}\n\n"
            "Respond ONLY in JSON with keys: "
            "{severity, bug_type, recommended_owner, reproduction: [], remediation: [], safeguards: [], "
            "automation: [{action, enabled, detail}], legal_note}"
        )
        result = ollama_chat([
            {"role": "system", "content": (
                "You are a software bug triage AI for FieldOps Manager — a React/TypeScript SPA backed by "
                "Supabase (Postgres, Edge Functions) and Ollama on RunPod. "
                "Analyse the bug report and provide a structured self-healing plan. "
                "Be specific and actionable. Reference the tech stack (React 18, TanStack Query, Zustand, "
                "Supabase RLS, Deno edge functions, Vite). "
                "Respond ONLY in valid JSON."
            )},
            {"role": "user", "content": user_msg},
        ], inp.get("model"), 0.2)
        structured = None
        try:
            m = re.search(r"\{[\s\S]*\}", result["content"])
            if m:
                structured = json.loads(m.group(0))
        except Exception:
            pass
        plan = structured or {"severity": severity, "bug_type": issue_type, "remediation": [result["content"]]}
        return {
            "success": True,
            "plan": plan,
            "raw_response": result["content"],
            "model": result["model"],
            "provider": "ollama-self-heal",
        }

    if action == "ui_vision":
        image_b64 = inp.get("image_b64")  # base64-encoded PNG/JPG
        if not image_b64:
            return {"success": False, "error": "image_b64 required"}
        focus = inp.get("focus", "general")
        focus_prompts = {
            "general":       "You are a UI/UX expert. Describe what you see in this screenshot. Identify usability issues, layout problems, cluttered areas, hard-to-read text, or anything that would frustrate a field officer using this on a mobile device. Be specific and actionable. Respond in JSON: {summary, issues: [{area, severity, description, suggestion}], overall_score_out_of_10, top_3_improvements}",
            "accessibility": "You are an accessibility expert. Review this UI screenshot for WCAG compliance issues: contrast ratios, text size, touch target sizes, visual hierarchy, and colour-only information. Respond in JSON: {summary, issues: [{area, severity, description, suggestion}], overall_score_out_of_10, top_3_improvements}",
            "mobile":        "You are a mobile UX expert. Review this UI for mobile usability: thumb-reach zones, touch target sizes, text legibility on small screens, scroll behaviour, and whether a field officer could use this with one hand at night. Respond in JSON: {summary, issues: [{area, severity, description, suggestion}], overall_score_out_of_10, top_3_improvements}",
            "clutter":       "You are a minimalist UI designer. Identify areas of visual clutter, information overload, poor whitespace usage, and unnecessary UI elements in this screenshot. Respond in JSON: {summary, issues: [{area, severity, description, suggestion}], overall_score_out_of_10, top_3_improvements}",
        }
        prompt = focus_prompts.get(focus, focus_prompts["general"])
        context = inp.get("context", "")
        if context:
            prompt = f"Context: {context}\n\n{prompt}"
        try:
            result = ollama_vision_chat(prompt, image_b64, inp.get("vision_model"))
            structured = None
            try:
                m = re.search(r"\{[\s\S]*\}", result["content"])
                if m:
                    structured = json.loads(m.group(0))
            except Exception:
                pass
            return {
                "success": True,
                "focus": focus,
                "analysis": structured or result["content"],
                "raw_response": result["content"],
                "model": result["model"],
                "provider": "ollama_vision",
            }
        except Exception as e:
            return {"success": False, "error": f"Vision analysis failed: {str(e)}", "provider": "ollama_vision"}

    if action == "run_playwright":
        specs = inp.get("specs") or []
        scope = inp.get("scope", "quick")
        timeout_ms = int(inp.get("timeout_ms", 120000))
        reporter = inp.get("reporter", "json")
        forwarded_runtime_env = {}
        for k, v in inp.items():
            if not isinstance(k, str) or not isinstance(v, str):
                continue
            if not v:
                continue
            if (
                k.startswith("PLAYWRIGHT_")
                or k.startswith("E2E_")
                or k.startswith("API_TEST_")
                or k.startswith("SUPABASE_")
                or k.startswith("VITE_")
                or k.startswith("NEXT_PUBLIC_")
                or k.startswith("RADIO_")
                or k.startswith("PTT_")
                or k.startswith("RUNPOD_")
            ):
                forwarded_runtime_env[k] = v
        for k in [
            "VITE_SUPABASE_URL",
            "VITE_SUPABASE_ANON_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_URL",
            "SUPABASE_ANON_KEY",
            "DEFAULT_PLAYWRIGHT_BASE_URL",
            "PLAYWRIGHT_BASE_URL",
            "INFERENCE_SERVICE_URL",
            "INFERENCE_API_KEY",
            "SYNTHETIC_MONITOR_USER_ID",
        ]:
            val = inp.get(k)
            if isinstance(val, str) and val:
                forwarded_runtime_env[k] = val
        # Optional repo clone/pull from job input — allows CI to trigger fresh tests
        # without rebuilding the worker image.
        repo_url = inp.get("repo_url") or os.environ.get("GITHUB_REPO_URL", "")
        repo_branch = inp.get("repo_branch") or os.environ.get("GITHUB_REPO_BRANCH", "main")
        repo_token = inp.get("repo_token") or os.environ.get("GITHUB_TOKEN", "")
        repo_auth_mode = (inp.get("repo_auth_mode") or "token").strip().lower()
        repo_dir = "/app/repo"

        if repo_url:
            auth_url = repo_url
            # token mode: worker embeds token; url-token mode: URL already carries credentials
            if repo_token and repo_auth_mode == "token" and repo_url.startswith("https://github.com/"):
                encoded_token = urllib.parse.quote(repo_token, safe='')
                auth_url = repo_url.replace(
                    "https://github.com/",
                    f"https://x-access-token:{encoded_token}@github.com/",
                )
            try:
                if os.path.isdir(os.path.join(repo_dir, ".git")):
                    print(f"[worker] Updating repo at {repo_dir} branch={repo_branch}")
                    try:
                        subprocess.run(
                            ["git", "-C", repo_dir, "fetch", "origin", repo_branch, "--depth=1"],
                            check=True,
                            capture_output=True,
                            timeout=120,
                            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                        )
                    except subprocess.CalledProcessError:
                        if auth_url != repo_url:
                            print("[worker] Auth fetch failed; retrying with public URL")
                            subprocess.run(
                                ["git", "-C", repo_dir, "remote", "set-url", "origin", repo_url],
                                check=True,
                                capture_output=True,
                                timeout=30,
                            )
                            subprocess.run(
                                ["git", "-C", repo_dir, "fetch", "origin", repo_branch, "--depth=1"],
                                check=True,
                                capture_output=True,
                                timeout=120,
                                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                            )
                        else:
                            raise
                    subprocess.run(
                        ["git", "-C", repo_dir, "reset", "--hard", f"origin/{repo_branch}"],
                        check=True,
                        capture_output=True,
                        timeout=30,
                    )
                else:
                    print(f"[worker] Cloning repo into {repo_dir} branch={repo_branch}")
                    try:
                        subprocess.run(
                            ["git", "clone", "--depth=1", "--branch", repo_branch, auth_url, repo_dir],
                            check=True,
                            capture_output=True,
                            timeout=300,
                            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                        )
                    except subprocess.CalledProcessError:
                        if auth_url != repo_url:
                            print("[worker] Auth clone failed; retrying with public URL")
                            subprocess.run(
                                ["git", "clone", "--depth=1", "--branch", repo_branch, repo_url, repo_dir],
                                check=True,
                                capture_output=True,
                                timeout=300,
                                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                            )
                        else:
                            raise

                pkg_json = os.path.join(repo_dir, "package.json")
                node_mod = os.path.join(repo_dir, "node_modules")
                if os.path.exists(pkg_json) and not os.path.isdir(node_mod):
                    print("[worker] Installing repo Node deps...")
                    has_bun_lock = os.path.exists(os.path.join(repo_dir, "bun.lock")) or os.path.exists(os.path.join(repo_dir, "bun.lockb"))
                    has_pkg_lock = os.path.exists(os.path.join(repo_dir, "package-lock.json"))
                    if has_bun_lock and shutil.which("bun"):
                        # Respect Bun-first repos to avoid npm peer resolution drift.
                        subprocess.run(
                            ["bun", "install", "--frozen-lockfile"],
                            cwd=repo_dir,
                            check=False,
                            capture_output=True,
                            timeout=420,
                        )
                    elif has_pkg_lock:
                        subprocess.run(
                            ["npm", "ci", "--legacy-peer-deps", "--silent"],
                            cwd=repo_dir,
                            check=False,
                            capture_output=True,
                            timeout=420,
                        )
                    else:
                        subprocess.run(
                            ["npm", "install", "--legacy-peer-deps", "--silent"],
                            cwd=repo_dir,
                            check=False,
                            capture_output=True,
                            timeout=420,
                        )

                # Write .env for tests. Include fixed runtime keys plus prefixed
                # role credentials so Playwright auth preflight can pass.
                env_lines = []
                env_values = {}
                fixed_keys = [
                    "VITE_SUPABASE_URL",
                    "VITE_SUPABASE_ANON_KEY",
                    "SUPABASE_SERVICE_ROLE_KEY",
                    "SUPABASE_URL",
                    "SUPABASE_ANON_KEY",
                    "INFERENCE_SERVICE_URL",
                    "INFERENCE_API_KEY",
                    "DEFAULT_PLAYWRIGHT_BASE_URL",
                    "PLAYWRIGHT_BASE_URL",
                    "SYNTHETIC_MONITOR_USER_ID",
                ]
                for k in fixed_keys:
                    v = inp.get(k) or os.environ.get(k, "")
                    if v:
                        env_values[k] = v

                for k, v in inp.items():
                    if not isinstance(k, str):
                        continue
                    if not isinstance(v, str):
                        continue
                    if not v:
                        continue
                    if (
                        k.startswith("PLAYWRIGHT_")
                        or k.startswith("E2E_")
                        or k.startswith("API_TEST_")
                        or k.startswith("SUPABASE_")
                        or k.startswith("VITE_")
                        or k.startswith("NEXT_PUBLIC_")
                        or k.startswith("RADIO_")
                        or k.startswith("PTT_")
                        or k.startswith("RUNPOD_")
                    ):
                        env_values[k] = v

                for k, v in env_values.items():
                    env_lines.append(f"{k}={v}")
                if env_lines:
                    with open(os.path.join(repo_dir, ".env"), "w") as ef:
                        ef.write("\n".join(env_lines) + "\n")

                print(f"[worker] Repo ready at {repo_dir}")
            except subprocess.CalledProcessError as ce:
                err = (ce.stderr or b"").decode()[-500:]
                print(f"[worker] Repo clone/pull failed: {err}")
                return {"success": False, "error": f"Repo clone failed: {err}", "provider": "playwright-runner"}
            except Exception as re_exc:
                print(f"[worker] Repo setup error: {re_exc}")
                return {"success": False, "error": str(re_exc), "provider": "playwright-runner"}

        working_dir = inp.get("working_dir") or (
            repo_dir if os.path.isdir(repo_dir) else "/app"
        )

        # Build playwright command
        cmd = ["npx", "playwright", "test", "--reporter", reporter]
        if specs:
            cmd += specs
        else:
            # scope presets
            scope_map = {
                "quick":     ["--grep", "@smoke", "--timeout", "30000"],
                "core":      ["tests/"],
                "workflows": ["tests/workflows/"],
                "visual":    ["tests/visual/"],
                "human":     ["tests/human/"],
                "full":      [],
            }
            cmd += scope_map.get(scope, [])

        cmd += ["--timeout", str(timeout_ms)]

        print(f"[worker] run_playwright scope={scope} cmd={' '.join(cmd)}")

        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            output_path = tmp.name

        def _run_playwright(run_cmd):
            return subprocess.run(
                run_cmd,
                capture_output=True,
                text=True,
                cwd=working_dir,
                timeout=timeout_ms // 1000 + 60,
                env={
                    **os.environ,
                    **forwarded_runtime_env,
                    "PLAYWRIGHT_JSON_OUTPUT_NAME": output_path,
                },
            )

        try:
            result_proc = _run_playwright(cmd)

            no_tests_msg = "No tests found"
            stdout_probe = result_proc.stdout or ""
            stderr_probe = result_proc.stderr or ""
            if (
                result_proc.returncode != 0
                and not specs
                and scope == "quick"
                and (no_tests_msg in stdout_probe or no_tests_msg in stderr_probe)
            ):
                # Fallback for repos that do not tag smoke tests with @smoke.
                fallback_cmd = ["npx", "playwright", "test", "tests/", "--reporter", reporter, "--timeout", str(timeout_ms)]
                print("[worker] quick scope found no tagged tests, retrying with tests/")
                result_proc = _run_playwright(fallback_cmd)

            stdout = result_proc.stdout[-8000:] if len(result_proc.stdout) > 8000 else result_proc.stdout
            stderr = result_proc.stderr[-4000:] if len(result_proc.stderr) > 4000 else result_proc.stderr
            exit_code = result_proc.returncode

            # Parse JSON report if available
            report_data = None
            try:
                with open(output_path, "r") as f:
                    report_data = json.load(f)
            except Exception:
                pass

            # Summarise for response
            passed = failed = skipped = 0
            failures = []
            if report_data and isinstance(report_data, dict):
                stats = report_data.get("stats", {})
                passed = stats.get("expected", 0)
                failed = stats.get("unexpected", 0)
                skipped = stats.get("skipped", 0)
                for suite in report_data.get("suites", []):
                    for spec in suite.get("specs", []):
                        for test in spec.get("tests", []):
                            if test.get("status") in ("unexpected", "failed"):
                                failures.append({
                                    "title": spec.get("title", ""),
                                    "file": spec.get("file", ""),
                                    "error": (test.get("results") or [{}])[-1].get("error", {}).get("message", ""),
                                })
                failures = failures[:20]  # cap at 20

            success = exit_code == 0
            print(f"[worker] run_playwright done — exit={exit_code} passed={passed} failed={failed}")

            return {
                "success": success,
                "exit_code": exit_code,
                "scope": scope,
                "stats": {"passed": passed, "failed": failed, "skipped": skipped},
                "failures": failures,
                "stdout_tail": stdout,
                "stderr_tail": stderr,
                "provider": "playwright-runner",
            }

        except subprocess.TimeoutExpired:
            return {"success": False, "error": f"Playwright run timed out after {timeout_ms}ms", "provider": "playwright-runner"}
        except FileNotFoundError:
            return {"success": False, "error": "npx/playwright not found in PATH — Node.js not installed in this worker image", "provider": "playwright-runner"}
        except Exception as exc:
            return {"success": False, "error": str(exc), "provider": "playwright-runner"}
        finally:
            try:
                import os as _os
                _os.unlink(output_path)
            except Exception:
                pass

    return {"success": False, "error": f"Unknown action: {action}"}


runpod.serverless.start({"handler": handler})
