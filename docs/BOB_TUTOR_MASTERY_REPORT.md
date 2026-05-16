# Bob Tutor Mastery Report

Generated at: 2026-05-16T07:05:26.115Z

## Objective

Train Bob and app workflows to enrich data safely and accurately using grounded schema/app knowledge, research discipline, and policy gates.

## Mastery Loop

- autonomous_orchestrator: ok (exit=0, duration_ms=20315)
- enrichment_training: failed (exit=1, duration_ms=108619)
- roster_source_inventory: ok (exit=0, duration_ms=3689)
- capability_gate: ok (exit=0, duration_ms=2920)

## Scope Used

- mode: apply
- bucket: Service-Contracts
- prefix: historical-imports
- limit: 25
- organization_id: 2a933f35-b648-45cd-ba0b-d232a301c2ce
- since_date: (none)

## Schema Confidence Snapshot

- database_types_exists: true
- detected_tables: 0
- sample_tables:
- none detected

## Tutor Notes

- If autonomous org inference is weak, run intake with explicit organization mapping before apply mode.
- Keep enrichment in dry-run until blocker count is zero and confidence gates are green.
- Re-run this cycle after schema changes, route rewires, or major data migrations.
