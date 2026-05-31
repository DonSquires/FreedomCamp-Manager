-- Ensure every user profile has an employer organization.
-- Backfill legacy nulls from primary organization before enforcing NOT NULL.

update public.user_profiles
set employer_organization_id = organization_id,
    updated_at = now()
where employer_organization_id is null
  and organization_id is not null;

alter table public.user_profiles
  alter column employer_organization_id set not null;

comment on column public.user_profiles.employer_organization_id is
'Required employer organization for all users. Backfilled from organization_id for legacy rows.';