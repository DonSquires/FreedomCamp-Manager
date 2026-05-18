# UI/UX Accessibility Checklist

This checklist is tailored for the FieldOps Manager React + shadcn/ui patterns.

## 1) Inputs, Filters, and Forms

- Every `Input`, `Select`, `Textarea`, and date/time field has a programmatic name.
- Prefer visible labels via `Label` + `htmlFor`.
- If compact UI requires hidden labels, use `aria-label`.
- Do not rely on placeholders as the only label.
- Required fields include clear required indicator and validation guidance.
- Error messages are tied to controls (`aria-describedby` where needed).

## 2) Keyboard Access

- All interactive actions are reachable by keyboard only.
- No `div`/`tr` click-only interactions for critical actions.
- Use native controls (`button`, `a`, `input`) for actions.
- If a non-native control is unavoidable, add `role`, `tabIndex`, `Enter` and `Space` handlers.
- Logical tab order follows visual order.
- Focus is always visible and not suppressed.

## 3) Table and Log Views

- Expand/collapse actions use explicit buttons in cells.
- Expand buttons expose `aria-expanded` and `aria-controls`.
- Expanded panel rows have stable IDs matching `aria-controls`.
- Row-level actions are not mouse-only.
- Sort/filter controls in table headers have accessible names.

## 4) Icon-Only Buttons

- Every icon-only button has an accessible name (`aria-label`).
- Prefer adding `title` for pointer users.
- Status-only icons include adjacent text or `aria-label` context.

## 5) Images and Media

- Informative images always include meaningful `alt` text.
- Decorative images use empty alt (`alt=""`).
- Clickable thumbnails are real buttons/links, not plain containers.
- If preview opens a dialog, ensure focus moves into dialog and returns on close.

## 6) Color and Contrast

- Text and controls meet WCAG contrast minimums.
- Status is not conveyed by color alone; include text/icons.
- Hover-only cues have non-hover equivalents.

## 7) Navigation and Landmarks

- Primary page landmarks are present (`header`, `nav`, `main`, `footer` as applicable).
- Mobile menu and sidebar toggles have accessible names and states.
- Current page is clearly indicated in navigation.
- Breadcrumbs reflect actual route hierarchy.

## 8) Feedback and Async States

- Loading states expose user feedback text (not spinner only).
- Empty states explain next action.
- Errors are actionable and specific.
- Background refresh indicators are announced clearly in UI text.

## 9) Dialogs, Sheets, Popovers

- Opening focus is set predictably.
- Escape closes when appropriate.
- Focus is trapped while open and restored when closed.
- Close buttons are discoverable and labeled.

## 10) Testing Gate (Before Merge)

- Keyboard-only walkthrough: pass
- Screen reader spot check on critical pages: pass
- Color contrast spot check on light/dark themes: pass
- Mobile viewport usability check: pass
- Lint + build pass with no new warnings/errors: pass

## Priority Review Pages in This Repo

- `src/pages/EnforcementActionLog.tsx`
- `src/pages/PricingRuleLog.tsx`
- `src/pages/DispatchJobLog.tsx`
- `src/pages/ObservationsView.tsx`
- `src/components/features/AppLayout.tsx`
