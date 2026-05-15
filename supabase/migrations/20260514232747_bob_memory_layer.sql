-- Bob persistent memory layer: semantic + episodic + entity storage.
create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.bob_memory_vault (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null,
	session_id text not null,
	memory_type text not null check (memory_type in ('semantic', 'episodic', 'entity')),
	content text not null,
	metadata jsonb not null default '{}'::jsonb,
	embedding vector(1536),
	created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists bob_vault_hnsw_idx
	on public.bob_memory_vault
	using hnsw (embedding vector_cosine_ops)
	where embedding is not null;

create index if not exists bob_vault_lookup_idx
	on public.bob_memory_vault (user_id, session_id, created_at desc);

create index if not exists bob_vault_type_idx
	on public.bob_memory_vault (memory_type, created_at desc);

alter table public.bob_memory_vault enable row level security;

drop policy if exists bob_memory_vault_select_own on public.bob_memory_vault;
create policy bob_memory_vault_select_own
	on public.bob_memory_vault
	for select
	to authenticated
	using (auth.uid() = user_id);

drop policy if exists bob_memory_vault_insert_own on public.bob_memory_vault;
create policy bob_memory_vault_insert_own
	on public.bob_memory_vault
	for insert
	to authenticated
	with check (auth.uid() = user_id);

create or replace function public.match_memories(
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
		bob_memory_vault.id,
		bob_memory_vault.content,
		1 - (bob_memory_vault.embedding <=> query_embedding) as similarity
	from public.bob_memory_vault
	where bob_memory_vault.user_id = p_user_id
		and bob_memory_vault.memory_type = 'semantic'
		and bob_memory_vault.embedding is not null
		and 1 - (bob_memory_vault.embedding <=> query_embedding) > match_threshold
	order by bob_memory_vault.embedding <=> query_embedding
	limit greatest(match_count, 1);
end;
$$;

grant execute on function public.match_memories(vector(1536), float, int, uuid) to authenticated;
grant execute on function public.match_memories(vector(1536), float, int, uuid) to service_role;
