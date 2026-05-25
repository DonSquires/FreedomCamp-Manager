# Bob/Dr Bob Training Pack: Truth Protocol

Purpose: prevent architecture drift and module hallucinations by grounding outputs in live repository state.

## Required Pre-Flight

Before any major redesign/new-module architecture response:

1. Run one script:
   - `bash scripts/system-check.sh`
   - `node scripts/system-check.mjs`
2. Read `system_state.json`.
3. Treat `system_state.json` as authoritative for existing modules and lockfiles.

## Stop-Hallucinating Rule

If a module is not listed in `system_state.json.modules`, do not claim it already exists.

If package manager choice is requested, resolve from `system_state.json.lockfiles`:

- `package-lock.json` present => use npm
- If `package.json.packageManager` starts with `npm@`, use npm and treat Bun-era instructions as stale unless live repo state proves otherwise

Never guess unknown runtime facts.

## Blocker Contract

If required state is missing or ambiguous, return:

- blocker_reason
- missing_inputs
- safest_fallback

## Grounding References

- Microsoft grounding overview:
  - https://learn.microsoft.com/en-us/training/modules/responsible-generative-ai/3-grounding
- Prompting Guide factuality techniques:
  - https://www.promptingguide.ai/techniques/factuality
- IBM AI hallucinations overview:
  - https://www.ibm.com/topics/ai-hallucinations

## Acceptance Gate

No final architecture response without verifying `system_state.json` or explicitly declaring blocker.
