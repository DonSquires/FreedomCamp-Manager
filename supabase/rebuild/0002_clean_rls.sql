-- FreedomCamp Manager clean rebuild RLS
-- Date: 2026-04-01
-- Depends on: 0001_clean_baseline.sql

-- -----------------------------------------------------------------------------
-- Auth helper functions
-- -----------------------------------------------------------------------------
create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select up.role
  from public.user_profiles up
  where up.id = auth.uid();
$$;

create or replace function public.current_user_org_id()
returns uuid
language sql
stable
as $$
  select up.organization_id
  from public.user_profiles up
  where up.id = auth.uid();
$$;

create or replace function public.is_service_role()
returns boolean
language sql
stable
as $$
  select auth.role() = 'service_role';
$$;

create or replace function public.is_grand_master()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_user_role() = 'grand_master', false);
$$;

create or replace function public.is_master_or_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_user_role() in ('master','admin','grand_master'), false);
$$;

create or replace function public.is_same_org(org_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_grand_master() or org_id = public.current_user_org_id();
$$;

-- -----------------------------------------------------------------------------
-- Table-level RLS enablement for clean baseline
-- -----------------------------------------------------------------------------
alter table public.zone_compliance_matrix enable row level security;
alter table public.zone_legal_config enable row level security;
alter table public.zone_signage_evidence enable row level security;
alter table public.canonical_vehicles enable row level security;
alter table public.canonical_scv enable row level security;
alter table public.canonical_homeless enable row level security;
alter table public.enforcement_cases enable row level security;
alter table public.enforcement_case_events enable row level security;
alter table public.infringement_notice_counters enable row level security;
alter table public.infringement_notices enable row level security;
alter table public.notices_to_vacate enable row level security;
alter table public.patrols enable row level security;
alter table public.patrol_schedule_zones enable row level security;
alter table public.patrol_checkpoints enable row level security;
alter table public.checkpoint_visits enable row level security;
alter table public.officer_shifts enable row level security;
alter table public.officer_welfare_settings enable row level security;
alter table public.officer_activity_log enable row level security;
alter table public.officer_welfare_alerts enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_attachments enable row level security;
alter table public.health_safety_reports enable row level security;
alter table public.person_records enable row level security;
alter table public.person_vehicle_links enable row level security;
alter table public.person_observations enable row level security;
alter table public.person_interactions enable row level security;
alter table public.audit_log enable row level security;
alter table public.dispute_intake enable row level security;
alter table public.privacy_curtain_settings enable row level security;
alter table public.privacy_access_log enable row level security;
alter table public.retention_policies enable row level security;

-- -----------------------------------------------------------------------------
-- Generic org-scoped policies for anchor tables
-- -----------------------------------------------------------------------------
create policy if not exists organizations_select on public.organizations
  for select
  using (public.is_service_role() or public.is_same_org(id));

create policy if not exists organizations_write on public.organizations
  for all
  using (public.is_service_role() or public.is_grand_master())
  with check (public.is_service_role() or public.is_grand_master());

create policy if not exists user_profiles_select on public.user_profiles
  for select
  using (public.is_service_role() or public.is_same_org(organization_id) or id = public.current_user_id());

create policy if not exists user_profiles_write on public.user_profiles
  for all
  using (public.is_service_role() or public.is_master_or_admin())
  with check (public.is_service_role() or public.is_master_or_admin());

create policy if not exists zones_select on public.zones
  for select
  using (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists zones_write on public.zones
  for all
  using (public.is_service_role() or public.is_master_or_admin())
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists observations_select on public.observations
  for select
  using (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists observations_insert on public.observations
  for insert
  with check (
    public.is_service_role()
    or (
      public.is_same_org(organization_id)
      and (
        recorded_by is null
        or recorded_by = public.current_user_id()
        or public.is_master_or_admin()
      )
    )
  );

create policy if not exists observations_update on public.observations
  for update
  using (
    public.is_service_role()
    or (
      public.is_same_org(organization_id)
      and (
        public.is_master_or_admin()
        or recorded_by = public.current_user_id()
      )
    )
  )
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists breach_alerts_select on public.breach_alerts
  for select
  using (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists breach_alerts_write on public.breach_alerts
  for all
  using (public.is_service_role() or public.is_master_or_admin())
  with check (public.is_service_role() or public.is_same_org(organization_id));

-- -----------------------------------------------------------------------------
-- Additional org-scoped table policies
-- -----------------------------------------------------------------------------
create policy if not exists patrols_select on public.patrols
  for select
  using (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists patrols_write on public.patrols
  for all
  using (public.is_service_role() or public.is_master_or_admin())
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists officer_shifts_select on public.officer_shifts
  for select
  using (
    public.is_service_role()
    or public.is_same_org(organization_id)
    or officer_id = public.current_user_id()
  );

create policy if not exists officer_shifts_write on public.officer_shifts
  for all
  using (
    public.is_service_role()
    or public.is_master_or_admin()
    or officer_id = public.current_user_id()
  )
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists incidents_select on public.incidents
  for select
  using (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists incidents_write on public.incidents
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists person_records_select on public.person_records
  for select
  using (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists person_records_write on public.person_records
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists audit_log_select on public.audit_log
  for select
  using (
    public.is_service_role()
    or public.is_grand_master()
    or public.is_same_org(organization_id)
  );

create policy if not exists audit_log_insert on public.audit_log
  for insert
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists dispute_intake_select on public.dispute_intake
  for select
  using (
    public.is_service_role()
    or organization_id is null
    or public.is_same_org(organization_id)
  );

create policy if not exists dispute_intake_insert on public.dispute_intake
  for insert
  with check (true);

create policy if not exists dispute_intake_update on public.dispute_intake
  for update
  using (public.is_service_role() or public.is_master_or_admin())
  with check (
    public.is_service_role()
    or organization_id is null
    or public.is_same_org(organization_id)
  );

-- -----------------------------------------------------------------------------
-- Service-role-only policies for non-org keyed tables in baseline stage
-- These are tightened in subsequent migrations once all relations are finalized.
-- -----------------------------------------------------------------------------
create policy if not exists service_only_zone_compliance_matrix on public.zone_compliance_matrix
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_zone_legal_config on public.zone_legal_config
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_zone_signage_evidence on public.zone_signage_evidence
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_canonical_vehicles on public.canonical_vehicles
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_canonical_scv on public.canonical_scv
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_canonical_homeless on public.canonical_homeless
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_enforcement_cases on public.enforcement_cases
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_enforcement_case_events on public.enforcement_case_events
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_infringement_notice_counters on public.infringement_notice_counters
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_infringement_notices on public.infringement_notices
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_notices_to_vacate on public.notices_to_vacate
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_patrol_schedule_zones on public.patrol_schedule_zones
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_patrol_checkpoints on public.patrol_checkpoints
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_checkpoint_visits on public.checkpoint_visits
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_officer_welfare_settings on public.officer_welfare_settings
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_officer_activity_log on public.officer_activity_log
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_officer_welfare_alerts on public.officer_welfare_alerts
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_incident_attachments on public.incident_attachments
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_health_safety_reports on public.health_safety_reports
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_person_vehicle_links on public.person_vehicle_links
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_person_observations on public.person_observations
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_person_interactions on public.person_interactions
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_privacy_curtain_settings on public.privacy_curtain_settings
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_privacy_access_log on public.privacy_access_log
  for all using (public.is_service_role()) with check (public.is_service_role());

create policy if not exists service_only_retention_policies on public.retention_policies
  for all using (public.is_service_role()) with check (public.is_service_role());
