create table if not exists public.system_documentation_library (
  id uuid primary key default gen_random_uuid(),
  file_path text not null unique,
  content text not null,
  intent_keywords text[] not null default '{}'::text[],
  priority text not null default 'medium',
  allowed_agents text[] not null default '{dr_bob,bob}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_documentation_library_priority_check
    check (priority in ('low', 'medium', 'high', 'critical'))
);

create index if not exists idx_system_documentation_library_intent_keywords
  on public.system_documentation_library
  using gin (intent_keywords);

create index if not exists idx_system_documentation_library_allowed_agents
  on public.system_documentation_library
  using gin (allowed_agents);

create index if not exists idx_system_documentation_library_priority
  on public.system_documentation_library (priority);

insert into public.system_documentation_library (
  file_path,
  content,
  intent_keywords,
  priority,
  allowed_agents
)
values
  (
    'docs/STAGING.md',
    'Seed placeholder. Run backend/scripts/sync-docs.ts to upload canonical content.',
    array['staging', 'deploy', 'build', 'ci', 'workflow', 'railway'],
    'high',
    array['dr_bob', 'bob']
  ),
  (
    'docs/INSTRUCTION_MANUAL.md',
    'Seed placeholder. Run backend/scripts/sync-docs.ts to upload canonical content.',
    array['instruction', 'manual', 'policy', 'role', 'governance', 'training'],
    'critical',
    array['dr_bob', 'bob', 'emulator']
  )
on conflict (file_path)
do update set
  intent_keywords = excluded.intent_keywords,
  priority = excluded.priority,
  allowed_agents = excluded.allowed_agents,
  updated_at = now();
