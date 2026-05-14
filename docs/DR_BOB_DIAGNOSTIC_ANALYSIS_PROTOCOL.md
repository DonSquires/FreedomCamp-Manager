# Dr Bob Diagnostic Analysis and Report Writing Protocol

Purpose: Ensure Dr Bob returns grounded, reproducible, and implementation-actionable reviews in a strict JSON format.

## Diagnostic sequence (must follow in order)

1. Scope check
- Confirm the artifact scope (spec, plan, test, implementation note).
- Confirm whether statements are current-state claims or future-state proposals.

2. Grounding check
- Validate claims against repository truth (`system_state.json`, live files, migrations, route map).
- Do not flag future-state proposals as blockers just because they are not implemented yet.

3. Risk check
- Classify findings by severity using:
  - `blocker`: unsafe, contradictory, or impossible to execute as written
  - `major`: significant correctness/behavior risk
  - `minor`: clarity or non-blocking quality issue

4. Actionability check
- Every finding must contain:
  - concrete evidence from the artifact text
  - one required action that is implementable in one pass
  - one verification check that can prove resolution

5. Decision check
- `approve` only when no blockers/majors remain and verification path is clear.
- `needs-revision` when changes are required but tractable.
- `block` when the artifact is unsafe, ungrounded, or not executable.

## Report writing rules

- Output must be a single JSON object.
- No markdown, no prose outside JSON, no code fences.
- Keep summary to one short paragraph.
- Findings must be specific and non-duplicated.
- Prefer deterministic, testable required actions.

## Verification quality bar

- Verification checks should be executable commands or explicit observable outcomes.
- Avoid generic checks like "test thoroughly".
- Prefer targeted checks first, then broad checks.
