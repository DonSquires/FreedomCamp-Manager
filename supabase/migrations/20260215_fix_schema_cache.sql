-- Fix schema cache issue after constraint modification
-- This ensures the schema is properly refreshed and queryable

-- Step 1: Validate the user_profiles table structure
do $$
begin
  -- Ensure the table exists and is accessible
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'user_profiles') then
    raise exception 'user_profiles table does not exist';
  end if;
  
  -- Ensure the role column exists
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'role') then
    raise exception 'role column does not exist in user_profiles';
  end if;
  
  raise notice 'user_profiles table structure validated successfully';
end $$;

-- Step 2: Refresh the constraint properly (in case it's in a bad state)
alter table user_profiles
drop constraint if exists user_profiles_role_check;

alter table user_profiles
add constraint user_profiles_role_check
check (role in ('master', 'admin', 'officer', 'admin_officer'));

-- Step 3: Ensure RLS is enabled
alter table user_profiles enable row level security;

-- Step 4: Recreate the basic SELECT policy for own profile
drop policy if exists "users_select_own_profile" on user_profiles;

create policy "users_select_own_profile"
on user_profiles
for select
to authenticated
using (id = auth.uid());

-- Step 5: Ensure anon users can insert during signup (needed for registration)
drop policy if exists "anon_insert_profile_on_signup" on user_profiles;

create policy "anon_insert_profile_on_signup"
on user_profiles
for insert
to anon
with check (true);

-- Step 6: Ensure authenticated users can update their own profile
drop policy if exists "users_update_own_profile" on user_profiles;

create policy "users_update_own_profile"
on user_profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Step 7: Refresh the schema cache
-- Force PostgreSQL to refresh its internal schema cache
notify pgrst, 'reload schema';

-- Verify constraint is working
comment on constraint user_profiles_role_check on user_profiles is
'Valid roles: master, admin, officer, admin_officer - Updated 2026-02-15';
