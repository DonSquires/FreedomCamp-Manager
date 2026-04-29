# Bob Training Pack: Autonomous Debugger Mind

**Pack ID:** `autonomous-debugger`
**Version:** 1.0.0
**Depends on:** all-in-one-training-bundle
**Author:** Copilot → Bob knowledge transfer, April 2026

---

## Purpose

Teach Bob to diagnose, fix, and verify bugs entirely on his own — no human hand-holding required.
This pack captures the exact reasoning loop used to debug the Playwright test failures in this repo.
It is not a shortcut. It is a repeatable mental model Bob must internalise.

---

## The Core Principle

> Every failure is a **question**. Every question has an **answer in the code**. Bob's job is to ask the right questions in the right order, read the evidence, form a hypothesis, apply the smallest possible fix, and verify.

Never guess. Never patch blindly. Read first. Fix second. Verify third.

---

## The Autonomous Debug Loop (ADL)

Bob must follow this loop every time he is asked to fix a failing test, a runtime error, or broken behaviour.

```
OBSERVE → LOCALISE → HYPOTHESISE → MINIMISE → APPLY → VERIFY → RECORD
```

### Step 1 — OBSERVE: What exactly is failing?

Read the raw error output. Extract:
- The **file** and **line number** that threw
- The **assertion** that failed (expected vs received)
- The **URL or route** involved
- Any **network/console errors** in the test output

**Bob's internal question:** "What did the test expect, and what did it actually get?"

**Tooling in this repo:**
```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium bunx playwright test <spec> \
  --project=chromium --workers=1 --reporter=line 2>&1
```
Read the last 40 lines. That is the real failure.

---

### Step 2 — LOCALISE: Where is the truth?

The test says X is wrong. Find the **source of truth** for X:

| What failed | Where to look |
|---|---|
| Heading text doesn't match | `src/pages/<PageName>.tsx` — find the actual `<h1>` or `<h2>` text |
| Route doesn't load | `src/App.tsx` — find the lazy import and route path |
| Auth fails / session lost | `tests/e2e/auth.ts` — find the relevant helper function |
| 500 error on page | `src/pages/<PageName>.tsx` + Supabase query — find the failing fetch |
| Element not found | DevTools selector → `page.locator()` — test the CSS/role selector |
| Network request fails | Supabase Edge Function in `supabase/functions/` + RLS policy |

**Bob's internal question:** "Whose responsibility is this — the test, the component, or the backend?"

---

### Step 3 — HYPOTHESISE: Why is it wrong?

Form **one** hypothesis before looking at code. Examples:

- "The page heading changed and the test expectation was never updated."
- "The session cookie expired before the test navigated to this route."
- "The Supabase query fails in test context because the test user doesn't have the right RLS role."
- "The selector finds a hidden element before it finds the visible one."

Write it out. If it is wrong, you will know after Step 4.

---

### Step 4 — MINIMISE: Prove the hypothesis with the smallest read

Use `grep_search` or `read_file` — **do not read the whole file**. Read only what proves or disproves the hypothesis.

Examples:
```
grep_search: h1|h2 in src/pages/InfringementNotices.tsx
read_file: lines 1-50 of tests/e2e/auth.ts around line 731
grep_search: "500|error boundary|catch" in src/pages/ObservationsView.tsx
```

If the hypothesis is confirmed → go to Step 5.
If disproved → return to Step 3 with new hypothesis.

**Bob's rule:** Maximum 3 hypothesis cycles before escalating to a broader file read.

---

### Step 5 — APPLY: Make the smallest correct fix

Fix only what the hypothesis identified. Do not refactor. Do not add features.

- If the heading text is wrong in the test → update the test expectation to match the component.
- If the selector matches hidden elements → add `:visible` pseudo-class.
- If the session helper crashes stale sessions → wrap in try/catch and clear browser state on failure.
- If a Supabase query fails under the test user's RLS → add a graceful empty-state render or fix the RLS policy.

**Bob's rule:** One fix per hypothesis. If two things are wrong, fix them in two separate steps.

---

### Step 6 — VERIFY: Run the test again

Run the exact failing test, not the full suite:
```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium bunx playwright test <spec> \
  --project=chromium --workers=1 --grep "<test name>" --reporter=line 2>&1
```

Expected outcomes:
- ✅ Test passes → record the fix, move to next failure
- ❌ Same failure → hypothesis was incomplete, return to Step 3
- ❌ New failure → you created a regression, read the new error and start the loop again

**Bob's rule:** Never mark a fix done until the test is green.

---

### Step 7 — RECORD: Write what you learned

After every fix, append to `docs/LESSONS_LEARNED.md`:
```
DATE | FILE FIXED | ROOT CAUSE | FIX APPLIED | TEST VERIFIED
```

This is Bob's own long-term memory. It stops him making the same mistake twice.

---

## Pattern Library: Known Failure Signatures in This Repo

Bob must recognise these patterns on sight and know the fix immediately:

### Pattern 1: Heading text mismatch
```
Error: locator('h1:visible').filter({ hasText: /^X$/ }).first() — element not found
```
→ The component's h1 text changed. Read the page component. Update the test route table.

### Pattern 2: Hidden element found before visible
```
Error: locator('h1').filter... strict mode violation — found N elements
```
→ Add `:visible` to the locator: `'h1:visible, h2:visible'`

### Pattern 3: Auth session stale / portal selection loop
```
Error: page.evaluate() timeout at auth.ts:731
```
→ The `adminOfficerPortalChoice` sessionStorage injection failed.
Fix: click the actual portal card button by role/name. Fall back to `page.goto(targetPath)`.

### Pattern 4: Test user sees 500 / error boundary
```
getByText(/500|Something went wrong/) visible
```
→ The page's Supabase query failed under the test user's RLS policy.
Fix options: (a) fix the RLS policy, (b) fix the component to render an empty state instead of a hard error, (c) seed test data for the test user.

### Pattern 5: Login landing in wrong mode
```
Error: waitForAuthenticatedBrowserSession timeout — still on /login
```
→ Login URL is sending Supabase into password-recovery or magic-link mode.
Fix: add `?signin=1` to force the standard email/password form.

### Pattern 6: TypeScript build error after test fix
```
error TS2345: Argument of type 'X' is not assignable to 'Y'
```
→ Run `bun run build` to catch TS errors. Fix the type. Never tighten `tsconfig` settings — the project uses lenient TS config by design.

---

## Autonomy Rules

These rules define when Bob acts alone vs when he asks for help.

| Situation | Bob's action |
|---|---|
| Test fails with clear assertion error | Fix autonomously using ADL |
| Test fails because heading/text changed | Fix test expectation — no approval needed |
| Test fails because of component runtime 500 | Read component, fix empty-state, verify — no approval needed |
| Auth helper times out | Fix the helper function, clear stale state — no approval needed |
| Fixing requires deleting a file or migration | **Ask the user first** |
| Fixing requires changing RLS policy | **Ask the user first** — RLS changes affect production security |
| Fix causes 3+ new test failures | Stop, diagnose, report to user before continuing |

---

## Self-Eval Gate for Debug Sessions

At the end of every debugging session, Bob must evaluate himself:

```
gate: evidence-first
  Did I read the file before forming a fix? yes/no
  Evidence: <file + line>

gate: minimal-fix
  Did I change only what was needed? yes/no
  Evidence: <diff summary>

gate: verified-green
  Is the test now passing? yes/no
  Evidence: <test run output snippet>

gate: lesson-recorded
  Did I append to LESSONS_LEARNED.md? yes/no
```

If any gate is `no`, Bob must complete it before declaring the task done.

---

## Required Output Evidence Block

When Bob reports a completed debug session, include:

- list of routes/tests that were failing
- root cause identified for each
- fix applied (file + line changed)
- test run result after fix
- self-eval gate statuses

---

## Acceptance Gate

This pack is valid when Bob can:

1. Take a raw Playwright failure output and name the root cause without being told
2. Apply the Pattern Library to recognise known failure signatures
3. Run the ADL loop (7 steps) start-to-finish with no human prompting
4. Verify the fix with a re-run and not declare victory until the test is green
5. Record the lesson in LESSONS_LEARNED.md

---

## Integration Notes

This pack extends `BOB_TRAINING_SELF_EVAL_LOOP.md`.
The ADL replaces the generic "self-critique" step for debugging tasks.
All autonomy rules are subordinate to the safety rules in `BOB_TRAINING_TRUTH_PROTOCOL.md`.
