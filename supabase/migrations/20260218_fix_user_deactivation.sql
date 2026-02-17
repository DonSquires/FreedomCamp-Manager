-- =====================================================
-- User Deactivation Fix - SECURITY ENHANCEMENT
-- =====================================================
-- Migration: 20260218_fix_user_deactivation.sql
-- Purpose: Ensure deactivated users cannot login
-- Status: MEDIUM PRIORITY - Security gap
--
-- Current Issue:
-- - Frontend sets is_active = false
-- - Auth user remains in auth.users table
-- - User CAN STILL LOGIN with old password
--
-- Solution:
-- Create Edge Function trigger that disables auth.users when is_active = false

-- =====================================================
-- FUNCTION: Sync User Active Status to Auth
-- =====================================================
-- When is_active changes, update auth.users accordingly
-- Note: Actual auth.users update must be done via Edge Function
-- This trigger logs the event for Edge Function to process

create table if not exists user_deactivation_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references user_profiles(id) on delete cascade,
  action text not null check (action in ('deactivate', 'reactivate')),
  requested_at timestamptz default now(),
  processed boolean default false,
  processed_at timestamptz,
  error_message text
);

comment on table user_deactivation_queue is 
'Queue for user deactivation/reactivation actions. Edge Function processes this queue to update auth.users.';

create index if not exists idx_deactivation_queue_pending 
  on user_deactivation_queue(requested_at) 
  where not processed;

-- =====================================================
-- TRIGGER: Queue User Deactivation
-- =====================================================

create or replace function queue_user_deactivation()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Only act if is_active changed
  if old.is_active = new.is_active then
    return new;
  end if;
  
  -- Queue the action
  if new.is_active = false then
    -- Deactivate user
    insert into user_deactivation_queue (user_id, action)
    values (new.id, 'deactivate')
    on conflict do nothing;
    
    raise notice 'User % queued for deactivation', new.email;
  else
    -- Reactivate user
    insert into user_deactivation_queue (user_id, action)
    values (new.id, 'reactivate')
    on conflict do nothing;
    
    raise notice 'User % queued for reactivation', new.email;
  end if;
  
  return new;
end;
$$;

drop trigger if exists trigger_queue_user_deactivation on user_profiles;

create trigger trigger_queue_user_deactivation
  after update of is_active
  on user_profiles
  for each row
  execute function queue_user_deactivation();

comment on trigger trigger_queue_user_deactivation on user_profiles is 
'Queues user deactivation/reactivation actions for Edge Function processing';

-- =====================================================
-- RLS POLICIES: Deactivation Queue
-- =====================================================

alter table user_deactivation_queue enable row level security;

-- Admins can view queue
create policy "admins_view_deactivation_queue"
  on user_deactivation_queue for select
  to authenticated
  using (
    get_user_role(auth.uid()) in ('admin', 'master')
  );

-- System can insert/update
create policy "system_manage_deactivation_queue"
  on user_deactivation_queue for all
  to authenticated
  using (true)
  with check (true);

-- =====================================================
-- HELPER FUNCTION: Process Deactivation Queue
-- =====================================================
-- This will be called by Edge Function to process queue

create or replace function process_user_deactivation_queue()
returns table(
  user_id uuid,
  email text,
  action text,
  should_disable boolean
)
language sql
stable
security definer
as $$
  select 
    q.user_id,
    u.email,
    q.action,
    case 
      when q.action = 'deactivate' then true
      else false
    end as should_disable
  from user_deactivation_queue q
  join user_profiles u on u.id = q.user_id
  where q.processed = false
  order by q.requested_at
  limit 100;
$$;

comment on function process_user_deactivation_queue() is 
'Returns pending user deactivation/reactivation actions for Edge Function to process';

-- =====================================================
-- HELPER FUNCTION: Mark Queue Item Processed
-- =====================================================

create or replace function mark_deactivation_processed(
  queue_user_id uuid,
  success boolean,
  error_msg text default null
)
returns void
language plpgsql
security definer
as $$
begin
  update user_deactivation_queue
  set 
    processed = success,
    processed_at = now(),
    error_message = error_msg
  where user_id = queue_user_id
    and processed = false;
end;
$$;

comment on function mark_deactivation_processed(uuid, boolean, text) is 
'Marks a deactivation queue item as processed. Called by Edge Function after updating auth.users.';

-- =====================================================
-- VERIFICATION
-- =====================================================

do $$
declare
  test_count integer;
begin
  raise notice '';
  raise notice '========================================';
  raise notice 'User Deactivation Fix Verification';
  raise notice '========================================';
  
  -- Check if queue table exists
  select count(*) into test_count
  from pg_tables
  where schemaname = 'public' 
  and tablename = 'user_deactivation_queue';
  
  if test_count > 0 then
    raise notice '✅ Deactivation queue table created';
  else
    raise notice '❌ Deactivation queue table missing';
  end if;
  
  -- Check if trigger exists
  select count(*) into test_count
  from pg_trigger
  where tgname = 'trigger_queue_user_deactivation';
  
  if test_count > 0 then
    raise notice '✅ Deactivation trigger installed';
  else
    raise notice '❌ Deactivation trigger missing';
  end if;
  
  raise notice '';
  raise notice '========================================';
  raise notice 'NEXT STEPS';
  raise notice '========================================';
  raise notice '1. Create Edge Function "process-user-deactivation"';
  raise notice '2. Edge Function should:';
  raise notice '   - Call process_user_deactivation_queue()';
  raise notice '   - For each user, call supabase.auth.admin.updateUserById()';
  raise notice '   - Set ban_duration: "indefinite" for deactivate';
  raise notice '   - Set ban_duration: "none" for reactivate';
  raise notice '   - Call mark_deactivation_processed() for each';
  raise notice '3. Run Edge Function on cron (every 5 minutes)';
  raise notice '';
  
end $$;
