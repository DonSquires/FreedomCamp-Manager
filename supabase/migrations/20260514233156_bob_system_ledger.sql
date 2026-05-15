create extension if not exists pgcrypto;
create extension if not exists vector;

do $$
begin
	if not exists (
		select 1
		from pg_type
		where typname = 'agent_step_status'
	) then
		create type public.agent_step_status as enum ('queued', 'running', 'success', 'failed');
	end if;
end
$$;

create table if not exists public.bob_system_ledger (
	id uuid primary key default gen_random_uuid(),
	session_id text not null,
	user_id uuid not null,
	operator_id uuid not null,
	record_type text not null check (record_type in ('short_term', 'long_term', 'transaction_step')),
	content text not null,
	embedding vector(1536),
	status public.agent_step_status not null default 'success',
	metadata jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.bob_system_ledger
	add column if not exists operator_id uuid;

update public.bob_system_ledger
set operator_id = user_id
where operator_id is null;

alter table public.bob_system_ledger
	alter column operator_id set not null;

create index if not exists bob_system_ledger_long_term_hnsw_idx
	on public.bob_system_ledger
	using hnsw (embedding vector_cosine_ops)
	where record_type = 'long_term' and embedding is not null;

create index if not exists bob_system_ledger_session_created_idx
	on public.bob_system_ledger (session_id, created_at desc);

create index if not exists bob_system_ledger_user_type_created_idx
	on public.bob_system_ledger (user_id, record_type, created_at desc);

create index if not exists bob_system_ledger_operator_type_created_idx
	on public.bob_system_ledger (operator_id, record_type, created_at desc);

alter table public.bob_system_ledger enable row level security;

drop policy if exists bob_system_ledger_select_own on public.bob_system_ledger;
create policy bob_system_ledger_select_own
	on public.bob_system_ledger
	for select
	to authenticated
	using (auth.uid() = user_id or auth.uid() = operator_id);

drop policy if exists bob_system_ledger_insert_own on public.bob_system_ledger;
create policy bob_system_ledger_insert_own
	on public.bob_system_ledger
	for insert
	to authenticated
	with check (auth.uid() = user_id or auth.uid() = operator_id);

create or replace function public.match_bob_memories(
	query_embedding vector(1536),
	match_threshold float,
	match_count int,
	p_user_id uuid
) returns table (
	id uuid,
	content text,
	similarity float
)
language plpgsql
security definer
set search_path = public
as $$
begin
	return query
	select
		bob_system_ledger.id,
		bob_system_ledger.content,
		1 - (bob_system_ledger.embedding <=> query_embedding) as similarity
	from public.bob_system_ledger
	where bob_system_ledger.user_id = p_user_id
		and bob_system_ledger.record_type = 'long_term'
		and bob_system_ledger.embedding is not null
		and 1 - (bob_system_ledger.embedding <=> query_embedding) > match_threshold
	order by bob_system_ledger.embedding <=> query_embedding
	limit greatest(match_count, 1);
end;
$$;

grant execute on function public.match_bob_memories(vector(1536), float, int, uuid) to authenticated;
grant execute on function public.match_bob_memories(vector(1536), float, int, uuid) to service_role;
