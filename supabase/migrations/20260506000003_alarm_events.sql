-- B-24: Alarm System Integration
-- Stores inbound alarm events from external security systems (GDS, Mark43, etc.)
-- received via the alarm-webhook edge function.

create table if not exists public.alarm_events (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  source_system       text not null,                      -- e.g. 'gds', 'mark43', 'adt', 'bosch'
  alarm_type          text not null,                      -- e.g. 'intruder', 'panic', 'duress', 'fire', 'tamper'
  severity            text not null default 'high',       -- 'critical' | 'high' | 'medium' | 'low'
  trigger_time        timestamptz not null default now(),
  address             text,
  zone_id             uuid references public.zones(id) on delete set null,
  site_reference      text,                               -- external site ID from the alarm system
  status              text not null default 'active',     -- 'active' | 'acknowledged' | 'dispatched' | 'resolved' | 'false_alarm'
  acknowledged_at     timestamptz,
  acknowledged_by     uuid references auth.users(id) on delete set null,
  resolved_at         timestamptz,
  linked_incident_id  uuid references public.incidents(id) on delete set null,
  notes               text,
  raw_payload         jsonb,                              -- full webhook payload for audit
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Index for org-scoped list queries (most common)
create index if not exists idx_alarm_events_org_trigger
  on public.alarm_events (organization_id, trigger_time desc);

-- Index for status queries
create index if not exists idx_alarm_events_status
  on public.alarm_events (organization_id, status);

-- Auto-update updated_at
create or replace function public.set_alarm_events_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_alarm_events_updated_at on public.alarm_events;
create trigger trg_alarm_events_updated_at
  before update on public.alarm_events
  for each row execute function public.set_alarm_events_updated_at();

-- RLS
alter table public.alarm_events enable row level security;

-- Org users can read their org's alarm events
create policy "alarm_events_org_read" on public.alarm_events
  for select
  using (
    organization_id = any(get_user_organization_ids())
  );

-- Org admins/officers can update (acknowledge / resolve / add notes)
create policy "alarm_events_org_update" on public.alarm_events
  for update
  using (
    organization_id = any(get_user_organization_ids())
  );

-- Insert is service-role only (via alarm-webhook edge function)
-- No anon or authenticated INSERT policy; the edge function uses service role.
