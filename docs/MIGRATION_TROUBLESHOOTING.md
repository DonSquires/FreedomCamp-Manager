# Migration Troubleshooting Guide

This document explains how to diagnose and resolve Supabase migration history
conflicts for the FreedomCamp Manager project.

---

## Background: How Migration Drift Happens

Supabase tracks which SQL files have been applied in a `supabase_migrations`
table on the remote database.  Drift occurs when:

- A migration file is renamed or its version prefix changes after it was
  already applied remotely (e.g. `20260313_fix_admin_officer_rls.sql` was
  pushed under the short key `20260313`, but new timestamped files like
  `20260313000001_…` were later added locally).
- A migration was applied directly on the remote database (e.g. via the
  Supabase dashboard) and was never committed locally.
- A developer applied a migration locally but didn't push it to the remote
  before another developer applied a different migration, creating an ordering
  conflict.

---

## Quick Diagnosis

```bash
# Requires SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, SUPABASE_PROJECT_REF
supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
supabase migration list
```

The output shows local files, remote entries, and their sync status.
Look for rows marked `MISSING` (present remotely but absent locally) or rows
with mismatched versions.

---

## Common Error Messages

### "Found local migration files to be inserted before the last migration on remote database"

A local file has a version timestamp earlier than the latest migration already
applied on the remote.

**Fix:**

```bash
supabase migration repair --status applied <version>
# Then retry:
supabase db push
```

The `version` is the date/time prefix of the local file
(e.g. `20260313000001` for `20260313000001_emergency_coalesce_fix.sql`).

### "Remote migration versions not found in local migrations directory"

The remote database has an entry (e.g. `20260313`) for which no matching local
file exists.  This typically means the file was renamed or split.

**Fix:**

```bash
supabase migration repair --status reverted <version>
# Then retry:
supabase db push
```

If the CLI suggests the exact repair command in its output, copy and run it
directly.

---

## Known Short-Form Drift Versions

The following date-only versions are known to appear on the remote as legacy
entries with no corresponding single local file:

| Version    | Local replacements |
|------------|--------------------|
| `20250127` | Various early migrations |
| `20260309` | `20260309000001_…` through `20260309000004_…` |
| `20260312` | `20260312000001_…` through `20260312000012_…` |
| `20260313` | `20260313000001_…`, `20260313000002_…`, `20260313000010_…`, `20260313_fix_admin_officer_rls.sql` |
| `20260315` | `20260315000001_revert_officer_shifts_and_site_visits.sql` |
| `20260316` | `20260316000001_…`, `20260316000002_…` |
| `20260320` | `20260320000001_…` through `20260320000003_…` |

Revert all of them in one command:

```bash
supabase migration repair --status reverted \
  20250127 20260309 20260312 20260313 20260315 20260316 20260320
```

---

## Future-Dated Migrations

**Background:** During March–April 2026 a number of migration files were
committed with version dates in April 2026 (e.g. `20260401000001` through
`20260416000001`) while the actual calendar date was still in March 2026.
These migrations are correctly applied in the remote database with those
version numbers.

**Why this matters — the silent-skip trap:**

Supabase applies migrations in ascending version order.  If a new migration is
created today with the actual current date (e.g. `20260316XXXXXX`), it will
sort _before_ the already-applied April migrations in the remote history.
`supabase db push` will then detect "local migrations before remote tail" and
— if the auto-repair logic in the workflow runs — silently mark the new file
as *applied* without ever executing its SQL.  **Schema changes will be
skipped without any error.**

**Rule: always use a version dated AFTER the latest applied migration.**

To find the latest applied version:

```bash
ls supabase/migrations | sort | tail -1
# Example output: 20260416000001_fix_vehicle_observations_v2_normalisation.sql
# → next safe version prefix: 20260417 (or 20260416000002 for same-day)
```

New migrations must use a version ≥ `20260417000001` until the wall-clock
date catches up to April 17, 2026.

**Detecting future-dated files:**

The `migration-check` CI workflow (`.github/workflows/migration-check.yml`)
includes a step that warns whenever migration files are dated ahead of the
current calendar date, and prints the minimum version prefix that is safe to
use for new work.

**Summary table:**

| Situation | Safe action |
|-----------|-------------|
| Adding a new migration now (< 2026-04-17) | Use version prefix `20260417000001` or later |
| Adding a new migration after 2026-04-17 | Use actual date as normal (`YYYYMMDD000001`) |
| Reviewing CI warning about future-dated files | Check the warning message for the minimum safe version |

---

## Automated Fix Script

For convenience, a script is provided that automates the repair workflow:

```bash
export SUPABASE_ACCESS_TOKEN='sbp_...'
export SUPABASE_DB_PASSWORD='...'
export SUPABASE_PROJECT_REF='...'

bash scripts/fix-migration-sync.sh
```

The script:

1. Links the CLI to the remote project.
2. Reverts all known short-form drift versions.
3. Retries `supabase db push` up to three times, handling Case 1 and Case 2
   errors automatically.
4. Falls back to `supabase db push --include-all` with one additional repair
   pass if needed.

---

## Manual Step-by-Step Recovery

Use this procedure when the automated script cannot resolve the conflict.

### Step 1 — Check migration state

```bash
supabase migration list
```

### Step 2 — Revert remote-only short-form versions

```bash
supabase migration repair --status reverted \
  20250127 20260309 20260312 20260313 20260316 20260320
```

### Step 3 — Try a standard push

```bash
supabase db push
```

If this succeeds, you are done.

### Step 4 — If "Found local … before last migration" error appears

Mark the out-of-order file as already applied:

```bash
supabase migration repair --status applied <version-from-error>
supabase db push
```

### Step 5 — If "Remote migration versions not found" error persists

Copy the repair command from the CLI output and run it:

```bash
supabase migration repair --status reverted <versions-from-error>
supabase db push --include-all
```

### Step 6 — If all else fails: pull remote schema

This overwrites local migration files with what the remote actually has.
**Commit your current migration files first.**

```bash
git add supabase/migrations && git stash
supabase db pull
git stash pop
# Resolve any conflicts, then:
supabase db push
```

---

## Preventing Future Drift

1. **Never apply SQL directly in the Supabase dashboard** on production without
   creating a matching local migration file first.
2. **Use full timestamp versions** (`YYYYMMDDHHMMSS`) for all new migrations,
   especially when multiple migrations are created on the same day.
3. **Never use a version date earlier than the latest applied migration.**
   If future-dated migrations exist in the repo, new files must use a version
   dated *after* the latest one.  Run `ls supabase/migrations | sort | tail -1`
   to find the current tail, then use the next calendar day as your prefix.
   See [Future-Dated Migrations](#future-dated-migrations) for details.
4. **Avoid renaming migration files** after they have been applied remotely.
5. **Always run `supabase migration list`** before and after pushing to verify
   the state.
6. **The CI workflow** (`.github/workflows/supabase-db-push.yml`) handles known
   drift automatically.  If it fails, run `scripts/fix-migration-sync.sh`
   locally and commit any resulting migration repairs.

---

## Related Documentation

- [docs/DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) — canonical deployment guide
- [docs/LIVE_SCHEMA.md](LIVE_SCHEMA.md) — live schema reference
- [docs/SUPABASE_MIGRATION_RECOVERY_RUNBOOK.md](SUPABASE_MIGRATION_RECOVERY_RUNBOOK.md) — historical runbook (see DEPLOYMENT_GUIDE.md for current procedures)
