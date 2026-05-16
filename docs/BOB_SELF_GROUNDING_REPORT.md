# Bob Self Grounding Report

Generated at: 2026-05-16T06:25:23.666Z

## Intent

Give Bob live, grounded context before autonomous actions: runtime state, architecture corpus, and schema/app surface snapshot.

## Pipeline Steps

- autonomous_learning_cycle: ok (exit=0, duration_ms=17073)
- broadcast_truth_protocol: ok (exit=0, duration_ms=7854)

## Schema Snapshot (from src/types/database.ts)

- types_file_exists: true
- table_count: 0
- view_count: 0
- enum_count: 0
- sample_tables:
- none detected

## App Surface Snapshot

- pages: 298
- components: 192
- hooks: 108
- stores: 19
- edge_functions: 110
- migrations: 410
- scripts: 228

## Next Actions

- Run this workflow at the start of each Bob-heavy session.
- If schema file and migrations diverge, regenerate database types before enrichment writes.
- Keep using intake dry-runs before any apply writes.
