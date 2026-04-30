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
import shutil
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
OPENAI_REFERENCE_GATE_ENABLED = os.environ.get("OPENAI_REFERENCE_GATE_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
ALLOW_OPENAI_REFERENCE_PROVIDER = os.environ.get("ALLOW_OPENAI_REFERENCE_PROVIDER", "false").strip().lower() in {"1", "true", "yes", "on"}

print(f"[worker] FieldOps AI Worker (Python/runpod) starting")
print(f"[worker] OLLAMA_BASE: {OLLAMA_BASE} ({'external' if _ext else 'local'})")
print(f"[worker] OLLAMA_MODEL: {OLLAMA_MODEL}")
print(f"[worker] OLLAMA_VISION_MODEL: {OLLAMA_VISION_MODEL}")
print(f"[worker] BOB_ATTITUDE_PROFILE: {BOB_ATTITUDE_PROFILE}")
print(f"[worker] OPENAI_REFERENCE_GATE_ENABLED: {OPENAI_REFERENCE_GATE_ENABLED}")
print(f"[worker] ALLOW_OPENAI_REFERENCE_PROVIDER: {ALLOW_OPENAI_REFERENCE_PROVIDER}")

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


def wants_openai_provider(inp):
    provider = str(inp.get("provider") or "").strip().lower()
    model = str(inp.get("model") or "").strip().lower()
    return provider in {"openai", "chatgpt"} or model.startswith("gpt-")


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
    # Prefer /api/chat, but fall back to /api/generate for older Ollama builds.
    chat_payload = {
        "model": model or OLLAMA_MODEL,
        "messages": messages,
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
            "model": model or OLLAMA_MODEL,
            "prompt": _messages_to_prompt(messages),
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
            raise ValueError("Ollama /api/generate returned empty content")
        return {"content": gen_content, "model": gen_data.get("model", model or OLLAMA_MODEL)}

    resp.raise_for_status()
    data = resp.json()
    content = data.get("message", {}).get("content", "")
    if not content:
        raise ValueError("Ollama returned empty content")
    return {"content": content, "model": data.get("model", model or OLLAMA_MODEL)}


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


def handler(job):
    inp = job.get("input") or {}
    action = inp.get("action", "chat")
    print(f"[worker] action={action} job={job.get('id','?')}")
    role = detect_role(action, inp)

    if OPENAI_REFERENCE_GATE_ENABLED and not ALLOW_OPENAI_REFERENCE_PROVIDER and wants_openai_provider(inp):
        return {
            "success": False,
            "error": "OpenAI reference provider requests are disabled by policy on this worker. Use ollama/inference providers.",
            "provider": "policy-enforcer",
            "openai_reference_gate_enabled": OPENAI_REFERENCE_GATE_ENABLED,
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

    if action == "run_playwright":
        import subprocess
        import tempfile

        specs = inp.get("specs") or []
        scope = inp.get("scope", "quick")
        timeout_ms = int(inp.get("timeout_ms", 120000))
        reporter = inp.get("reporter", "json")
        # Optional repo clone/pull from job input — allows CI to trigger fresh tests
        # without rebuilding the worker image.
        repo_url = inp.get("repo_url") or os.environ.get("GITHUB_REPO_URL", "")
        repo_branch = inp.get("repo_branch") or os.environ.get("GITHUB_REPO_BRANCH", "main")
        repo_token = inp.get("repo_token") or os.environ.get("GITHUB_TOKEN", "")
        repo_dir = "/app/repo"

        if repo_url:
            auth_url = repo_url
            if repo_token:
                auth_url = repo_url.replace("https://", f"https://{repo_token}@")
            try:
                if os.path.isdir(os.path.join(repo_dir, ".git")):
                    print(f"[worker] Updating repo at {repo_dir} branch={repo_branch}")
                    subprocess.run(
                        ["git", "-C", repo_dir, "fetch", "origin", repo_branch, "--depth=1"],
                        check=True,
                        capture_output=True,
                        timeout=120,
                        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                    )
                    subprocess.run(
                        ["git", "-C", repo_dir, "reset", "--hard", f"origin/{repo_branch}"],
                        check=True,
                        capture_output=True,
                        timeout=30,
                    )
                else:
                    print(f"[worker] Cloning repo into {repo_dir} branch={repo_branch}")
                    subprocess.run(
                        ["git", "clone", "--depth=1", "--branch", repo_branch, auth_url, repo_dir],
                        check=True,
                        capture_output=True,
                        timeout=300,
                        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
                    )

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
                    "INFERENCE_SERVICE_URL",
                    "INFERENCE_API_KEY",
                    "DEFAULT_PLAYWRIGHT_BASE_URL",
                    "PLAYWRIGHT_BASE_URL",
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
                    if k.startswith("PLAYWRIGHT_") or k.startswith("E2E_") or k.startswith("API_TEST_"):
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
                env={**os.environ, "PLAYWRIGHT_JSON_OUTPUT_NAME": output_path},
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
