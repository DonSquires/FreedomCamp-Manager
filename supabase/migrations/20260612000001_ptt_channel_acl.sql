-- P2-5: Per-officer PTT channel-level access control
-- Adds channel ACL array to user profiles for granular PTT authorization

-- Add ptt_channel_access column to user_profiles
alter table if exists public.user_profiles
add column if not exists ptt_channel_access text[] default null;

-- Index for faster ACL checks during token minting
create index if not exists idx_user_profiles_ptt_channel_access
on public.user_profiles using gin (ptt_channel_access);

-- RLS: officers see their own profile + ACL
-- admins see all profiles + ACL in their org
-- (existing RLS should allow this via is_admin check)

-- Comment for clarity
comment on column public.user_profiles.ptt_channel_access is 
  'Array of explicit channel scope strings this officer can access beyond default org scope. E.g., ["org:uuid", "team:uuid", "incident:uuid"]. NULL = no restrictions (default org only).';