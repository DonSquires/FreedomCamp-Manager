-- Cognitive reasoning ledger for Bob risk/reward decisions.
create table if not exists public.ai_reasoning_ledger (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  created_at timestamptz not null default now(),
  intent_context text not null,
  hypothetical_risks text not null,
  projected_rewards text not null,
  confidence_score numeric(4,2) not null,
  action_taken text not null check (action_taken in ('RECOMMENDED_ONLY', 'AGENTIC_EXECUTED')),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_ai_reasoning_session
  on public.ai_reasoning_ledger(session_id);
