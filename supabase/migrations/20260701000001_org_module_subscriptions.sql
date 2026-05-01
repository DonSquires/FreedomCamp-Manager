-- ============================================================
-- Org Module Subscriptions
-- Allows each organisation to subscribe to specific modules.
-- Nelson City Council example: subscribe to 'noise_control' only.
-- Level 1 (master) admins manage subscriptions for child orgs.
-- ============================================================

create table if not exists public.org_module_subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  module_key          text not null,
  is_active           boolean not null default true,
  config              jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_org_module unique (organization_id, module_key)
);

-- Valid module keys (informational constraint via check)
alter table public.org_module_subscriptions
  add constraint chk_module_key check (
    module_key in (
      'noise_control',
      'parking',
      'dispatch',
      'roster',
      'patrol',
      'compliance',
      'crm',
      'ptt',
      'bob',
      'enforcement',
      'biosecurity',
      'smoke_control',
      'asset_management',
      'reporting',
      'alpr',
      'identity_verification'
    )
  );

-- RLS
alter table public.org_module_subscriptions enable row level security;

-- Master/grand_master can see and manage all
create policy "master can manage all module subscriptions"
  on public.org_module_subscriptions
  for all
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid()
        and role in ('master', 'grand_master')
    )
  );

-- Org admins can see their own org subscriptions
create policy "org admin can read own module subscriptions"
  on public.org_module_subscriptions
  for select
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid()
        and (organization_id = org_module_subscriptions.organization_id
             or organization_id in (
               select id from public.organizations
               where parent_organization_id = org_module_subscriptions.organization_id
             ))
        and role in ('admin', 'admin_officer')
    )
  );

-- Authenticated users can read their own org's subscriptions
create policy "users can read own org module subscriptions"
  on public.org_module_subscriptions
  for select
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid()
        and organization_id = org_module_subscriptions.organization_id
    )
  );

-- Org admins can manage their own org subscriptions
create policy "org admin can manage own module subscriptions"
  on public.org_module_subscriptions
  for all
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid()
        and organization_id = org_module_subscriptions.organization_id
        and role in ('admin', 'admin_officer', 'master', 'grand_master')
    )
  );

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_org_module_subscriptions_updated_at
  before update on public.org_module_subscriptions
  for each row execute function public.set_updated_at();

-- Index for fast per-org lookup
create index if not exists idx_org_module_subscriptions_org_id
  on public.org_module_subscriptions (organization_id)
  where is_active = true;

-- RPC: get active modules for a given org (used by useOrgModules hook)
create or replace function public.get_org_modules(p_org_id uuid)
returns table (module_key text, config jsonb)
language sql
security definer
set search_path = public
as $$
  select module_key, config
  from public.org_module_subscriptions
  where organization_id = p_org_id
    and is_active = true
  order by module_key;
$$;

comment on table public.org_module_subscriptions is
  'Org-level module subscriptions. Controls which product modules an organisation has access to. Managed by master admins.';
