# Bob Deputy Static Guard Import Playbook

Purpose: teach Bob how to convert Deputy static-guard roster evidence into safe, reviewable site enrichment work.

## Current grounded seed set

- Nelson City Council: Civic House - Customer Service
- Ministry of Justice: MOJ Nelson District Court
- Ministry of Justice: MOJ Blenheim District Court

Evidence source:
- `tmp/docs/storage-review/deputy-and-small-clients/Deputy data.csv`
- `tmp/docs/storage-review/deputy-and-small-clients/Deputy Location-sites-patrol zones.csv`

## Required Bob workflow

1. Start from the Deputy seed list, not freeform guessing.
2. If the target organization does not exist, research it and create it in live `organizations`.
3. Infer and store jurisdiction context (organization metadata + inactive jurisdiction zone placeholder).
4. Build a site dossier before apply writes.
5. If no live site zone exists, create an inactive placeholder zone only for onboarding compatibility.
6. Create the seeded client site as inactive until geocode and boundary research are complete.
7. Mark geocode, access instructions, and jurisdiction geometry as follow-up research items.
8. Keep source provenance in the site notes.

## Dossier minimums

- purpose summary
- admin watchouts
- officer visit brief
- source evidence path
- confidence and open questions

## Safe write policy

- Allowed: create missing organizations as `client` with researched metadata and jurisdiction notes
- Allowed: create/update inactive `client_sites` with Deputy provenance notes
- Allowed: create inactive placeholder `zones` with clear Deputy-seed naming
- Not allowed: invent GPS, access codes, after-hours contacts, or jurisdiction geometry
- Not allowed: assign a site to the wrong organization when org matching is ambiguous

## Commands

Dry-run import:

```bash
bun run deputy:static-guard:sites
```

Apply import:

```bash
bun run deputy:static-guard:sites:apply
```

Feed this workflow to Bob:

```bash
bun run bob:feed:deputy-static-guard
```

## Output artifacts

- `tmp/docs/storage-review/deputy-static-guard-sites/deputy-static-guard-sites-import.json`
- `tmp/docs/storage-review/deputy-static-guard-sites/deputy-static-guard-sites-import.md`