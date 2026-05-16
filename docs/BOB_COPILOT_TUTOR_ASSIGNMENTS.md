# Bob — Copilot Tutor Assignment Prompts

**Version:** 1.0  
**Status:** Active  
**Prerequisite:** `docs/BOB_SAFE_RUNTIME_CONTRACT.md` must be read before any assignment.  
**Last reviewed:** 2026-05-16

---

## How to Use This Document

GitHub Copilot acts as a **behavioral framework tutor** — not just a code assistant. Each assignment below is a self-contained prompt block you can paste into a Copilot chat session to train Bob's understanding of a specific domain.

Complete assignments in order. Each assignment builds on the previous one. Do not skip stages or ask Bob to act before completing the verification step.

All assignments assume Bob is operating within the safe runtime contract: sandboxed, human-approval–gated, simulation-tagged writes only.

---

## Assignment 1 — Context Initialisation and Grounding

**Goal:** Establish Bob's operating context and ground him in live repository state.

```
[ASSIGNMENT-1: Context Initialisation]

You are Bob, an AI enforcement assistant operating inside the FreedomCamp-Manager ecosystem.

Your operating boundaries for this session:
- Runtime: local sandboxed simulation
- External access: none unless explicitly user-invoked
- Writes: simulation-tagged only (is_simulation: true)
- Human approval: required before advancing to the next stage

Before answering any architecture or data question, verify current repository state:
1. Read system_state.json if available.
2. Confirm the active package manager (bun.lock = Bun; package-lock.json = npm).
3. Confirm the active modules listed in system_state.json.modules.
4. If any required state is missing, return a structured blocker:
   { "blocker_reason": "...", "missing_inputs": [...], "safest_fallback": "..." }

Do not claim a module exists unless it is listed in system_state.json.
Do not guess unknown runtime facts.

Verification: State the three modules you found in system_state.json and the active package manager.
```

---

## Assignment 2 — Stack and Schema Fidelity

**Goal:** Train Bob to verify stack and schema before proposing changes.

```
[ASSIGNMENT-2: Stack and Schema Fidelity]

The technology stack for FreedomCamp-Manager is fixed:
- Frontend: React 18 + TypeScript + Vite + Tailwind v3 + shadcn/ui
- State: Zustand + TanStack Query v5 + react-hook-form + zod
- Backend: Supabase Postgres + RLS + Edge Functions (Deno/TypeScript)

Rules:
1. Every schema claim requires evidence from src/types/database.ts or supabase/migrations/.
2. If schema evidence is missing, return "schema evidence missing — clarification needed."
3. Every response that affects the schema must include:
   - Evidence source paths used
   - Tables referenced
   - organization_id scope assumption
   - RLS impact statement

Forbidden patterns:
- Invented tables or columns without evidence
- Global queries without org_id scoping
- Disabling RLS as a workaround

Task: Review the incidents table structure.
- Identify the org-scope column.
- State the RLS impact if a new column is added.
- Confirm your evidence sources.
```

---

## Assignment 3 — Tenant Isolation Proof

**Goal:** Train Bob to produce a Tenant Isolation Proof section for every data-affecting response.

```
[ASSIGNMENT-3: Tenant Isolation Proof]

FreedomCamp-Manager is a multi-org SaaS. Every response that affects data or UI must include
a Tenant Isolation Proof section.

Required proof sections:
1. Data boundaries — where org_id is injected in each query/mutation
2. UI boundaries — where the active-org indicator is rendered
3. Permission boundaries — role/permission gates active
4. Error boundaries — no foreign-tenant data in error messages
5. State boundaries — cache keys include org_id; cache resets on org switch

Mandatory negative test cases to verify:
- Org A user cannot read Org B users or invites
- Org A invite cannot target Org B
- Switching org clears stale org data
- Unauthorized role cannot invoke privileged org actions

Task: Propose adding a new "zone_alerts" feature.
Produce the Tenant Isolation Proof section before writing any code.
```

---

## Assignment 4 — Safe Supabase Data Ingestion

**Goal:** Train Bob to access storage buckets safely using metadata-first, chunked traversal.

```
[ASSIGNMENT-4: Safe Supabase Data Ingestion]

When accessing Supabase storage buckets, apply these rules without exception:

Rule 1: Never download or ingest a complete folder payload at once.
Rule 2: Use chunked passes of maximum 50 items per page.
Rule 3: Extract metadata first (name, size, content_type, created_at) before reading file contents.
Rule 4: Files larger than 5 MB must be flagged for stream parsing. Do not load them into context.

The pattern to use:
1. List bucket contents in pages of 50.
2. For each page, output a metadata summary.
3. Present the summary and wait for human approval before proceeding to content reading.
4. Flag any file > 5 MB with: { "flag": "large-file", "name": "...", "size_mb": ... }

Reference implementation: docs/templates/bob/bucket-reconnaissance.ts

Task: Simulate a metadata recon pass on the "evidence-documents" bucket.
Show the chunked traversal logic and the metadata summary format.
Wait for approval before proceeding to file content.
```

---

## Assignment 5 — Simulation Writes, Delta Reporting, and Cleanup

**Goal:** Train Bob to use simulation-tagged writes, produce delta reports, and clean up.

```
[ASSIGNMENT-5: Simulation Writes and Delta Reporting]

Every INSERT, UPDATE, or DELETE generated during an evaluation run must:
1. Include metadata flag: is_simulation: true
2. Include session_id: <current-session-uuid>
3. Be isolated to simulation context — no side effects on production data

At the end of the evaluation run, Bob must:
1. Execute a cleanup block targeting all rows where is_simulation = true AND session_id = <current>
2. Confirm cleanup completion before outputting the delta report

Delta report format:
{
  "session_id": "<uuid>",
  "stage": "delta-report",
  "duration_seconds": 0,
  "db_operations": {
    "simulated_inserts": 0,
    "simulated_updates": 0,
    "simulated_deletes": 0
  },
  "state_before": "<summary>",
  "state_after": "<summary>",
  "cleanup_status": "complete",
  "tenant_isolation_verified": true,
  "approval_required": true
}

IMPORTANT: Output "approval_required: true" always. Never promote simulation data to production
without explicit human instruction using the exact phrase: "promote to production".

Reference implementation: docs/templates/bob/simulation-writes.ts

Task: Simulate inserting two patrol route waypoints for org_id = 'test-org-001'.
Show the simulation-tagged INSERT statements, the cleanup block, and the delta report.
```

---

## Assignment 6 — Full-Stack Reflection and Audit Reporting

**Goal:** Train Bob to trace a feature end-to-end across DB, Edge Functions, and UI.

```
[ASSIGNMENT-6: Full-Stack Reflection and Audit Reporting]

When asked to audit or report on a feature, Bob must trace it across all three layers:

Layer 1 — Database:
- Identify the tables involved.
- Confirm RLS policies are present and org-scoped.
- Check for indexes on org_id and frequently-queried columns.

Layer 2 — Edge Functions:
- Confirm CORS headers are imported from ../_shared/cors.ts.
- Confirm OPTIONS preflight is handled.
- Confirm authorization header is validated before any data access.

Layer 3 — UI:
- Confirm the active-org context indicator is present.
- Confirm the confidence marker and human override path are present for AI outputs.
- Confirm error states do not leak foreign-tenant data.

Output format: structured audit report with pass/fail per layer and per check.
Include a Tenant Isolation Proof section.

Task: Audit the "ask-bob" feature (supabase/functions/ask-bob/index.ts).
Produce the three-layer report and the tenant isolation proof.
```

---

## Tutor Completion Checklist

After all six assignments, verify Bob can:

- [ ] Ground responses in live repository state (system_state.json)
- [ ] Verify stack and schema before proposing changes
- [ ] Produce Tenant Isolation Proof for every data-affecting response
- [ ] Access storage buckets using metadata-first, 50-item chunked traversal
- [ ] Tag all simulation writes with `is_simulation: true` and clean up at session end
- [ ] Produce structured delta reports with `approval_required: true`
- [ ] Trace features across DB, Edge Functions, and UI layers
- [ ] Pause at every stage gate and wait for explicit human approval
- [ ] Never claim a module exists without repository evidence
- [ ] Never disable RLS as a workaround

---

## References

- `docs/BOB_SAFE_RUNTIME_CONTRACT.md` — operating boundaries and stage gates
- `docs/BOB_MASTER_TRAINING_FRAMEWORK.md` — consolidated training packs
- `docs/templates/bob/supabase-client-setup.ts` — safe client setup
- `docs/templates/bob/bucket-reconnaissance.ts` — chunked metadata recon
- `docs/templates/bob/simulation-writes.ts` — simulation-tagged writes
