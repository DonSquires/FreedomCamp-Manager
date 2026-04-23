# Bob/Dr Bob Training Pack: Self-Evaluation Loop

Purpose: improve answer quality by forcing a gate-based self-audit and auto-revision before final output.

## Output Mode

Responses for redesign/new-module prompts must end with a structured Self-Eval block.

## Self-Eval Gates (8)

1. Stack fidelity
2. Org-scope enforcement
3. Tenant isolation proof completeness
4. UI hierarchy and color semantics compliance
5. Real-time/PTT state model compliance
6. Module blueprint compliance
7. Accessibility coverage
8. Low-spec Ubuntu VPS performance constraints

## Gate Format

For each gate output:

- gate_name
- status: pass | fail
- evidence
- remediation_if_fail

## Auto-Revision Rule

If any gate fails:

- revise response immediately
- re-run all gates
- output final only when all gates pass or explicit blocker is declared

## Blocker Declaration

When blocked, include:

- blocker_reason
- missing_inputs
- safest fallback

## Acceptance Gate

No final response without completed Self-Eval block.
