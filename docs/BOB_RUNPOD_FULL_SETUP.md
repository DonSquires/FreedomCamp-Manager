# Bob RunPod Full Setup — Complete Installation & Training

**Version**: 2026-04-28  
**Target**: RunPod Serverless (n0bp1ifmq01cx2)  
**Models**: Qwen2.5 7B (primary) + Llama3.2-Vision 11B (vision)  
**Training**: Full FieldOps AI suite + NZ domain + autonomy rules

> **Deployment rule:** Only Ollama-native models belong in the Railway Ollama service.
> If a model requires ONNX, Python GPU inference, or another runtime that Ollama does not support,
> keep it in a separate worker image and, if needed, a separate Railway project/service.

---

## 1. Prerequisites

### RunPod Account & Endpoint
- **Endpoint ID**: `n0bp1ifmq01cx2`
- **Endpoint Name**: `fieldops-ai-engine`
- **Base URL**: `https://api.runpod.ai/v2/n0bp1ifmq01cx2`
- **API Key**: Get from RunPod dashboard (starts with `rpa_`)

### Codespace Secrets
Add these to GitHub → Repository → Settings → Secrets and Variables → Codespaces:

```
INFERENCE_SERVICE_URL=https://api.runpod.ai/v2/n0bp1ifmq01cx2
INFERENCE_API_KEY=rpa_<your-runpod-api-key>
RUNPOD_ENDPOINT_ID=n0bp1ifmq01cx2
RUNPOD_API_KEY=<your-runpod-api-key>
```

---

## 2. Local Codespace Setup

### Step 1: Load Credentials
```bash
cd /workspaces/FreedomCamp-Manager

# Create local runtime env file (NOT committed to git)
mkdir -p .runtime
cat > .runtime/bob.env << 'EOF'
export INFERENCE_SERVICE_URL="https://api.runpod.ai/v2/n0bp1ifmq01cx2"
export INFERENCE_API_KEY="rpa_<your-key>"
export RUNPOD_ENDPOINT_ID="n0bp1ifmq01cx2"
export BOB_OPERATING_MODE="build-training"
export SELF_CONTAINED_MODE="false"
EOF

chmod 600 .runtime/bob.env
source .runtime/bob.env
```

### Step 2: Verify Connection
```bash
# Smoke test: Is RunPod responsive?
curl -i "${INFERENCE_SERVICE_URL}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"ping"}}'

# Expected: HTTP 200, JSON response with status: "COMPLETED"
```

---

## 3. Model & Tool Suite Installation

### Step 1: Verify Models on RunPod Pod
SSH into your RunPod pod and run:
```bash
ollama list
# Should show:
#   qwen2.5:7b         (primary chat model)
#   llama3.2-vision:11b (vision model for biosecurity)
```

### Step 2: Load Training Configuration
```bash
bun run bob:feed-all
bun run bob:auto-ingest
```

This loads:
- **Bob Autonomy Rules** (`docs/BOB_TRAINING_TRUTH_PROTOCOL.md`)
- **FieldOps Domain** (patrol, compliance, vehicle management)
- **NZ Business Rules** (councils procurement, regulatory compliance)
- **Self-Evaluation Loop** (adversarial review, fail-fast diagnostics)
- **Architecture Decisions** (`docs/adr/`)

### Step 3: Deploy Full Tool Suite
```bash
# Bob now has access to:

# 1. Code introspection tools
#    - Repository analysis via semantic_search
#    - Codebase indexing via file discovery
#    - Type system analysis (TypeScript)

# 2. AI reasoning tools
#    - Adversarial self-review (dr-bob-review.mjs)
#    - Response scoring (data/bob-response-scores.jsonl)
#    - Failure pattern detection (summarize-failures.mjs)

# 3. Knowledge base management
#    - Schema ingestion (auto-ingest.mjs)
#    - Architecture decision records (docs/adr/)
#    - Lessons learned repository (docs/LESSONS_LEARNED.md)

# 4. Testing & validation
#    - Playwright E2E test suite
#    - Visual regression snapshots
#    - Deep-functional tests

# Verify tool availability:
bun run bob:doctor:any-container
bun run bob:capabilities
bun run test:bob:governance
```

---

## 4. Training Bootstrap

### Step 1: Ingest Core Training Data
```bash
# Run the auto-ingestor to populate Bob's brain with latest codebase knowledge
node scripts/auto-ingest.mjs
# This generates: docs/BOB_BRAIN_DUMP.md
```

### Step 2: Load Architecture Decisions
```bash
# ADRs are Bob's permanent memory for design patterns
# They live in docs/adr/ and are loaded at startup
# Key ADRs for Bob to know:
ls docs/adr/
```

### Step 3: Activate Self-Healing System
```bash
# Bob's self-correction loop keeps her aligned with repo state
bun run bob:self-heal-bridge
bun run bob:autonomous-cycle
```

---

## 5. Daily Operations

### Health Check
```bash
# Verify Bob is healthy and models are loaded
curl -s "${INFERENCE_SERVICE_URL}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"chat","message":"status check"}}' | jq '.status'
```

### Chat with Bob (Direct Mode)
```bash
# For manual testing
node scripts/bob-direct-chat.mjs "What are the key Routes in this app?"
```

### Run Bob-Assisted Tests
```bash
# Bob evaluates test failures and suggests fixes
bun run test

# Or run specific test suite:
bash scripts/playwright-bob-runtime.sh bunx playwright test tests/e2e/visual-regression.spec.ts --project=chromium --workers=1
```

### Translation Validation (D2)
```bash
# Validate translation/speech boundaries when translation quality degrades
bash scripts/playwright-bob-runtime.sh bunx playwright test tests/e2e/phase-d2-translation-speech-boundaries.spec.ts --project=chromium --workers=1 --reporter=line
```

### Knowledge Base Updates
```bash
# When schema changes, push knowledge to Bob
bun run bob:feed-context
bun run bob:auto-ingest
```

---

## 6. Advanced: Model Selection & Fine-Tuning

### Available Models on Pod
- **Primary**: `qwen2.5:7b` (reasoning, chat, code analysis)
- **Vision**: `llama3.2-vision:11b` (biosecurity plant ID, smoke assessment)
- **Optional**: `mistral:7b` (faster, lower VRAM)
- **Optional**: `neural-chat:7b` (instruction-following)

### Model Routing Matrix

| Model / workload | Runtime | Railway placement | Notes |
|---|---|---|---|
| `qwen2.5:7b` | Ollama | Railway Ollama service | Primary Bob chat / reasoning model |
| `llama3.2-vision:11b` | Ollama | Railway Ollama service | Vision model for biosecurity and smoke review |
| ALPR ONNX models (`yolov8n.onnx`, `lp_detector.onnx`) | ONNX / Python worker | Separate worker image (`runpod-worker/`) | Keep out of Ollama; needs ONNX runtime and model assets |
| Face detection ONNX (`version-RFB-640.onnx`) | ONNX / Python worker | Separate worker image (`runpod-worker/`) | Keep out of Ollama; same worker image can host this alongside ALPR |
| STT / Whisper paths | Separate service or provider-specific worker | Separate service | Do not force into Ollama unless the chosen model is actually Ollama-native |

### Capability Boundary Matrix

| Capability | What it is | Where it should run | What not to do |
|---|---|---|---|
| Playwright | Browser E2E test runner | CI runner, dev container, or dedicated test worker | Do not treat it as an inference model or deploy it inside Railway Ollama |
| Chromium / browser runtime | Browser executable for Playwright and render checks | CI runner or dedicated browser-capable host | Do not put browser binaries into Ollama just to run tests |
| Bob sandbox emulator | Training / operator practice workflow | Browser + local app/dev environment | Do not treat the emulator as a production inference dependency |
| TTS synthesis (`synthesize-translated-audio`) | Audio render service | Dedicated TTS provider path, currently Piper/RunPod-backed | Do not route TTS through Ollama unless a real Ollama-native voice runtime is intentionally adopted |
| Video generation / briefing video | Media generation pipeline | Dedicated media worker or shared RunPod path with explicit auth | Do not assume video generation belongs in the Ollama service |
| Browser STT fallback | Client-side speech fallback | Browser Web Speech API | Do not move browser fallback logic into Ollama |

### Switch Model (Advanced)
```bash
# On RunPod pod:
ollama pull mistral:7b
export OLLAMA_MODEL=mistral:7b

# Or in Codespace, set at request time:
curl "${INFERENCE_SERVICE_URL}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input":{"model":"mistral:7b","action":"chat","message":"test"}}'
```

---

## 7. Integration Checklist

- [ ] Codespace secrets configured
- [ ] `INFERENCE_SERVICE_URL` and `INFERENCE_API_KEY` in environment
- [ ] RunPod pod is running (check dashboard)
- [ ] Ollama `/api/tags` responds with `qwen2.5:7b` and `llama3.2-vision:11b`
- [ ] Non-Ollama workloads remain isolated in worker images (ALPR, face, STT, etc.)
- [ ] Playwright/Chromium/test tooling remain in test runners or browser-capable hosts, not the Ollama service
- [ ] TTS/video/emulator flows are assigned to their own service paths and are not counted as Ollama model requirements
- [ ] Smoke test: `/runsync` returns HTTP 200
- [ ] Training data loaded: `docs/BOB_BRAIN_DUMP.md` exists
- [ ] ADRs indexed: `docs/adr/` folder populated
- [ ] Bob health monitor running
- [ ] Tests can call Bob for assist (optional but recommended)

---

## 8. Troubleshooting

### RunPod Endpoint Not Responding
```bash
# Check RunPod dashboard for pod status (should be "Running")
# If pod crashed:
#   1. Restart pod from RunPod web UI
#   2. Wait 60s for Ollama to warm up
#   3. Retry smoke test
```

### Models Not Loaded
```bash
# SSH into pod and verify:
ollama list
ollama show qwen2.5:7b

# If missing, manually pull:
ollama pull qwen2.5:7b
```

### Auth Errors (Bearer Token)
```bash
# Verify API key format:
echo "${INFERENCE_API_KEY:0:4}" # Should be "rpa_"

# Check authorization header:
curl -i "${INFERENCE_SERVICE_URL}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Slow Responses
- Check RunPod pod utilization (may need GPU upgrade)
- Try switching to faster model: `mistral:7b`
- Increase timeout: `BOB_RUNPOD_TIMEOUT_MS=180000`

---

## 9. Scaling & Production

### Multi-Endpoint Setup
```bash
# For high-volume workloads, deploy multiple RunPod endpoints
# and load-balance across them via:
INFERENCE_ENDPOINTS="https://api.runpod.ai/v2/endpoint1|https://api.runpod.ai/v2/endpoint2"
BOB_LOAD_BALANCER_MODE="round-robin"
```

### Monitoring & Alerts
```bash
# Enable Bob's supervision system:
export BOB_SUPERVISOR_STATE_FILE=.runtime/bob-supervisor.json
export BOB_SUPERVISOR_ACTIVITY_FILE=.runtime/bob-activity.touch

bun run runpod:bob:supervisor:once
bun run bob:monitor
```

### Persisting State
```bash
# Bob maintains state in:
#   - data/bob-response-scores.jsonl (training scores)
#   - data/bob-failure-summary.json (recent failures)
#   - docs/DECISIONS.md (architecture decisions)
#   - .runtime/bob-supervisor-state.json (supervision state)

# Back these up regularly:
tar -czf bob-state-backup-$(date +%s).tar.gz data/ docs/ .runtime/
```

---

## 10. Success Criteria

After setup, verify:
1. ✅ Endpoint responds to `/runsync` in < 5s
2. ✅ Models (`qwen2.5:7b`, `llama3.2-vision:11b`) are loaded
3. ✅ Chat works: `{"input":{"action":"chat","message":"hello"}}`
4. ✅ Training data visible: `docs/BOB_BRAIN_DUMP.md` > 50KB
5. ✅ ADRs indexed: `find docs/adr -type f | wc -l` > 3
6. ✅ Tests pass: `bun run test` exits 0
7. ✅ Bob assists on failures: response_scores logged

**Bob is ready for production.** 🚀

---

## References

- **RunPod Endpoint**: https://api.runpod.ai/v2/n0bp1ifmq01cx2/runsync
- **Bot Config**: `docs/BOB_CONFIGURATION.md`
- **Gateway Docs**: `runpod-gateway/README.md`
- **Training Suite**: `docs/BOB_TRAINING_*.md` (15+ modules)
- **Architecture**: `docs/adr/`
