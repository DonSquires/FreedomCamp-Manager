# Bob Analysis Session: Ollama Fallback Issue

**Session ID**: bob-session-20260405-001  
**Initiated**: April 5, 2026 (static analysis mode)  
**Status**: ANALYSIS READY FOR EXECUTION

---

## Input: Synthetic Bug Report

```json
{
  "id": "synthetic-20260405-ollama-fallback",
  "issue_type": "bug",
  "severity": "high",
  "title": "Chat requests return heuristic provider instead of ollama",
  "description": "Smoke test ops-bob-human-interaction-smoke.yml is failing. Three consecutive chat prompts all return provider=heuristic with fallback=true, but expected provider=ollama. This indicates Ollama is not available or misconfigured.",
  "steps_to_reproduce": "Run .github/workflows/ops-bob-human-interaction-smoke.yml",
  "console_errors": [
    "Expected provider ollama but got heuristic",
    "Unexpected fallback=true in response"
  ],
  "ci_status": {
    "workflow": "ops-bob-human-interaction-smoke",
    "status": "failure",
    "run_id": "recent",
    "logs": "smoke-chat job failed after 1 hour with exit code 1"
  }
}
```

---

## Bob's Diagnostic Reasoning Engine

### Step 1: Assess Provider Fallback Conditions

**Query**: Inference service returns heuristic when?

**Code Reference**: `inference-service/server.js` lines 887-956

```javascript
async function generateChatReplyWithOllama(message, history = [], context = {}) {
  // Condition 1: OLLAMA_ENABLED is false
  if (!OLLAMA_ENABLED) {
    return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
  }

  // Condition 2: Circuit breaker is open
  if (!ollamaCircuitBreaker.allowRequest()) {
    return { provider: 'heuristic', text: generateHeuristicChatReply(message, context), fallback: true };
  }

  // Condition 3: HTTP error from Ollama
  if (!response.ok) {
    ollamaCircuitBreaker.recordFailure(new Error(`HTTP ${response.status}`));
    return { provider: 'heuristic', ... fallback: true };
  }

  // Condition 4: Empty response payload
  if (!content || typeof content !== 'string') {
    return { provider: 'heuristic', ... fallback: true };
  }

  // Condition 5: Timeout or socket error
  catch (error) {
    ollamaCircuitBreaker.recordFailure(error);
    return { provider: 'heuristic', ... fallback: true };
  }
}
```

**Bob's Assessment**: All 5 conditions result in the observed behavior (provider=heuristic, fallback=true).

---

### Step 2: Trace OLLAMA_ENABLED Logic

**Code Reference**: `inference-service/server.js` line 189

```javascript
const OLLAMA_ENABLED = OLLAMA_REQUESTED && (!SELF_CONTAINED_MODE || isLocalUrl(OLLAMA_BASE_URL));
```

**Breaking it down:**
- `OLLAMA_REQUESTED = (CHAT_PROVIDER === 'ollama' || TABULAR_NLP_PROVIDER === 'ollama')`
- `SELF_CONTAINED_MODE = env var check`
- `isLocalUrl(OLLAMA_BASE_URL) = hostname is localhost/127.0.0.1/::1`

**Bob's Check**: Is Ollama actually requested AND reachable?

---

### Step 3: Determine Most Likely Cause

**Evidence Chain**:
1. Smoke test sends explicit `provider=ollama` request
2. All 3 prompts get heuristic fallback
3. This happens consistently (not transient)
4. No circuit breaker state reported in error (suggests Condition 1 or 2)

**Bob's Hypothesis Ranking**:

| Rank | Cause | Likelihood | Evidence |
|------|-------|------------|----------|
| 1 | `CHAT_PROVIDER` env is not `ollama` at runtime | HIGH | Smoke test hardening shows this is checked now; if preflight passes, this is ruled out |
| 2 | `OLLAMA_BASE_URL` not reachable from Railway | HIGH | Network isolation between services or port mismatch (11434 vs 3000) |
| 3 | Circuit breaker is open | MEDIUM | Would indicate Ollama failed 3+ times; health endpoint shows state |
| 4 | `SELF_CONTAINED_MODE=true` + OLLAMA_BASE_URL is external | MEDIUM | Config policy prevents outbound to non-local |
| 5 | Ollama service crashed/not running | MEDIUM | Would cause repeated connection failures → circuit breaker trip |

---

### Step 4: Map to Validation Steps

**Bob's Validation Sequence**:

```
Question 1: Is smoke preflight reporting chat_local_ollama_enabled=true?
  → YES: Ollama is enabled; circuit breaker is not open
    Go to → Question 2
  → NO: Either CHAT_PROVIDER or OLLAMA_BASE_URL is wrong
    Diagnosis: FIX RAILWAY ENV VARIABLES
    
Question 2: Is health endpoint reachable and returning HTTP 200?
  → YES: Inference service is up
    Go to → Question 3
  → NO: Inference service is down
    Diagnosis: RESTART INFERENCE SERVICE on Railway
    
Question 3: What is the circuit breaker state?
  → "closed": Normal operation; Ollama should be working
    Diagnosis: Ollama pod is running but not responding to chat requests
    ACTION: Check Ollama logs; restart Ollama service
    
  → "open": Circuit tripped after 3+ failures
    Diagnosis: Ollama is unreachable or timing out
    ACTION: Verify OLLAMA_BASE_URL is correct port (3000 not 11434 on Railway)
    ACTION: Restart Ollama service on RunPod pod
    
  → "half-open": Probe request allowed; next request will determine fate
    Diagnosis: Waiting for Ollama recovery
    ACTION: Wait 60 seconds (OLLAMA_CB_COOLDOWN_MS); re-test
```

---

### Step 5: Propose Fixes

**Bob's Recommended Action Plan**:

#### Fix Path A: Environment Alignment (Highest Priority)

**Validation Command** (human must run):
```bash
# 1. Trigger wiring audit workflow
gh workflow run ops-railway-wiring-audit.yml

# 2. Wait for result; check output JSON
gh run list --workflow=ops-railway-wiring-audit.yml --limit=1 --json conclusion

# 3. If FAILED, check which assertion failed
curl https://<VITE_SUPABASE_URL>/functions/v1/check-railway-health \
  -H "Authorization: Bearer <SUPABASE_JWT>"
```

**Expected Output** (if healthy):
```json
{
  "inference": {
    "status": "healthy",
    "config": {
      "CHAT_PROVIDER": "ollama",
      "TABULAR_NLP_PROVIDER": "ollama"
    }
  },
  "capabilities": {
    "chat_local_ollama_enabled": true,
    "tabular_nlp_ollama_enabled": true
  },
  "ollama_circuit_breaker": {
    "state": "closed",
    "consecutiveFailures": 0,
    "threshold": 3,
    "cooldownMs": 60000
  }
}
```

**If NOT healthy**, diagnose by field:

| Field | Value | Action |
|-------|-------|--------|
| `CHAT_PROVIDER` | not `ollama` | Set Railway env: `CHAT_PROVIDER=ollama` |
| `chat_local_ollama_enabled` | `false` | Check `OLLAMA_BASE_URL` (should be `http://127.0.0.1:11434`) |
| `circuit_breaker.state` | `open` | Ollama is down; restart Ollama on RunPod pod |
| `inference.status` | not `healthy` | Restart Bob inference (RunPod) service |

#### Fix Path B: Ollama Service Recovery

```bash
# If circuit breaker is open:
# 1. SSH to RunPod pod
railway shell -s ollama-production

# 2. Check Ollama is running
ps aux | grep ollama

# 3. If not running, start it
# 4. Exit shell
# 5. Wait 60s for circuit breaker cooldown
# 6. Re-run smoke test

sleep 60
gh workflow run ops-bob-human-interaction-smoke.yml
```

#### Fix Path C: Emergency Recovery (If Neither Works)

```bash
# Restart inference service to reset circuit breaker
railway restart -s inference-service

# Wait for cold start
sleep 30

# Re-validate
gh workflow run ops-railway-wiring-audit.yml
```

---

### Step 6: Expected Outcomes

**After applying Fix Path A** (env alignment):
```
Smoke test run 2:
- Preflight: ✅ chat_local_ollama_enabled=true
- Prompt 1: ✅ provider=ollama, fallback=false
- Prompt 2: ✅ provider=ollama, fallback=false
- Prompt 3: ✅ provider=ollama, fallback=false
Result: PASS
```

**After applying Fix Path B** (Ollama restart):
```
Smoke test run 3:
- Health check: ✅ circuit_breaker.state="closed"
- Prompt 1: ✅ provider=ollama, fallback=false
Result: PASS
```

---

## Bob's Confidence Levels

| Diagnosis | Confidence | Evidence Strength |
|-----------|------------|------------------|
| CHAT_PROVIDER env is wrong | 🔴 LOW | Smoke preflight now checks this; will be explicit if wrong |
| OLLAMA_BASE_URL unreachable | 🟡 MEDIUM | Common Railway service-to-service issue; preflight can validate |
| Circuit breaker is open | 🟡 MEDIUM | Would see fallback on ALL requests; health endpoint shows state |
| Ollama service is down | 🟢 HIGH | Matches observed behavior (consistent fallback); fixable in <2min |

---

## Integration with auto-analyse-report

**When human creates bug_report** with this analysis attached:

1. `auto-analyse-report` edge function triggers
2. Fetches GitHub CI status (most recent 5 workflow runs)
3. Calls `/self-heal/bug-report` with:
   - Report title + description
   - Console errors: `["Expected provider ollama but got heuristic"]`
   - CI context: Smoke test failure + logs
4. Inference service processes via Bob's self-heal logic
5. Bob returns structured analysis + suggested fix
6. Result stored in `bug_reports.ai_suggested_fix` column

**Output Example**:
```json
{
  "analysis": "Ollama provider fallback indicates service unavailability or misconfiguration",
  "root_cause": "Circuit breaker is open (Ollama failed 3+ times) OR CHAT_PROVIDER env is not 'ollama'",
  "suggested_fix": "1) Run wiring audit to validate config; 2) If config ok, restart Ollama service; 3) Re-run smoke test",
  "severity": "high",
  "require_human_review": false
}
```

---

## Commands Ready for Human Execution

```bash
# 1. Validate current wiring
.github/workflows/ops-railway-wiring-audit.yml

# 2. Re-run smoke test with new diagnostics
.github/workflows/ops-bob-human-interaction-smoke.yml

# 3. Check circuit breaker state (manual)
curl -s https://<INFERENCE_SERVICE_URL>/health | jq '.ollama_circuit_breaker'

# 4. Create bug_report for Bob's auto-analysis (needs Supabase CLI)
supabase db push  # Ensure migrations are current

# 5. Trigger Bob's auto-analyse-report workflow
.github/workflows/bug-report-escalator.yml
```

---

## Next Checkpoint

**Bob is ready to execute IF**:
- ✅ Diagnosis plan is committed to repo
- ✅ Smoke workflow is enhanced with preflight
- ✅ Human provides next run's health artifact OR runs wiring audit

**Bob will then**:
- Correlate health state with circuit breaker readings
- Propose specific env var changes OR service restart
- Document findings in auto-analysed bug_report for human review

