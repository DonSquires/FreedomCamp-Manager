# Bob + Human Joint Diagnosis & Fix Plan

**Date**: April 5, 2026  
**Status**: Active investigation (no live DB access in this shell)  
**Approach**: Static code analysis + smoke test evidence

---

## Known Issues Discovered

### 0. **Current Blocking Mismatches (verified live)**
**Evidence source**: `https://focused-courage-production-ccee.up.railway.app/health`

- `REQUIRE_SELF_CONTAINED_MODE`: `null` (workflow expects `true`)
- `SELF_CONTAINED_STRICT_EGRESS`: `null` (workflow expects `true`)
- `CHAT_PROVIDER`: `ollama` (good)
- `TABULAR_NLP_PROVIDER`: `ollama` (good)
- `capabilities.chat_local_ollama_enabled`: `true` (good)

**Impact on workflows**:
- `.github/workflows/ops-bob-human-interaction-smoke.yml` fails preflight strict assertions.
- `.github/workflows/ops-railway-wiring-audit.yml` fails if `VITE_SUPABASE_URL` secret is missing.

### 1. **Smoke Test Failure: Ollama Provider Fallback**
**Severity**: HIGH  
**Evidence**: `.github/workflows/ops-bob-human-interaction-smoke.yml` failed with:
```
Expected provider ollama but got heuristic
fallback: true
```

**Root Cause Chain**:
- Workflow sends `provider=ollama` request to `/chat` endpoint
- Inference service returns `provider=heuristic, fallback=true`
- This happens when either:
  - `OLLAMA_ENABLED` is false (line 889 in `inference-service/server.js`)
  - Circuit breaker is open (line 893-894)
  - Ollama request fails (line 927-956)

**Why This Happens**:
```javascript
// inference-service/server.js L189
const OLLAMA_ENABLED = OLLAMA_REQUESTED && (!SELF_CONTAINED_MODE || isLocalUrl(OLLAMA_BASE_URL));
```

**Failure Modes**:
1. `CHAT_PROVIDER` env is not `ollama` at runtime
2. `OLLAMA_BASE_URL` is not reachable from Railway inference pod
3. `SELF_CONTAINED_MODE=true` but `OLLAMA_BASE_URL` points to external URL
4. Ollama service crashed or timed out (circuit breaker tripped)

---

### 2. **Workflow Diagnostics Gap**
**Severity**: MEDIUM  
**Issue**: Smoke test fails but does not report which enablement check failed

**Fix Applied** ✅:
- Added health preflight step to smoke workflow
- Captures live config, capabilities, wiring state before prompts
- Saves diagnostics as artifact for post-mortem

**File**: `.github/workflows/ops-bob-human-interaction-smoke.yml` (lines 35-59)

---

### 3. **Credential Wiring Verified** ✅
**Status**: Good alignment found

Traced:
- GitHub secrets: `INFERENCE_SERVICE_URL`, `INFERENCE_API_KEY`
- Inference auth middleware accepts:
  - `x-inference-api-key` header (line 417 in `inference-service/server.js`)
  - Supabase service role bearer token (line 426)
  - Supabase JWT (line 432)
- Health function reports config + capabilities (check-railway-health)

---

## Proposed Joint Fixes

### Fix A: Runtime Environment Alignment
**Owner**: Deployer/DevOps  
**Action**: Verify Railway inference service environment:

```bash
# Check these via Railway dashboard:
CHAT_PROVIDER=ollama              # Must be set
TABULAR_NLP_PROVIDER=ollama       # Must be set
OLLAMA_BASE_URL=http://ollama.railway.internal:3000  # Railway targetPort is 3000
SELF_CONTAINED_MODE=true
REQUIRE_SELF_CONTAINED_MODE=true
SELF_CONTAINED_STRICT_EGRESS=true
```

**Validation**: Run wiring audit workflow (already has these checks)
```
.github/workflows/ops-railway-wiring-audit.yml
```

### Fix A1: Set missing GitHub Actions secret for wiring audit
**Owner**: Repo admin

`ops-railway-wiring-audit.yml` requires `VITE_SUPABASE_URL` in Actions secrets.

Set:

```bash
VITE_SUPABASE_URL=https://kxwjcupuxnnbnzcgmkoi.supabase.co
```

If your canonical production URL differs, use the production one actually used by Edge Functions.

### Fix A2: Railway variable update checklist (Bob service)
**Owner**: Railway project admin

Minimum variables to satisfy strict workflow checks:

```bash
SELF_CONTAINED_MODE=true
REQUIRE_SELF_CONTAINED_MODE=true
SELF_CONTAINED_STRICT_EGRESS=true
CHAT_PROVIDER=ollama
TABULAR_NLP_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama.railway.internal:3000
```

After saving variables, redeploy/restart Bob service and verify:

```bash
curl -fsS --max-time 20 https://focused-courage-production-ccee.up.railway.app/health | jq '{
   status,
   require:.config.REQUIRE_SELF_CONTAINED_MODE,
   strict:.config.SELF_CONTAINED_STRICT_EGRESS,
   chat:.config.CHAT_PROVIDER,
   tabular:.config.TABULAR_NLP_PROVIDER,
   ollama_chat:.capabilities.chat_local_ollama_enabled
}'
```

Expected:
- `status = "healthy"`
- `require = true`
- `strict = true`
- `chat = "ollama"`
- `tabular = "ollama"`
- `ollama_chat = true`

---

### Fix B: Smoke Test Health Preflight
**Owner**: Merged ✅  
**Status**: Done  
**Impact**: Future smoke failures will include:
- `inference-health-preflight.json` artifact
- Clear diagnostics on which check failed before prompts run

---

### Fix C: Circuit Breaker Observability ✅
**Status**: ALREADY IMPLEMENTED  
**Current State**: Circuit breaker is fully observable in health endpoint

**Implementation Details** (lines 200-265, 2945 in `inference-service/server.js`):
- Breaker state tracked: `closed` | `open` | `half-open`
- Failure count tracked
- Last error message captured
- Health endpoint exposes: `.ollama_circuit_breaker`
  ```json
  {
    "state": "closed",
    "consecutiveFailures": 0,
    "lastError": null,
    "openedAt": null,
    "threshold": 3,
    "cooldownMs": 60000
  }
  ```

**Logging**:
- Console warns on breaker OPEN: `"🔌 Ollama circuit breaker OPEN after N failures"`
- Logs on probe transition: `"🔄 Ollama circuit breaker HALF-OPEN"`
- Logs on reset: `"✅ Ollama circuit breaker reset — connection restored"`

**Bob Can Use**: When Ollama returns heuristic fallback, Bob can inspect health endpoint to determine if circuit breaker was the cause (state != "closed")

---

## Bob's Analysis Path (auto-analyse-report)

**Current Flow**:
1. Bug report submitted → triggers `auto-analyse-report` edge function
2. Fetches CI status from GitHub Actions (5 most recent runs)
3. Builds structured self-heal prompt with:
   - Report title + description
   - Console errors (JSONB array)
   - CI workflow status
4. Calls `/self-heal/bug-report` endpoint on inference service
5. Persists analysis to `ai_analysis` JSONB column

**Schema**:
```sql
-- bugs_reports table (from migration 20250215000001)
ai_analyzed BOOLEAN DEFAULT false
ai_analysis JSONB
ai_suggested_fix TEXT
requires_human_review BOOLEAN DEFAULT true
```

**Issues Bob Can Detect** (from code patterns):
- Ollama provider fallback (this issue)
- Circuit breaker trips (missing from current telemetry)
- Inference service unreachable (HTTP errors)
- GitHub Actions CI failures (included in prompt context)
- Self-contained mode policy blocks (SELF_CONTAINED_STRICT_EGRESS)

---

## Next Steps (Human + Bob)

### Immediate (Today)
1. **Run wiring audit**: `.github/workflows/ops-railway-wiring-audit.yml`
   - Validates CHAT_PROVIDER=ollama on live deployment
   - Reports if OLLAMA_BASE_URL is unreachable
   - Checks `TABULAR_NLP_PROVIDER=ollama`
   - **Exit code 0** = wiring is good; if fails, check Railway env variables

2. **Check smoke artifact**: Next scheduled run of smoke test
   - Download `inference-health-preflight.json` from artifacts
   - Verify `config.CHAT_PROVIDER` and `capabilities.chat_local_ollama_enabled`
   - If `chat_local_ollama_enabled: false`, Ollama is blocked or misconfigured

3. **Bob Debug Query** (if you have Supabase CLI access):
   - Query latest bug_reports with AI analysis
   - Look for patterns in `ai_suggested_fix` that mention Ollama fallback
   - Cross-reference timestamps with smoke failures

### Short-term (This week)
4. **Create Synthetic Bug Report for Bob**:
   - Title: "Chat requests return heuristic provider instead of ollama"
   - Description: Reference this diagnosis plan + health check findings
   - Let `auto-analyse-report` call `/self-heal/bug-report`
   - Bob will reason through circuit breaker state + config alignment
   - Suggested fix will include environment variable corrections

5. **Emergency Ollama Recovery** (if breaker is open):
   - Circuit breaker has 3-failure threshold with 60-second cooldown
   - Manual fix: Restart Ollama pod on Railway; breaker resets after successful request
   - Programmatic fix: Add `/reset/ollama-circuit-breaker` admin endpoint (if needed)

6. **Add Circuit Breaker Recovery Logging**:
   - Current: Only logs warn/info
   - Proposal: Add structured logging sink to bug_reports table for circuit-breaker events
   - Enables Bob to see recovery timeline during auto-analysis

---

## How Bob & Human Collaborate (No Live Credentials)

Since this shell cannot access live Supabase or GitHub secrets, Bob's analysis role is:

1. **Static Code Analysis** (Done ✅):
   - Read auth + wiring patterns in inference-service, edge functions
   - Identify fallback conditions in chat endpoint
   - Map circuit breaker logic to failure scenarios

2. **Workflow Diagnostics** (Done ✅):
   - Enhanced smoke test with health preflight (now captures diagnostics)
   - Wiring audit validates live deployment state

3. **Proposed Fixes** (This doc):
   - Document root causes from code + workflow telemetry
   - Propose concrete env variable checks and recovery steps
   - Reference specific line numbers for human verification

4. **Future Runtime Analysis** (When live):
   - Run auto-analyse-report on synthetic bug_report
   - Connect circuit breaker state to Bob's reasoning
   - Suggest Ollama restart or config change
   - Log suggestions to bug_reports for human review

---

## Files Modified This Session

| File | Change | Purpose |
|------|--------|---------|
| `.github/workflows/ops-bob-human-interaction-smoke.yml` | Added health preflight + diagnostics | Fail fast with wiring info before chat prompts |
| `BOB_JOINT_DIAGNOSIS.md` | Created (this file) | Document issues, fixes, and collaboration plan |

---

## Summary For Next Human Session

**Bob's Finding**: Ollama chat requests return heuristic fallback  
**Likely Cause**: OLLAMA_BASE_URL unreachable from Railway OR circuit breaker is open  
**Immediate Validation**: Run wiring audit + check smoke preflight artifact  
**Evidence Captured**: Health endpoint now exposes circuit breaker state, config, and capabilities  
**Next Action**: Verify Railway env variables match deployment docs or restart Ollama service

---

## References

| File | Lines | Purpose |
|------|-------|---------|
| `inference-service/server.js` | 125-189 | Provider config + Ollama enablement logic |
| `inference-service/server.js` | 415-450 | Auth middleware |
| `inference-service/server.js` | 887-960 | Ollama chat function + fallback |
| `supabase/functions/auto-analyse-report/index.ts` | 1-120 | Bob auto-analysis flow |
| `supabase/functions/check-railway-health/index.ts` | 1-165 | Wiring validation |
| `.github/workflows/ops-bob-human-interaction-smoke.yml` | 35-59 | Smoke preflight (newly added) |
| `.github/workflows/ops-railway-wiring-audit.yml` | 71-82 | Provider assertions |
