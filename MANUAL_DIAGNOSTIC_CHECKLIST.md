# Manual Diagnostic Checklist — Three-Step Validation

**Date**: April 5, 2026  
**Purpose**: Execute all three diagnostics in order to provide Bob with runtime data  
**Note**: GitHub CLI dispatch permissions limited; use manual execution instead

---

## Step 1: Wiring Audit (Manual Execution)

**What it validates**: Bob service URLs, status, and Ollama configuration (RunPod)

**Manual command** (requires VITE_SUPABASE_URL and SUPABASE_JWT):
```bash
export SUPABASE_URL="<VITE_SUPABASE_URL>"
export JWT_TOKEN="<YOUR_SUPABASE_JWT>"

curl -s "${SUPABASE_URL}/functions/v1/check-railway-health" \
  -H "Authorization: Bearer $JWT_TOKEN" | jq '.' > wiring-audit-result.json

cat wiring-audit-result.json
```

**What Bob expects to see**:
```json
{
  "proxy_url": "https://proxy-server.railway.app",
  "inference_url": "https://api.runpod.ai/v2/<RUNPOD_ENDPOINT_ID>/runsync",
  "ptt_url": "https://ptt-server.railway.app",
  "proxy": { "status": "ok" },
  "inference": {
    "status": "healthy",
    "config": {
      "CHAT_PROVIDER": "ollama",
      "TABULAR_NLP_PROVIDER": "ollama"
    },
    "capabilities": {
      "chat_local_ollama_enabled": true,
      "tabular_nlp_ollama_enabled": true
    }
  },
  "ptt": { "status": "ok" },
  "inference_api_key_configured": true,
  "ollama_circuit_breaker": {
    "state": "closed",
    "consecutiveFailures": 0,
    "threshold": 3,
    "lastError": null
  }
}
```

**Diagnostic Logic**:
| Field | Expected | If Fails | Bob's Action |
|-------|----------|----------|--------------|
| `inference.status` | `healthy` | Shows error | Restart inference service on Railway |
| `CHAT_PROVIDER` | `ollama` | Shows different value | Update Railway env: `CHAT_PROVIDER=ollama` |
| `chat_local_ollama_enabled` | `true` | Shows `false` | Check OLLAMA_BASE_URL on RunPod pod (should be `http://127.0.0.1:11434`) |
| `circuit_breaker.state` | `closed` | Shows `open` | Ollama service is down; restart it |

**Status file**: Save output to `diagnose-step1-wiring-audit.json`

---

## Step 2: Smoke Test — Preflight Check (Manual Execution)

**What it validates**: Inference health + Ollama provider availability before chat prompts

**Manual command** (requires INFERENCE_SERVICE_URL and INFERENCE_API_KEY):
```bash
export INFERENCE_URL="<INFERENCE_SERVICE_URL>"
export INFERENCE_KEY="<INFERENCE_API_KEY>"

curl -s "${INFERENCE_URL}/health" \
  -H "x-inference-api-key: $INFERENCE_KEY" | jq '.' > smoke-preflight-health.json

cat smoke-preflight-health.json
```

**What Bob expects to see**:
```json
{
  "status": "healthy",
  "config": {
    "CHAT_PROVIDER": "ollama",
    "TABULAR_NLP_PROVIDER": "ollama",
    "OLLAMA_BASE_URL": "http://127.0.0.1:11434"
  },
  "capabilities": {
    "chat_local_ollama_enabled": true,
    "tabular_nlp_ollama_enabled": true
  },
  "ollama_circuit_breaker": {
    "state": "closed",
    "consecutiveFailures": 0,
    "threshold": 3,
    "cooldownMs": 60000,
    "lastError": null
  }
}
```

**Diagnostic Logic**:
| Field | Expected | If Fails | Bob's Action |
|-------|----------|----------|--------------|
| `status` | `healthy` | Shows error | Service is down; restart |
| `CHAT_PROVIDER` | `ollama` | Shows `heuristic` | Config error; fix env var |
| `chat_local_ollama_enabled` | `true` | Shows `false` | Ollama URL unreachable; check networking |
| `circuit_breaker.state` | `closed` | Shows `open` | Ollama has failed 3+ times; restart |
| `circuit_breaker.lastError` | `null` | Shows error string | That error is why fallback is happening |

**Status file**: Save output to `diagnose-step2-smoke-preflight.json`

---

## Step 3: Manual Health Check via Circuit Breaker

**What it validates**: Current Ollama circuit breaker state (immediate indicator)

**Manual command** (requires INFERENCE_SERVICE_URL and INFERENCE_API_KEY):
```bash
export INFERENCE_URL="<INFERENCE_SERVICE_URL>"
export INFERENCE_KEY="<INFERENCE_API_KEY>"

curl -s "${INFERENCE_URL}/health" \
  -H "x-inference-api-key: $INFERENCE_KEY" \
  | jq '.ollama_circuit_breaker' > diagnose-step3-circuit-breaker.json

cat diagnose-step3-circuit-breaker.json
```

**What Bob expects to see**:
```json
{
  "state": "closed",
  "consecutiveFailures": 0,
  "threshold": 3,
  "cooldownMs": 60000,
  "lastError": null
}
```

**Diagnostic Decision Tree** (Bob reads this):

```
IF state == "closed" AND lastError == null:
  → Ollama is healthy and available
  → If smoke test still fails, check: CHAT_PROVIDER config or network routing
  
IF state == "open":
  → Ollama has failed 3+ consecutive times
  → Action: Restart Ollama service on RunPod pod
  → Then: Wait 60 seconds for cooldown
  → Then: Re-run smoke test
  
IF state == "half-open":
  → Ollama was down; now attempting recovery
  → Action: Wait 60 seconds (OLLAMA_CB_COOLDOWN_MS)
  → Then: Re-run smoke test to trigger next probe
  
IF lastError contains "ECONNREFUSED" or "ETIMEDOUT":
  → Ollama is unreachable at OLLAMA_BASE_URL
  → Action: Check Railway internal DNS resolution
  → Action: Verify OLLAMA_BASE_URL is http://127.0.0.1:11434
```

**Status file**: Save output to `diagnose-step3-circuit-breaker.json`

---

## Bob's Unified Diagnosis (After All Three Steps)

Once you provide all three JSON files, Bob will:

1. **Correlate** the three outputs
2. **Identify** which condition is causing the fallback
3. **Recommend** specific fix (env var, service restart, or network troubleshooting)

**Example output**:
```
DIAGNOSIS: Ollama circuit breaker is OPEN (state="open")
EVIDENCE:
  - Step 1 (Wiring): circuit_breaker.state="open"
  - Step 2 (Preflight): circuit_breaker.state="open"
  - Step 3 (CB): state="open", lastError="ECONNREFUSED"
INTERPRETATION: Ollama service is not responding at http://127.0.0.1:11434
ROOT CAUSE: Ollama pod crashed or is unreachable due to network isolation
RECOMMENDED FIX:
  1. SSH into RunPod pod
  2. Restart Ollama process
  3. Wait 60 seconds for circuit breaker cooldown
  4. Re-run smoke test; should now pass
```

---

## How to Proceed

**Option A**: Run all three diagnostics manually (recommended)  
```bash
# You provide credentials; I execute the curl commands
# You provide JSON output; Bob analyzes
```

**Option B**: Create synthetic bug_report (alternative)  
```bash
# Create bug_report in Supabase with Ollama failure evidence
# Trigger auto-analyse-report edge function
# Bob's AI analysis is stored in bug_reports.ai_suggested_fix
```

**Option C**: Provide any one JSON output  
```bash
# Even partial data helps Bob narrow down the diagnosis
# E.g., just the circuit_breaker state is enough to suggest restart
```

---

## Required Credentials

To execute manual diagnostics, provide (in order):
1. `VITE_SUPABASE_URL` — Supabase project URL
2. `SUPABASE_JWT` — Valid Supabase JWT token (for check-railway-health call)
3. `INFERENCE_SERVICE_URL` — Bob inference service URL (RunPod)
4. `INFERENCE_API_KEY` — API key for inference service (x-inference-api-key header)

**Privacy Note**: Credentials are only used to query `/health` endpoints; no data is collected or stored locally.

---

## Next Steps

👉 **Provide the credentials listed above**  
👉 **I will execute all three diagnostics**  
👉 **Results saved to diagnose-step*.json files**  
👉 **Bob analyzes and provides structured recommendation**

Ready when you are.
