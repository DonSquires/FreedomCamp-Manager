# BOB_INSTRUCTIONS.md — FieldOps Manager Agentic SOP

> **Audience**: Bob (the AI ops agent) — not human developers.
> This document tells Bob how to operate the FieldOps Manager development loop
> autonomously without asking for clarification.

---

## 1. Running the Emulator

```bash
# Start the Vite dev server (http://localhost:5173)
bun run dev

# Run ALL Playwright E2E tests in headless Chromium
bunx playwright test --config playwright.config.ts

# Run only the deep-functional suite
bunx playwright test tests/e2e/deep-functional.spec.ts

# Run with visible browser (debug mode)
bunx playwright test --headed

# Run with MOCK_MODE so no RunPod/Whisper calls happen
MOCK_MODE=true bunx playwright test
```

**Pre-flight checklist before running tests:**
1. `bun run build` must pass (type errors → fix before testing)
2. Dev server must be on port 5173 (check with `lsof -i :5173`)
3. Verify `.env.playwright.local` exists with all four role credentials

---

## 2. Checking Supabase RLS for Multi-Tenant Safety

```bash
# Grep all SQL migrations for policies on a given table
grep -r "CREATE POLICY" supabase/migrations/ | grep <table_name>

# Check the live schema policy names
cat docs/LIVE_SCHEMA.md | grep -A3 "policy"
```

**Rules Bob must verify after any schema change:**
- Every table that has an `organization_id` column MUST have an RLS policy that filters by `auth.uid()`'s `organization_id`
- `user_profiles` must NEVER be readable cross-tenant (check policies include `organization_id = auth.jwt() ->> 'organization_id'`)
- Use `SUPABASE_SERVICE_ROLE_KEY` only in server-side Edge Functions and synthetic test teardown — never in browser-facing code

---

## 3. Debugging PTT Translation Failures Without Asking

When a PTT test fails, work through these steps automatically:

### Step 1: Check if the inference service is reachable
```bash
curl -s http://localhost:3000/health/stack | jq .services
```
Expected: `{"runpod":"online","supabase":"online","ollama":"online"}`
If RunPod is offline → set `MOCK_MODE=true` and re-run

### Step 2: Check the PTT translate endpoint
```bash
curl -s -X POST http://localhost:3000/infer/transcribe \
  -H "Content-Type: application/json" \
  -d '{"audio":"<base64-wav>","language":"en"}'
```

### Step 3: Inspect ptt-server logs
```bash
cd ptt-server && node server.js 2>&1 | head -50
```
Look for: `WebSocket connected`, `STUN/TURN negotiated`, `relay latency`

### Step 4: Check Supabase notifications table
```bash
# Via REST
curl -s "$VITE_SUPABASE_URL/rest/v1/notifications?order=created_at.desc&limit=10" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" | jq .[].title
```

### Step 5: Cross-reference telemetry
```bash
bash scripts/aggregate-telemetry.sh --tail
```

If all 5 steps pass but the test still fails → write a note in `knowledge_base/ptt-debug-log.md`

---

## 4. Mock vs Live Test Strategy

| Scenario | Setting | When to use |
|---|---|---|
| UI layout / interaction tests | `MOCK_MODE=true` | Always, no external deps needed |
| Translation accuracy tests | `MOCK_MODE=false` | Only with RunPod online |
| PTT latency tests | Use `network-profile.ts` fixture | Simulate slow3g/fast3g in CI |
| Multi-tenant RLS tests | `synthOrg` fixture | Per-test clean org, auto-deleted |
| Full production smoke | `MOCK_MODE=false` + live creds | Manual gate before release |

**Switching mock mode:**
- In `.env.playwright.local`: add `MOCK_MODE=true`
- In `inference-service/.env`: add `MOCK_MODE=true`
- Via fixture: `MOCK_MODE=true bunx playwright test`

---

## 5. Telemetry Cross-Referencing

The Observer aggregator collects logs from all services into `system_telemetry.log`:

```bash
# One-shot aggregation snapshot
bash scripts/aggregate-telemetry.sh

# Live tail
bash scripts/aggregate-telemetry.sh --tail
```

Bob should cross-reference test failure timestamps with `system_telemetry.log` before
reporting an error. If the log shows `runpod: error` at the same time as the test failure,
the root cause is infra not code.

---

## 6. Model Tier Routing

| Workload | Environment Variable | Default URL |
|---|---|---|
| PTT audio (fast) | `OLLAMA_PTT_BASE_URL` | `OLLAMA_BASE_URL` |
| Tabular NLP | `OLLAMA_TABULAR_BASE_URL` | `OLLAMA_BASE_URL` |
| Chat / writing | `OLLAMA_CHAT_BASE_URL` | `OLLAMA_BASE_URL` |
| Heavy GPU (ONNX/ALPR) | `RUNPOD_ENDPOINT_URL` | RunPod serverless |

**Economical dev setup** (all lightweight, no GPU):
```
OLLAMA_PTT_BASE_URL=http://ollama:11434
OLLAMA_TABULAR_BASE_URL=http://ollama:11434
OLLAMA_CHAT_BASE_URL=http://ollama:11434
MOCK_MODE=true
```

---

## 7. Test Credential Inventory

Credentials are in `.env.playwright.local` (not committed). Current layout:

| Role | Note |
|---|---|
| admin | `squires.don@gmail.com` |
| master | `squires.don@gmail.com` |
| officer | `littlemissno5@gmail.com` — **must exist in Supabase with `officer` role** |
| admin_officer | `squires.don@gmail.com` |

If Bex (officer) login fails:
1. Verify the account exists in Supabase Auth → `Authentication > Users`
2. Verify `user_profiles` row has `role = 'officer'` and `organization_id` matches
3. If not → create the account in Supabase dashboard and update the profile, OR use the `synthOrg` fixture with a dynamically seeded officer

---

## 8. Safe Defaults Bob Must Never Override

- **Never** commit `SUPABASE_SERVICE_ROLE_KEY` or `RUNPOD_ENDPOINT_API_KEY` to source code
- **Never** delete Playwright test output in `playwright-report/` without reading it first
- **Never** hard-reset migrations — use new migration files instead
- **Never** tighten TypeScript settings (`noImplicitAny`, `strictNullChecks`, `skipLibCheck`)
- **Never** push directly to `main` — use feature branches

---

## 9. Knowledge Base

Bob writes self-correcting notes to `knowledge_base/` — one topic per file.
When Bob discovers a non-obvious fix or root cause, it appends the finding to the
appropriate file so that next time the same issue appears, retrieval is instant.

```
knowledge_base/
├── README.md           ← this document's index
├── ptt-debug-log.md    ← PTT-specific failures and fixes
├── rls-gotchas.md      ← RLS policy edge cases
├── test-creds.md       ← Living record of test credential issues
└── model-tier-routing.md ← Routing decisions and reasoning
```

---

## 10. Architectural Context Injection (UI/UX + System Design)

These standards are mandatory for redesign and new-module requests.

### 10.1 Multi-Org Driver (UX)
- Scope all data and UI state by `organizationId`.
- Every view must show a visible active-org context indicator.
- Never leak data, controls, or states between organizations.

### 10.2 Visual Hierarchy (Refactoring UI style)
- Prefer spacing and typography hierarchy over heavy borders.
- Color semantics are functional only:
  - Action: blue
  - Success: green
  - Warning (PTT pending/transmitting): amber
  - Destructive: red

### 10.3 Real-Time + PTT Logic
- Use optimistic updates for user-triggered actions.
- Always represent and test these states:
  - idle
  - processing/sending
  - synced
  - error
- Design with latency bridge assumptions (RunPod/VPS + proxy path).

### 10.4 Modular Architecture
- New features belong under `src/modules/<module-name>/`.
- Module redesigns must be self-contained and avoid core cross-coupling.
- A redesign in one module must not require unrelated module rewrites.

### 10.5 Required Knowledge Base Alignment
- Apply principles from:
  - Refactoring UI (visual hierarchy and composition)
  - Laws of UX (usability patterns)
  - Clerk-style multi-tenant org switching patterns

### 10.6 Bob Blueprint (Module Template)
All module work should follow:

```
src/modules/<module-name>/
  components/
  services/
  hooks/
  types.ts
```

Mandatory implementation rules:
- Begin with org-context resolution (`activeOrgId`, permissions).
- Include org context in every fetch/mutation boundary.
- For signal-style actions, use state machine:
  - `idle | transmitting | synced | error`
- Dashboard standard:
  - Header with active org + breadcrumbs
  - 12-column responsive grid (single-column mobile collapse)
  - Purpose-specific empty state

Validation checklist before completion:
- No cross-org leakage
- Works on low-spec Ubuntu VPS
- Keyboard accessible
- Refactoring UI hierarchy applied

---

## 11. Recommended Training Packs (Mandatory)

For redesign/new-module requests, apply all three packs together:

- docs/BOB_TRAINING_STACK_SCHEMA_FIDELITY.md
- docs/BOB_TRAINING_TENANT_ISOLATION_PROOF.md
- docs/BOB_TRAINING_SELF_EVAL_LOOP.md
- docs/BOB_TRAINING_TRUTH_PROTOCOL.md
- docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md

### 11.1 Required Output Sections

- Schema Evidence
- Tenant Isolation Proof
- Self-Eval Gates (all pass or explicit blocker)

### 11.2 Refusal Rule

If a response cannot satisfy stack fidelity, schema truth, and tenant isolation proof,
do not fabricate. Return blocker details and safest fallback.

---

## 12. Verification Script Truth Protocol (Mandatory before major redesign)

Before any major architectural redesign or module-wide UI proposal:

1. Run `bash scripts/system-check.sh` (or `node scripts/system-check.mjs`).
2. Read `system_state.json` before proposing architecture.
3. If a module is not in `system_state.json.modules`, do not claim it exists.
4. Determine package manager from `system_state.json.lockfiles`:
  - `bun.lock` => Bun
  - `package-lock.json` => npm
5. Never guess missing runtime facts. Return blocker + safest fallback.

Required operator prompt when drift is detected:

"Bob, before you provide any code or architectural advice, you must check system_state.json. If a module or package is not listed in that file, you are prohibited from assuming it exists. If you are asked to use a package manager, look at the lockfiles array. If bun.lock exists, use Bun. If package-lock.json exists, use NPM. Never guess."

---

## 13. Advanced Architect Training (Spec-Driven, Agentic, RLHF)

Apply the advanced training pack for major redesigns and new modules:

- `docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md`

Operational rules:

1. Spec-First workflow:
  - produce `spec.md`
  - self-critique with at least 3 flaws
  - produce `plan.md` with bite-sized tickets
  - implement one ticket at a time
2. Dr Bob review loop:
  - Dr Bob must challenge architecture assumptions before merge-ready status
  - Bob cannot claim done while required tests fail
3. RLHF scoring:
  - reward grounded tenant-safe answers explicitly
  - penalize hallucinations explicitly with cause
