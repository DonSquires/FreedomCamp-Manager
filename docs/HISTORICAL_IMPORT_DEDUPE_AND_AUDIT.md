# Historical Import Dedupe and Audit Artifacts

## Purpose

This project now enforces no-double-up behavior across Deputy roster ingestion and historical import pipelines.

Rules implemented:
- If a client already exists, reuse it.
- If a site already exists, reuse it.
- If a staff profile already exists, reuse it.
- Each alarm/dispatch job must remain unique.
- Historical rows must be idempotent and skipped when duplicate.

## Updated Pipelines

### 1) Deputy roster import

Function:
- `supabase/functions/deputy-roster-import/index.ts`

Behavior:
- Reuses existing officers, client sites, and locations when possible.
- Uses deterministic keys and in-batch duplicate guards for shifts/leave/timesheets.
- Staged staff creation does not send invites (`invite_suppressed` behavior).

### 2) Historical import (XLSX path)

Function:
- `supabase/functions/import-historical-data/index.ts`

Behavior:
- In-batch duplicate set guards.
- Idempotency checks and duplicate skip metrics.
- Returns summary field `duplicates_skipped`.

Audit artifact support:
- Request accepts optional:
  - `audit_bucket` (default: `import-audits`)
  - `audit_prefix` (default: `historical-imports`)
- Response includes:
  - `audit_artifact.bucket`
  - `audit_artifact.path`

### 3) Historical import (legacy AI extraction path)

Function:
- `supabase/functions/import-data/index.ts`

Behavior:
- Deterministic idempotency key generation.
- Duplicate rows are skipped before insert.
- Returns duplicate counters.

Audit artifact support:
- Request accepts optional:
  - `auditBucket` (default: `import-audits`)
  - `auditPrefix` (default: `historical-imports`)
- Response includes:
  - `audit_artifact.bucket`
  - `audit_artifact.path`

## Audit Artifact JSON Content

The artifact stores run-level import metrics, including duplicate treatment. Typical fields include:
- `generated_at`
- `importer`
- `organization_id`
- `metrics` with duplicate counters
- sampled skipped/error records for traceability

If artifact upload fails, import processing remains successful and the response returns a null artifact path.

## Parser-Level Dedupe

Files:
- `src/lib/historicalDispatchIntelligence.ts`
- `src/lib/historicalPatrolIntelligence.ts`

Behavior:
- Dedupes parsed rows by dispatch identifiers before write-time import logic.
- Provides defense-in-depth with runtime idempotency checks.

## Source Mapping and Duplicate Audit Tooling

Files:
- `data/source-mappings/small-client-ingestion-rules.json`
- `scripts/audit-small-client-source-duplicates.mjs`

Purpose:
- Defines dataset-level natural/fallback duplicate keys.
- Produces duplicate-rate audit output artifacts before/after import runs.
