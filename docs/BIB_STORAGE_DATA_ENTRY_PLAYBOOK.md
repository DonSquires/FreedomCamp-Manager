# Bib Storage Data Entry Playbook

Purpose: stage raw files from Supabase Storage into the app so Bob/Bib can review and action them in the intake queue.

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
  - `node scripts/backfill-bob-intakes-from-storage.mjs --bucket evidence --limit 200`
- Dry-run specific prefix:
  - `node scripts/backfill-bob-intakes-from-storage.mjs --bucket evidence --prefix bob-intake --limit 200 --verbose`
- Apply specific prefix:
  - `node scripts/backfill-bob-intakes-from-storage.mjs --apply --bucket evidence --prefix bob-intake --limit 200`
- Apply with offset cursor:
   - `node scripts/backfill-bob-intakes-from-storage.mjs --apply --bucket evidence --organization-id <org-uuid> --offset 200 --limit 100`

## Full Enrichment + Bob/App Training Execution

Use this sequence to continue live enrichment and training in one run.

1. Dry-run orchestration:
   - `npm run bob:enrichment:training`
2. Apply orchestration:
   - `npm run bob:enrichment:training:apply`

What the apply workflow executes:

- Intake dry-run + apply
- First Security org bootstrap
- Marlborough parking bootstrap (zones/sites/grants + workspace/contractor access)
- Bob context feeds
- Validation gates (doc lint, typecheck, build, spatial tests)
- App training checks (runtime status + capability gate)

### Resilience behavior (current default)

- Spatial boundary step uses AI retry and timeout fallback (`--aiRetries 3 --allowAiTimeout`).
- Spatial boundary test runs with strict transition coordinates between Marlborough District Council and Port Marlborough workspaces; no-transition is treated as a blocker.
- Capability gate uses explicit diagnostics and retries (`--retries 3 --timeoutMs 90000`); persistent serverless aborts are treated as external blockers.
- Any active blocker state means the run is not ready for strict sign-off.

### Run artifact (required)

- Each apply run writes:
   - `logs/enrichment-training-artifact.json`
- Artifact records:
   - per-step success/failure
   - retry attempts
   - blocker list
   - degraded state (expected `false` for strict sign-off)

### Mandatory follow-up after blocked completion

1. Re-run boundary test with validated coordinates once context resolver coverage is confirmed:
   - `node scripts/geo-boundary-transition-test.mjs --providerOrgId b3dcef79-9cc1-4f3b-bae0-a190297c52b7`
2. Re-run capability gate when inference/serverless health is stable:
   - `npm run bob:capabilities`
3. Record blocker status and timestamps in staging notes.
