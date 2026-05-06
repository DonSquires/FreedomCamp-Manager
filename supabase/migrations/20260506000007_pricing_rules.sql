-- B-32: Dynamic Pricing Engine
-- Stores time-of-day / day-of-week pricing multipliers and overrides per zone.

create table if not exists public.pricing_rules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  zone_id             uuid references public.zones(id) on delete cascade,  -- null = applies to all zones
  label               text not null,
  day_of_week         smallint check (day_of_week between 0 and 6),        -- 0=Sun … 6=Sat; null = every day
  hour_from           smallint check (hour_from between 0 and 23),         -- null = whole day
  hour_to             smallint check (hour_to between 0 and 23),           -- exclusive upper bound
  multiplier          numeric(5,3) not null default 1.0 check (multiplier > 0),
  flat_override_nzd   numeric(8,2),                                        -- replaces fee_nzd if set
  is_active           boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- updated_at trigger
create or replace function public.set_pricing_rules_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pricing_rules_updated_at
  before update on public.pricing_rules
  for each row execute function public.set_pricing_rules_updated_at();

-- RLS
alter table public.pricing_rules enable row level security;

create policy "pricing_rules_org_select" on public.pricing_rules
  for select using (
    organization_id = any(public.get_user_organization_ids())
  );

create policy "pricing_rules_org_insert" on public.pricing_rules
  for insert with check (
    organization_id = any(public.get_user_organization_ids())
  );

create policy "pricing_rules_org_update" on public.pricing_rules
  for update using (
    organization_id = any(public.get_user_organization_ids())
  );

create policy "pricing_rules_org_delete" on public.pricing_rules
  for delete using (
    organization_id = any(public.get_user_organization_ids())
  );

-- Index for fast lookups when calculating effective price
create index if not exists idx_pricing_rules_org_zone
  on public.pricing_rules (organization_id, zone_id);
