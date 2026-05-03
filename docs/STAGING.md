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

Current finding: org-scoping static audit now reports `missing_org_filter=17` after latest remediation pass (down from 47).

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
  - Org-scoping audit still reports 17 missing org filters; owner: Application architecture + data governance
- Next exact command to run: `cd /workspaces/FreedomCamp-Manager && GH_PAGER=cat gh run list --limit 30 --json databaseId,headSha,name,status,conclusion,url | jq 'map(select(.headSha=="'"$(git rev-parse HEAD)"'"))' && node scripts/audit-org-scoping.mjs`

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
