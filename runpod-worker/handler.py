"""
RunPod Serverless Worker — FieldOps AI Engine (Bob)
Uses official runpod Python SDK which handles heartbeats, job fetching, and result posting.
"""

import os
import json
import requests
import runpod

OLLAMA_BASE  = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1:8b")
TIMEOUT_S    = int(os.environ.get("OLLAMA_TIMEOUT_MS", "120000")) // 1000

print(f"[worker] FieldOps AI Worker (Python/runpod) starting")
print(f"[worker] OLLAMA_BASE: {OLLAMA_BASE}")
print(f"[worker] OLLAMA_MODEL: {OLLAMA_MODEL}")

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


def handler(job):
    inp = job.get("input") or {}
    action = inp.get("action", "chat")
    print(f"[worker] action={action} job={job.get('id','?')}")

    if action == "ping":
        return {"success": True, "message": "AI Engine online", "model": OLLAMA_MODEL, "provider": "ollama"}

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

    return {"success": False, "error": f"Unknown action: {action}"}


runpod.serverless.start({"handler": handler})
