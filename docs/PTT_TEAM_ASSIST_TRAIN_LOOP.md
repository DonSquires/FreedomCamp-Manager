# PTT Team Assist and Training Loop

Updated: 2026-04-24

This workflow ensures Bob, Dr Bob, and Human Test assist every PTT implementation cycle and are corrected when wrong.

## Purpose

1. Keep PTT delivery grounded in repo evidence.
2. Catch design and runtime failures before deployment.
3. Retrain team behavior after every wrong output.

## Team Roles

1. Bob: planning, implementation strategy, and task sequencing.
2. Dr Bob: adversarial blocker detection and safety/security challenge.
3. Human Test: runtime and operational realism checks.

## Standard Loop

1. Define objective and target artifact.
2. Run Bob plan pass.
3. Run Dr Bob review against the artifact.
4. Run Human Test engine.
5. Record corrections for any wrong output.
6. Apply fixes.
7. Re-run steps 2 to 4 until blockers are closed.

## Command

```bash
npm run ptt:team:train -- "<objective>" [artifact-file]
```

Example:

```bash
npm run ptt:team:train -- "Implement secure PTT token refresh and offboarding revoke" docs/PTT_ENTERPRISE_STACK_FIT_AND_BUILD.md
```

## Output Bundle

Each run writes an evidence bundle to:

- tools/ptt-team-training/TIMESTAMP/objective.txt
- tools/ptt-team-training/TIMESTAMP/bob-plan.txt
- tools/ptt-team-training/TIMESTAMP/dr-bob-review.txt
- tools/ptt-team-training/TIMESTAMP/human-test.log
- tools/ptt-team-training/TIMESTAMP/correction-protocol.md

## Correction Standard (Teach the Right Way)

When any team member is wrong, add a correction entry with:

1. Agent name.
2. What was wrong.
3. Why it was wrong.
4. Correct method.
5. Repo evidence proving the correction.
6. New guardrail to prevent recurrence.
7. Verification step confirming fix.

No new PTT ticket is marked complete until correction entries are captured and rerun evidence is attached.
