# Monthly Geofence Review

This process performs a monthly review of all active zone geofences and logs drift events for:

- New zones created in the review month
- Boundary changes (geometry hash changed from previous month)
- Degraded zones (missing/malformed geometry)

Drift events are written to `public.drift_events` with geofence-specific `event_type` values.

## 1) Apply Database Migration

Run this SQL migration in Supabase SQL Editor first:

- `supabase/migrations/20260324000001_geofence_monthly_review_and_drift.sql`

This adds:

- Geofence drift metadata columns to `drift_events`
- `zone_geofence_monthly_snapshots` table for month-over-month geometry auditing

## 2) Dry Run (Preview)

```bash
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
REVIEW_MONTH="2026-03-01" \
npx tsx scripts/review_zone_geofences.ts
```

Defaults:

- `DRY_RUN=1` (preview mode)
- `REVIEW_MONTH` defaults to current month start (UTC)

## 3) Live Run (Write Snapshots + Drift Events)

```bash
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
REVIEW_MONTH="2026-03-01" \
DRY_RUN=0 \
npx tsx scripts/review_zone_geofences.ts
```

## 4) Review Reports

Run SQL report:

- `scripts/reports/monthly_geofence_drift_review.sql`

This provides:

- Drift event counts by month and type
- Repeated degradation hotspots (last 6 months)
- Latest snapshot quality status by organization

## Suggested Cadence

1. Run dry-run on the 1st business day of each month.
2. Review counts for anomalies.
3. Run live mode.
4. Assign and track remediation for degraded zones from `drift_events`.

## Automation (GitHub Actions)

Automatic monthly execution is configured in:

- `.github/workflows/monthly-geofence-review.yml`

Schedule:

- Runs on day 1 of each month at `02:00 UTC`
- Scheduled runs execute in live mode (`DRY_RUN=0`)

Manual trigger options:

- `dry_run` (`true` or `false`)
- `review_month` (optional `YYYY-MM-01`)

Required GitHub repository secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
