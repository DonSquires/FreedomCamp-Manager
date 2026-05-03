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

- [ ] Verify `docs/ENTERPRISE_PAIR_REVIEW_CANONICAL.md` reflects the latest commit hash and cycle date.
- [ ] Confirm `docs/ENTERPRISE_COLLAB_EXECUTION_PLAN_2026-05-02.md` still matches canonical priorities.
- [ ] Run doc authority checks and archive output for handoff evidence.
```bash
bun run lint:doc-authority
```

### B. PTT and Radio Readiness

- [ ] Confirm PTT control-plane health schema remains stable (`/radio/health` contract).
- [ ] Validate Phase 1 radio workflow remains green in CI.
- [ ] Re-run degradation and consent related checks according to `docs/INSTRUCTION_MANUAL.md` and `docs/radio-degradation-runbook.md`.

### C. Workflow Evidence Integrity

- [ ] Validate all P0 workflow IDs in `docs/PHASE1_WORKFLOW_MATRIX_2026-05-02.json` have fresh evidence references.
- [ ] Re-run evidence collection scripts if any workflow is stale.
```bash
node scripts/collect-workflow-evidence.mjs
node scripts/validate-workflow-evidence.mjs
```

### D. Multi-Org and Access Controls

- [ ] Reconfirm role-route mapping against `docs/MODULE_ROADMAP.md` and `src/App.tsx`.
- [ ] Re-run org-scoping verification artifacts before release candidate promotion.

### E. Release Gate Discipline

- [ ] Ensure each release gate run ends with GO, CONDITIONAL_GO, or NO_GO and all blockers have owners.
- [ ] Keep CI run IDs and outcomes logged in Section 7 before ending a session.

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
