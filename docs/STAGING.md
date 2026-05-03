# STAGING — Unified Execution To-Do and Crash Recovery Plan

Date: 2026-05-03
Owner: GitHub Copilot (GPT-5.3-Codex)
Status: Active staging checklist

## 1. Purpose

This is the single staging plan to resume work safely after interruptions.
It ties together the instruction manual, enterprise plans, governance records, and runtime checks.
If there is any conflict between documents, follow the authority order in Section 2.

## 2. Document Authority Order

Read and apply in this order:

1. `docs/INSTRUCTION_MANUAL.md` (product and operational baseline)
2. `docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md` (canonical execution authority)
3. `docs/ENTERPRISE_COLLAB_EXECUTION_PLAN_2026-05-02.md` (active phase plan)
4. `docs/MODULE_ROADMAP.md` (route and role map)
5. `docs/PHASE1_WORKFLOW_MATRIX_2026-05-02.json` (test workflow inventory)
6. `docs/MASTER_IMPLEMENTATION_PLAN_2026-05-01.md` (historical baseline only)
7. `docs/DECISIONS.md` and `docs/LESSONS_LEARNED.md` (durable guardrails)
8. `spec.md` and `plan.md` (target-state roadmap, not assumed current state)

## 3. Restart-After-Crash Checklist

Run in order every time a session restarts:

1. Confirm repo context.
```bash
git rev-parse --show-toplevel
git status -sb
```

2. Re-sync truth state.
```bash
bash scripts/system-check.sh
node scripts/summarize-failures.mjs
```

3. Refresh architecture/doc ingestion.
```bash
node scripts/auto-ingest.mjs
```

4. Re-check local quality gates.
```bash
bun run lint
bun run build
node --test ptt-server/test/radio-health-schema.test.js
```

5. Re-check CI for current HEAD.
```bash
sha=$(git rev-parse HEAD)
GH_PAGER=cat gh run list --limit 120 --json databaseId,headSha,name,status,conclusion,url \
  --jq '.[] | select(.headSha=="'"$sha"'") | [.databaseId,.name,.status,.conclusion,.url] | @tsv'
```

6. Resume only from the first unchecked item in Section 6.

## 4. Required Tools and Installation (Alpine)

Install base tooling:

```bash
apk update
apk add --no-cache bash git curl wget jq ca-certificates openssh-client
apk add --no-cache nodejs npm python3 make g++
```

Install Bun (if missing):

```bash
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
bun --version
```

Install project dependencies:

```bash
cd /workspaces/FreedomCamp-Manager
bun install
```

Install Playwright browsers and deps:

```bash
cd /workspaces/FreedomCamp-Manager
bunx playwright install --with-deps chromium webkit
```

Install GitHub CLI (if missing):

```bash
apk add --no-cache github-cli
gh --version
```

Authenticate GitHub CLI:

```bash
gh auth status || gh auth login
```

Optional local services for deeper staging tests:

```bash
apk add --no-cache redis
redis-server --version
```

## 5. Operating Instructions for the Agent

1. Always run truth sync (`system-check` + failure summary) before edits.
2. Never claim target-state features exist unless verified in repo files or `system_state.json`.
3. Keep canonical authority docs in sync when changing route, role, schema, CI, or governance behavior.
4. Treat local Playwright credential failures as environment blockers unless CI reproduces code failure.
5. After each material change: lint, build, relevant tests, then CI status pull for current SHA.
6. If conflicts appear across plans, update canonical doc first, then align downstream docs.

## 6. Staging To-Do List (Cross-Document)

### A. Authority and Governance

- [x] Verify `docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md` reflects the latest commit hash and cycle date.
- [x] Confirm `docs/ENTERPRISE_COLLAB_EXECUTION_PLAN_2026-05-02.md` still matches canonical priorities.
- [x] Run doc authority checks and archive output for handoff evidence.
```bash
bun run lint:doc-authority
```

### B. PTT and Radio Readiness

- [x] Confirm PTT control-plane health schema remains stable (`/radio/health` contract).
- [x] Validate Phase 1 radio workflow remains green in CI.
- [ ] Re-run degradation and consent related checks according to `docs/INSTRUCTION_MANUAL.md` and `docs/radio-degradation-runbook.md`.

### C. Workflow Evidence Integrity

- [x] Validate all P0 workflow IDs in `docs/PHASE1_WORKFLOW_MATRIX_2026-05-02.json` have fresh evidence references.
- [x] Re-run evidence collection scripts if any workflow is stale.
```bash
node scripts/collect-workflow-evidence.mjs
node scripts/validate-workflow-evidence.mjs
```

### D. Multi-Org and Access Controls

- [x] Reconfirm role-route mapping against `docs/MODULE_ROADMAP.md` and `src/App.tsx`.
- [x] Re-run org-scoping verification artifacts before release candidate promotion.

Current finding: org-scoping static audit now reports `missing_org_filter=0` after latest remediation pass (down from 47).

### E. Release Gate Discipline

- [x] Ensure each release gate run ends with GO, CONDITIONAL_GO, or NO_GO and all blockers have owners.
- [x] Keep CI run IDs and outcomes logged in Section 7 before ending a session.

## 7. Session Handoff Log (Update Before Exit)

Fill this before stopping work:

- Timestamp (NZ):
- Current branch:
- HEAD SHA:
- Working tree status (`git status -sb`):
- Latest lint result:
- Latest build result:
- Latest targeted test result:
- Active/last CI run IDs:
- Open blockers with owner:
- Next exact command to run:

Latest Session Snapshot:

- Timestamp (NZ): 2026-05-03 19:16:42 NZST
- Current branch: main
- HEAD SHA: 10319594f3f5bf57756ceed9f707ea091436d9e6
- Working tree status (`git status -sb`): clean (`## main...origin/main`)
- Latest lint result: pass (`LINT_EXIT=0`)
- Latest build result: pass (`vite build`, 3953 modules transformed, built in 21.42s)
- Latest targeted test result: pass (`node --test ptt-server/test/radio-health-schema.test.js`, 3 passed, 0 failed)
- Active/last CI run IDs:
  - `25272681980` Governance Release Gate: success
  - `25272681977` policy-bob-no-openai: success
  - `25272681982` Validate RunPod Image Tags: success
  - `25272681979` Deploy Admin Portal to Vercel: success
  - `25272788170` Synthetic UI Monitor: success
- Open blockers with owner: none
- Next exact command to run: `cd /workspaces/FreedomCamp-Manager && bash scripts/system-check.sh && node scripts/summarize-failures.mjs && bun run lint && bun run build`

Latest Session Snapshot:

- Timestamp (NZ): 2026-05-03 19:35:58 NZST
- Current branch: main
- HEAD SHA: 34e84bcba0a5e12109794e7496af12a8cdec3cbb
- Working tree status (`git status -sb`): clean (`## main...origin/main`)
- Latest lint result: pass (`bun run lint`)
- Latest build result: pass (`bun run build`)
- Latest targeted test result: pass (`node --test ptt-server/test/radio-health-schema.test.js`, 3 passed, 0 failed)
- Active/last CI run IDs:
  - `25273201961` Governance Release Gate: success
  - `25273201959` policy-bob-no-openai: success
  - `25273201958` Validate RunPod Image Tags: success
  - `25273201956` CI Build High Memory: success
  - `25273201952` CI Org Isolation API: success
  - `25273201963` Deploy Admin Portal to Vercel: in progress
- Open blockers with owner:
  - Org-scoping audit still reports 45 missing org filters; owner: Application architecture + data governance
- Next exact command to run: `cd /workspaces/FreedomCamp-Manager && node scripts/audit-org-scoping.mjs && GH_PAGER=cat gh run list --limit 20 --json databaseId,headSha,name,status,conclusion,url`

Latest Session Snapshot:

- Timestamp (NZ): 2026-05-03 19:57:35 NZST
- Current branch: main
- HEAD SHA: 15db51f691471e824b7ddd0399d7d5f29f1dbe8a
- Working tree status (`git status -sb`): pending staged updates (`docs/STAGING.md` only)
- Latest lint result: pass (`bun run lint`)
- Latest build result: pass (`bun run build`, 3953 modules transformed, built in 21.10s)
- Latest targeted test result: pass (`node scripts/audit-org-scoping.mjs`, missing required org filters reduced to 24)
- Active/last CI run IDs:
  - `25273584289` policy-bob-no-openai: success
  - `25273584280` Validate RunPod Image Tags: success
  - `25273584279` CI Build High Memory: in progress
  - `25273584285` Deploy Admin Portal to Vercel: in progress
- Open blockers with owner:
  - Org-scoping audit still reports 8 missing org filters (all in `src/lib/testUtils.ts`); owner: Application architecture + data governance
- Next exact command to run: `cd /workspaces/FreedomCamp-Manager && GH_PAGER=cat gh run list --limit 30 --json databaseId,headSha,name,status,conclusion,url | jq 'map(select(.headSha=="'"$(git rev-parse HEAD)"'"))' && node scripts/audit-org-scoping.mjs`

Latest Session Snapshot:

- Timestamp (NZ): 2026-05-03 20:07:20 NZST
- Current branch: main
- HEAD SHA: fd9ac1c11702c8baf98555d7ca353caaea579a23
- Working tree status (`git status -sb`): docs handoff update pending
- Latest lint result: pass (`bun run lint`)
- Latest build result: pass (`bun run build`, 3953 modules transformed, built in 21.81s)
- Latest targeted test result: pass (`node scripts/audit-org-scoping.mjs`, missing required org filters reduced to 17)
- Active/last CI run IDs:
  - `25273838147` Governance Release Gate: success
  - `25273838150` policy-bob-no-openai: success
  - `25273838141` Validate RunPod Image Tags: success
  - `25273838153` CI Build High Memory: in progress
  - `25273838163` Deploy Admin Portal to Vercel: in progress
  - `25273838133` Playwright Deep Functional Cross-Browser: queued
- Open blockers with owner:
  - Remaining org-scoping findings concentrated in `src/lib/*` and `src/lib/testUtils.ts`; owner: Application architecture + data governance
  - CI Build + Deploy not complete yet for current head; owner: CI/Release pipeline
- Next exact command to run: `cd /workspaces/FreedomCamp-Manager && GH_PAGER=cat gh run list --limit 80 --json databaseId,headSha,workflowName,status,conclusion,url | jq 'map(select(.headSha=="'"$(git rev-parse HEAD)"'"))'`

Latest Session Snapshot:

- Timestamp (NZ): 2026-05-03 20:15:18 NZST
- Current branch: main
- HEAD SHA: 046b54137b94e0fecab668dda00a2bd41a9db494
- Working tree status (`git status -sb`): staged updates pending for org-scope-zero slice
- Latest lint result: pass (`bun run lint`)
- Latest build result: pass (`bun run build`, 3953 modules transformed, built in 20.73s)
- Latest targeted test result: pass (`node scripts/audit-org-scoping.mjs`, missing required org filters reduced to 0)
- Active/last CI run IDs:
  - `25273957011` Governance Release Gate: success
  - `25273957022` policy-bob-no-openai: success
  - `25273957034` Validate RunPod Image Tags: success
  - `25273957132` CI Build High Memory: success
  - `25273957027` Deploy Admin Portal to Vercel: in progress
  - `25273957029` Playwright Deep Functional Cross-Browser: queued
- Open blockers with owner:
  - No org-scoping blockers remain in static audit.
  - Deploy + Playwright still pending for current head; owner: CI/Release pipeline
- Next exact command to run: `cd /workspaces/FreedomCamp-Manager && GH_PAGER=cat gh run list --limit 80 --json databaseId,headSha,workflowName,status,conclusion,url | jq 'map(select(.headSha=="'"$(git rev-parse HEAD)"'"))'`

Latest Session Snapshot (ORG-SCOPE-ZERO COMPLETE):

- Timestamp (NZ): 2026-05-03 20:25:28 NZST
- Current branch: main
- HEAD SHA: 76d3e2799b00ca3ad5f247bd2e07e150f4c799cc
- Working tree status (`git status -sb`): clean (`## main...origin/main`)
- Latest lint result: pass (`bun run lint`)
- Latest build result: pass (`bun run build`, 3953 modules transformed, built in 20.73s)
- Latest targeted test result: pass (`node scripts/audit-org-scoping.mjs`, missing required org filters: 0)
- Active/last CI run IDs (all complete):
  - `25274043306` Governance Release Gate: completed, success
  - `25274043303` policy-bob-no-openai: completed, success
  - `25274043310` Validate RunPod Image Tags: completed, success
  - `25274043335` CI Build High Memory: completed, success
  - `25274043305` Deploy Admin Portal to Vercel: completed, success
  - `25274043304` Playwright Deep Functional Cross-Browser: completed, success
- Open blockers with owner: **NONE**. Org-scoping hardening complete; all required CI gates passed.
- Next exact command to run: `cd /workspaces/FreedomCamp-Manager && bash scripts/system-check.sh && node scripts/summarize-failures.mjs`

Latest Session Snapshot (Phase 2 Governance Hardening Progress):

- Timestamp (NZ): 2026-05-03 21:13:55 NZST
- Current branch: main
- HEAD SHA: 95ba598db062e9705de9fa9390a1aaabd05b042c
- Working tree status (`git status -sb`): docs update pending (`docs/STAGING.md`)
- Latest strict checks:
  - `node scripts/validate-roadmap-role-gates.mjs --strict`: pass
  - `DOC_AUTHORITY_STRICT=true bun run lint:doc-authority`: pass
  - `node scripts/generate-route-role-matrix.mjs`: pass (`tools/route-role-matrix/route-role-matrix.json`, route count 121)
- Active/last CI run IDs (all complete):
  - `25274883666` Governance Release Gate: completed, success
  - `25274883650` policy-bob-no-openai: completed, success
  - `25274883656` Validate RunPod Image Tags: completed, success
  - `25274883733` CI Build High Memory: completed, success
  - `25274883644` Deploy Admin Portal to Vercel: completed, success
- Open blockers with owner:
  - Triad sign-off capture pending for this Phase 2 cycle; owner: Primary execution lead
- Next exact command to run: `cd /workspaces/FreedomCamp-Manager && node scripts/dr-bob-review.mjs --file docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md`

Latest Session Snapshot (Phase 2 Governance Hardening Complete):

- Timestamp (NZ): 2026-05-03 21:17:55 NZST
- Current branch: main
- HEAD SHA: a6e39a0f9b669e73105fba8244c845b3655bc0c3
- Working tree status (`git status -sb`): docs updates pending (`docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md`, `docs/STAGING.md`)
- Latest triad evidence:
  - Bob review: approve, no findings (`data/dr-bob-reviews/ENTERPRISE_PAIR_REVIEW_CANONICAL.md.2026-05-03T09-17-02-045Z.json`)
  - OpenAI architecture lens: approve-with-notes
  - Specialist challenge: conditional-go (procedural-only), no technical blockers
- Active/last CI run IDs (all complete):
  - `25275195429` Governance Release Gate: completed, success
  - `25275195435` policy-bob-no-openai: completed, success
  - `25275195424` Validate RunPod Image Tags: completed, success
- Open blockers with owner: **NONE**. Phase 2 governance hardening complete.
- Next exact command to run: `cd /workspaces/FreedomCamp-Manager && node scripts/run-human-module-suite.mjs --grep "UX"`

## Phase 2 (P1): Governance and Auditability Hardening To-Do List

**Owner**: Application architecture + Release engineering
**Status**: Complete (Start date: 2026-05-03, Completed: 2026-05-03)
**Exit criteria**: All 3 deliverables complete + triad sign-off (Bob + OpenAI + Specialist)

### 8A. Phase 2 Deliverables (Execution Checklist)

1. [x] **CI wiring for doc-authority checks on route/schema/edge changes**
  - Command: `bun run lint:doc-authority --strict` (success on push to main)
  - Files: `.github/workflows/governance-release-gate.yml` (already wired)
  - Evidence: Run CI on next push, capture DOC_AUTHORITY_STRICT=true behavior
  - Owner: Release engineering

2. [x] **Route-role authority completeness review from roadmap to router truth**
  - Command: `node scripts/validate-roadmap-role-gates.mjs --strict`
  - Source: docs/MODULE_ROADMAP.md → src/App.tsx route inventory
  - Artifact: tools/route-role-matrix/governance/[run_id]/route-role-matrix.json
  - Owner: Application architecture

3. [x] **Governance cadence definition (monthly triad review + release gate checkpoints)**
  - Add to docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md Section: "Review Cadence"
  - Define: monthly triad review schedule + release gates
  - Definition: governance-release-gate.yml on every push to main (role/schema/edge changes)
  - Owner: Primary execution lead

### 8B. Phase 2 Supporting Tasks

- [x] Validate role-gate strict checks pass on current HEAD
- [x] Run doc-authority check in strict mode against current branch
- [x] Verify all role annotations in MODULE_ROADMAP.md are bidirectionally validated against App.tsx
- [x] Generate fresh route-role matrix artifact for Phase 2 evidence
- [x] Update ENTERPRISE_PAIR_REVIEW_CANONICAL.md with governance cadence section
- [x] Record Phase 2 exit criteria evidence in canonical record
- [x] Triad review: Bob + OpenAI + Specialist validation

### 8C. Phase 2 Blocker Resolution

If any gate fails:
1. Check logs: `GH_PAGER=cat gh run view [RUN_ID] --log 2>&1 | grep -i error | head -20`
2. Investigate: route not in roadmap, missing role gate, or doc mismatch
3. Fix: update docs/MODULE_ROADMAP.md or src/App.tsx
4. Revalidate: `node scripts/validate-roadmap-role-gates.mjs --strict --matrix [ARTIFACT]`
5. Record: blocker reason + resolution in STAGING.md session note before retry

## Phase 3 (P1/P2): UX and Operator Efficiency Improvements To-Do List

**Owner**: Product design + Application architecture + Operations enablement
**Status**: Active (Start date: 2026-05-03)
**Exit criteria**: Top-friction routes triaged, high-impact UX fixes implemented/scheduled, triad review confirms enterprise trajectory

### 9A. Phase 3 Deliverables (Execution Checklist)

1. [ ] **UX triage list for high-impact readability/navigation issues**
  - Scope: top 10 high-traffic routes with operator friction scoring
  - Output: ranked triage table with severity, user impact, and fix owner
  - Owner: Product design

2. [ ] **Role-specific path simplification for high-frequency operations**
  - Scope: reduce click depth and decision points for officer/admin daily flows
  - Output: before/after route-path maps and acceptance criteria
  - Owner: Application architecture

3. [ ] **Visual hierarchy cleanup plan for dense pages**
  - Scope: tables, compliance pages, dispatch/monitoring pages, officer portals
  - Output: implementation checklist with phased rollout and regression guardrails
  - Owner: Product design + frontend

### 9B. Phase 3 Supporting Tasks

- [ ] Identify top 10 high-traffic routes using existing workflow matrix and operator workflows
- [ ] Capture route-level friction findings (time-to-task, click depth, error-prone actions)
- [ ] Propose quick wins and classify into now/next/later slices
- [ ] Define measurable UX acceptance criteria per route family
- [ ] Map role-specific path simplifications for admin, admin_officer, officer, master
- [ ] Validate route and role changes stay aligned with MODULE_ROADMAP and App router
- [ ] Run triad review on Phase 3 artifact before implementation commit

### 9C. Phase 3 Validation Commands

1. `bun run lint`
2. `bun run build`
3. `bun run lint:doc-authority`
4. `node scripts/generate-route-role-matrix.mjs`
5. `node scripts/validate-roadmap-role-gates.mjs --strict`

### 9D. Phase 3 Blocker Resolution

If UX or role-flow change introduces route/doc drift:
1. Check docs vs routes: `node scripts/generate-route-role-matrix.mjs`
2. Validate strict gates: `node scripts/validate-roadmap-role-gates.mjs --strict`
3. Resolve mismatch in docs/MODULE_ROADMAP.md or src/App.tsx
4. Re-run doc authority checks and record evidence in STAGING snapshot

## 8. Fast Resume Commands

Run these as a single crash-recovery bundle:

```bash
cd /workspaces/FreedomCamp-Manager
bash scripts/system-check.sh
node scripts/summarize-failures.mjs
node scripts/auto-ingest.mjs
bun run lint && bun run build
sha=$(git rev-parse HEAD)
GH_PAGER=cat gh run list --limit 120 --json databaseId,headSha,name,status,conclusion,url \
  --jq '.[] | select(.headSha=="'"$sha"'") | [.databaseId,.name,.status,.conclusion,.url] | @tsv'
```

## 9. Non-Negotiable Safety Rules

1. Do not commit secrets.
2. Do not rewrite history or reset unrelated user changes.
3. Do not mark tasks complete without command evidence.
4. Do not ship doc changes that contradict canonical authority.
5. Do not treat design-target files (`spec.md`, `plan.md`) as implementation proof.
