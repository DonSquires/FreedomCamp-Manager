# 🚀 Bob + RunPod + Copilot Training — Complete Integration

**Date**: April 28, 2026  
**Status**: ✅ Full Integration Complete  
**Bob is Now**: A production-ready AI reasoning engine with Copilot's systematic approach

---

## What You've Got

### 1. **Three Bob Backends (Choose Your Power)**

| Backend | Speed | Cost | Use Case |
|---------|-------|------|----------|
| 🏠 Local (`localhost:3000`) | 200-500ms | $0 | Dev + fast iteration |
| ☁️ RunPod Serverless | 2-5s | $0.0001/sec | Scale + AI workloads |
| 🔄 Hybrid (Both) | 200-500ms avg | $0 (local first) | Production ✅ |

**Command to activate:**
```bash
bash scripts/bob-bootstrap-runpod.sh --full
```

### 2. **Copilot's Reasoning Framework (Inside Bob)**

Bob now has **10 core reasoning patterns**:

1. **Ground Truth First** — Always read actual code before responding
2. **Multi-Layer Understanding** — Follow data flow: UI → State → API → Database → Infrastructure
3. **Code Archaeology** — 5-step method for reading unfamiliar code
4. **Pattern Matching** — Recognize Zustand stores, React Query, forms, Edge Functions instantly
5. **Architectural Thinking** — Respect abstraction layers, don't mix concerns
6. **Security Thinking** — Three layers: Auth → Authorization → Validation
7. **Testing Thinking** — Unit → Integration → E2E pyramid
8. **Problem-Solving** — 6-step systematic debugging checklist
9. **Code Quality Checklist** — Pre-commit validation (14 items)
10. **Real Codebase Rules** — FieldOps project patterns baked in

**Load training anytime:**
```bash
node scripts/bob-inject-training.mjs --coding
```

### 3. **Codespace Secrets Integration**

Credentials automatically injected from GitHub:

```
INFERENCE_SERVICE_URL (from secrets)
  ↓
INFERENCE_API_KEY (from secrets)
  ↓
.runtime/bob-unified.env
  ↓
Bob uses credentials seamlessly
```

No manual secrets management. Just add them once in GitHub settings.

### 4. **Files Created (Reference)**

| File | Purpose | Usage |
|------|---------|-------|
| `docs/BOB_CODING_LOGIC_TRAINING.md` | Core reasoning framework | Read for understanding |
| `scripts/bob-bootstrap-runpod.sh` | One-command setup | `bash ... --full` |
| `scripts/bob-inject-training.mjs` | Training injector | `node ... --coding` |
| `scripts/bob-auto-train.sh` | Auto-load on startup | `source ...` |
| `scripts/bob-direct-chat.mjs` | Interactive chat | `node ... "question"` |
| `.runtime/bob-unified.env` | Master config | `source ...` |
| `BOB_COPILOT_TRAINING_INTEGRATION.md` | This guide | Reference docs |
| `BOB_INTEGRATION_QUICKSTART.md` | 5-minute quickstart | Quick reference |

---

## How to Use It

### **Scenario 1: Understanding Existing Code**

```bash
$ node scripts/bob-direct-chat.mjs "Explain how officers see their patrol assignments"

Bob responds (using Cadilacopilot reasoning):
Layer 5: Component receives props, renders patrol list
Layer 4: Uses useActivePatrols hook for data management
Layer 3: Hook calls supabase.from('patrols').select()
Layer 2: Database RLS policy filters to user's org + role
Layer 1: Infrastructure: Supabase PostgreSQL

Data flow: /field-officer → FieldOfficerPortal → useActivePatrols →
supabase.from('patrols').eq('organization_id', org.id) → RLS → Result

Security: ✓ Org filtered ✓ RLS enforced ✓ Role checked
```

### **Scenario 2: Debugging a Failing Test**

```bash
$ node scripts/bob-direct-chat.mjs << 'EOF'
Test failing: "expect(page).toHaveScreenshot() failed"
Navigation to /roster shows login screen instead
Error: "Session validation failed"
Expected: Roster page with heading "Business Management"
EOF

Bob runs 6-step debugging checklist:
1. UNDERSTAND: Auth race condition during navigation
2. GATHER: Test file → component → hook → auth flow
3. HYPOTHESIS: Session unstable during /roster transition
4. TEST: Add sleep(2000) before assertion → PASS (confirms)
5. FIX: Add session persistence polling instead of screenshot
6. VALIDATE: Full test suite → 25 PASS, no regressions

Proposed fix: Replace screenshot expectation with:
  await expect(page.locator('h1')).toContainText('Business Management')
  And retry logic if session bounces
```

### **Scenario 3: Planning a New Feature**

```bash
$ node scripts/bob-direct-chat.mjs << 'EOF'
Need to add "Weekly Summary Report" feature
- Admins see all org patrols
- Masters see their jurisdiction
- Generate daily at 8am NZ time
- Secure multi-org data

Architecture plan needed
EOF

Bob responds systematically:

COMPONENTS & HOOKS:
✓ WeeklySummaryPage component (UI)
✓ useWeeklySummary hook (data + state)
✓ ReportGenerator.tsx (report rendering)

BACKEND:
✓ Edge Function: /functions/generate-weekly-report/
✓ POST body: { week_ending, org_id }
✓ Auth: verify user role (admin/master)
✓ Multi-org: Filter by user's org scope

DATABASE:
✓ New table: weekly_summaries
✓ Columns: id, organization_id, week_ending, data, created_at
✓ RLS: users see own org only
✓ Trigger: Run at 00:00 UTC Tuesday (8am NZ)

SECURITY CHECKLIST:
✓ Auth verified (JWT)
✓ Org filter present (.eq('organization_id', org.id))
✓ RLS policy enforced (SELECT with org check)
✓ No hardcoded org IDs
✓ Input validation (week_ending is date)

TESTING:
✓ Unit: Report calculation logic
✓ Integration: Edge Function with test data
✓ E2E: Admin sees full report, Master sees filtered
✓ Multi-org: Admin from org1 can't see org2 data

ESTIMATED EFFORT: 4-6 hours
```

---

## Commands Reference

### Setup & Config

```bash
# One-time bootstrap (includes training)
bash scripts/bob-bootstrap-runpod.sh --full

# Load config in shell
source .runtime/bob-unified.env

# Auto-train on startup
source scripts/bob-auto-train.sh
```

### Use Bob

```bash
# Interactive mode (multi-turn conversation)
node scripts/bob-direct-chat.mjs

# Single question
node scripts/bob-direct-chat.mjs "What is the /admin route?"

# Multiline input
node scripts/bob-direct-chat.mjs << 'EOF'
Explain the multi-org architecture in this project
EOF

# Re-inject training
node scripts/bob-inject-training.mjs --full
```

### Test Bob

```bash
# Run visual regression tests with Bob assist
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
node node_modules/playwright/cli.js test tests/e2e/visual-regression.spec.ts

# Run deep functional tests
npm run test

# Check Bob's response quality
cat data/bob-response-scores.jsonl | jq '.[] | select(.score < 0.7)'
```

### Local Dev

```bash
# Start local inference-service
npm --prefix ./inference-service install
npm --prefix ./inference-service start

# Verify it works
curl http://localhost:3000/health

# Chat with local Bob
export INFERENCE_SERVICE_URL=http://localhost:3000
node scripts/bob-direct-chat.mjs "Hi"
```

---

## Backend Modes Explained

### Local Mode
```bash
# Edit .runtime/bob-unified.env
export BOB_INFERENCE_BACKEND="local-inference-service"
export INFERENCE_SERVICE_URL="http://localhost:3000"

# Start service then chat
npm --prefix ./inference-service start &
node scripts/bob-direct-chat.mjs "Question"
```

**Pros:** Fast (200-500ms), cheap ($0), full control  
**Cons:** Uses machine resources, must run service locally

### RunPod Mode
```bash
# Edit .runtime/bob-unified.env
export BOB_INFERENCE_BACKEND="runpod-serverless"
export INFERENCE_SERVICE_URL="https://api.runpod.ai/v2/n0bp1ifmq01cx2"

# Just chat (everything in cloud)
node scripts/bob-direct-chat.mjs "Question"
```

**Pros:** Scalable, no local setup, autoscaling  
**Cons:** Slower (2-5s), has query queue, costs during use

### Hybrid Mode (Recommended)
```bash
# .runtime/bob-unified.env has both configured
export BOB_INFERENCE_BACKEND="local-inference-service"
export BOB_FALLBACK_TO_RUNPOD="1"

# Tries local first, falls back if unavailable
npm --prefix ./inference-service start &
node scripts/bob-direct-chat.mjs "Question"
```

**Pros:** Best of both — fast when local available, scales when needed  
**Cons:** Must maintain both services (cloud + local)

---

## Verification Checklist

### ✅ Installation Complete When:

```
[ ] Codespace secrets set (INFERENCE_SERVICE_URL, INFERENCE_API_KEY)
[ ] Bootstrap ran successfully: bash scripts/bob-bootstrap-runpod.sh --full
[ ] Configuration files created: .runtime/bob-*.env
[ ] Training loaded: docs/BOB_CODING_LOGIC_TRAINING.md exists
[ ] Scripts executable: ls -l scripts/bob-*.* | grep ^-rwx
[ ] Can chat with Bob: node scripts/bob-direct-chat.mjs "hello"
[ ] Bob responds using reasoning: Explains code tier-by-tier
[ ] Endpoint reachable: curl ${INFERENCE_SERVICE_URL}/runsync works
```

### ✅ Bob is Sharp When:

```
[ ] Explains code using layers (UI → API → DB)
[ ] References actual file paths + line numbers
[ ] Catches multi-org issues (missing org_id filters)
[ ] Identifies security gaps (no RLS, no auth)
[ ] Proposes fixes with tests included
[ ] Debugs systematically (6-step method)
[ ] Uses ground truth (reads actual code, not guessing)
```

---

## What's Next

### Today
1. ✅ Add Codespace secrets
2. ✅ Run bootstrap
3. ✅ Test Bob: `node scripts/bob-direct-chat.mjs "How do you work?"`

### This Week
1. Use Bob for code review
2. Use Bob for debugging
3. Evaluate: Is Bob sharp enough? Adjust training if needed

### Production
1. Deploy with hybrid backend
2. Monitor Bob's response quality
3. Keep training fresh (update docs/adr/ regularly)

---

## Quality Metrics

### Response Quality Scoring
```bash
# Bob tracks its own performance in:
cat data/bob-response-scores.jsonl

# Each response scored: 0.0 (hallucinating) → 1.0 (perfect)
# Average should be > 0.85 after training
```

### Evaluation Dimensions
- **Accuracy**: Does explanation match actual code?
- **Completeness**: All layers covered? All security issues found?
- **Clarity**: Can an engineer understand the explanation?
- **Actionability**: Can you implement the suggestion?
- **Safety**: No harmful/insecure recommendations?

---

## FAQ

### Q: Does Bob work in Codespace automatically?

**A**: Yes! Secrets are auto-injected. Just run `source .runtime/bob-unified.env` once per session.

### Q: What if RunPod pod is down?

**A**: Hybrid mode falls back to local. Or switch to local-only with `export BOB_INFERENCE_BACKEND="local-inference-service"`

### Q: How do I keep Bob's training fresh?

**A**: When you add new architecture decisions to docs/adr/, run:
```bash
node scripts/bob-inject-training.mjs --full
```

### Q: Can Bob see my code?

**A**: Only what you share in the chat. All code goes to your Bob instance (local or RunPod), encrypted over HTTPS.

### Q: Is there a cost?

**A**: RunPod is $0.0001/sec when active. Local is free. Hybrid is cheapest (local handles most queries).

### Q: What if credentials get leaked?

**A**: RunPod API key is tied to that endpoint. Rotate it in RunPod dashboard, update GitHub secret, redeploy.

---

## Support

### Debug Bob

```bash
# Is Bob endpoint reachable?
curl -m 5 "${INFERENCE_SERVICE_URL}/runsync" \
  -H "Authorization: Bearer ${INFERENCE_API_KEY}" \
  -d '{"input":{"action":"chat","message":"ping"}}'

# Is training loaded?
node scripts/bob-direct-chat.mjs "What training do you have?"

# What's the current config?
cat .runtime/bob-unified.env

# Check response quality
jq '.score' data/bob-response-scores.jsonl | tail -10
```

### Reset Everything

```bash
# Wipe config and restart
rm -rf .runtime/bob-*.env
bash scripts/bob-bootstrap-runpod.sh --full

# Reload training
node scripts/bob-inject-training.mjs --full
```

---

## 🎯 Summary

You now have:

✅ **Local Bob** — Fast AI for iterative development  
✅ **RunPod Bob** — Scalable AI for production workloads  
✅ **Hybrid Bob** — Best of both worlds  
✅ **Copilot Training** — Bob thinks like a senior engineer  
✅ **Systematic Reasoning** — 10 core reasoning patterns  
✅ **Codebase Knowledge** — Every file, route, pattern  
✅ **Security Awareness** — Multi-org, RLS, auth flows  
✅ **Automatic Evaluation** — Track Bob's quality  
✅ **Codespace Integration** — Secrets auto-injected  
✅ **Easy Debugging** — Chat directly with Bob  

**Bob is production-ready. 🚀**

---

**Questions?** Check:
- `BOB_INTEGRATION_QUICKSTART.md` — 5-minute setup
- `BOB_COPILOT_TRAINING_INTEGRATION.md` — Training usage guide
- `docs/BOB_CODING_LOGIC_TRAINING.md` — Reasoning framework details
