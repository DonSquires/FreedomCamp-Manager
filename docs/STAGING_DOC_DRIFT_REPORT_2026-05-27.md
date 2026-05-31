# Staging Doc Drift Report (2026-05-27)

## Scope

Reviewed staging entry points and directly associated docs:

- docs/STAGING.md
- REALIGNMENT_EXECUTION_STAGING.md
- docs/DEPLOYMENT_GUIDE.md
- Associated-doc index was generated locally during review (61 markdown files) and not committed to the repository.

## Summary

Canonical runtime policy in this repository is npm-first and npm-only for package management. Drift remains in operational docs that still present Bun commands as active instructions.

## Findings

Findings below describe the pre-fix state observed during this review pass:

1. REALIGNMENT_EXECUTION_STAGING.md previously presented Bun as required in Quick Start and tooling sections.
2. docs/DEPLOYMENT_GUIDE.md previously used Bun validation commands in pre-deploy and post-push checks.
3. docs/STAGING.md includes historical Bun command evidence entries mixed with npm-only governance sections.

## Resolution Applied

1. REALIGNMENT_EXECUTION_STAGING.md:
- Quick Start changed to npm commands.
- Tool requirements changed to npm as package manager.
- Phase A install block changed to npm commands.
- Commit template test line changed to npm commands.
- Added explicit normalization note that any remaining historical Bun snippets are archival and map to npm equivalents.

2. docs/DEPLOYMENT_GUIDE.md:
- Replaced Bun validation references with npm equivalents.
- Updated Vercel build command guidance to npm.
- Updated live schema verification runbook build/lint commands to npm and removed Bun PATH export.

3. docs/STAGING.md:
- Added a top-level canonical command policy note clarifying that historical Bun evidence entries are archival and current execution must use npm equivalents.

## Remaining Optional Follow-up

1. Full archival cleanup pass replacing every historical Bun token in docs/STAGING.md for visual consistency.
2. Add a CI docs drift check that fails on new active Bun command instructions outside explicitly marked archival sections.
