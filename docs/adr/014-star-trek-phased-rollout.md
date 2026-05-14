# ADR 014 — Star Trek Phased Rollout Architecture

Date: 2026-05-14
Status: Accepted
Deciders: Platform Architecture Lead, Bob Platform Lead
Linked plan: [docs/STAR_TREK_PHASED_ROLLOUT_PLAN.md](../STAR_TREK_PHASED_ROLLOUT_PLAN.md)
Linked staging: [docs/STAGING.md](../STAGING.md)

---

## Context

FieldOps Manager needed a structured rollout to safely introduce Bob AI as a first-class platform actor across four capability areas:

1. **Phase 1 (Director)** — Roster-gated field access: officers cannot enter tactical modules without an active shift.
2. **Phase 2 (Universal Translator)** — Dual-path audio: co-worker PTT + Bob intercom with wake-word and audio ducking.
3. **Phase 3 (Sentient XO)** — Persistent Bob memory and voice-operated administrative actuation.
4. **Phase 4 (Admiral's Bridge)** — Manager-level tactical map, pre-arrival safety dossier, and human-in-the-loop enforcement signature.

Each phase required: a checkpoint E2E spec, a STAGING evidence entry, and an INSTRUCTION_MANUAL update before the next phase could begin.

---

## Decision

### Phase 1 — Director (Roster and Access Gate)

- **Implementation**: `useDirectorRosterGate()` hook in `src/middleware.ts` redirects `officer` role users to `WAITING_FOR_SHIFT_PATH = '/officer-home'` when no active `roster_shifts` record exists.
- **Canonical welfare standby route**: `/officer-home` (`OfficerHomePage`). The `/waiting-for-shift` path is a legacy redirect to `/officer-home`.
- **Admin bypass**: The gate only applies when `user.role === 'officer'`; `admin`, `admin_officer`, and `master` roles are never subject to it.
- **Bob identity bypass**: Bob's E2E testing identity (`loginAs(page, 'bob')`) is not redirected to `/officer-home`.

### Phase 2 — Universal Translator (Voice and Audio Logic)

- **Implementation**: `src/pages/PTTRadio.tsx` hosts the dual-path audio surface.
- **Key UI surface**: Interpreter panel behind the "Show Interpreter" button (`data-testid="show-interpreter-toggle"`); only visible on `md:` breakpoint and above.
- **Wake-word control**: `data-testid="wake-word-switch"` (Switch component).
- **Audio ducking**: `data-testid="audio-ducking-switch"` (Switch component); defaults on; `data-testid="audio-ducking-status"` shows current state.
- **Bob Intercom**: `data-testid="bob-intercom-speak-button"` in the interpreter panel.
- **Hold-to-talk**: `[data-testid="ptt-hold-to-talk"]` or `button[aria-label="Push to talk"]`.

### Phase 3 — Sentient XO (Memory and Administrative Actuation)

- **Route**: `/bob-assistant` (`BobAssistantStudio`).
- **Bob input**: `textarea[placeholder*="Ask Bob"]` with fallback to `textarea[placeholder*="Message Bob"]` and `textarea[aria-label*="Bob"]`.
- **Response bubbles**: `[class*="rounded-2xl"]` — presence of at least one bubble confirms message exchange.
- **Login identity**: `loginAs(page, 'bob')` — Bob is the dedicated testing identity for all Bob assistant workflow checks.

### Phase 4 — Admiral's Bridge (Welfare and Enforcement)

- **Tactical map**: `/live-tracking`.
- **Welfare alerts**: `/admin/dashboard`.
- **Armed-danger toggle**: `#bob-danger-auto-assist` in `BobAssistantStudio` (line 5787).
- **Human re-auth**: `gotoWithReauth` pattern used for protected admin routes.

---

## E2E Test Coverage

| Phase | Spec file | Hardened standard | Deferred browser validation |
|---|---|---|---|
| 1 — Director | `phase1-director-roster-gate.spec.ts` | ✓ | Required (Alpine/Chromium constraint) |
| 2 — Universal Translator | `phase2-universal-translator.spec.ts` | ✓ | Required (Alpine/Chromium constraint) |
| 3 — Sentient XO | `phase3-sentient-xo.spec.ts` | ✓ | PASS 5/5 confirmed in browser environment |
| 4 — Admiral's Bridge | `phase4-admirals-bridge.spec.ts` | ✓ | PASS 5/5 confirmed in browser environment |

---

## Consequences

1. All future changes to roster-gate logic in `src/middleware.ts` must update the `WAITING_FOR_SHIFT_PATH` constant and keep `phase1-director-roster-gate.spec.ts` in sync.
2. PTTRadio interpreter panel UI changes must preserve the five data-testids used by Phase 2 spec.
3. BobAssistantStudio changes must preserve `/bob-assistant` route, Bob input textarea, `rounded-2xl` bubble class, and `#bob-danger-auto-assist` toggle ID.
4. Any officer-role access or welfare-standby change must be reflected in `docs/INSTRUCTION_MANUAL.md` section 2.3a before deployment.
5. The canonical deferred retest command for Phase 1+2 browser validation is: `bash scripts/playwright-bob-runtime.sh bunx playwright test tests/e2e/phase1-director-roster-gate.spec.ts tests/e2e/phase2-universal-translator.spec.ts --project=chromium --workers=1 --reporter=line`.
