-- Migration: doc_council_sync_log (B-12)
--
-- Stores the result of each automated DOC / council data-sync run so that
-- admins can see when the last sync occurred, what changed, and whether
-- any errors occurred.

create table if not exists public.doc_council_sync_log (
  id              uuid primary key default gen_random_uuid(),
  run_at          timestamptz not null default now(),
  source          text not null,                 -- 'doc_api' | 'council_feed' | 'manual'
  status          text not null default 'pending',  -- 'pending' | 'success' | 'partial' | 'error'
  zones_added     int  not null default 0,
  zones_updated   int  not null default 0,
  zones_removed   int  not null default 0,
  error_message   text,
  raw_summary     jsonb,
  triggered_by    uuid references auth.users(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete cascade,
  created_at      timestamptz not null default now()
);

-- Index for dashboard queries
create index if not exists idx_doc_council_sync_log_run_at
  on public.doc_council_sync_log (run_at desc);

create index if not exists idx_doc_council_sync_log_org
  on public.doc_council_sync_log (organization_id, run_at desc);

-- RLS: admin+ can read; only service-role / edge function writes
alter table public.doc_council_sync_log enable row level security;

create policy "doc_sync_log_read"
  on public.doc_council_sync_log
  for select
  using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid()
        and role in ('admin', 'master', 'grand_master')
    )
  );

-- Service-role inserts are not blocked by RLS (service role bypasses RLS).
-- No authenticated-user insert policy is intentionally defined here.

comment on table public.doc_council_sync_log is
  'Audit log for automated DOC / council zone data-sync runs (B-12).';
