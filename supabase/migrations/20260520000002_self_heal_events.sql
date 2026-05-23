-- Self-Heal Events Ledger
-- Central audit table for every event that enters the AI orchestration loop.
-- Records the source error, AI fix attempt, PR reference, and final outcome.
-- Guardrail: the AI engine reads this table to detect rapid recurrence (< 10 min)
-- and trips the regression circuit before creating another fix PR.

create table if not exists public.self_heal_events (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),

  -- Where the error came from
  source              text not null,                    -- 'vercel' | 'railway' | 'github_actions' | 'supabase'
  environment         text not null default 'production', -- 'production' | 'staging' | 'preview'
  error_summary       text not null,
  error_detail        jsonb,                            -- full stack trace / payload (if available)

  -- Fingerprint for recurrence detection (circuit breaker)
  error_fingerprint   text,                             -- deterministic hash of source + error category
  previous_event_id   uuid references public.self_heal_events(id),

  -- AI triage
  triage_tier         integer,                          -- 1–4, matches progressive escalation tiers
  ai_analysis         text,                             -- Bob's root-cause summary
  fix_branch          text,                             -- 'ops/ai-fix/<sha>-<ts>'
  fix_pr_number       integer,
  fix_pr_url          text,

  -- Resolution
  outcome             text default 'pending',           -- 'pending' | 'merged' | 'rolled_back' | 'human_required' | 'circuit_open'
  resolved_at         timestamptz,
  rollback_commit     text,

  -- Timing guardrail: if same fingerprint recurs within recurrence_window_minutes, escalate
  recurrence_count    integer not null default 1,
  recurrence_window_minutes integer not null default 10,

  -- Org context
  org_id              uuid references public.organizations(id) on delete set null
);

-- Index for fast recurrence lookups
create index if not exists self_heal_events_fingerprint_idx
  on public.self_heal_events (error_fingerprint, created_at desc);

create index if not exists self_heal_events_outcome_idx
  on public.self_heal_events (outcome, created_at desc);

-- RLS: service role only — the AI orchestration engine uses service role; no user-facing access
alter table public.self_heal_events enable row level security;

drop policy if exists "service_role_full_access" on public.self_heal_events;
create policy "service_role_full_access" on public.self_heal_events
  for all using (auth.role() = 'service_role');

-- Admin read-only (for the operations dashboard)
drop policy if exists "admin_read" on public.self_heal_events;
create policy "admin_read" on public.self_heal_events
  for select using (
    exists (
      select 1 from public.user_profiles
      where id = auth.uid()
      and role in ('admin', 'master', 'grand_master')
    )
  );

comment on table public.self_heal_events is
  'Immutable audit log for every event processed by the AI self-healing orchestration loop. '
  'Used for circuit-breaker recurrence detection, triage tier tracking, and rollback auditing.';
