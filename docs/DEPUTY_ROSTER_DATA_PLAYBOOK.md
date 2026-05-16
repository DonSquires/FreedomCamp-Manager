# Deputy Roster Data Playbook

Purpose: define the exact process for discovering, staging, and reviewing Deputy exports before Bob uses them as roster evidence.

## Scope

Use this playbook when files are Deputy-origin or Deputy-like roster exports (CSV/XLSX/XLS) and need to be staged into `ai_import_intakes`.

## Grounded Rules

- Deputy-first roster rule applies: if Deputy files exist, use them as primary roster evidence input.
- Do not auto-assign org ownership when source naming is ambiguous.
- Stage first, review in queue, and only then action.
- Placeholders (for example `.emptyFolderPlaceholder`) are not operational evidence.

## Current Known Sources (May 2026)

- `Service-Contracts/Deputy-Data/Deputy data.csv`
- `Service-Contracts/Deputy-Data/Deputy Location-sites-patrol zones.csv`

These were detected as Deputy exports and are suitable for staged review.

## End-to-End Workflow

1. Inventory Deputy-like files first.
2. Confirm organization ownership.
3. Run dry-run staging.
4. Run apply staging.
5. Review staged rows in Bob Intake Queue.
6. Proceed to enrichment only after review confirms source and mapping.

## Commands

Inventory Deputy files in one bucket:

```bash
bun run bob:intake:roster-source-inventory -- --include-bucket Service-Contracts --artifact-out logs/roster-source-inventory.service-contracts.json
```

Dry-run Deputy staging with explicit organization fallback:

```bash
bun run bob:intake:backfill-storage -- --bucket Service-Contracts --organization-id <org-uuid> --limit 100 --verbose
```

Apply staging after dry-run confirmation:

```bash
bun run bob:intake:backfill-storage:apply -- --bucket Service-Contracts --organization-id <org-uuid> --limit 100
```

Drain mode for repeatable batches:

```bash
bun run bob:intake:backfill-storage:drain:apply -- --bucket Service-Contracts --organization-id <org-uuid> --limit 100 --start-offset 0 --max-batches 20
```

## Intake Queue Review Checklist

- Status is `staged`.
- `documentStyle` expectation aligns to Deputy file type (`deputy_csv_export` or `deputy_spreadsheet_export`).
- Organization assignment is correct.
- Site labels are reviewed for `client_sites` mapping.
- Placeholder or unknown files are not treated as staffing facts.

## Failure and Ambiguity Handling

Stop and ask before actioning when any of the following are true:

- Multiple organization candidates match file/path naming.
- Site labels in Deputy exports do not match known site names.
- Timesheet or payroll values are present but unit/currency semantics are unclear.
- File appears Deputy-related but has unknown format or missing headers.

## Expected Outcome

After successful execution, Deputy files are visible in intake queue as staged records with clear ownership and are ready for controlled enrichment, not blind auto-action.
