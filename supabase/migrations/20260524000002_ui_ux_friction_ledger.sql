create table if not exists public.ui_ux_friction_ledger (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  created_at timestamptz not null default now(),
  target_screen text not null,
  path_length_count int not null,
  detected_bottleneck text not null,
  ux_practicality_score numeric(4,2),
  proposed_layout_fix text not null,
  status text not null check (status in ('RESOLVED_AND_DEPLOYED', 'PENDING_HUMAN_REVIEW'))
);

create index if not exists idx_ui_ux_friction
  on public.ui_ux_friction_ledger (session_id);
