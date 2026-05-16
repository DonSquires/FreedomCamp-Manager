# Bib Storage Data Entry Playbook

Purpose: stage raw files from Supabase Storage into the app so Bob/Bib can review and action them in the intake queue.

For Deputy-specific roster evidence handling, follow `docs/DEPUTY_ROSTER_DATA_PLAYBOOK.md`.

## What this does

- Scans a storage bucket/prefix.
- Converts each file into a staged row in `ai_import_intakes`.
- Avoids duplicates by checking `storage_bucket + storage_path`.
- Leaves the final decision to the existing Bob Intake Queue workflow.

## Prerequisites

- `SUPABASE_SERVICE_ROLE_KEY` set in environment (or `.env`).
- `SUPABASE_URL` or `VITE_SUPABASE_URL` set.
- Organization ID is either:
  - discoverable from path (`historical-imports/<org-uuid>/...` or `bob-intake/<org-uuid>/...`), or
  - provided via `--organization-id`.

## Step-by-step training workflow (teach Bib while doing)

1. Explain the objective to Bib:
   - "We are staging raw files for review, not auto-approving imports."
2. Run a dry-run first:
   - `bun run bob:intake:backfill-storage -- --bucket evidence --prefix historical-imports --limit 100 --verbose`
3. Review summary counts:
   - `staged` should be non-zero.
   - `skipped_missing_org` should be zero or expected.
4. If org IDs are missing in paths, rerun with fallback org:
   - `bun run bob:intake:backfill-storage -- --bucket evidence --prefix legacy-imports --organization-id <org-uuid> --limit 100 --verbose`
5. Execute real write:
   - `bun run bob:intake:backfill-storage:apply -- --bucket evidence --prefix historical-imports --limit 100`
6. Continue in deterministic batches with offset:
   - `bun run bob:intake:backfill-storage:apply -- --bucket evidence --organization-id <org-uuid> --offset 100 --limit 100`
   - Increase `--offset` by `--limit` each run (0, 100, 200, ...).
7. In the app, review outcomes:
   - Open `/bob-intake-queue`.
   - Filter by status `staged`.
   - Confirm each item before marking `actioned`.

## Recommended coaching script for Bib

- "Dry-run first, always."
- "Never auto-action staged records without queue review."
- "If org is ambiguous, stop and provide explicit `--organization-id`."
- "Use small batches (`--limit 50` or `--limit 100`) and validate after each run."

## Safety notes

- The script does not delete or mutate storage objects.
- The script does not mark records `actioned`; it creates `staged` rows only.
- Re-running is safe because duplicate storage objects are skipped.

## Commands quick reference

- Dry-run all root files in evidence:
  - `bun run bob:intake:backfill-storage -- --bucket evidence --limit 200`
- Dry-run specific prefix:
  - `bun run bob:intake:backfill-storage -- --bucket evidence --prefix bob-intake --limit 200 --verbose`
- Apply specific prefix:
  - `bun run bob:intake:backfill-storage:apply -- --bucket evidence --prefix bob-intake --limit 200`
- Apply with offset cursor:
   - `bun run bob:intake:backfill-storage:apply -- --bucket evidence --organization-id <org-uuid> --offset 200 --limit 100`

## Auto-stop batch runner (repeatable scheduling)

- Dry-run drain (stops when staged=0):
   - `bun run bob:intake:backfill-storage:drain -- --bucket evidence --organization-id <org-uuid> --limit 100 --start-offset 0 --max-batches 100`
- Apply drain (safe per-batch dry-run + apply):
   - `bun run bob:intake:backfill-storage:drain:apply -- --bucket evidence --organization-id <org-uuid> --limit 100 --start-offset 0 --max-batches 100`
- Apply a scoped prefix drain:
   - `bun run bob:intake:backfill-storage:drain:apply -- --bucket evidence --prefix bob-intake --organization-id <org-uuid> --limit 100 --max-batches 50`
