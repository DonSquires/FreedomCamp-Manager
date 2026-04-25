# PTT Team Correction Protocol

Use this file to retrain Bob, Dr Bob, and Human Test after each run.

## Rule

If any team member is wrong, log the mistake and the corrected approach before the next implementation pass.

## Correction Entries

### Entry Template

1. Agent: Bob | Dr Bob | Human Test
2. Wrong Output:
3. Root Cause:
4. Correct Method:
5. Repo Evidence:
6. Guardrail Added:
7. Verification Step:

### Checklist

1. Convert each blocker into a concrete code or config task.
2. Add a test or diagnostic that would catch the same mistake next time.
3. Update architecture docs if a pattern changed.
4. Re-run Dr Bob and Human Test after fixes.

## Correction Entries (Run 20260424T072319Z)

1. Agent: Bob
2. Wrong Output: Bob planning step failed before producing plan output.
3. Root Cause: Team loop script did not load environment files prior to running Bob collaboration command.
4. Correct Method: Source .env, .env.local, .env.playwright.local, and .runtime/bob.env in team loop before Bob pass.
5. Repo Evidence: scripts/ptt-team-train-loop.sh now sources these files at startup.
6. Guardrail Added: Team loop always loads env before any Bob/Dr Bob/Human Test step.
7. Verification Step: Re-run ptt:team:train and confirm bob-plan.txt contains model output instead of missing env error.

1. Agent: Dr Bob
2. Wrong Output: Flagged future-state architecture items as ungrounded blockers rather than roadmap items.
3. Root Cause: Artifact language was not explicit that section 6 and phased build items are proposed future-state designs.
4. Correct Method: Mark future architecture sections and phases with explicit roadmap/future-state language.
5. Repo Evidence: docs/PTT_ENTERPRISE_STACK_FIT_AND_BUILD.md now states section 6 is proposed future-state and section 7 is roadmap.
6. Guardrail Added: Future architecture docs must include an explicit present-vs-future disclaimer line.
7. Verification Step: Re-run Dr Bob review and confirm those findings downgrade or clear.

1. Agent: Human Test
2. Wrong Output: Report flagged bootstrap credentials as failure without mapping this to known local test-env prerequisites in summary log.
3. Root Cause: Human Test output details existed in report.json but top-level loop log was minimal and appeared empty.
4. Correct Method: Treat report.json as primary truth and map bootstrap credential failures to a clear environment prerequisites checklist.
5. Repo Evidence: tools/ptt-team-training/20260424T072319Z/human-test/2026-04-24T07-23-23-313Z/report.json includes explicit missing vars.
6. Guardrail Added: Team review must always inspect generated human-test report.json before concluding no output.
7. Verification Step: Provide required vars and rerun Human Test to clear bootstrap.credentials failure.
