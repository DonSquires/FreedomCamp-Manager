# Jurisdiction Boundary Setup

This project now supports bulk jurisdiction boundary population from a public,
reliable New Zealand source.

## Boundary Source

Use GeoBoundaries (Stats NZ sourced):

- Website: `https://www.geoboundaries.org/`
- NZ Territorial Authorities (ADM2): `https://www.geoboundaries.org/api/current/gbOpen/NZL/ADM2/`
- NZ Regions (ADM1): `https://www.geoboundaries.org/api/current/gbOpen/NZL/ADM1/`

Why this source:

- Public, no API key required
- Machine-readable API with direct GeoJSON download URL
- Canonical NZ jurisdiction layers from Stats NZ source datasets

## What the importer updates

`scripts/import_boundaries.ts` now does this in `IMPORT_MODE=territorial`:

1. Downloads ADM1 + ADM2 NZ boundaries from GeoBoundaries API.
2. Matches features to active `organizations` by normalized names.
3. Updates both:
   - `organizations.geom` (used for jurisdiction map auto-focus)
   - `zones.geometry` for the org's `zone_type = 'general'` zone

## Run it

Set required environment values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Then run:

```bash
# Territorial/region jurisdiction import (all orgs)
IMPORT_MODE=territorial bun run scripts/import_boundaries.ts
```

Meshblock mode remains available (requires Stats NZ API key):

```bash
IMPORT_MODE=meshblock ORGANIZATION_ID=<org-uuid> STATSNZ_API_KEY=<key> bun run scripts/import_boundaries.ts
```

## Verify results

```sql
select name
from organizations
where geom is null
order by name;
```

```sql
select o.name, z.name as general_zone, z.geometry is not null as has_zone_geometry
from organizations o
left join zones z
  on z.organization_id = o.id
 and z.zone_type = 'general'
order by o.name;
```

## Notes

- Not every organization type has a clean jurisdiction match (for example some crown entities).
- The script logs all unmatched organizations so you can set those manually in `Spatial Compliance Admin`.
