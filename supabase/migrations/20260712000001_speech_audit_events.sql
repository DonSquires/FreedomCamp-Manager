-- speech_audit_events
-- Persists every speech-to-intent call for NZ Privacy Act IPP 5/6/7 compliance.
-- Linked to the authenticated user (no org-based access restrictions). Transcript is the raw (non-redacted)
-- text captured by the STT layer BEFORE any OpenAI egress (redaction happens
-- upstream in speech-router for OpenAI paths).

create table if not exists public.speech_audit_events (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  org_id            uuid references public.organizations(id) on delete set null,
  transcript        text not null default '',
  intent_name       text,
  confidence        numeric(4,3),
  needs_confirmation boolean not null default true,
  provider_stt      text not null default '',
  provider_intent   text not null default '',
  redacted          boolean not null default false,
  error_message     text
);

-- RLS: users can see only their own events
alter table public.speech_audit_events enable row level security;

create policy "User can read own speech audit events"
  on public.speech_audit_events for select
  using (auth.uid() = user_id);

-- Service role inserts are unrestricted (edge function uses service role key)
create policy "Service role can insert speech audit events"
  on public.speech_audit_events for insert
  with check (true);

-- Indexes
create index if not exists idx_speech_audit_events_user_id
  on public.speech_audit_events (user_id, created_at desc);

create index if not exists idx_speech_audit_events_org_id
  on public.speech_audit_events (org_id, created_at desc);
