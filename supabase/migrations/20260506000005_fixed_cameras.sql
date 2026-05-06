-- B-27: Fixed Camera Support
-- Stores CCTV / ALPR / traffic fixed cameras managed by each organisation.
-- Cameras can be linked to a zone and optionally to a site_reference.

create table if not exists public.fixed_cameras (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  name                text not null,
  camera_type         text not null check (camera_type in ('cctv', 'alpr', 'traffic', 'body_worn', 'other')),
  status              text not null default 'active' check (status in ('active', 'offline', 'maintenance', 'decommissioned')),
  latitude            double precision,
  longitude           double precision,
  address             text,
  zone_id             uuid references public.zones(id) on delete set null,
  stream_url          text,         -- RTSP / HLS stream URL (internal use only)
  snapshot_url        text,         -- Last snapshot image URL
  last_seen_at        timestamptz,  -- Last heartbeat / frame received
  notes               text,
  metadata            jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Org-scoped lookup index
create index if not exists idx_fixed_cameras_org
  on public.fixed_cameras (organization_id, status);

-- Zone association index
create index if not exists idx_fixed_cameras_zone
  on public.fixed_cameras (zone_id)
  where zone_id is not null;

-- Auto-update updated_at
create or replace function public.set_fixed_cameras_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_fixed_cameras_updated_at on public.fixed_cameras;
create trigger trg_fixed_cameras_updated_at
  before update on public.fixed_cameras
  for each row execute function public.set_fixed_cameras_updated_at();

-- RLS
alter table public.fixed_cameras enable row level security;

-- Org members can read their org's cameras
create policy "fixed_cameras_org_read" on public.fixed_cameras
  for select
  using (organization_id = any(get_user_organization_ids()));

-- Org admins / admin_officers / master can insert
create policy "fixed_cameras_org_insert" on public.fixed_cameras
  for insert
  with check (organization_id = any(get_user_organization_ids()));

-- Org admins / admin_officers / master can update
create policy "fixed_cameras_org_update" on public.fixed_cameras
  for update
  using (organization_id = any(get_user_organization_ids()));

-- Org admins / master can delete
create policy "fixed_cameras_org_delete" on public.fixed_cameras
  for delete
  using (organization_id = any(get_user_organization_ids()));

-- Grant to authenticated role
grant select, insert, update, delete on public.fixed_cameras to authenticated;
