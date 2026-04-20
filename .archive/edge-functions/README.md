# Edge Function Consolidation Roadmap (Do Not Delete Yet)

This archive index documents functions queued for decommission after caller updates are complete.

## Consolidation targets

- **Scan pipeline target:** `process-officer-scan`
- **Nightly/batch target:** `cleanup-and-recalculate`
- **Photo maintenance target:** `photo-maintenance`

## Priority delete candidates (after callers are migrated)

- `recalculate-compliance`
- `recalculate-compliance-v2`
- `recalculate-compliance-v3`
- `alpr-retry`
- `orc-ingest`
- `zone-correction`
- `correct-zone-assignments`
- `scan-breaches`
- `check-almost-breaches`
- `check-zone-corrections`
- `duplicate-detection`
- `analyze-vehicle-photo`
- `vehicle-ingest`
- `plate-scanner-photo-first`
- `select-best-vehicle-photo`
- `link-evidence-photos`
- `stream-webhook`
- `reingest-photos`
- `photo-recovery`
- `daily-photo-reconciler`
- `scrape-vehicle-photos`
- `sync-spatial-layers`
- `enrich-from-motorweb`

## Caller references to update before deletion

- Frontend `src/lib/edgeFunctions.ts`
- Supabase cron schedules and SQL jobs invoking legacy nightly functions
- Other edge functions invoking old scan/batch sub-functions
- GitHub workflows and scripts that still call deprecated names

## 17-function target state (from `docs/CLEAN_REBUILD_DESIGN.md`)

1. `process-officer-scan`
2. `cleanup-and-recalculate`
3. `generate-notice-to-vacate`
4. `generate-infringement`
5. `sync-scv-list`
6. `create-user`
7. `monitor-officer-welfare`
8. `send-report-email`
9. `export-data`
10. `import-data`
11. `submit-dispute-intake`
12. `public-case-lookup`
13. `hotspot-data`
14. `process-homeless-data`
15. `nightly-privacy-cleanup`
16. `manage-user`
17. `photo-maintenance`
