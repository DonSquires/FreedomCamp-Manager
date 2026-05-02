# ADR 002: Module Grounding Parser Hardening

## Status

Accepted

## Context

`scripts/generate-module-grounding-report.mjs` parses `src/App.tsx` to extract route declarations and resolve their component imports. Two bugs caused false-positive grounding failures:

1. **Route collection using `indexOf`**: The script matched the `Routes` container component as a route declaration, causing `/login` to be reported with `componentName: "Routes"` and no resolved file.
2. **Import resolution not handling directory imports**: The script only tried `<import>.tsx` extension when resolving `@/`-prefixed imports. Directory-based imports such as `@/modules/messaging` (which resolves to `src/modules/messaging/index.ts`) were reported as unresolved.

These bugs caused strict governance gates to report `unresolved > 0` and `missing files > 0` even on a clean, fully-grounded codebase.

## Decision

1. Replace `indexOf`-based Route collection with a regex-based approach:
   ```js
   [...source.matchAll(/<Route\b[\s\S]*?\/>/g)]
   ```
   This matches only self-closing `<Route ... />` elements, excluding container components like `<Routes>`.

2. Replace the single-extension `normalizeImportPath()` with a multi-candidate `resolveImportFile()` that tests extensions in priority order:
   - `.tsx`, `.ts`, `.jsx`, `.js`
   - `index.tsx`, `index.ts`, `index.jsx`, `index.js` (for directory imports)

## Consequences

- All 120 routes resolve to known imports and existing files (unresolved=0, missing files=0).
- Strict governance gate `[module-grounding:validate]` no longer produces false positives for self-closing Route parsing or directory-index imports.
- Any future directory-based module entry points will resolve automatically without script changes.
- The fix is backwards compatible — file-based imports still resolve via the existing extension candidates.

## Verification

- `node scripts/generate-module-grounding-report.mjs` reports `Routes: 120 | unresolved: 0 | missing files: 0`
- `node scripts/validate-module-grounding.mjs` exits with `[module-grounding:validate] PASS`
- All P0 governance gates pass in the same run.
