-- Add NZSCV monitor role for read-only vehicle registry monitoring.
-- This role can be assigned via user_profiles.role and used for scoped login access.

alter table if exists public.user_profiles
drop constraint if exists user_profiles_role_check;

alter table if exists public.user_profiles
add constraint user_profiles_role_check
check (role in ('master', 'admin', 'officer', 'admin_officer', 'nzscv_monitor'));

comment on constraint user_profiles_role_check on public.user_profiles is
'Valid roles: master, admin, officer, admin_officer, nzscv_monitor';

notify pgrst, 'reload schema';
