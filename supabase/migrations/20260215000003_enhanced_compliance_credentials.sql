-- Enhanced Compliance Credentials with AI Auto-Fill Support
-- Extends officer_compliance_credentials.sql with activity tracking and organization-specific requirements

-- Step 1: Add enhanced credential fields
alter table user_profiles
add column if not exists authorized_activities jsonb default '[]'::jsonb,
add column if not exists issuing_authority text,
add column if not exists coa_license_type text,
add column if not exists warrant_acts text[], -- Acts they're authorized under (e.g., Freedom Camping Act 2011)
add column if not exists credentials_verified boolean default false,
add column if not exists credentials_verified_at timestamp with time zone,
add column if not exists credentials_verified_by uuid references user_profiles(id);

comment on column user_profiles.authorized_activities is 
'JSONB array of authorized activities extracted from COA/Warrant: ["freedom_camping", "noise_control", "trespass", "security_guard"]';

comment on column user_profiles.issuing_authority is 
'Authority that issued the warrant (e.g., "Nelson City Council", "Ministry of Justice")';

comment on column user_profiles.coa_license_type is 
'Type of COA license (e.g., "Certificate of Approval - Security Guard", "Private Investigator")';

comment on column user_profiles.warrant_acts is 
'Array of Acts officer is authorized under (e.g., ["Freedom Camping Act 2011", "Trespass Act 1980", "Summary Offences Act 1981"])';

comment on column user_profiles.credentials_verified is 
'True if admin has verified uploaded credentials are legitimate';

-- Create index for activity queries
create index if not exists idx_user_profiles_authorized_activities on user_profiles using gin(authorized_activities);
create index if not exists idx_user_profiles_credentials_verified on user_profiles(credentials_verified);

-- Step 2: Update organization-specific compliance requirements
alter table organizations
add column if not exists requires_coa boolean default false,
add column if not exists requires_warrant_for_enforcement boolean default true;

comment on column organizations.requires_coa is 
'True if organization requires officers to have COA (Certificate of Approval - Security License). E.g., First Security = true, Nelson City Council = false';

comment on column organizations.requires_warrant_for_enforcement is 
'True if organization requires warrant to issue enforcement actions. E.g., all organizations = true';

-- Set organization-specific requirements
update organizations
set requires_coa = true,
    requires_warrant_for_enforcement = true
where name = 'First Security';

update organizations
set requires_coa = false, -- Council employees don't need COA
    requires_warrant_for_enforcement = true -- But need warrant for enforcement
where name in ('Nelson City Council', 'Nelson');

-- Step 3: Create function to check organization-specific compliance
create or replace function check_organization_compliance(
  p_user_id uuid,
  p_employer_org_id uuid
)
returns jsonb as $$
declare
  v_org record;
  v_user record;
  v_compliance_result jsonb;
  v_missing_items text[] := array[]::text[];
  v_warnings text[] := array[]::text[];
begin
  -- Get organization requirements
  select requires_coa, requires_warrant_for_enforcement
  into v_org
  from organizations
  where id = p_employer_org_id;
  
  -- Get user credentials
  select 
    coa_number,
    coa_expiry_date,
    has_warrant,
    warrant_number,
    warrant_expiry_date,
    compliance_status
  into v_user
  from user_profiles
  where id = p_user_id;
  
  -- Check COA requirement
  if v_org.requires_coa = true then
    if v_user.coa_number is null then
      v_missing_items := array_append(v_missing_items, 'COA (Certificate of Approval - Security License)');
    elsif v_user.coa_expiry_date < current_date then
      v_warnings := array_append(v_warnings, 'COA has EXPIRED - cannot work');
    elsif v_user.coa_expiry_date - current_date <= 30 then
      v_warnings := array_append(v_warnings, format('COA expires in %s days', v_user.coa_expiry_date - current_date));
    end if;
  end if;
  
  -- Check warrant requirement (for enforcement)
  if v_org.requires_warrant_for_enforcement = true then
    if v_user.has_warrant = false then
      v_warnings := array_append(v_warnings, 'No warrant - cannot issue enforcement actions (can still perform patrols)');
    elsif v_user.warrant_expiry_date is null then
      v_warnings := array_append(v_warnings, 'Warrant expiry date not set');
    elsif v_user.warrant_expiry_date < current_date then
      v_warnings := array_append(v_warnings, 'Warrant has EXPIRED - cannot issue enforcement actions');
    elsif v_user.warrant_expiry_date - current_date <= 30 then
      v_warnings := array_append(v_warnings, format('Warrant expires in %s days', v_user.warrant_expiry_date - current_date));
    end if;
  end if;
  
  -- Build result
  v_compliance_result := jsonb_build_object(
    'can_login', true, -- Always allow login
    'can_work', cardinality(v_missing_items) = 0 and not (v_user.coa_expiry_date < current_date and v_org.requires_coa = true),
    'can_enforce', v_user.has_warrant = true and (v_user.warrant_expiry_date is null or v_user.warrant_expiry_date >= current_date),
    'missing_items', v_missing_items,
    'warnings', v_warnings,
    'requires_coa', v_org.requires_coa,
    'requires_warrant', v_org.requires_warrant_for_enforcement,
    'compliance_status', v_user.compliance_status
  );
  
  return v_compliance_result;
end;
$$ language plpgsql stable security definer;

comment on function check_organization_compliance(uuid, uuid) is 
'Checks user compliance based on employer organization requirements. Returns JSON with can_login, can_work, can_enforce, missing_items, warnings';

-- Step 4: Create view for compliance dashboard with organization context
drop view if exists officer_compliance_dashboard;
create or replace view officer_compliance_dashboard as
select 
  up.id as user_id,
  up.first_name,
  up.last_name,
  up.email,
  up.role,
  o.name as employer_organization,
  o.requires_coa,
  o.requires_warrant_for_enforcement,
  
  -- COA details
  up.coa_number,
  up.coa_expiry_date,
  up.coa_license_type,
  case 
    when up.coa_expiry_date is not null 
    then up.coa_expiry_date - current_date
    else null
  end as coa_days_until_expiry,
  case 
    when o.requires_coa = false then false -- N/A for this org
    when up.coa_number is null then true
    when up.coa_expiry_date is null then true
    when up.coa_expiry_date - current_date <= 30 then true
    else false 
  end as coa_expiring_soon,
  
  -- Warrant details
  up.has_warrant,
  up.warrant_number,
  up.warrant_expiry_date,
  up.issuing_authority,
  up.warrant_acts,
  up.authorized_activities,
  case 
    when up.warrant_expiry_date is not null 
    then up.warrant_expiry_date - current_date
    else null
  end as warrant_days_until_expiry,
  case 
    when up.has_warrant = false then false
    when up.warrant_expiry_date is null then true
    when up.warrant_expiry_date - current_date <= 30 then true
    else false 
  end as warrant_expiring_soon,
  
  -- Compliance status
  up.compliance_status,
  up.credentials_verified,
  up.credentials_verified_at,
  
  -- Capabilities based on organization requirements
  check_organization_compliance(up.id, up.employer_organization_id) as compliance_check,
  can_officer_work(up.id) as can_work_legacy,
  can_issue_enforcement(up.id) as can_enforce_legacy
  
from user_profiles up
left join organizations o on up.employer_organization_id = o.id
where up.role in ('officer', 'admin_officer')
order by 
  case 
    when o.requires_coa = true and up.coa_number is null then 1
    when up.coa_expiry_date < current_date then 2
    when up.warrant_expiry_date < current_date then 3
    else 4
  end,
  up.coa_expiry_date asc;

comment on view officer_compliance_dashboard is 
'Officer compliance dashboard with organization-specific requirements (First Security = COA required, Nelson = warrant only)';

-- Step 5: Create audit log for AI credential processing
create table if not exists credential_processing_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  document_type text not null check (document_type in ('coa', 'warrant')),
  document_url text not null,
  
  -- AI extraction results
  ai_model text, -- e.g., 'gpt-4o'
  extracted_text text, -- Full OCR text
  extracted_data jsonb, -- Structured data from AI
  confidence_score numeric(3,2), -- 0.00 to 1.00
  
  -- Parsed fields
  license_number text,
  expiry_date date,
  issuing_authority text,
  authorized_activities text[],
  
  -- Processing status
  status text default 'pending' check (status in ('pending', 'success', 'failed', 'manual_review')),
  error_message text,
  
  -- Review
  manually_verified boolean default false,
  verified_by uuid references user_profiles(id),
  verified_at timestamp with time zone,
  
  processed_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

create index idx_credential_processing_user on credential_processing_log(user_id);
create index idx_credential_processing_status on credential_processing_log(status);
create index idx_credential_processing_document_type on credential_processing_log(document_type);

comment on table credential_processing_log is 
'Audit trail for AI-powered credential document processing (COA/warrant scanning and auto-fill)';

-- Step 6: Summary
do $$
declare
  first_security_count integer;
  nelson_count integer;
  missing_coa_count integer;
  missing_warrant_count integer;
begin
  -- Count users by organization
  select count(*) into first_security_count
  from user_profiles up
  join organizations o on up.employer_organization_id = o.id
  where o.name = 'First Security'
  and up.role in ('officer', 'admin_officer');
  
  select count(*) into nelson_count
  from user_profiles up
  join organizations o on up.employer_organization_id = o.id
  where o.name in ('Nelson City Council', 'Nelson')
  and up.role in ('officer', 'admin_officer');
  
  -- Count missing credentials
  select count(*) into missing_coa_count
  from user_profiles up
  join organizations o on up.employer_organization_id = o.id
  where o.requires_coa = true
  and up.coa_number is null
  and up.role in ('officer', 'admin_officer');
  
  select count(*) into missing_warrant_count
  from user_profiles up
  where up.has_warrant = false
  and up.role in ('officer', 'admin_officer');
  
  raise notice '✅ Enhanced Compliance System Installed';
  raise notice '';
  raise notice '📊 Organization Summary:';
  raise notice '   - First Security Officers: % (COA REQUIRED)', first_security_count;
  raise notice '   - Nelson Officers: % (Warrant REQUIRED, COA not needed)', nelson_count;
  raise notice '';
  raise notice '⚠️  Missing Credentials:';
  raise notice '   - Missing COA: %', missing_coa_count;
  raise notice '   - Missing Warrant: %', missing_warrant_count;
  raise notice '';
  raise notice '🤖 AI Features:';
  raise notice '   - Auto-extract license numbers from uploaded documents';
  raise notice '   - Parse expiry dates automatically';
  raise notice '   - Extract authorized activities (freedom camping, noise control, etc.)';
  raise notice '   - Identify issuing authority';
  raise notice '';
  raise notice '🔐 Login Flow:';
  raise notice '   - Users CAN login even without credentials';
  raise notice '   - Blocking modal shows if credentials missing/expired';
  raise notice '   - Upload credentials directly from blocking screen';
  raise notice '   - AI scans document and auto-fills form';
  raise notice '   - Access granted once credentials valid';
end $$;
