# Lessons Learned

Use this file to record concrete mistakes Bob and Dr Bob found during adversarial review or failed executions.

## Entry Template

- Date: YYYY-MM-DD
- Trigger: command, review, or failure source
- Mistake: what Bob got wrong
- Risk: why it mattered
- Fix: what changed
- Prevention Rule: what Bob must do next time

## Current Lessons

- Date: 2026-04-28
- Trigger: Visual regression route assertion for `/roster` during stabilization run.
- Mistake: test expectation assumed `RosterPlanner` heading without validating actual route-to-component wiring.
- Risk: false red test loops, wrong fixes, and churn from patching symptoms instead of source-of-truth behavior.
- Fix: validated route mapping in `src/App.tsx`, aligned expectation to actual routed page behavior, and codified pre-change intent checks in Bob instructions.
- Prevention Rule: before any edit, confirm existence, role behavior, expected UI result, destination/next step, and success/failure outcomes against real routes/components.

- Date: 2026-04-23
- Trigger: `node scripts/dr-bob-review.mjs --file docs/BOB_TRAINING_ADVANCED_ARCHITECT_2026.md --type plan`
- Mistake: architecture guidance referenced ungrounded module placeholders without matching `system_state.json` evidence.
- Risk: Bob can invent module structure and mislead implementation planning.
- Fix: added blocker review flow, truth protocol checks, and failure summarization.
- Prevention Rule: any module path not grounded in repo files or `system_state.json` must be treated as unverified and blocked.
