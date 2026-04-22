"""
RunPod Serverless Worker — FieldOps AI Engine (Bob)
Uses official runpod Python SDK which handles heartbeats, job fetching, and result posting.

OLLAMA_BASE_URL resolution order:
  1. OLLAMA_EXTERNAL_URL — use an external Ollama (Railway, VPS, etc.) bypassing localhost
  2. OLLAMA_BASE_URL     — explicit base URL (default: http://127.0.0.1:11434)
Chat endpoint: tries /api/chat first (Ollama >=0.1.14); falls back to /api/generate for older builds.
"""

import os
import json
import requests
import runpod

# Allow an external Ollama URL to override the default localhost.
# Set OLLAMA_EXTERNAL_URL on the RunPod endpoint environment when the
# co-located Ollama pod is unavailable or not yet loaded.
_ext = os.environ.get("OLLAMA_EXTERNAL_URL", "").strip().rstrip("/")
OLLAMA_BASE         = _ext if _ext else os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL        = os.environ.get("OLLAMA_MODEL", "llama3.1:8b")
OLLAMA_VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "llama3.2-vision:11b")
TIMEOUT_S           = int(os.environ.get("OLLAMA_TIMEOUT_MS", "120000")) // 1000

print(f"[worker] FieldOps AI Worker (Python/runpod) starting")
print(f"[worker] OLLAMA_BASE: {OLLAMA_BASE} ({'external' if _ext else 'local'})")
print(f"[worker] OLLAMA_MODEL: {OLLAMA_MODEL}")
print(f"[worker] OLLAMA_VISION_MODEL: {OLLAMA_VISION_MODEL}")

# Probe Ollama at startup so failures are visible in worker logs, not per-job.
try:
    _probe = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=10)
    _models = [m.get("name") for m in _probe.json().get("models", [])]
    print(f"[worker] Ollama probe OK — models available: {_models or 'none listed'}")
except Exception as _e:
    print(f"[worker] WARNING: Ollama probe failed at startup — {_e}")
    print(f"[worker] Jobs will fail until Ollama is reachable at {OLLAMA_BASE}")
    print(f"[worker] To use an external Ollama, set OLLAMA_EXTERNAL_URL on the RunPod endpoint.")

BOB_SYSTEM = (
    "You are Bob, the AI assistant for FieldOps Manager — a freedom camping "
    "enforcement platform in New Zealand. Be concise and actionable."
)


def _extract_content_from_generate(data):
    """Extract text from /api/generate response format."""
    return data.get("response", "")


def ollama_chat(messages, model=None, temperature=0.7):
    """Call Ollama. Tries /api/chat (modern) then falls back to /api/generate (older builds)."""
    used_model = model or OLLAMA_MODEL
    payload_chat = {
        "model": used_model,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature},
    }
    try:
        resp = requests.post(f"{OLLAMA_BASE}/api/chat", json=payload_chat, timeout=TIMEOUT_S)
        if resp.status_code == 404:
            raise ValueError("api/chat not found — will try /api/generate fallback")
        resp.raise_for_status()
        data = resp.json()
        content = data.get("message", {}).get("content", "")
        if not content:
            raise ValueError("Ollama /api/chat returned empty content")
        return {"content": content, "model": data.get("model", used_model)}
    except (ValueError, requests.exceptions.HTTPError) as chat_err:
        print(f"[worker] /api/chat failed ({chat_err}); falling back to /api/generate")
        # Build a single prompt from messages for the generate endpoint
        prompt = "\n".join(
            f"{'System' if m['role'] == 'system' else m['role'].capitalize()}: {m['content']}"
            for m in messages
        ) + "\nAssistant:"
        resp2 = requests.post(
            f"{OLLAMA_BASE}/api/generate",
            json={"model": used_model, "prompt": prompt, "stream": False,
                  "options": {"temperature": temperature}},
            timeout=TIMEOUT_S,
        )
        resp2.raise_for_status()
        data2 = resp2.json()
        content2 = _extract_content_from_generate(data2)
        if not content2:
            raise ValueError("Ollama /api/generate returned empty response field")
        return {"content": content2, "model": data2.get("model", used_model)}


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
            "message": "AI Engine online" if ollama_ok else "AI Engine online but Ollama unreachable",
            "ollama_reachable": ollama_ok,
            "ollama_base": OLLAMA_BASE,
            "models_available": available,
            "model": OLLAMA_MODEL,
            "provider": "ollama",
        }

    if action == "chat":
        message = inp.get("message")
        if not message:
            return {"success": False, "error": "message required"}
        messages = [
            {"role": "system", "content": inp.get("system_prompt") or BOB_SYSTEM},
            *(inp.get("history") or []),
            {"role": "user", "content": message},
        ]
        result = ollama_chat(messages, inp.get("model"), inp.get("temperature", 0.7))
        return {"success": True, "response": result["content"], "message": result["content"],
                "model": result["model"], "provider": "ollama"}

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
