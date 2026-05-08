-- Video generation foundation schema
-- Purpose: add auditable, org-scoped structures for Bob video artifacts

begin;

create table if not exists public.media_generation_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_user_id uuid not null,
  media_type text not null check (media_type in ('video')),
  purpose text not null check (purpose in ('research', 'training', 'briefing')),
  source_entity_type text,
  source_entity_id uuid,
  provider text,
  model_name text,
  model_version text,
  output_url text,
  source_hash text,
  output_hash text,
  retention_days integer not null default 90 check (retention_days > 0),
  legal_hold boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.video_briefing_packs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_user_id uuid not null,
  media_log_id uuid not null references public.media_generation_log(id) on delete cascade,
  title text,
  description text,
  duration_seconds integer,
  format text not null default 'mp4',
  bitrate_tier text not null default 'medium' check (bitrate_tier in ('low', 'medium', 'high')),
  output_url text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_media_generation_log_org_created
  on public.media_generation_log(org_id, created_at desc);

create index if not exists idx_media_generation_log_actor_created
  on public.media_generation_log(actor_user_id, created_at desc);

create index if not exists idx_video_briefing_packs_org_created
  on public.video_briefing_packs(org_id, created_at desc);

alter table public.media_generation_log enable row level security;
alter table public.video_briefing_packs enable row level security;

-- Policies align with existing org-scoping helper get_user_organization_ids().

drop policy if exists "media_generation_log_select_org" on public.media_generation_log;
create policy "media_generation_log_select_org"
  on public.media_generation_log
  for select
  using (org_id = any(get_user_organization_ids()));

drop policy if exists "media_generation_log_insert_org" on public.media_generation_log;
create policy "media_generation_log_insert_org"
  on public.media_generation_log
  for insert
  with check (org_id = any(get_user_organization_ids()));

drop policy if exists "media_generation_log_update_org" on public.media_generation_log;
create policy "media_generation_log_update_org"
  on public.media_generation_log
  for update
  using (org_id = any(get_user_organization_ids()))
  with check (org_id = any(get_user_organization_ids()));

drop policy if exists "video_briefing_packs_select_org" on public.video_briefing_packs;
create policy "video_briefing_packs_select_org"
  on public.video_briefing_packs
  for select
  using (org_id = any(get_user_organization_ids()));

drop policy if exists "video_briefing_packs_insert_org" on public.video_briefing_packs;
create policy "video_briefing_packs_insert_org"
  on public.video_briefing_packs
  for insert
  with check (org_id = any(get_user_organization_ids()));

drop policy if exists "video_briefing_packs_update_org" on public.video_briefing_packs;
create policy "video_briefing_packs_update_org"
  on public.video_briefing_packs
  for update
  using (org_id = any(get_user_organization_ids()))
  with check (org_id = any(get_user_organization_ids()));

-- Keep updated_at in sync if shared trigger helper exists in schema.
-- If a global trigger helper is present, wire this in follow-up migration.

commit;
