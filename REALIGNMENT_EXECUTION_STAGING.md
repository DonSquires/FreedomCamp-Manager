# FieldOps Manager Build Realignment — Phase A Execution Staging

**Status**: ✅ Blueprint Approved (May 4, 2026)  
**Phase A Kickoff**: May 12, 2026  
**Critical Path Dates**: May 12 → June 2-9 (Phase A Gate Window) → June 10 (Phase B Launch Target)

> Scheduling note: earlier accelerated May 19/20 gate references in this guide are historical planning artifacts. The authoritative execution path is the June 9 gate and June 10 Phase B launch target used in the current master status and gate report.

---

## Quick Start

```bash
# Clone and setup
git clone https://github.com/DonSquires/FreedomCamp-Manager.git
cd FreedomCamp-Manager

# Install dependencies (requires bun)
bun install

# Verify environment
bun run build  # Should succeed with no errors
bun run lint   # Should pass ESLint
bun run test:bob:governance  # Bob governance contract must stay green

# Check current realignment status
cat docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md | head -50
```

---

## Tool Requirements & Installation

### Prerequisites (Already in Codespace)
- **Git** (version control, commit/push)
- **Bun** (package manager, already in use)
- **Node.js 18+** (for scripts)
- **TypeScript** (configured in `tsconfig.json`)

### Required Tools for Phase A

| Tool | Purpose | Installation | Verification |
|------|---------|--------------|--------------|
| **bun** | Build, test, dev server | Pre-installed | `bun --version` |
| **Playwright** | E2E testing | `bun install -D @playwright/test` | `bunx playwright --version` |
| **Supabase CLI** | Database migrations | `bun add -g supabase-cli` or `npm i -g supabase-cli` | `supabase --version` |
| **ESLint 9** | Linting (flat config) | Already in `package.json` | `bun run lint` |
| **TypeScript 5.5+** | Type checking | Already in `package.json` | `tsc --version` |

### Install All Phase A Tools (One Command)
```bash
cd /workspaces/FreedomCamp-Manager
bun install
bun add -D @playwright/test vitest @vitest/ui
npm install -g supabase-cli 2>/dev/null || echo "Supabase CLI optional for Phase A"
bun run build  # Verify all tools work
```

---

## Session & Commit Workflow

### Before Each Work Session

1. **Create Session Memory File**
   ```bash
   SESSION_DATE=$(date +%Y-%m-%d_%H%M)
   touch /memories/session/realignment-phase-a-${SESSION_DATE}.md
   ```
   Add to that file:
   ```markdown
   # Phase A Session — [DATE]
   
   **Start Time**: [HH:MM UTC]  
   **Target Tasks**: [List tasks from today's to-do]  
   **Today's Goal**: [1–2 items max]
   
   ## Completion Log
   - [ ] Task 1
   - [ ] Task 2
   ```

2. **Pull Latest Main**
   ```bash
   git checkout main
   git pull origin main
   ```

3. **Create Feature Branch** (if changes > docs update)
   ```bash
   git checkout -b realignment/phase-a-[task-name]-[DATE]
   ```

### After Each Completed Task

1. **Update Session Memory**
   ```bash
   echo "✅ [TASK_NAME] completed at $(date)" >> /memories/session/realignment-phase-a-*.md
   ```

2. **Update Documentation** (if applicable)
   - Edit `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` → Update "**Status**: In Progress"
   - Add completion timestamp to relevant section (e.g., "11.1a completed May 15, 10:30 UTC")
   - Format: `**Section 11.1a Completed**: May 15, 10:30 UTC by @username`
  - If Bob execution or governance changed, also update `docs/STAGING.md`, `docs/DEPLOYMENT_GUIDE.md`, and `docs/DECISIONS.md`

3. **Commit & Push**
   ```bash
   git add .
   git commit -m "realignment: [PHASE] [TASK_NAME] — [BRIEF_DESCRIPTION]

   Completed:
   - [Bullet of what was done]
   - [Bullet of what was done]

  Tests: [bun run build] ✅ [bun run lint] ✅ [bun run test:bob:governance] ✅
   Docs updated: docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md
   "
   
   git push origin realignment/phase-a-[task-name]-[DATE]
   ```

4. **Create/Update PR**
   ```bash
   # If first push of session
   gh pr create --title "Phase A: [TASK_NAME]" \
               --body "Closes #[ISSUE_NUMBER]
   
   **Work**: [Description of realignment work]
   
   **Status**: In Progress / Ready for Review
   
   **Checklist**:
   - [x] Code builds and lints
   - [x] Docs updated
   - [x] Session memory recorded
   
   Related: docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md"
   
   # If updating existing PR
   git push origin realignment/phase-a-[task-name]-[DATE] --force-with-lease
   ```

5. **Merge to Main When Task Complete**
   ```bash
   git checkout main
   git pull origin main
   git merge --no-ff realignment/phase-a-[task-name]-[DATE]
   git push origin main
   ```

---

## Phase A: Week-by-Week To-Do List

### Week 1 (May 12–18): Foundation & Schema

**Goal**: Case model schema defined, org isolation test framework created.

Bob governance note for this lane:
- The current Bob execution-review persistence already fits the existing schema because `public.bob_conversation_memory.context` is JSONB. Do not add a new migration for execution-review metadata unless the shape must become queryable at SQL level.

#### To-Do Items

- [ ] **May 12 (Monday)**: Team kickoff & ownership alignment
  ```bash
  # Action: Confirm team roles in GitHub @DonSquires/team-realignment
  # Verify in Slack #realignment-kickoff thread
  # Assign: Platform Arch Lead, Data Platform Lead, Frontend Platform Lead
  # Docs: Confirm names in section 13.2a
  # Commit: git commit -m "realignment: team alignment — kickoff complete"
  ```

- [ ] **May 13–14**: Unified case model schema design (Platform Arch Lead + Data Platform Lead)
  ```bash
  # Location: supabase/migrations/202605_case_model.sql
  # Requirements (from 11.2a):
  # - Create operational_cases table with: id, org_id, case_type, created_at, updated_at
  # - Create event_* tables (patrol_events, dispatch_events, enforcement_events)
  # - Add RLS policies for org isolation
  # Test: Run migration on local Supabase instance
  # Command:
  supabase migration up --local
  # Verify types generated:
  bun run build  # src/types/database.ts should update
  # Commit: git commit -m "realignment: case model schema — operational_cases + event tables"
  ```

- [ ] **May 15–16**: Org isolation test harness creation (Data Platform Lead + QA)
  ```bash
  # Location: tests/integration/org-isolation.test.ts
  # Framework: Vitest (configured in vitest.config.ts)
  # 5 Test Scenarios (from 3.7a):
  # 1. Cross-org read isolation: Officer A cannot query org B dispatch_jobs
  # 2. Realtime subscriber filtering: Subscription filters by org automatically
  # 3. Export scoping: CSV exports contain only caller's org data
  # 4. Geofence transition resolution: Transitions correctly resolve to caller's org
  # 5. Radio transcript isolation: Transcripts remain org-scoped in realtime
  # Template:
  # ```typescript
  # import { describe, it, expect, beforeAll } from 'vitest';
  # import { supabase } from '@/lib/supabase';
  #
  # describe('Org Isolation — Phase A Gate', () => {
  #   it('Officer from Org A cannot read dispatch_jobs from Org B', async () => {
  #     // Test logic here
  #   });
  #   // ... 4 more tests
  # });
  # ```
  # Verify: bun test tests/integration/org-isolation.test.ts
  # Commit: git commit -m "realignment: org isolation test harness — 5 scenarios (Phase A gate)"
  ```

- [ ] **May 17**: Event family contract documentation
  ```bash
  # Location: docs/EVENT_FAMILY_CONTRACT_2026-05-04.md (new file)
  # Content:
  # - Define 3 core event families: patrol_events, dispatch_events, enforcement_events
  # - Sample JSON payloads for each
  # - Columns, types, constraints, org isolation rules
  # - RLS policy examples
  # Commit: git commit -m "realignment: event family contract — patrol/dispatch/enforcement"
  ```

- [ ] **May 18 (Saturday)**: Org isolation test validation
  ```bash
  # Action: Run full test suite
  bun test tests/integration/org-isolation.test.ts
  # All 5 scenarios should pass or show clear failures to fix
  # If failures: Document root cause and schedule fix for May 19
  # Verify build & lint:
  bun run build && bun run lint
  # Docs update: Add "**Status**: Org Isolation Tests — [X/5 Passing]" to 3.7a
  # Commit & Push to Main:
  git add .
  git commit -m "realignment: org isolation WIP — [X/5] tests passing"
  git push origin realignment/phase-a-org-isolation-may-12-18
  # Create PR for review
  ```

---

### Week 2 (May 19–25): Bootstrap Routes & Feature Flags

**Goal**: 3 bootstrap routes running on case model, feature flag infrastructure live.

#### To-Do Items

- [x] **May 19–20**: Field Officer route bootstrap (Frontend Platform Lead) — Completed May 13; FieldOfficerDispatch uses useOperationalCases
  ```bash
  # Location: src/pages/FieldOfficerPortal/BootstrapRoutes/PatrolDispatch.tsx
  # Task: Migrate page to read from operational_cases + patrol_events
  # Test: E2E test in tests/e2e/bootstrap-routes.test.ts
  # Test Case: Patrol dispatch insertion → creates dispatch_job on operational_cases
  # Verify:
  bunx playwright test tests/e2e/bootstrap-routes.test.ts
  # Docs: Add "**Patrol Route Migrated**: May 20, [TIME]" to 11.2a
  # Commit: git commit -m "realignment: field officer patrol route — case model integration"
  ```

- [x] **May 21**: Dispatch Console route bootstrap (Dispatch Lead) — Completed May 13; DispatchMonitor FF_PHASE_B_PATROL_EVENTS gate added
  ```bash
  # Location: src/pages/AdminPortal/DispatchConsole/JobList.tsx
  # Task: Migrate page to read from operational_cases + dispatch_events
  # Test: E2E test (same suite)
  # Test Case: Dispatch job list → reflects dispatch_events status transitions
  # Commit: git commit -m "realignment: dispatch console route — case model integration"
  ```

- [x] **May 22**: Breaches/Enforcement route bootstrap (Enforcement Lead) — Completed prior; EnforcementActions already on FF_PHASE_B_ENFORCEMENT_EVENTS gate
  ```bash
  # Location: src/pages/AdminPortal/Enforcement/Timeline.tsx
  # Task: Migrate page to read from operational_cases + enforcement_events
  # Test: E2E test (same suite)
  # Test Case: Enforcement timeline creation on dispatch completion
  # Commit: git commit -m "realignment: enforcement timeline route — case model integration"
  ```

- [x] **May 22–23**: Feature flag table & rollback infrastructure (Platform Infra Lead) — migration 20260504000003_feature_flags.sql present; advance-canary-stage.sh ready
  ```bash
  # Location: supabase/migrations/202605_feature_flags.sql
  # Schema (from 12.1a):
  # - Table: feature_flags
  # - Columns: id, name (TEXT, unique), org_id (UUID), enabled (BOOLEAN), rollout_pct (INT 0–100)
  # - Rollout pattern: 5% → 25% → 50% → 100%
  # - Naming convention: FF_PHASE_B_*
  # Apply migration:
  supabase migration up --local
  # Test data: Create FF_PHASE_B_PATROL_EVENTS (enable for 5% of orgs)
  # Rollback script location: scripts/rollback-feature-flag.sh
  # Rollback script logic:
  # ```bash
  # #!/bin/bash
  # FLAG_NAME=$1
  # supabase db execute "UPDATE feature_flags SET enabled = false WHERE name = '$FLAG_NAME';"
  # echo "✅ Rolled back $FLAG_NAME"
  # ```
  # Test rollback: bash scripts/rollback-feature-flag.sh FF_PHASE_B_PATROL_EVENTS
  # Commit: git commit -m "realignment: feature flag infrastructure — FF_PHASE_B_* pattern, rollback"
  ```

- [ ] **May 23–24**: Smoke testing — all 3 routes + org isolation
  ```bash
  # Run full E2E suite:
  bunx playwright test tests/e2e/bootstrap-routes.test.ts
  # Run org isolation tests:
  bun test tests/integration/org-isolation.test.ts
  # Full build & lint check:
  bun run build && bun run lint
  # Document results: Add results snapshot to docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md
  # Commit & Push:
  git add .
  git commit -m "realignment: phase A week 2 complete — 3 bootstrap routes, feature flags, org isolation ✅"
  git push origin realignment/phase-a-week-2-may-19-25
  # Create PR & merge to main
  ```

- [ ] **May 25**: Phase A gate readiness check
  ```bash
  # Verify all 5 gate criteria (from 12.1):
  # 1. Case model schema: deployed? ✅
  # 2. Org isolation tests: all 5 passing? ✅
  # 3. Bootstrap routes smoke test: all 3 passing? ✅
  # 4. Feature flags: table created, rollback tested? ✅
  # 5. Ownership: team assigned in GitHub, Slack confirmation ready?
  # Docs: Update section 12.1a with final status
  # Create Slack message in #realignment-kickoff:
  # "🟢 Phase A Week 2 Complete — Gate Criteria Status: [5/5] ✅"
  ```

---

### Week 3 (May 26–Jun 1): Route/Role Truth & Approval Workflows

**Goal**: Route/role authorization truth validated, Bob approval paths defined.

#### To-Do Items

- [x] **May 14–15**: Route/role truth validation (Platform Arch Lead) — Completed early on May 13
  ```bash
  # Task: Verify all 3 bootstrap routes have correct role guards
  # Validation script location: scripts/validate-route-role-truth.mjs
  # Script output: Audit trail showing:
  # - Route → required roles mapping
  # - Org isolation checks on each route
  # - Missing role guards (blockers)
  # Run: node scripts/validate-route-role-truth.mjs
  # Latest result: PASS (route_truth_exit=0), 0 critical blockers
  # Fix any blockers immediately
  # Docs: Add validation summary to section 6.2 (Bob executability)
  # Commit: git commit -m "realignment: route/role truth validation — [BLOCKERS_FIXED]"
  ```

- [x] **May 15–16**: Bob approval path specification (Bob/AI Lead) — Completed early on May 13
  ```bash
  # Location: docs/BOB_APPROVAL_PATHS_PHASE_B.md
  # Content (from 6.2):
  # - Minimum executable approval workflow for Phase B modules
  # - SLA targets (e.g., approval decision within 2 hours)
  # - Escalation rules (who to escalate to if decision delayed)
  # - Audit fields: proposal_id, approver_id, timestamp, status
  # Example approval workflow:
  # 1. Dispatch feature proposed → Bob AI trained on use case
  # 2. Bob generates approval/rejection with reasoning
  # 3. If rejected: dev team can appeal with additional context
  # 4. If approved: feature branches auto-created for implementation
  # Docs: Link from 6.2 and 6.4
  # Commit: git commit -m "realignment: bob approval paths phase B — SLA/escalation/audit"
  ```

- [x] **May 16–17**: Event sequencing documentation (Data Platform Lead) — Completed early on May 13
  ```bash
  # Location: docs/EVENT_SEQUENCING_ROADMAP.md
  # Content (from 3.3a):
  # - Phase A event families: (none — schema only)
  # - Phase B event families: patrol_events, dispatch_events, enforcement_events
  # - Phase C event families: add security_events, assistive_events
  # - Phase D event families: add approval_events, transition_events
  # - Phase E event families: add audit_events
  # Diagram: Mermaid flowchart showing event lifecycle
  # Commit: git commit -m "realignment: event sequencing roadmap — phases A–E event families"
  ```

- [x] **May 17–18**: Bob audit trail spec (Bob/QA Lead) — Completed (migration already present)
  ```bash
  # Location: supabase/migrations/20260504000004_bob_audit.sql
  # Schema (from 6.4):
  # - Table: bob_approval_audit
  # - Columns: id, proposal_id, approver_id, decision (approve/reject), reasoning (TEXT),
  #   timestamp, status, org_id
  # - RLS: org isolation enforced
  # Apply migration:
  supabase migration up --local
  # Test: Insert sample audit record
  # Commit: git commit -m "realignment: bob audit trail schema — proposal tracking & appeal workflow"
  ```

- [ ] **Jun 2–9**: Finalize Phase A gate & prepare Phase B kickoff
  ```bash
  # Verify all Week 3 tasks complete:
  bun run build && bun run lint
  bash scripts/phase-a-fast-track.sh --skip-build --skip-lint
  bun test tests/integration/org-isolation.test.ts
  bunx playwright test tests/e2e/bootstrap-routes.test.ts
  # Update docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md:
  # - Section 12.1 Phase A Gate: Mark all criteria GREEN
  # - Add timestamp: "**Phase A Gate Completion**: June 9, [TIME]"
  # Slack announcement:
  # "🟢 PHASE A COMPLETE — June 9, 2026
  # ✅ Case model schema deployed
  # ✅ Org isolation tests: 5/5 passing
  # ✅ Bootstrap routes: 3/3 migrated
  # ✅ Feature flags: infrastructure live
  # ✅ Bob approval paths: documented
  # Next: Phase B Kickoff — June 10, 2026"
  # Final commit & push:
  git add .
  git commit -m "realignment: phase A complete — all gate criteria green ✅"
  git push origin main
  ```

---

## Critical Path Dates & Go/No-Go Gates

| Date | Gate / Milestone | Criteria | Owner | Slack Channel |
|------|------------------|----------|-------|---------------|
| **June 9** | **PHASE A → B Go/No-Go** | Org isolation tests: 5/5 ✅<br/>Bootstrap routes: 3/3 ✅<br/>Feature flags: live & tested ✅<br/>Operational sign-off evidence attached | Platform Arch Lead | #realignment-kickoff |
| Jul 28 | Dispatch acceptance live | Callsign binding + dispatch ack flows E2E | Dispatch Lead | #phase-b-dispatch |
| Sep 29 | Bob approval phase D ready | Bob service integrated & tested | Bob/AI Lead | #phase-d-bob |
| Jan 31 | Phase E consolidation done | All 5 phases launched, data queries optimized | Full Team | #go-live |

---

## Documentation Update Checklist

After **every** completed task:

- [ ] Update session memory file: `/memories/session/realignment-phase-a-YYYY-MM-DD_HHMM.md`
- [ ] Update main plan: `docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md` (add completion timestamp to relevant section)
- [ ] Add detailed note if task took longer than expected or hit blockers
- [ ] Update status in plan: `**Status**: Phase A WK2: [3/5 gate items complete]`
- [ ] Commit to git with detailed message (see Commit & Push section above)
- [ ] If blocker found: Create issue in GitHub and link in next commit

---

## Commit Message Template

```
realignment: [PHASE] [TASK_NAME] — [BRIEF_DESCRIPTION]

**Work Done**:
- [Bullet 1]
- [Bullet 2]
- [Bullet 3]

**Tests**:
- bun run build: ✅
- bun run lint: ✅
- [E2E/integration tests]: ✅

**Docs Updated**:
- docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md (section [X.X])
- [Any other doc files]

**Related PRs/Issues**:
- Closes #[ISSUE_NUMBER]
- Related to realignment phase A gate criteria
```

---

## Abort/Rollback Procedures

### If Org Isolation Tests Fail Before Jun 9

```bash
# 1. Identify root cause
bun test tests/integration/org-isolation.test.ts --reporter=verbose

# 2. Create bug fix branch
git checkout -b realignment/phase-a-org-isolation-fix-[DATE]

# 3. Fix and re-test
# [Make code changes]
bun test tests/integration/org-isolation.test.ts

# 4. If fix fails: Rollback entire week and reassess
git checkout main
git revert [COMMIT_HASH_OF_SCHEMA_CHANGE]
git push origin main

# 5. Schedule postmortem and re-plan week 2
```

### If Bootstrap Route Migration Breaks Dispatch

```bash
# 1. Revert route to previous version
git checkout HEAD~1 src/pages/AdminPortal/DispatchConsole/JobList.tsx

# 2. Create isolated test to understand blocker
# [Write new test case]

# 3. Re-attempt migration with clearer understanding
# [Fix and commit]

# 4. Full smoke test before re-pushing to main
bunx playwright test
```

### Full Phase A Restart (Extreme Case)

```bash
git checkout main
git reset --hard [COMMIT_BEFORE_PHASE_A_STARTED]
git push origin main --force-with-lease
# Schedule team retrospective before restarting
```

---

## Success Criteria for Phase A

Phase A is **COMPLETE** when:

- ✅ Case model schema deployed to staging with RLS policies
- ✅ `src/types/database.ts` auto-generated with `operational_cases` and event table types
- ✅ Org isolation test suite: all 5 scenarios passing in GitHub Actions CI
- ✅ Bootstrap routes (field officer, dispatch, enforcement): all 3 migrated and smoke tested
- ✅ Feature flag infrastructure live with `FF_PHASE_B_*` naming and rollback script tested
- ✅ Bob approval audit trail table created with sample records
- ✅ Event family contract and boot sequence documentation published
- ✅ All team roles assigned and acknowledged in GitHub team + Slack confirmation thread
- ✅ June 9 Go/No-Go date confirmed (if all above ✅, proceed to Phase B June 10)

---

## Quick Reference: Phase A Files to Create/Update

| File | Type | Owner | Due Date |
|------|------|-------|----------|
| `supabase/migrations/202605_case_model.sql` | SQL | Platform Arch | May 14 |
| `supabase/migrations/202605_feature_flags.sql` | SQL | Platform Infra | May 23 |
| `supabase/migrations/202605_bob_audit.sql` | SQL | Bob/AI | May 29 |
| `tests/integration/org-isolation.test.ts` | TypeScript | QA | May 16 |
| `tests/e2e/bootstrap-routes.test.ts` | TypeScript | QA | May 20 |
| `scripts/rollback-feature-flag.sh` | Bash | Platform Infra | May 23 |
| `scripts/validate-route-role-truth.mjs` | JavaScript | Platform Arch | Completed May 14 |
| `docs/EVENT_FAMILY_CONTRACT_2026-05-04.md` | Markdown | Data Eng | May 17 |
| `docs/BOB_APPROVAL_PATHS_PHASE_B.md` | Markdown | Bob/AI | Completed May 15 |
| `docs/EVENT_SEQUENCING_ROADMAP.md` | Markdown | Data Eng | Completed May 16 |

---

## Emergency Contacts & Escalation

| Issue | Escalate To | Slack | Response SLA |
|-------|-------------|-------|--------------|
| Blocker on Phase A gate | @DonSquires (Lead) | #realignment-kickoff | 2 hours |
| Org isolation test failure | Platform Arch Lead | #phase-a-org-isolation | 4 hours |
| Dispatch route crash | Dispatch Lead | #phase-a-dispatch-routes | 1 hour |
| Feature flag bug | Platform Infra Lead | #phase-a-feature-flags | 2 hours |

---

## Session Log Template

Save as `/memories/session/realignment-phase-a-YYYY-MM-DD_HHMM.md`:

```markdown
# Phase A Session — [DATE] [TIME]

**Start Time**: [HH:MM UTC]  
**Target Completion**: [EXPECTED_HH:MM_UTC]  
**Owner**: [@USERNAME]  
**Today's Goal**: 
- [ ] [Task 1]
- [ ] [Task 2]

## Progress Log

### [TASK 1]
- Started: [HH:MM]
- Status: [In Progress / Complete]
- Notes: [Any blockers or insights]
- Commit: [COMMIT_HASH]

### [TASK 2]
- Started: [HH:MM]
- Status: [In Progress / Complete]
- Notes: [Any blockers or insights]
- Commit: [COMMIT_HASH]

## End of Session
**Completion Time**: [HH:MM UTC]  
**Tasks Completed**: [X/Y]  
**Tomorrow's Focus**: [2 items max]  
**Blocker Analysis**: [Any issues to escalate]  
```

---

## Final Checklist Before Pushing to Main

```bash
# Before every push to main:
bun run build        # TypeScript + Vite compile
bun run lint         # ESLint 9 flat config
bun test             # Full test suite (vitest)
git status           # Verify only expected files staged
git diff --staged    # Review all changes one more time

# Then push:
git push origin main
```

---

**Last Updated**: May 4, 2026  
**Next Review**: May 12, 2026 (Phase A Kickoff)  
**Plan Reference**: [docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md](docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md)
