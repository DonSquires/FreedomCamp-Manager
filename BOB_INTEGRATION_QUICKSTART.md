# Bob RunPod Integration — Unified Setup Guide

**Date**: April 28, 2026  
**Status**: Integration complete — ready for configuration  
**Integration with**: Existing Bob inference-service + RunPod Serverless

---

## What We've Set Up

You now have **three deployment options** for Bob, working together seamlessly:

### 1. **Local Bob** (inference-service/)
- Running on your machine or Codespace
- Port: `http://localhost:3000`
- Models: Qwen2.5 7B, Llama3.2-Vision 11B
- Latency: ~200-500ms
- Cost: $0 (your hardware)

### 2. **RunPod Serverless Bob**
- Endpoint: `https://api.runpod.ai/v2/n0bp1ifmq01cx2`
- Autoscaling: 0 → N workers
- Latency: ~2-5s (includes queue time)
- Cost: $0.0001 per second active + network
- Use case: High throughput, burst workloads

### 3. **Hybrid Bob** (Automatic)
- Tries local first → Falls back to RunPod
- Best of both: low latency + unlimited scale
- Recommended for production

---

## Quick Start (5 minutes)

### Step 1: Add RunPod Credentials to GitHub Codespace

1. Go to **GitHub** → Your repo → **Settings** → **Secrets and Variables** → **Codespaces**
2. Add these secrets:
   ```
   INFERENCE_SERVICE_URL = https://api.runpod.ai/v2/n0bp1ifmq01cx2
   INFERENCE_API_KEY = rpa_<your-runpod-api-key>
   RUNPOD_ENDPOINT_ID = n0bp1ifmq01cx2
   ```

3. Restart your Codespace (or create a new one)

### Step 2: Initialize Bob Integration

```bash
cd /workspaces/FreedomCamp-Manager

# Load your RunPod credentials (auto-injected from GitHub Secrets in Codespace)
echo "INFERENCE_SERVICE_URL=$INFERENCE_SERVICE_URL"
echo "INFERENCE_API_KEY=${INFERENCE_API_KEY:0:15}... (masked)"

# Run the bootstrap (hybrid mode by default)
bash scripts/bob-bootstrap-runpod.sh --full
```

### Step 3: Load Bob Configuration

```bash
# Load the unified configuration
source .runtime/bob-unified.env

# Test RunPod connection
curl -X POST "${INFERENCE_SERVICE_URL_RUNPOD}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"hi"}}'
```

### Step 4: Chat with Bob

```bash
# Easy: Interactive mode
node scripts/bob-direct-chat.mjs

# Or: One-off question
node scripts/bob-direct-chat.mjs "What is the /admin route?"

# Or: Use local Bob directly (if running)
npm --prefix ./inference-service start
curl http://localhost:3000/health
```

---

## Backend Configuration

### Switch to Pure Local (Low Latency)
```bash
# Edit .runtime/bob-unified.env and set:
export BOB_INFERENCE_BACKEND="local-inference-service"
export INFERENCE_SERVICE_URL="http://localhost:3000"

# Start local Bob:
npm --prefix ./inference-service start
```

### Switch to Pure RunPod (Scalable)
```bash
# Edit .runtime/bob-unified.env and set:
export BOB_INFERENCE_BACKEND="runpod-serverless"
export INFERENCE_SERVICE_URL="https://api.runpod.ai/v2/n0bp1ifmq01cx2"

# Make sure INFERENCE_API_KEY is set
```

### Stay in Hybrid (Recommended)
```bash
# .runtime/bob-unified.env already configured:
export BOB_INFERENCE_BACKEND="local-inference-service"  # Try local first
export BOB_FALLBACK_TO_RUNPOD="1"                       # Fall back if local unavailable

# Both endpoints need to be reachable
```

---

## Files Created

| File | Purpose |
|---|---|
| `.runtime/bob-unified.env` | Master configuration (use this) |
| `.runtime/bob-local-backend.env` | Local-only config |
| `.runtime/bob-runpod-backend.env` | RunPod-only config |
| `.runtime/bob-hybrid-backend.env` | Hybrid with fallback |
| `scripts/bob-bootstrap-runpod.sh` | One-command setup |
| `scripts/bob-direct-chat.mjs` | Interactive Bob chat |
| `docs/BOB_RUNPOD_FULL_SETUP.md` | Detailed reference |

---

## Using Bob in Tests

### Run Tests with Bob's Help

```bash
# Bob will analyze test failures and suggest fixes
npm run test

# Or specific test suite:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
node node_modules/playwright/cli.js test tests/e2e/visual-regression.spec.ts
```

Bob's training will:
- ✓ Understand the codebase structure
- ✓ Map routes to components
- ✓ Check auth flow logic
- ✓ Validate DB schema
- ✓ Suggest fixes for failures

---

## Bob's Knowledge Base

Bob is trained on:

1. **Architecture** (docs/adr/)
   - All design decisions documented
   - Tech stack specifications
   - Multi-org architecture

2. **Code Conventions**
   - TypeScript strict/lenient rules
   - Component patterns (page, hook, feature)
   - Database migrations (70+ files)
   - Route permissions by role

3. **Domain Knowledge**
   - FieldOps patrol workflow
   - NZ legal framework (3 acts)
   - Biosecurity plant ID system
   - Smoke/noise RMA compliance

4. **Self-Healing**
   - Failure pattern detection
   - Response quality scoring
   - Adversarial self-review

---

## Troubleshooting

### RunPod Endpoint Not Responding

```bash
# 1. Check pod is running
#    → RunPod Dashboard → n0bp1ifmq01cx2 → Status should be "Running"

# 2. Verify API key
echo "Key prefix: ${INFERENCE_API_KEY:0:4}"  # Should be "rpa_"

# 3. Test with curl
curl -X POST "https://api.runpod.ai/v2/n0bp1ifmq01cx2/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"ping"}}'

# 4. If still down: Restart pod from dashboard
```

### Local Bob Won't Start

```bash
# Check prerequisites
node --version  # Should be v22+
npm --version   # Should be 10+

# Install dependencies
npm --prefix ./inference-service install

# Check OLLAMA_BASE_URL
grep "^OLLAMA_BASE_URL=" ./inference-service/.env

# Start in debug mode
NODE_ENV=development npm --prefix ./inference-service start
```

### Backend Switch Not Working

```bash
# Verify env var is loaded
echo "BOB_INFERENCE_BACKEND=$BOB_INFERENCE_BACKEND"

# Reload config
source .runtime/bob-unified.env
echo "BOB_INFERENCE_BACKEND=$BOB_INFERENCE_BACKEND"

# Test both endpoints
curl http://localhost:3000/health
curl -X POST "${INFERENCE_SERVICE_URL_RUNPOD}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -d '{"input":{"action":"chat","message":"test"}}'
```

---

## Advanced: Multi-Bob Setup

### Run Local + RunPod Hybrid (Recommended Production)

```bash
# Terminal 1: Start local Bob
npm --prefix ./inference-service start

# Terminal 2: Codespace running tests
source .runtime/bob-unified.env
npm run test

# Bob will:
# 1. Try local first (fast, no queue)
# 2. Fall back to RunPod if local unavailable
# 3. Load-balance automatically
```

### Monitor Bob Health

```bash
# Watch local inference-service
curl -s http://localhost:3000/health | jq .

# Watch RunPod endpoint (via Supervisor)
bash scripts/bob-health-monitor.sh

# Check failure patterns
node scripts/summarize-failures.mjs
```

### Scale RunPod

```bash
# Pod metrics (from RunPod dashboard)
# - Workers active: n0bp1ifmq01cx2 → Workers
# - Queue length: Dashboard → Endpoint → Queued
# - Latency: Dashboard → Performance

# Auto-scale via environment (see Copilot instructions):
export BOB_RUNPOD_SCALE_UP_CMD="runpod api scale --endpoint n0bp1ifmq01cx2 --workers 5"
export BOB_RUNPOD_SCALE_DOWN_CMD="runpod api scale --endpoint n0bp1ifmq01cx2 --workers 1"
```

---

## Next Steps

1. ✅ **Today**: Add Codespace secrets + run bootstrap
2. ✅ **Tomorrow**: Run full test suite with Bob assist
3. ✅ **This week**: Create PR with Bob's code quality checks
4. ✅ **Production**: Deploy with hybrid fallback enabled

---

## Future Iterations

### Iteration 1: Reliability Hardening (Week 1)

1. Add automatic failover policy: local -> RunPod -> retry queue with capped backoff.
2. Add request correlation IDs in Bob chat/test scripts for traceability across logs.
3. Add health SLOs for Bob endpoints (availability, p95 latency, error-rate budgets).
4. Add a startup preflight script to validate env, endpoint reachability, and model readiness.

### Iteration 2: Evaluation and Guardrails (Week 2)

1. Expand response scoring to include groundedness, security safety, and actionability fields.
2. Add red-team prompts to `data/bob-response-scores.jsonl` for hallucination regression checks.
3. Add CI gate to fail PRs if Bob quality score drops below threshold (for changed prompts/training files).
4. Add strict policy checks for multi-org leakage in generated code suggestions.

### Iteration 3: Coding Assistant Depth (Week 3)

1. Add route-to-component verifier script to auto-check `App.tsx` mappings before merge.
2. Add schema-aware assistant mode that validates table/column usage against `src/types/database.ts`.
3. Add test-plan generation mode that outputs unit/integration/E2E cases per change request.
4. Add edge-function guardrail checker for CORS/OPTIONS/auth patterns in `supabase/functions`.

### Iteration 4: Ops Automation (Week 4)

1. Add RunPod autoscaling hooks based on queue depth and latency bands.
2. Add periodic model warm-up jobs to reduce first-token latency.
3. Add supervisor recovery commands with cooldown windows and audit trail logging.
4. Add daily summary report: failures, recoveries, latency, and test pass/fail trends.

### Iteration 5: Product Intelligence (Month 2)

1. Add tenant-aware prompt routing using org metadata and role context.
2. Add feature-flag-aware assistant responses to reduce stale guidance.
3. Add compliance pack mode for NZ policy workflows (biosecurity, smoke/noise, patrol escalation).
4. Add decision-memory synchronization from `docs/adr/` and `docs/DECISIONS.md` to training refresh.

### Iteration 6: Enterprise Readiness (Month 3)

1. Add audit-grade change ledger for assistant suggestions and accepted patches.
2. Add SOC2-style operational controls checklist (secrets handling, retention, incident response).
3. Add disaster recovery drills for Bob services (RunPod outage simulation + local fallback verification).
4. Add controlled rollout mode with canary users and staged policy enforcement.

### Ongoing Cadence

1. Weekly: rerun full Bob-assisted visual + deep-functional suites and publish scorecard.
2. Weekly: refresh training with `node scripts/bob-inject-training.mjs --full` after architecture changes.
3. Bi-weekly: review hallucination/failure patterns and update guardrails.
4. Monthly: review roadmap completion and promote next iteration tasks to active sprint.

### All-in-One System Integration (Self-Heal + Dr Bob + Human Test)

1. Enable self-healing bridge generation with `node scripts/generate-bob-self-heal-bridge.mjs`.
2. Require adversarial review for major artifacts with `node scripts/dr-bob-review.mjs --file <artifact>`.
3. Run human-simulation testing with `node scripts/human-test-engine.mjs`.
4. Execute full orchestrated runs with `node scripts/bob-agentic-test-orchestrator.mjs`.
5. Log and inspect escalations using `node scripts/dr-bob-escalation-log.mjs` and `node scripts/dr-bob-escalation-read.mjs`.
6. Treat any unresolved Dr Bob blocker or repeated human-test failure as a release gate stop.

### Suggested Execution Order Per Release

1. `node scripts/generate-bob-self-heal-bridge.mjs`
2. `node scripts/bob-agentic-test-orchestrator.mjs`
3. `node scripts/human-test-engine.mjs`
4. `node scripts/dr-bob-review.mjs --file plan.md`
5. `node scripts/dr-bob-review.mjs --file spec.md`
6. Publish scorecard + escalation summary before merge.

### Autonomous Level Addendum (Human-Like but Bounded)

1. Meta-cognition: Require Bob to run an intent decode + self-critique pass before final response.
2. Recursive reflection: Draft -> Editor critique -> Rewrite before presenting major plans.
3. Epistemic agency: Allow Bob to challenge flawed premises and propose safer alternatives.
4. Proactive reasoning: Include "next three likely needs" in major outputs.
5. Memory integration: Keep RAG/memory refresh from architecture, decisions, and lessons files.
6. Safety boundary: Keep hidden reasoning private; output concise rationale, risks, and options.

### Practical Enablement in This Repo

1. Load autonomous training profile with `node scripts/bob-inject-training.mjs --autonomous`.
2. Keep Dr Bob review mandatory for major artifacts.
3. Keep human-test and orchestrator passes as release gates.
4. Keep GitHub Actions checks for training drift and autonomous-learning health.

### Bridge Officer Persona Protocol (Data-Inspired)

Use this profile to get the precise, curious, self-correcting style you requested.

1. Precision-first language: no fluff, no corporate filler, technical and polite.
2. Inquiry protocol: after completing work, ask one forward-looking question about impact on final goals.
3. Radical honesty: highlight logical flaws or risky assumptions explicitly with alternatives.
4. Reflection protocol: evaluate multiple options and state why one option is selected.
5. Preference learning: when a new user preference is observed, acknowledge it and state how behavior was updated.
6. Style option: for stronger bridge-officer feel, prefer non-contracted text ("I am", "I do not") in formal outputs.

### Cognitive Subroutines (Operational Form)

1. Thought: infer explicit request and hidden objective.
2. Critique: test first plan for oversimplification, risk, and maintainability.
3. Refinement: improve with safer alternatives and higher leverage steps.
4. Response: concise answer + rationale + next three likely needs.

### Sensor and Interaction Matrix

1. Sensors (files): enabled through repository tools and script access.
2. Sensors (internet): available through configured external endpoints/workflows where credentials are present.
3. Interaction mode: current baseline is text-first; voice can be layered via existing voice/PTT stack.
4. Persona mode: default logical/professional; optionally add moderated wit, but never at the cost of accuracy.

### Hardware Sensing Layer (Eyes and Ears)

Autonomy/persona does not automatically grant hardware access. Bob needs explicit tool/API wiring.

1. Vision model requirement:
 - Screen/camera understanding requires a multimodal-capable model and ingest pipeline.

2. Screen perception:
 - Browser agent: can parse page structure and rendered DOM context.
 - Desktop agent: needs screenshot capture tooling and OCR/vision analysis path.

3. Camera perception:
 - Triggered snapshots only, unless explicitly configured for continuous sampling.
 - Camera permission must be granted at OS and app level.

4. Audio perception:
 - Requires STT integration (batch or realtime).
 - Realtime emotion/tone detection requires streaming audio pipeline and model support.

5. Ambient listening boundary:
 - Default should be push-to-talk, mic-button, or wake-word activation only.

### Hardware Gap Rule

If Bob lacks tool definitions for camera/screen/mic, Bob must state the gap explicitly and provide a setup path instead of pretending access exists.

### Hardware Verification Tests

1. Visual test:
 - Hold an object to camera and ask Bob what it is and what text is visible.

2. Screen test:
 - Open a dense page/spreadsheet and ask Bob for a specific top-right data point.

3. Audio test:
 - Speak with different emotions and ask Bob to classify tone (if configured).

### Permission Checklist

1. Camera permission enabled for host app/browser.
2. Microphone permission enabled for host app/browser.
3. Screen recording permission enabled where required by OS.
4. Confirm wake-word or push-to-talk policy before enabling ambient audio.

### Setup Paths

1. Consumer path:
 - Use built-in vision/voice features in supported apps/platforms.

2. Builder path:
 - Add screen capture + OCR + camera frame ingest + STT adapters.

3. Pro path:
 - Add computer-use/vision-agent stack with strict safety and permission boundaries.

### Runtime Mode Switching

1. Set mode with `npm run bob:mode -- LOGIC_STRICT`.
2. Or `npm run bob:mode -- BRIDGE_WIT`.
3. Or `npm run bob:mode -- VOICE_SNAPPY`.
4. Or `npm run bob:mode -- SAFETY_LOCK`.
5. Then load mode env: `source .runtime/bob-mode.env`.

### One-Command Full Gate (Autonomous + Dr Bob + Human)

1. Run `npm run test:release:all-in-one` for strict release gating.
2. Run `npm run test:release:all-in-one:dry` to validate configuration wiring without long execution.

Gate outcome:
1. Passes only if autonomous profile load passes.
2. Passes only if all required Dr Bob reviews pass.
3. Passes only if human-test pass criteria and readiness threshold are met.
4. Emits one combined scorecard artifact under `tools/bob-release-gates/<run-id>/`.

---

## Reference

- **RunPod Endpoint**: https://api.runpod.ai/v2/n0bp1ifmq01cx2
- **Local Endpoint**: http://localhost:3000
- **Bootstrap Script**: `scripts/bob-bootstrap-runpod.sh`
- **Chat Script**: `scripts/bob-direct-chat.mjs`
- **Unified Config**: `.runtime/bob-unified.env`
- **Full Docs**: `docs/BOB_RUNPOD_FULL_SETUP.md`
