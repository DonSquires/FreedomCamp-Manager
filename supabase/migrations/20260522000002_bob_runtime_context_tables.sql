create extension if not exists pgcrypto;

create table if not exists public.system_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_knowledge_base (
  id uuid primary key default gen_random_uuid(),
  service_name text not null unique,
  schema_payload text not null,
  system_rules jsonb not null default '[]'::jsonb,
  agent_roles jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.heal_patches (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  service_name text null,
  error_message text null,
  target_variable text null,
  patch_value text null,
  patch jsonb not null default '{}'::jsonb,
  error_payload jsonb not null default '{}'::jsonb,
  dr_bob_analysis text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deployed_at timestamptz null,
  reviewed_at timestamptz null,
  reviewed_by text null
);

alter table public.system_templates enable row level security;
alter table public.system_rules enable row level security;
alter table public.system_knowledge_base enable row level security;
alter table public.heal_patches enable row level security;

do $$
begin
  create policy system_templates_admin_read
    on public.system_templates
    for select
    to authenticated
    using (exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master', 'developer')
    ));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create policy system_rules_admin_read
    on public.system_rules
    for select
    to authenticated
    using (exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master', 'developer')
    ));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create policy system_knowledge_base_admin_read
    on public.system_knowledge_base
    for select
    to authenticated
    using (exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master', 'developer')
    ));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create policy heal_patches_admin_read
    on public.heal_patches
    for select
    to authenticated
    using (exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master', 'developer')
    ));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create policy heal_patches_admin_write
    on public.heal_patches
    for all
    to authenticated
    using (exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master', 'developer')
    ))
    with check (exists (
      select 1
      from public.user_profiles up
      where up.id = auth.uid()
        and up.role in ('admin', 'admin_officer', 'master', 'grand_master', 'developer')
    ));
exception
  when duplicate_object then null;
end
$$;