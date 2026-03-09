-- Repair imported observation timestamps after migration-time created_at drift.
--
-- Scope:
-- - Only legacy/imported observations (is_legacy_import = true)
-- - Only rows where created_at is clearly later than recorded_at
--
-- What it fixes:
-- - created_at is reset to recorded_at
-- - updated_at is reset only when it still equals old created_at
--   (to avoid wiping real post-import edits)

-- 1) Preview candidate rows before applying
select
  count(*) as candidate_rows,
  min(recorded_at) as oldest_recorded_at,
  max(recorded_at) as newest_recorded_at,
  min(created_at) as oldest_created_at,
  max(created_at) as newest_created_at
from public.observations
where coalesce(is_legacy_import, false) = true
  and recorded_at is not null
  and created_at is not null
  and created_at > recorded_at + interval '5 minutes';

-- 2) Apply repair (wrap in transaction)
begin;

with candidates as (
  select id, recorded_at, created_at as old_created_at
  from public.observations
  where coalesce(is_legacy_import, false) = true
    and recorded_at is not null
    and created_at is not null
    and created_at > recorded_at + interval '5 minutes'
)
update public.observations o
set
  created_at = c.recorded_at,
  updated_at = case
    when o.updated_at = c.old_created_at then c.recorded_at
    else o.updated_at
  end
from candidates c
where o.id = c.id;

-- 3) Verify remaining drift after repair
select
  count(*) as remaining_rows
from public.observations
where coalesce(is_legacy_import, false) = true
  and recorded_at is not null
  and created_at is not null
  and created_at > recorded_at + interval '5 minutes';

commit;
