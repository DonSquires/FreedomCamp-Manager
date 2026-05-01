# Human Trial Go/No-Go Checklist (One-Page)

Use this checklist after the Human Trial Release Gate workflow completes.

## 1) Core Gate Passes (Must Pass)

- [ ] Verify Bob training wiring passed.
- [ ] Required credentials/secrets validation passed.
- [ ] Lint passed.
- [ ] Navigation parity test passed.
- [ ] Build passed.
- [ ] API suite passed.
- [ ] Focused Chromium suite passed.
- [ ] Human module sweep passed.
- [ ] Deep cross-browser suite (WebKit + Mobile Safari) passed.

If any item above fails: No-Go.

## 2) Artifact Review (Must Exist)

- [ ] Evidence artifact uploaded: human-trial-release-gate-evidence-<run_id>.
- [ ] Summary artifact uploaded: human-trial-release-gate-summary-<run_id>.
- [ ] Summary files present in artifact: tools/human-trial-gate/summary.json and summary.md.
- [ ] Playwright report and test-results present.

If missing summary or evidence artifacts: No-Go.

## 3) Severity Review (From summary.md)

- [ ] Blockers = 0.
- [ ] Failed gate steps = 0.
- [ ] Majors reviewed and accepted by product + operations.
- [ ] Minors logged for follow-up (if any).

Decision rule:
- Verdict NO_GO or any blockers/failed steps: No-Go.
- Verdict CONDITIONAL_GO with accepted majors and explicit owner/date: Conditional Go.
- Verdict GO with no blockers/majors: Go.

## 4) Human Trial Readiness Controls

- [ ] Trial script reviewed with test facilitators.
- [ ] Rollback owner assigned for live trial window.
- [ ] Incident channel and escalation path confirmed.
- [ ] Observability dashboard and logs verified accessible.
- [ ] Participant data/privacy controls confirmed for trial cohort.

If any control is missing: Conditional Go at best.

## 5) Sign-Off Record

- [ ] Engineering sign-off (name/date).
- [ ] Product sign-off (name/date).
- [ ] Operations sign-off (name/date).
- [ ] Final decision recorded: Go / Conditional Go / No-Go.
- [ ] Next checkpoint time scheduled.
