"""
RunPod Serverless Worker — FieldOps AI Engine (Bob)
Uses official runpod Python SDK which handles heartbeats, job fetching, and result posting.

OLLAMA_BASE_URL resolution order:
  1. OLLAMA_EXTERNAL_URL — point at an external Ollama (Railway, VPS, etc.)
  2. OLLAMA_BASE_URL     — explicit base URL (default: http://127.0.0.1:11434)

Requires Ollama >= 0.3.x for /api/chat support (pinned in Dockerfile via OLLAMA_VERSION).
"""

import os
import json
import requests
import runpod

# Allow an external Ollama URL to override localhost.
# Useful when the RunPod endpoint needs to call a separately-hosted Ollama
# (e.g. Railway service) without rebuilding the image.
_ext = os.environ.get("OLLAMA_EXTERNAL_URL", "").strip().rstrip("/")
OLLAMA_BASE         = _ext if _ext else os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL        = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
OLLAMA_VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "llama3.2-vision:11b")
BOB_ATTITUDE_PROFILE = os.environ.get("BOB_ATTITUDE_PROFILE", "operational").strip().lower()
BOB_ATTITUDE_INSTRUCTIONS = os.environ.get("BOB_ATTITUDE_INSTRUCTIONS", "").strip()
TIMEOUT_S           = int(os.environ.get("OLLAMA_TIMEOUT_MS", "120000")) // 1000
TRAINING_MEMORY_PATH = os.environ.get("TRAINING_MEMORY_PATH", os.path.join(os.path.dirname(__file__), "training_memory.json"))
MAX_RUNTIME_NOTES = 8

print(f"[worker] FieldOps AI Worker (Python/runpod) starting")
print(f"[worker] OLLAMA_BASE: {OLLAMA_BASE} ({'external' if _ext else 'local'})")
print(f"[worker] OLLAMA_MODEL: {OLLAMA_MODEL}")
print(f"[worker] OLLAMA_VISION_MODEL: {OLLAMA_VISION_MODEL}")
print(f"[worker] BOB_ATTITUDE_PROFILE: {BOB_ATTITUDE_PROFILE}")

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

# Probe Ollama at startup so failures are visible in worker logs immediately,
# not discovered mid-job. This is diagnostic only — the worker still starts.
try:
    _probe = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=10)
    _models = [m.get("name") for m in _probe.json().get("models", [])]
    print(f"[worker] Ollama probe OK — models: {_models or '(none listed)'}")
except Exception as _e:
    print(f"[worker] WARNING: Ollama probe failed — {_e}")
    print(f"[worker] Ensure Ollama >= 0.3.x is running at {OLLAMA_BASE}")
    print(f"[worker] To use an external instance, set OLLAMA_EXTERNAL_URL on the endpoint.")

BOB_SYSTEM = (
    "You are Bob, the AI assistant for FieldOps Manager — a freedom camping "
    "enforcement platform in New Zealand. Be concise and actionable."
)


def ollama_chat(messages, model=None, temperature=0.7):
    resp = requests.post(
        f"{OLLAMA_BASE}/api/chat",
        json={"model": model or OLLAMA_MODEL, "messages": messages, "stream": False,
              "options": {"temperature": temperature}},
        timeout=TIMEOUT_S,
    )
    resp.raise_for_status()
    data = resp.json()
    content = data.get("message", {}).get("content", "")
    if not content:
        raise ValueError("Ollama returned empty content")
    return {"content": content, "model": data.get("model", OLLAMA_MODEL)}


def ollama_vision_chat(prompt, image_b64, model=None, temperature=0.2):
    """Send an image + prompt to the vision model. image_b64 is a base64-encoded image string."""
    resp = requests.post(
        f"{OLLAMA_BASE}/api/chat",
        json={
            "model": model or OLLAMA_VISION_MODEL,
            "messages": [{"role": "user", "content": prompt, "images": [image_b64]}],
            "stream": False,
            "options": {"temperature": temperature},
        },
        timeout=TIMEOUT_S,
    )
    resp.raise_for_status()
    data = resp.json()
    content = data.get("message", {}).get("content", "")
    if not content:
        raise ValueError("Vision model returned empty content")
    return {"content": content, "model": data.get("model", OLLAMA_VISION_MODEL)}


def handler(job):
    inp = job.get("input") or {}
    action = inp.get("action", "chat")
    print(f"[worker] action={action} job={job.get('id','?')}")
    role = detect_role(action, inp)

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
            "provider": "ollama",
        }

    if action == "training_note":
        note = inp.get("message") or inp.get("prompt") or ""
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
        messages = [
            {"role": "system", "content": build_system_prompt(role, inp.get("system_prompt") or BOB_SYSTEM)},
            *(inp.get("history") or []),
            {"role": "user", "content": message},
        ]
        result = ollama_chat(messages, inp.get("model"), inp.get("temperature", 0.7))
        return {"success": True, "response": result["content"], "message": result["content"],
                "model": result["model"], "provider": "ollama"}

    if action == "review":
        message = inp.get("message") or inp.get("prompt")
        if not message:
            return {"success": False, "error": "message or prompt required"}
        result = ollama_chat([
            {"role": "system", "content": build_system_prompt("dr_bob", inp.get("system_prompt"))},
            {"role": "user", "content": message},
        ], inp.get("model"), inp.get("temperature", 0.2))
        return {
            "success": True,
            "response": result["content"],
            "message": result["content"],
            "model": result["model"],
            "provider": "ollama-review",
        }

    if action == "assess":
        text = inp.get("symptom") or inp.get("description") or inp.get("imageDescription")
        if not text:
            return {"success": False, "error": "symptom or description required"}
        type_ = inp.get("type", "general")
        sys_map = {
            "smoke":       "Assess for biosecurity risk.",
            "biosecurity": "Assess for biosecurity risk.",
            "noise":       "Assess noise complaint severity and recommended enforcement action.",
            "ptt":         "Diagnose PTT radio issue with troubleshooting steps.",
            "platform":    "Assess system health symptom and recommend resolution.",
        }
        result = ollama_chat([
            {"role": "system", "content": sys_map.get(type_, "Provide a structured assessment.")},
            {"role": "user", "content": f"{text}\n\nRespond in JSON: {{severity, summary, recommendation, actions}}"},
        ], inp.get("model"), 0.3)
        structured = None
        try:
            import re
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
        langs = {"zh": "Chinese (Simplified)", "ja": "Japanese", "ko": "Korean",
                 "mi": "Te Reo Maori", "fr": "French", "de": "German", "es": "Spanish"}
        target = inp.get("target_language", "en")
        target_name = langs.get(target, target)
        result = ollama_chat([
            {"role": "system", "content": f"Translate to {target_name}. Return only the translation."},
            {"role": "user", "content": text},
        ], inp.get("model"), 0.1)
        return {"success": True, "translation": result["content"], "translated_text": result["content"],
                "target_language": target, "model": result["model"], "provider": "ollama"}

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
                import re
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

    return {"success": False, "error": f"Unknown action: {action}"}


runpod.serverless.start({"handler": handler})
