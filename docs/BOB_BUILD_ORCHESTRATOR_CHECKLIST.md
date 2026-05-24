# Bob Build Orchestrator Checklist

This checklist is the runnable contract for Bob to execute build planning and release gates in a consistent order.

Execution model: app/Bob-driven only. Do not rely on GitHub Actions for this workflow.

## Run Command

```bash
npm run bob:build:orchestrate
```

Optional skip for data bootstrap when doing quick compile/route verification only:

```bash
npm run bob:build:orchestrate -- --skip-bootstrap
```

## Gate Sequence

1. Environment preflight
2. Truth sync: `scripts/system-check.mjs`
3. Truth sync: `scripts/broadcast-truth-protocol.mjs`
4. Core build: `npm run build`
5. Route contract: `scripts/check-route-contract-artifact.mjs`
6. Route/role truth: `scripts/validate-route-role-truth.mjs`
7. Manual chain bootstrap: `scripts/bootstrap-manual-chain.mjs`
8. Final build recheck
9. Final route contract recheck

## Required Environment

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Failure Policy

1. Fail fast on first broken gate.
2. Capture the command and exit code.
3. Fix root cause with minimal safe changes.
4. Re-run from gate 1 for full confidence.

## Output Contract

The script prints:

1. `Build status summary` with pass/fail per gate.
2. First failed gate and exit code (if any).
3. Next action recommendation.
