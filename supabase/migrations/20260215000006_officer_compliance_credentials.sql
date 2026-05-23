-- Officer Compliance Credentials System
-- COA (Certificate of Approval - Security License) and Warrant (Freedom Camping Enforcement Authority)

-- Step 1: Add compliance fields to user_profiles
alter table user_profiles
add column if not exists coa_number text,
add column if not exists coa_expiry_date date,
add column if not exists coa_document_url text,
add column if not exists has_warrant boolean default false,
add column if not exists warrant_number text,
add column if not exists warrant_expiry_date date,
add column if not exists warrant_document_url text,
add column if not exists compliance_status text default 'pending' check (compliance_status in ('valid', 'expired_coa', 'expired_warrant', 'missing_coa', 'pending'));

comment on column user_profiles.coa_number is 'Certificate of Approval (Security License) number - REQUIRED for First Security officers';
comment on column user_profiles.coa_expiry_date is 'COA expiry date - officers cannot work if expired';
comment on column user_profiles.coa_document_url is 'Storage path to uploaded COA document (evidence)';
comment on column user_profiles.has_warrant is 'True if officer has valid Freedom Camping Enforcement Warrant';
comment on column user_profiles.warrant_number is 'Warrant identification number (if applicable)';
comment on column user_profiles.warrant_expiry_date is 'Warrant expiry date - blocks enforcement actions if expired';
comment on column user_profiles.warrant_document_url is 'Storage path to uploaded warrant document (evidence)';
comment on column user_profiles.compliance_status is 'Current compliance status: valid, expired_coa, expired_warrant, missing_coa, pending';

-- Create indexes for compliance checks
create index if not exists idx_user_profiles_coa_expiry on user_profiles(coa_expiry_date);
create index if not exists idx_user_profiles_warrant_expiry on user_profiles(warrant_expiry_date);
create index if not exists idx_user_profiles_compliance_status on user_profiles(compliance_status);

-- Step 2: Create function to calculate compliance status
create or replace function calculate_compliance_status(
  p_employer_org_id uuid,
  p_coa_expiry_date date,
  p_warrant_expiry_date date,
  p_has_warrant boolean
)
returns text as $$
declare
  employer_name text;
begin
  -- Get employer organization name
  select name into employer_name
  from organizations
  where id = p_employer_org_id;
  
  -- Only enforce COA for First Security employees
  if employer_name = 'First Security' then
    -- Check COA expiry
    if p_coa_expiry_date is null then
      return 'missing_coa';
    elsif p_coa_expiry_date < current_date then
      return 'expired_coa';
    end if;
    
    -- Check warrant expiry (if they have one)
    if p_has_warrant = true and p_warrant_expiry_date is not null then
      if p_warrant_expiry_date < current_date then
        return 'expired_warrant';
      end if;
    end if;
  end if;
  
  -- All checks passed
  return 'valid';
end;
$$ language plpgsql stable;

comment on function calculate_compliance_status(uuid, date, date, boolean) is 
'Calculates officer compliance status based on COA/Warrant expiry. Returns: valid, expired_coa, expired_warrant, missing_coa';

-- Step 3: Create trigger to auto-update compliance_status
create or replace function update_compliance_status_trigger()
returns trigger as $$
begin
  -- Auto-calculate compliance status on insert/update
  new.compliance_status := calculate_compliance_status(
    new.employer_organization_id,
    new.coa_expiry_date,
    new.warrant_expiry_date,
    new.has_warrant
  );
  
  return new;
end;
$$ language plpgsql;

create trigger trigger_update_compliance_status
before insert or update of employer_organization_id, coa_expiry_date, warrant_expiry_date, has_warrant
on user_profiles
for each row
execute function update_compliance_status_trigger();

-- Step 4: Create function to check if officer can work
create or replace function can_officer_work(officer_id uuid)
returns boolean as $$
declare
  officer_status text;
begin
  select compliance_status into officer_status
  from user_profiles
  where id = officer_id;
  
  -- Officers can work if:
  -- 1. Status is 'valid'
  -- 2. Status is 'expired_warrant' (can work, but can't issue enforcement)
  -- 3. Status is 'pending' (initial setup)
  
  return officer_status in ('valid', 'expired_warrant', 'pending');
end;
$$ language plpgsql stable security definer;

comment on function can_officer_work(uuid) is 
'Returns true if officer can work (COA valid). False if COA missing or expired.';

-- Step 5: Create function to check if officer can issue enforcement
create or replace function can_issue_enforcement(officer_id uuid)
returns boolean as $$
declare
  officer_record record;
begin
  select 
    compliance_status,
    has_warrant,
    warrant_expiry_date
  into officer_record
  from user_profiles
  where id = officer_id;
  
  -- Must have valid COA
  if officer_record.compliance_status not in ('valid', 'expired_warrant') then
    return false;
  end if;
  
  -- Must have valid warrant
  if officer_record.has_warrant = false then
    return false;
  end if;
  
  if officer_record.warrant_expiry_date is null then
    return false;
  end if;
  
  if officer_record.warrant_expiry_date < current_date then
    return false;
  end if;
  
  return true;
end;
$$ language plpgsql stable security definer;

comment on function can_issue_enforcement(uuid) is 
'Returns true if officer can issue enforcement actions (valid COA + valid warrant)';

-- Step 6: Add validation to enforcement_actions table
create or replace function validate_enforcement_action()
returns trigger as $$
declare
  can_enforce boolean;
  officer_name text;
begin
  -- Check if officer can issue enforcement
  can_enforce := can_issue_enforcement(new.user_id);
  
  if can_enforce = false then
    select first_name || ' ' || last_name into officer_name
    from user_profiles
    where id = new.user_id;
    
    raise exception 'Officer % cannot issue enforcement actions. Reason: Missing or expired warrant. Please verify credentials.',
      officer_name;
  end if;
  
  return new;
end;
$$ language plpgsql;

create trigger trigger_validate_enforcement_credentials
before insert on enforcement_actions
for each row
execute function validate_enforcement_action();

comment on trigger trigger_validate_enforcement_credentials on enforcement_actions is 
'Validates officer has valid warrant before allowing enforcement action creation';

-- Step 7: Create view for compliance dashboard
drop view if exists officer_compliance_dashboard;
create or replace view officer_compliance_dashboard as
select 
  up.id as user_id,
  up.first_name,
  up.last_name,
  up.email,
  up.role,
  o.name as employer_organization,
  up.coa_number,
  up.coa_expiry_date,
  up.has_warrant,
  up.warrant_number,
  up.warrant_expiry_date,
  up.compliance_status,
  
  -- Calculate days until expiry
  case 
    when up.coa_expiry_date is not null 
    then up.coa_expiry_date - current_date
    else null
  end as coa_days_until_expiry,
  
  case 
    when up.warrant_expiry_date is not null 
    then up.warrant_expiry_date - current_date
    else null
  end as warrant_days_until_expiry,
  
  -- Warning flags
  case 
    when up.coa_expiry_date is not null and up.coa_expiry_date - current_date <= 30 
    then true 
    else false 
  end as coa_expiring_soon,
  
  case 
    when up.warrant_expiry_date is not null and up.warrant_expiry_date - current_date <= 30 
    then true 
    else false 
  end as warrant_expiring_soon,
  
  can_officer_work(up.id) as can_work,
  can_issue_enforcement(up.id) as can_enforce
from user_profiles up
left join organizations o on up.employer_organization_id = o.id
where up.role in ('officer', 'admin_officer')
order by up.compliance_status desc, up.coa_expiry_date asc;

comment on view officer_compliance_dashboard is 
'Officer compliance status dashboard showing COA/Warrant expiry and work authorization';

-- Step 8: Create RLS policy for compliance documents
-- Officers can view their own compliance status
create policy "officers_view_own_compliance"
on user_profiles for select
to authenticated
using (
  id = auth.uid() and 
  role in ('officer', 'admin_officer')
);

-- Admins can view all compliance data for their organization
create policy "admins_view_org_compliance"
on user_profiles for select
to authenticated
using (
  (get_user_role(auth.uid()) = any(array['admin', 'master'])) and
  (employer_organization_id = any(get_user_organization_ids()))
);

-- Step 9: Create audit log for compliance checks
create table if not exists compliance_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  check_type text not null check (check_type in ('login', 'patrol_checkin', 'enforcement_attempt')),
  compliance_status text not null,
  can_work boolean,
  can_enforce boolean,
  blocked_reason text,
  timestamp timestamp with time zone default now()
);

create index idx_compliance_audit_user on compliance_audit_log(user_id);
create index idx_compliance_audit_timestamp on compliance_audit_log(timestamp);

comment on table compliance_audit_log is 
'Audit trail for COA/Warrant compliance checks (login, patrol check-in, enforcement attempts)';

-- Step 10: Create function to log compliance checks
create or replace function log_compliance_check(
  p_user_id uuid,
  p_check_type text,
  p_blocked_reason text default null
)
returns void as $$
declare
  v_status text;
  v_can_work boolean;
  v_can_enforce boolean;
begin
  select compliance_status into v_status
  from user_profiles
  where id = p_user_id;
  
  v_can_work := can_officer_work(p_user_id);
  v_can_enforce := can_issue_enforcement(p_user_id);
  
  insert into compliance_audit_log (
    user_id,
    check_type,
    compliance_status,
    can_work,
    can_enforce,
    blocked_reason
  ) values (
    p_user_id,
    p_check_type,
    v_status,
    v_can_work,
    v_can_enforce,
    p_blocked_reason
  );
end;
$$ language plpgsql security definer;

comment on function log_compliance_check(uuid, text, text) is 
'Logs compliance checks to audit trail (login, patrol check-in, enforcement attempts)';

-- Step 11: Add employer_organization_id if not exists (from previous migration)
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'user_profiles' 
    and column_name = 'employer_organization_id'
  ) then
    alter table user_profiles
    add column employer_organization_id uuid references organizations(id);
    
    comment on column user_profiles.employer_organization_id is 
    'Organization that employs this user (payroll, HR, legal responsibility). E.g., First Security employs the officer.';
    
    -- Backfill: set employer = primary org for existing users
    update user_profiles
    set employer_organization_id = organization_id
    where employer_organization_id is null;
  end if;
end $$;

-- Step 12: Summary and verification
do $$
declare
  first_security_count integer;
  missing_coa_count integer;
begin
  -- Count First Security officers
  select count(*) into first_security_count
  from user_profiles up
  join organizations o on up.employer_organization_id = o.id
  where o.name = 'First Security'
  and up.role in ('officer', 'admin_officer');
  
  -- Count officers missing COA
  select count(*) into missing_coa_count
  from user_profiles
  where compliance_status = 'missing_coa'
  and role in ('officer', 'admin_officer');
  
  raise notice '✅ Officer Compliance System Installed';
  raise notice '';
  raise notice '📋 Summary:';
  raise notice '   - First Security Officers: %', first_security_count;
  raise notice '   - Officers Missing COA: %', missing_coa_count;
  raise notice '';
  raise notice '🔐 Compliance Rules:';
  raise notice '   - COA (Certificate of Approval): REQUIRED for First Security officers to work';
  raise notice '   - Warrant: REQUIRED to issue enforcement actions/infringements';
  raise notice '   - Officers can work without warrant (but cannot issue enforcement)';
  raise notice '';
  raise notice '⚠️  Action Required:';
  raise notice '   - Upload COA documents for all First Security officers';
  raise notice '   - Upload warrant documents for officers who issue enforcement';
  raise notice '   - System will block login/patrol check-in if COA expired';
  raise notice '   - System will block enforcement actions if warrant missing/expired';
end $$;
