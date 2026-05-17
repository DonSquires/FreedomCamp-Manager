# Small Client Alarm/Patrol + Deputy Coverage Audit (2026-05-17)

## Question Audited

Whether current realignment included:
- smaller clients in alarm response and patrol datasets
- Deputy documentation for static guarding sites and staff

Client-specific clarification captured:
- Noise control historical data is specifically owned by Nelson City Council.

## Live Runtime Coverage (current linked environment)

Client/operator organizations checked:
- Marlborough District Council
- Port Marlborough
- ORIKAN
- Nelson City Council
- Tasman District Council

Current table-level counts by org:

- `alarm_events`
  - all five orgs: `0`
- `patrols`
  - all five orgs: `0`
- `client_sites`
  - Marlborough District Council: `8`
  - Port Marlborough: `3`
  - ORIKAN: `0`
  - Nelson City Council: `0`
  - Tasman District Council: `0`
- `zones`
  - Marlborough District Council: `2`
  - Port Marlborough: `1`
  - ORIKAN / NCC / Tasman: `0`
- `locations_of_interest`
  - Marlborough District Council: `2`
  - Port Marlborough: `1`
  - ORIKAN / NCC / Tasman: `0`
- `contractor_documents` (current docs)
  - all five orgs: `0`

Conclusion:
- Smaller-client alarm and patrol historical data has not yet been loaded into runtime `alarm_events` / `patrols` for these orgs.
- Deputy/static guarding/staff documentation has not yet been loaded into runtime document tables for these orgs.

## Source Data Found in Storage (ground truth)

Found in `Service-Contracts` bucket:
- `Deputy-Data/Deputy Location-sites-patrol zones.csv`
  - approx rows: `500`
  - columns: location code/name, roster sort order, workplace/pay center metadata
- `Deputy-Data/Deputy data.csv`
  - approx rows: `588`
  - columns include staff identity, shifts/timesheets, schedule, area/location, pay center, contact fields
- `Wilsar-Data/Nelsn Alarm-Noise control historical data.csv`
  - approx rows: `12,677`
  - columns include client identifiers, response timestamps, response/on-site durations, comments, zone/subcontractor, charges
  - ownership rule: map to Nelson City Council by default unless explicit source evidence indicates an override
- `Wilsar-Data/Nelson Patrol Historical data.csv`
  - approx rows: `46,032`
  - columns include client identifiers, patrol type, on/off-site timestamps, patrol status, dispatch zone, subcontractor, incident flag

Conclusion:
- The required smaller-client and Deputy/staff source datasets exist and are large enough to materially improve coverage.
- Gap is ingestion/mapping into runtime tables, not source availability.

## Mapping Readiness

Likely target mapping surfaces:
- Alarm/noise historical CSV -> `alarm_events` (+ optional derived incidents/work orders)
- Patrol historical CSV -> `patrols` / patrol history tables
- Deputy location/site roster CSV -> `client_sites`, `zones`, `locations_of_interest`
- Deputy staff/timesheet CSV -> rostering/staff surfaces (`roster_*`, staff profile/assignment tables), plus static guarding site assignment links

## Priority Next Actions

1. Build and run a dedicated importer for Wilsar alarm/noise and patrol CSVs by `Client ID` -> org mapping.
  - apply strict default rule: Nelson noise-control dataset belongs to Nelson City Council
2. Build and run Deputy importer for:
   - static guarding sites/locations
   - staff and shift/timesheet rows
3. Write loaded source files to `contractor_documents` (or a dedicated agreement/document table) with source provenance and ingestion timestamp.
4. Re-run:
   - onboarding gate
   - Bob agreement/doc monitor
   - data coverage audit counts for `alarm_events` and `patrols`

## Mapping Rule Artifact

- `data/source-mappings/small-client-ingestion-rules.json`
  - includes the strict default mapping rule for Nelson noise-control historical data -> Nelson City Council

## Double-Ups (Duplicate Rows) Handling

Treatment strategy:
- pre-write dedupe using dataset-specific natural keys (with fallback keys)
- write path uses idempotent upsert semantics on deterministic ingest keys
- on duplicate conflict, winner policy is `keep_latest_by_source_timestamp`

Duplicate policy source:
- `data/source-mappings/small-client-ingestion-rules.json` (`dedupe_policy` section)

Measured duplicate rates (source audit):
- audit artifact: `tmp/docs/storage-review/deputy-and-small-clients/small-client-source-duplicate-audit.json`
- `alarm_noise_control_historical`: natural duplicate rate `0.7284`
- `patrol_historical`: natural duplicate rate `0.0402`
- `deputy_locations_sites_zones`: natural duplicate rate `0.89`
- `deputy_staff_roster`: natural duplicate rate `0.1344`

Operational implication:
- alarm/noise and Deputy locations datasets have high repeat rows and must not be loaded append-only.
- dedupe+upsert is mandatory to avoid inflated event/site counts and duplicate patrol/alarm history.
