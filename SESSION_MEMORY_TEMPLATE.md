# Phase A Session Memory Template

Copy this template to `/memories/session/realignment-phase-a-YYYY-MM-DD_HHMM.md` at the start of each work session.

---

# Phase A Session — [YYYY-MM-DD] [HH:MM UTC]

**Start Time**: [HH:MM UTC]  
**Target Completion**: [EXPECTED_HH:MM UTC]  
**Owner**: [@GITHUB_USERNAME]  
**Week Target**: [Week 1 / Week 2 / Week 3]  
**Phase A Week Schedule**:
- Week 1 (May 12–18): Foundation & Schema
- Week 2 (May 19–25): Bootstrap Routes & Feature Flags
- Week 3 (May 26–Jun 1): Route/Role Truth & Approval Workflows

## Today's Goal

What will be completed by session end? (1–2 items max)

- [ ] [TASK 1]: [specific_file or deliverable]
- [ ] [TASK 2]: [specific_file or deliverable]

---

## Progress Log

### Task 1: [TASK_NAME]

**Description**: [What needs to be done]  
**File(s)**: [src/..., docs/..., supabase/migrations/...]  
**Started**: [HH:MM UTC]  
**Status**: [Not Started / In Progress / Complete]  
**Blocker**: [If blocked, describe issue]  
**Test Command**: [bun test OR bunx playwright test OR other]  

**Work Log**:
- [HH:MM] Started task
- [HH:MM] Created file X
- [HH:MM] Tests running...
- [HH:MM] [Issue / Resolution]

**Test Result**: [PASS ✅ / FAIL ❌]  
**Commit Hash**: [If committed: git log --oneline -1]

---

### Task 2: [TASK_NAME]

**Description**: [What needs to be done]  
**File(s)**: [...]  
**Started**: [HH:MM UTC]  
**Status**: [Not Started / In Progress / Complete]  
**Blocker**: [If blocked, describe issue]  
**Test Command**: [...]  

**Work Log**:
- [HH:MM] Started task
- [HH:MM] [Progress note]
- [HH:MM] [Result]

**Test Result**: [PASS ✅ / FAIL ❌]  
**Commit Hash**: [If committed: git log --oneline -1]

---

## End of Session Summary

**Completion Time**: [HH:MM UTC]  
**Session Duration**: [X hours Y minutes]  
**Tasks Completed**: [X/Y]  
**Success Rate**: [X%]  

### Completed Tasks ✅
- [Task 1]: [Brief result]
- [Task 2]: [Brief result]

### Incomplete Tasks (Carry Over)
- [Task 3]: [Reason — blocker / not started]

### Tomorrow's Focus (If Multi-Day)
1. [Task 3] — unblock and complete
2. [Task 4] — new task for next session

### Blocker Analysis

**Critical Blockers** (prevent progress):
- [Blocker 1]: [Description and escalation path]
- [Blocker 2]: [Description and escalation path]

**Minor Issues** (workaround found):
- [Issue 1]: [Description and workaround]

### Documentation Updated

- [x] docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md — Added completion timestamps to sections [X.X], [Y.Y]
- [x] REALIGNMENT_EXECUTION_STAGING.md — Updated week [X] progress
- [ ] [Other docs]

### Commits This Session

```bash
# Run to view all commits from this session:
git log --oneline --since="[START_DATE_TIME]" --until="[END_DATE_TIME]"
```

List commits:
1. `[HASH]` — realignment: [TASK 1] — [brief message]
2. `[HASH]` — realignment: [TASK 2] — [brief message]

### Next Session Prerequisites

- [ ] Pull latest main: `git pull origin main`
- [ ] Verify build: `bun run build`
- [ ] Review blockers from this session (see Blocker Analysis above)
- [ ] Check Slack #realignment-kickoff for any overnight updates

---

## Quick Links for Phase A

- **Master Plan**: [docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md](docs/BUILD_REALIGNMENT_PLAN_2026-05-04.md)
- **Execution Guide**: [REALIGNMENT_EXECUTION_STAGING.md](REALIGNMENT_EXECUTION_STAGING.md)
- **Event Contract**: [docs/EVENT_FAMILY_CONTRACT_2026-05-04.md](docs/EVENT_FAMILY_CONTRACT_2026-05-04.md) (Week 1)
- **Slack Channel**: #realignment-kickoff
- **Team List**: GitHub @DonSquires/team-realignment

---

**Template Version**: 1.0 (May 4, 2026)  
**For Questions**: See REALIGNMENT_EXECUTION_STAGING.md → "Emergency Contacts & Escalation"
