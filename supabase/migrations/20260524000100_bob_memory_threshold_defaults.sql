-- Harden Bob memory retrieval defaults to reduce empty context returns.
-- Keep function names, argument order, and return schema unchanged.

create or replace function public.match_memories(
	query_embedding vector(1536),
	match_threshold float default 0.45,
	match_count int default 5,
	p_user_id uuid default null
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

create or replace function public.match_bob_memories(
	query_embedding vector(1536),
	match_threshold float default 0.45,
	match_count int default 3,
	p_user_id uuid default null
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
