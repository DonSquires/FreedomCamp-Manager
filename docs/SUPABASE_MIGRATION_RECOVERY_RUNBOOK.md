# Supabase Migration Recovery Runbook

Purpose: fast recovery when `supabase db push` fails due migration-history drift or schema variance between local migrations and remote database.

## 1) Pre-checks

1. Ensure local branch is up-to-date.
2. Use Supabase CLI `2.75.0+`.
3. Authenticate with a Supabase Personal Access Token (`sbp_...`), not a project JWT.

```bash
export SUPABASE_ACCESS_TOKEN='sbp_...'
/tmp/supabase migration list
```

## 2) Detect drift pattern

If `db push` reports remote versions missing locally, run:

```bash
/tmp/supabase migration list
```

Look for rows where one side is blank. Typical problematic short versions were:

- `20250127`
- `20260309`
- `20260312`
- `20260316`
- `20260320`

## 3) Repair remote history to match normalized full versions

Use CLI repair when prompted by Supabase output:

```bash
/tmp/supabase migration repair --status reverted 20250127 20260309 20260312 20260316 20260320 --yes
```

Then retry:

```bash
/tmp/supabase db push --include-all --yes
```

## 4) Normalization rules for migration files

1. Keep migration versions unique.
2. Prefer full timestamp versions (`YYYYMMDDHHMMSS`) over date-only when multiple same-day migrations exist.
3. Avoid having both a short date migration and multiple same-date timestamp migrations in active chains.

## 5) Compatibility guardrails now in place

The following migrations were hardened to tolerate schema drift:

- `20260312000008_seed_nz_organisations.sql`
- `20260316000001_compliance_dashboard_indexes.sql`
- `20260320000001_fix_observation_zone_assignments.sql`
- `20260323_photo_recovery_infrastructure.sql`
- `20260326_evidence_bucket_import_policy.sql`

## 6) Non-blocking warning handling

`20260326_evidence_bucket_import_policy.sql` may warn:

- `Skipping storage.objects policy updates: insufficient privileges for current role.`

This is non-blocking for migration completion in environments where the executing role does not own `storage.objects`.

## 7) Validation after green push

```bash
/tmp/supabase migration list
```

Expect no critical mismatch error and successful completion of:

```bash
/tmp/supabase db push --include-all --yes
```

Then run app smoke tests for:

1. Scan ingest and observation writes
2. Breach alert generation paths
3. Photo recovery views/functions if used
