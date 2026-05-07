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

- Date: 2026-05-07
- Trigger: Playwright Bob UI regression (`tests/e2e/governance-bob-regression.spec.ts`) showing blank `/login` and `/bob` pages.
- Mistake: duplicate `/open-shifts` entries existed in both `src/navigation/routeManifest.ts` and `src/App.tsx`, causing route manifest validation to throw during app boot.
- Risk: full app startup failure in dev/prod, blank-page regressions, and misleading route-level debugging.
- Fix: removed duplicate route ID/path registrations and revalidated startup plus Bob/login route tests.
- Prevention Rule: when adding routes, run a manifest uniqueness check (routeId + path) and verify startup in browser before running deeper feature tests.

- Date: 2026-05-07
- Trigger: Browser console/runtime errors on Bob Assistant (`Cannot read properties of undefined (reading 'toFixed')`) and CSP warnings in production.
- Mistake: render path assumed numeric values (`speechRate`, `confidence`) were always defined; CSP policy did not include Vercel feedback script origin.
- Risk: render crashes in `BobAssistantStudio`, error-boundary fallbacks, and noisy console warnings that hide real defects.
- Fix: guarded `toFixed` calls with null-safe defaults, added migration fallback for speech rate, updated CSP `script-src` with `https://vercel.live`, and added `mobile-web-app-capable` meta tag.
- Prevention Rule: every user-controlled or persisted numeric render value must have a safe default, and CSP updates must accompany any newly introduced third-party script origins.

- Date: 2026-05-04
- Trigger: Repeated synthetic monitor bug-report bursts (#483-#502).
- Mistake: health workflow treated Bob provider degradation as a full platform outage even when frontend, Supabase, and Playwright checks passed.
- Risk: issue-noise floods, alert fatigue, and triage cycles spent on non-actionable platform incidents.
- Fix: updated `.github/workflows/synthetic-monitor.yml` so Bob degradation is flagged as warning-only when core app checks are healthy.
- Prevention Rule: synthetic reliability checks must classify core availability separately from optional/auxiliary provider quality signals.

- Date: 2026-05-04
- Trigger: `bun run build` failure in `src/components/features/AppLayout.tsx` after breadcrumb label map addition.
- Mistake: `new Map(...)` resolved to the imported Lucide `Map` icon symbol, not the global constructor.
- Risk: hard build failure on `main` and blocked release validation.
- Fix: switched constructor call to `new globalThis.Map(...)` and re-ran lint/build.
- Prevention Rule: when a file imports symbols that shadow built-ins (e.g., `Map`, `Set`), use `globalThis.*` for constructors in shared layout code.

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
