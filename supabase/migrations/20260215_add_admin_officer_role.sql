-- Add admin_officer role to user_profiles role check constraint
-- Fixes: "user_profiles_role_check" constraint violation when saving admin_officer users

-- Step 1: Drop the existing role check constraint
alter table user_profiles
drop constraint if exists user_profiles_role_check;

-- Step 2: Add new constraint with admin_officer included
alter table user_profiles
add constraint user_profiles_role_check
check (role in ('master', 'admin', 'officer', 'admin_officer'));

-- Verify constraint is applied
comment on constraint user_profiles_role_check on user_profiles is
'Valid roles: master (system admin), admin (org admin), officer (field officer), admin_officer (dual role with limited admin permissions)';
