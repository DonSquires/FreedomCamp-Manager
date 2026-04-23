# Knowledge Base — Bob's Self-Correcting Notes

This directory contains Bob's operational memory: non-obvious findings, root causes,
and workarounds discovered during debugging sessions. Each topic lives in its own file
so retrieval is O(1) — no scanning required.

## Index

| File | Topic | Last Updated |
|---|---|---|
| [test-creds.md](./test-creds.md) | Test credential issues and fixes | see file |
| [ptt-debug-log.md](./ptt-debug-log.md) | PTT translation failures and root causes | see file |
| [rls-gotchas.md](./rls-gotchas.md) | Supabase RLS policy edge cases | see file |
| [model-tier-routing.md](./model-tier-routing.md) | Model tier selection rationale | see file |

## Protocol

- When Bob discovers a non-obvious fix, append to the relevant file immediately
- Use ISO timestamps: `## 2025-01-15T10:22:00+12:00 — Title`
- Include: symptom, root cause, fix applied, verification step
- Keep entries factual — no speculation
