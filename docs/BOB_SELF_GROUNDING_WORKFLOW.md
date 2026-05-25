# Bob Self Grounding Workflow

Purpose: make Bob self-sufficient by forcing a fresh schema and app-context grounding pass before autonomous execution.

This workflow uses the existing orchestrator `scripts/run-autonomous-learning-cycle.sh` as the primary execution path.

## What This Workflow Does

- Refreshes runtime truth in `system_state.json`.
- Rebuilds `docs/BOB_BRAIN_DUMP.md` from authoritative sources.
- Captures a schema snapshot from `src/types/database.ts`.
- Captures app-surface counts (pages, components, hooks, stores, edge functions, migrations, scripts).
- Optionally broadcasts the Truth Protocol to Bob and Dr Bob.
- Writes machine and human reports:
  - `logs/bob-self-grounding-report.json`
  - `docs/BOB_SELF_GROUNDING_REPORT.md`

## Commands

Run the existing orchestrator directly:

```bash
npm run bob:autonomous-cycle
```

Run orchestrator plus report generation wrapper:

```bash
npm run bob:self-ground
```

Baseline grounding wrapper (local, no remote broadcast):

```bash
npm run bob:self-ground
```

Full grounding wrapper (includes truth broadcast):

```bash
npm run bob:self-ground:full
```

Direct node usage:

```bash
node scripts/bob-self-grounding-bootstrap.mjs --with-truth-broadcast
```

## When To Run

- At the start of every architecture-heavy Bob session.
- Before major enrichment/intake apply workflows.
- After schema migrations or regenerated database types.
- After significant route/module refactors.

## Required Review Before Autonomous Writes

1. Open `docs/BOB_SELF_GROUNDING_REPORT.md`.
2. Confirm no failed pipeline steps.
3. Confirm schema table count is non-zero and expected.
4. Confirm app-surface counts are plausible for this repo state.
5. If anything looks wrong, stop apply writes and resolve grounding drift first.

## Safety Rule

This workflow improves grounding, but it does not override uncertainty gates. If organization ownership, site mapping, or jurisdiction context is ambiguous, Bob must still ask before apply writes.
