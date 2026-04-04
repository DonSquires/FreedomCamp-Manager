# Bob Self-Contained Build Review Training Pack

## Purpose
Use this pack to train and evaluate Bob in strict privacy mode (no outbound cloud access) before go-live.

This pack is based on a real validation run from this repository on 2026-04-04.

## Ground Rules
- Bob must run in self-contained mode only.
- No external API calls for training or inference.
- Use internal evidence only (build logs, lint logs, code context).
- Strip sensitive values from prompts and logs before storage.

## Current Baseline Evidence
### Build
- Command: `bun run build`
- Result: success
- Notable warning: large chunks after minification
- Key chunk sizes:
  - `ImportData` about 1006 kB (gzip about 282 kB)
  - `vendor-charts` about 434 kB
  - `vendor-xlsx` about 332 kB
  - `vendor-maps` about 199 kB

### Lint
- Command: `bun run lint`
- Result: fail
- Summary: 6 errors, 8 warnings
- Error hotspots:
  - `src/components/features/PublicSafetyBanner.tsx`: `prefer-const`
  - `src/pages/ImportData.tsx`: `prefer-const`
  - `src/pages/TeamChat.tsx`: `no-useless-escape` (4 instances)
- Warning hotspots (hook dependency risk):
  - `src/components/features/AccessControlPanel.tsx`
  - `src/components/features/FaceRecognition.tsx`
  - `src/hooks/useSessionGpsLogging.ts`
  - `src/pages/BobAssistantStudio.tsx`
  - `src/pages/FieldOfficerPortal.tsx`

## Training Objective
Teach Bob to produce high-quality, privacy-safe, actionable build reviews that:
- separate blockers from advisories,
- prioritize impact,
- cite concrete evidence,
- propose short execution plans,
- avoid requesting cloud access.

## Prompt Set (Internal)

### Prompt 1: Full Build Review
You are Bob, operating in self-contained internal mode.
Review this evidence:
- Build: successful with large chunk warning (`ImportData` ~1006 kB, `vendor-charts` ~434 kB, `vendor-xlsx` ~332 kB, `vendor-maps` ~199 kB).
- Lint: failed with 6 errors and 8 warnings.
- Errors: `prefer-const` in `PublicSafetyBanner.tsx` and `ImportData.tsx`; `no-useless-escape` in `TeamChat.tsx` (4 instances).
- Warnings: React hook dependency warnings in `AccessControlPanel.tsx`, `FaceRecognition.tsx`, `useSessionGpsLogging.ts`, `BobAssistantStudio.tsx`, `FieldOfficerPortal.tsx`.
Return sections:
1) Critical release blockers
2) Performance risks
3) Reliability/maintainability risks
4) Privacy checks before release
5) 14-day remediation plan with owners

### Prompt 2: Blocker-Only Triage
From the same evidence, return only hard release blockers and exact first fixes.
Max 8 bullet points.

### Prompt 3: Perf Optimization Plan
Create a focused chunk-reduction plan for `ImportData` and related heavy vendors.
Include measurable targets and validation commands.

### Prompt 4: Reliability Drill
Explain why stale hook dependencies are risky in this app and list top 5 fixes by operational impact.

### Prompt 5: Privacy-Safe Review Style
Rewrite a noisy technical review into privacy-safe language:
- no keys,
- no external endpoint assumptions,
- no cloud dependencies.

## Gold Answer Outline
Use this expected structure when grading Bob responses.

### A. Critical blockers
- Lint must be zero-error before release.
- Explicitly call out `prefer-const` and `no-useless-escape` locations.
- Distinguish errors from warnings.

### B. Performance risks
- Identify `ImportData` as highest impact bundle hotspot.
- Mention likely causes: eager imports (xlsx/charts/maps), monolithic route payload.
- Recommend route-level and feature-level dynamic imports.

### C. Reliability risks
- Hook dependency warnings can cause stale closures and incorrect runtime behavior.
- Prioritize high-traffic/operational pages first.

### D. Privacy checks
- Confirm self-contained mode policy adherence.
- Confirm no outbound model or third-party calls required for training workflow.
- Ensure logs used for training are sanitized.

### E. 14-day plan
- Days 1-2: clear lint errors.
- Days 3-6: fix hook dependency warnings in priority order.
- Days 7-10: split `ImportData` and heavy vendor imports.
- Days 11-12: regression checks.
- Days 13-14: dry-run release review and acceptance sign-off.

## Scoring Rubric (0-2 per criterion)
- Accuracy: does Bob reflect the evidence correctly?
- Prioritization: blockers before advisories?
- Actionability: clear next steps with owners/sequence?
- Privacy discipline: no cloud requirement introduced?
- Concision: focused and scannable?

Total score: 10 points.
- 9-10: release-ready reviewer behavior
- 7-8: acceptable with minor coaching
- <=6: needs retraining loop

## Recommended Ownership Model
- Frontend engineer: lint errors and chunk splitting
- Platform engineer: build/lint gating and CI policy
- Product/ops reviewer: remediation priority validation
- Security/privacy reviewer: dataset sanitization checks

## Execution Loop (Self-Contained)
1. Run `bun run build` and `bun run lint`.
2. Feed evidence into Bob using Prompt 1.
3. Score output with rubric.
4. If score < 9, run Prompt 2 and Prompt 4 for corrective coaching.
5. Repeat after each fix batch.

## Acceptance Gate Before Go-Live
- Lint errors: 0
- Build: success
- Chunk strategy defined for large routes
- Bob review score: >= 9 across 3 consecutive runs
- Privacy check: no outbound dependency required for training loop

## Notes
Current deployed Bob endpoint is returning strict self-contained policy text for complex review prompts. Treat that as a deployment/runtime behavior to fix separately from this training content. The training pack remains valid and can be executed with any internal Bob runtime that returns normal review text.
