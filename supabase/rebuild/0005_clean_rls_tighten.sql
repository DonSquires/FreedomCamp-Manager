-- FreedomCamp Manager clean rebuild RLS tighten pass
-- Date: 2026-04-01
-- Depends on: 0002_clean_rls.sql

-- -----------------------------------------------------------------------------
-- Remove temporary service-only policies from 0002
-- -----------------------------------------------------------------------------
drop policy if exists service_only_zone_compliance_matrix on public.zone_compliance_matrix;
drop policy if exists service_only_zone_legal_config on public.zone_legal_config;
drop policy if exists service_only_zone_signage_evidence on public.zone_signage_evidence;
drop policy if exists service_only_canonical_vehicles on public.canonical_vehicles;
drop policy if exists service_only_canonical_scv on public.canonical_scv;
drop policy if exists service_only_canonical_homeless on public.canonical_homeless;
drop policy if exists service_only_enforcement_cases on public.enforcement_cases;
drop policy if exists service_only_enforcement_case_events on public.enforcement_case_events;
drop policy if exists service_only_infringement_notice_counters on public.infringement_notice_counters;
drop policy if exists service_only_infringement_notices on public.infringement_notices;
drop policy if exists service_only_notices_to_vacate on public.notices_to_vacate;
drop policy if exists service_only_patrol_schedule_zones on public.patrol_schedule_zones;
drop policy if exists service_only_patrol_checkpoints on public.patrol_checkpoints;
drop policy if exists service_only_checkpoint_visits on public.checkpoint_visits;
drop policy if exists service_only_officer_welfare_settings on public.officer_welfare_settings;
drop policy if exists service_only_officer_activity_log on public.officer_activity_log;
drop policy if exists service_only_officer_welfare_alerts on public.officer_welfare_alerts;
drop policy if exists service_only_incident_attachments on public.incident_attachments;
drop policy if exists service_only_health_safety_reports on public.health_safety_reports;
drop policy if exists service_only_person_vehicle_links on public.person_vehicle_links;
drop policy if exists service_only_person_observations on public.person_observations;
drop policy if exists service_only_person_interactions on public.person_interactions;
drop policy if exists service_only_privacy_curtain_settings on public.privacy_curtain_settings;
drop policy if exists service_only_privacy_access_log on public.privacy_access_log;
drop policy if exists service_only_retention_policies on public.retention_policies;

-- -----------------------------------------------------------------------------
-- Helper functions for indirect org ownership
-- -----------------------------------------------------------------------------
create or replace function public.can_access_zone(p_zone_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.zones z
    where z.id = p_zone_id
      and public.is_same_org(z.organization_id)
  ) or public.is_service_role();
$$;

create or replace function public.can_access_patrol(p_patrol_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.patrols p
    where p.id = p_patrol_id
      and public.is_same_org(p.organization_id)
  ) or public.is_service_role();
$$;

create or replace function public.can_access_incident(p_incident_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.incidents i
    where i.id = p_incident_id
      and public.is_same_org(i.organization_id)
  ) or public.is_service_role();
$$;

create or replace function public.can_access_person(p_person_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.person_records p
    where p.id = p_person_id
      and public.is_same_org(p.organization_id)
  ) or public.is_service_role();
$$;

-- -----------------------------------------------------------------------------
-- Tightened policies replacing service-only fallback
-- -----------------------------------------------------------------------------
create policy if not exists zone_compliance_matrix_access on public.zone_compliance_matrix
  for all
  using (public.can_access_zone(zone_id))
  with check (public.can_access_zone(zone_id));

create policy if not exists zone_legal_config_access on public.zone_legal_config
  for all
  using (public.can_access_zone(zone_id))
  with check (public.can_access_zone(zone_id));

create policy if not exists zone_signage_evidence_access on public.zone_signage_evidence
  for all
  using (public.can_access_zone(zone_id))
  with check (public.can_access_zone(zone_id));

create policy if not exists canonical_vehicles_select on public.canonical_vehicles
  for select
  using (
    public.is_service_role()
    or public.is_master_or_admin()
    or exists (
      select 1
      from public.observations o
      where o.plate_number = canonical_vehicles.plate_number
        and public.is_same_org(o.organization_id)
    )
  );

create policy if not exists canonical_vehicles_write on public.canonical_vehicles
  for all
  using (public.is_service_role() or public.is_master_or_admin())
  with check (public.is_service_role() or public.is_master_or_admin());

create policy if not exists canonical_scv_select on public.canonical_scv
  for select
  using (
    public.is_service_role()
    or public.is_master_or_admin()
    or exists (
      select 1
      from public.observations o
      where o.plate_number = canonical_scv.plate_number
        and public.is_same_org(o.organization_id)
    )
  );

create policy if not exists canonical_scv_write on public.canonical_scv
  for all
  using (public.is_service_role() or public.is_master_or_admin())
  with check (public.is_service_role() or public.is_master_or_admin());

create policy if not exists canonical_homeless_select on public.canonical_homeless
  for select
  using (
    public.is_service_role()
    or public.is_master_or_admin()
    or exists (
      select 1
      from public.observations o
      where o.plate_number = canonical_homeless.plate_number
        and public.is_same_org(o.organization_id)
    )
  );

create policy if not exists canonical_homeless_write on public.canonical_homeless
  for all
  using (public.is_service_role() or public.is_master_or_admin())
  with check (public.is_service_role() or public.is_master_or_admin());

create policy if not exists enforcement_cases_access on public.enforcement_cases
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists enforcement_case_events_access on public.enforcement_case_events
  for all
  using (
    public.is_service_role()
    or exists (
      select 1
      from public.enforcement_cases c
      where c.id = enforcement_case_events.case_id
        and public.is_same_org(c.organization_id)
    )
  )
  with check (
    public.is_service_role()
    or exists (
      select 1
      from public.enforcement_cases c
      where c.id = enforcement_case_events.case_id
        and public.is_same_org(c.organization_id)
    )
  );

create policy if not exists infringement_notice_counters_access on public.infringement_notice_counters
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists infringement_notices_access on public.infringement_notices
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists notices_to_vacate_access on public.notices_to_vacate
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists patrol_schedule_zones_access on public.patrol_schedule_zones
  for all
  using (public.can_access_patrol(patrol_id))
  with check (public.can_access_patrol(patrol_id));

create policy if not exists patrol_checkpoints_access on public.patrol_checkpoints
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists checkpoint_visits_access on public.checkpoint_visits
  for all
  using (
    public.is_service_role()
    or exists (
      select 1
      from public.patrol_checkpoints c
      where c.id = checkpoint_visits.checkpoint_id
        and public.is_same_org(c.organization_id)
    )
  )
  with check (
    public.is_service_role()
    or exists (
      select 1
      from public.patrol_checkpoints c
      where c.id = checkpoint_visits.checkpoint_id
        and public.is_same_org(c.organization_id)
    )
  );

create policy if not exists officer_welfare_settings_access on public.officer_welfare_settings
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists officer_activity_log_access on public.officer_activity_log
  for all
  using (
    public.is_service_role()
    or exists (
      select 1
      from public.user_profiles u
      where u.id = officer_activity_log.officer_id
        and public.is_same_org(u.organization_id)
    )
  )
  with check (
    public.is_service_role()
    or exists (
      select 1
      from public.user_profiles u
      where u.id = officer_activity_log.officer_id
        and public.is_same_org(u.organization_id)
    )
  );

create policy if not exists officer_welfare_alerts_access on public.officer_welfare_alerts
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists incident_attachments_access on public.incident_attachments
  for all
  using (public.can_access_incident(incident_id))
  with check (public.can_access_incident(incident_id));

create policy if not exists health_safety_reports_access on public.health_safety_reports
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists person_vehicle_links_access on public.person_vehicle_links
  for all
  using (public.can_access_person(person_id))
  with check (public.can_access_person(person_id));

create policy if not exists person_observations_access on public.person_observations
  for all
  using (
    public.is_service_role()
    or public.can_access_person(person_id)
    or exists (
      select 1
      from public.observations o
      where o.observation_id = person_observations.observation_id
        and public.is_same_org(o.organization_id)
    )
  )
  with check (
    public.is_service_role()
    or public.can_access_person(person_id)
    or exists (
      select 1
      from public.observations o
      where o.observation_id = person_observations.observation_id
        and public.is_same_org(o.organization_id)
    )
  );

create policy if not exists person_interactions_access on public.person_interactions
  for all
  using (public.can_access_person(person_id))
  with check (public.can_access_person(person_id));

create policy if not exists privacy_curtain_settings_access on public.privacy_curtain_settings
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists privacy_access_log_access on public.privacy_access_log
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));

create policy if not exists retention_policies_access on public.retention_policies
  for all
  using (public.is_service_role() or public.is_same_org(organization_id))
  with check (public.is_service_role() or public.is_same_org(organization_id));
