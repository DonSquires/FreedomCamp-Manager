/**
 * Data Integrity Check Edge Function
 * Comprehensive validation of all system data
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface IntegrityIssue {
  table: string;
  issue_type: 'duplicate' | 'integrity' | 'spelling' | 'empty_field' | 'invalid_plate' | 'orphaned';
  severity: 'critical' | 'warning' | 'info';
  record_id: string;
  field_name?: string;
  current_value?: string;
  expected_value?: string;
  description: string;
  auto_fixable: boolean;
}

// NZ plate number validation regex patterns
const NZ_PLATE_PATTERNS = [
  /^[A-Z]{3}\d{3}$/,           // Standard: ABC123
  /^[A-Z]{2}\d{4}$/,           // Old: AB1234
  /^[A-Z]{6}$/,                // Personalized: ABCDEF
  /^[A-Z]{3}\d{2}$/,           // Short: ABC12
  /^[A-Z]{1,3}\d{1,4}$/,       // Flexible: A1 to ABC1234
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const {
      fix_mode = false,
      issues_to_fix = [],
      include_auto_fix = true,
      check_duplicates = true,
      check_foreign_keys = true,
      check_plate_formats = true,
      check_required_fields = true,
      organization_id = null,
      zone_id = null,
      get_organizations = false,
      get_zones = false,
    } = body;

    console.log('Data integrity check started:', {
      fix_mode,
      check_duplicates,
      check_foreign_keys,
      check_plate_formats,
      check_required_fields,
      organization_id,
      zone_id,
      get_organizations,
      get_zones,
    });

    // GET ORGANIZATIONS MODE: Return list of orgs to scan
    if (get_organizations) {
      const { data: orgs, error: orgsError } = await supabaseAdmin
        .from('organizations')
        .select('id, name, is_active')
        .eq('is_active', true)
        .order('name');

      if (orgsError) throw orgsError;

      return new Response(JSON.stringify({ organizations: orgs || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GET ZONES MODE: Return list of zones for an org
    if (get_zones && organization_id) {
      const { data: zones, error: zonesError } = await supabaseAdmin
        .from('zones')
        .select('id, name, is_active')
        .eq('organization_id', organization_id)
        .eq('is_active', true)
        .order('name');

      if (zonesError) throw zonesError;

      return new Response(JSON.stringify({ zones: zones || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // FIX MODE: Apply fixes to selected issues
    if (fix_mode && issues_to_fix.length > 0) {
      const fixResults = await applyFixes(supabaseAdmin, issues_to_fix);
      return new Response(JSON.stringify(fixResults), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // SCAN MODE: Check all data
    const issues: IntegrityIssue[] = [];
    let totalRecordsScanned = 0;

    // 1. Check canonical_vehicles (global table - scan once per full check)
    if ((check_duplicates || check_plate_formats) && (!organization_id || !zone_id)) {
      const canonicalIssues = await checkCanonicalVehicles(supabaseAdmin, {
        check_duplicates,
        check_plate_formats,
      }, organization_id, zone_id);
      issues.push(...canonicalIssues.issues);
      totalRecordsScanned += canonicalIssues.count;
    }

    // 2. Check vehicle_observations_v2 (new migrated table)
    if (check_duplicates || check_foreign_keys) {
      const observationIssues = await checkVehicleObservationsV2(supabaseAdmin, {
        check_duplicates,
        check_foreign_keys,
      }, organization_id, zone_id);
      issues.push(...observationIssues.issues);
      totalRecordsScanned += observationIssues.count;
    }

    // 3. Check incidents
    if (check_duplicates || check_foreign_keys || check_required_fields) {
      const incidentIssues = await checkIncidents(supabaseAdmin, {
        check_duplicates,
        check_foreign_keys,
        check_required_fields,
      }, organization_id, zone_id);
      issues.push(...incidentIssues.issues);
      totalRecordsScanned += incidentIssues.count;
    }

    // 4. Check enforcement_actions
    if (check_duplicates || check_foreign_keys) {
      const enforcementIssues = await checkEnforcementActions(supabaseAdmin, {
        check_duplicates,
        check_foreign_keys,
      }, organization_id, zone_id);
      issues.push(...enforcementIssues.issues);
      totalRecordsScanned += enforcementIssues.count;
    }

    // 5. Check flagged_vehicles
    if (check_duplicates || check_plate_formats) {
      const flaggedIssues = await checkFlaggedVehicles(supabaseAdmin, {
        check_duplicates,
        check_plate_formats,
      }, organization_id, zone_id);
      issues.push(...flaggedIssues.issues);
      totalRecordsScanned += flaggedIssues.count;
    }

    // 6. Check breach_alerts
    if (check_foreign_keys) {
      const breachIssues = await checkBreachAlerts(supabaseAdmin, {
        check_foreign_keys,
      }, organization_id, zone_id);
      issues.push(...breachIssues.issues);
      totalRecordsScanned += breachIssues.count;
    }

    // 7. Check person_records (homeless)
    if (check_required_fields) {
      const personIssues = await checkPersonRecords(supabaseAdmin, {
        check_required_fields,
      }, organization_id, zone_id);
      issues.push(...personIssues.issues);
      totalRecordsScanned += personIssues.count;
    }

    // 8. Check investigation_jobs
    if (check_required_fields || check_foreign_keys) {
      const investigationIssues = await checkInvestigationJobs(supabaseAdmin, {
        check_required_fields,
        check_foreign_keys,
      }, organization_id, zone_id);
      issues.push(...investigationIssues.issues);
      totalRecordsScanned += investigationIssues.count;
    }

    // 9. Check plate_scans (bulk scan review)
    if (check_duplicates || check_plate_formats) {
      const scanIssues = await checkPlateScans(supabaseAdmin, {
        check_duplicates,
        check_plate_formats,
      }, organization_id, zone_id);
      issues.push(...scanIssues.issues);
      totalRecordsScanned += scanIssues.count;
    }

    // 10. Check vehicle_monthly_stays (compliance tracking)
    if (check_foreign_keys) {
      const monthlyStaysIssues = await checkVehicleMonthlyStays(supabaseAdmin, {
        check_foreign_keys,
      }, organization_id, zone_id);
      issues.push(...monthlyStaysIssues.issues);
      totalRecordsScanned += monthlyStaysIssues.count;
    }

    // Build report
    const issuesBySeverity = {
      critical: issues.filter(i => i.severity === 'critical').length,
      warning: issues.filter(i => i.severity === 'warning').length,
      info: issues.filter(i => i.severity === 'info').length,
    };

    const issuesByType = {
      duplicate: issues.filter(i => i.issue_type === 'duplicate').length,
      integrity: issues.filter(i => i.issue_type === 'integrity').length,
      spelling: issues.filter(i => i.issue_type === 'spelling').length,
      empty_field: issues.filter(i => i.issue_type === 'empty_field').length,
      invalid_plate: issues.filter(i => i.issue_type === 'invalid_plate').length,
      orphaned: issues.filter(i => i.issue_type === 'orphaned').length,
    };

    const autoFixableCount = issues.filter(i => i.auto_fixable).length;

    const report = {
      scan_id: crypto.randomUUID(),
      scanned_at: new Date().toISOString(),
      tables_checked: [
        'canonical_vehicles',
        'vehicle_observations_v2',
        'vehicle_monthly_stays',
        'incidents',
        'enforcement_actions',
        'flagged_vehicles',
        'breach_alerts',
        'person_records',
        'investigation_jobs',
        'plate_scans',
      ],
      total_records_scanned: totalRecordsScanned,
      issues_found: issues.length,
      issues_by_severity: issuesBySeverity,
      issues_by_type: issuesByType,
      issues: issues,
      auto_fixable_count: autoFixableCount,
    };

    console.log('Integrity check complete:', {
      total_records: totalRecordsScanned,
      issues_found: issues.length,
      auto_fixable: autoFixableCount,
    });

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Data integrity check failed:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Validation helpers
function isValidNZPlate(plate: string): boolean {
  if (!plate || typeof plate !== 'string') return false;
  
  // Clean plate (remove spaces, hyphens)
  const cleaned = plate.toUpperCase().replace(/[\s-]/g, '');
  
  // Check against patterns
  return NZ_PLATE_PATTERNS.some(pattern => pattern.test(cleaned));
}

// Individual table checks
async function checkCanonicalVehicles(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  // Note: canonical_vehicles is a global table with plate_number as PK
  const { data: vehicles, error } = await client
    .from('canonical_vehicles')
    .select('*');
    
  if (error) throw error;
  
  const count = vehicles?.length || 0;
  
  if (options.check_plate_formats) {
    vehicles?.forEach((vehicle: any) => {
      if (!isValidNZPlate(vehicle.plate_number)) {
        issues.push({
          table: 'canonical_vehicles',
          issue_type: 'invalid_plate',
          severity: 'critical',
          record_id: vehicle.plate_number,
          field_name: 'plate_number',
          current_value: vehicle.plate_number,
          description: `Canonical vehicle has invalid plate: ${vehicle.plate_number}`,
          auto_fixable: false,
        });
      }
    });
  }
  
  if (options.check_duplicates) {
    // Check for duplicate plates (should never happen with PK constraint)
    const seen = new Map<string, number>();
    vehicles?.forEach((vehicle: any) => {
      const plate = vehicle.plate_number?.toUpperCase().replace(/[\s-]/g, '');
      seen.set(plate, (seen.get(plate) || 0) + 1);
    });
    
    seen.forEach((count, plate) => {
      if (count > 1) {
        issues.push({
          table: 'canonical_vehicles',
          issue_type: 'duplicate',
          severity: 'critical',
          record_id: plate,
          field_name: 'plate_number',
          current_value: plate,
          description: `Duplicate canonical vehicle entry for plate ${plate} (should be prevented by PK)`,
          auto_fixable: false,
        });
      }
    });
  }
  
  return { issues, count };
}

async function checkVehicleObservationsV2(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  let query = client.from('vehicle_observations_v2').select('observation_id, plate_number, zone_id, organization_id');
  
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }
  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }
  
  const { data: observations, error } = await query;
    
  if (error) throw error;
  
  const count = observations?.length || 0;
  
  if (options.check_foreign_keys) {
    // Check if plates exist in canonical_vehicles
    const plates = [...new Set(observations?.map((obs: any) => obs.plate_number) || [])];
    
    if (plates.length > 0) {
      const { data: validPlates, error: platesError } = await client
        .from('canonical_vehicles')
        .select('plate_number')
        .in('plate_number', plates);
        
      if (!platesError) {
        const validPlateSet = new Set(validPlates?.map((v: any) => v.plate_number) || []);
        
        observations?.forEach((obs: any) => {
          if (!validPlateSet.has(obs.plate_number)) {
            issues.push({
              table: 'vehicle_observations_v2',
              issue_type: 'orphaned',
              severity: 'critical',
              record_id: obs.observation_id,
              field_name: 'plate_number',
              current_value: obs.plate_number,
              description: `Orphaned observation - plate ${obs.plate_number} does not exist in canonical_vehicles`,
              auto_fixable: false,
            });
          }
        });
      }
    }
    
    // Check if zones exist
    const zoneIds = [...new Set(observations?.map((obs: any) => obs.zone_id) || [])];
    
    if (zoneIds.length > 0) {
      const { data: validZones, error: zonesError } = await client
        .from('zones')
        .select('id')
        .in('id', zoneIds);
        
      if (!zonesError) {
        const validZoneSet = new Set(validZones?.map((z: any) => z.id) || []);
        
        observations?.forEach((obs: any) => {
          if (!validZoneSet.has(obs.zone_id)) {
            issues.push({
              table: 'vehicle_observations_v2',
              issue_type: 'orphaned',
              severity: 'critical',
              record_id: obs.observation_id,
              field_name: 'zone_id',
              description: 'Orphaned observation - zone_id does not exist',
              auto_fixable: false,
            });
          }
        });
      }
    }
  }
  
  return { issues, count };
}

async function checkIncidents(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  let query = client.from('incidents').select('id, description, vehicle_id, zone_id, organization_id, user_id');
  
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }
  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }
  
  const { data: incidents, error } = await query;
    
  if (error) throw error;
  
  const count = incidents?.length || 0;
  
  if (options.check_required_fields) {
    incidents?.forEach((incident: any) => {
      if (!incident.description || incident.description.trim() === '') {
        issues.push({
          table: 'incidents',
          issue_type: 'empty_field',
          severity: 'warning',
          record_id: incident.id,
          field_name: 'description',
          description: 'Incident missing description',
          auto_fixable: false,
        });
      }
    });
  }
  
  if (options.check_foreign_keys) {
    // Note: incidents table references canonical_vehicles_backup_20250203 (old schema)
    // This will be fixed when canonical_vehicles migration is complete
    // For now, we skip this check
  }
  
  return { issues, count };
}

async function checkEnforcementActions(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  let query = client.from('enforcement_actions').select('id, vehicle_record_id, zone_id, organization_id, plate_number');
  
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }
  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }
  
  const { data: actions, error } = await query;
    
  if (error) throw error;
  
  const count = actions?.length || 0;
  
  if (options.check_foreign_keys) {
    // Check plate_number references
    const plates = [...new Set(actions?.filter((a: any) => a.plate_number).map((a: any) => a.plate_number) || [])];
    
    if (plates.length > 0) {
      const { data: validPlates, error: platesError } = await client
        .from('canonical_vehicles')
        .select('plate_number')
        .in('plate_number', plates);
        
      if (!platesError) {
        const validPlateSet = new Set(validPlates?.map((v: any) => v.plate_number) || []);
        
        actions?.forEach((action: any) => {
          if (action.plate_number && !validPlateSet.has(action.plate_number)) {
            issues.push({
              table: 'enforcement_actions',
              issue_type: 'orphaned',
              severity: 'warning',
              record_id: action.id,
              field_name: 'plate_number',
              current_value: action.plate_number,
              description: `Enforcement action references non-existent plate: ${action.plate_number}`,
              auto_fixable: false,
            });
          }
        });
      }
    }
  }
  
  return { issues, count };
}

async function checkFlaggedVehicles(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  let query = client.from('flagged_vehicles').select('*');
  
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }
  // Note: flagged_vehicles table does not have zone_id, so we ignore zone filter
  
  const { data: flagged, error } = await query;
    
  if (error) throw error;
  
  const count = flagged?.length || 0;
  
  if (options.check_plate_formats) {
    flagged?.forEach((vehicle: any) => {
      if (!isValidNZPlate(vehicle.plate_number)) {
        issues.push({
          table: 'flagged_vehicles',
          issue_type: 'invalid_plate',
          severity: 'critical',
          record_id: vehicle.id,
          field_name: 'plate_number',
          current_value: vehicle.plate_number,
          description: `Flagged vehicle has invalid plate: ${vehicle.plate_number}`,
          auto_fixable: false,
        });
      }
    });
  }
  
  if (options.check_duplicates) {
    const seen = new Map<string, string[]>();
    flagged?.forEach((vehicle: any) => {
      const key = `${vehicle.organization_id}_${vehicle.plate_number}`;
      if (!seen.has(key)) {
        seen.set(key, []);
      }
      seen.get(key)!.push(vehicle.id);
    });
    
    seen.forEach((ids) => {
      if (ids.length > 1) {
        ids.slice(1).forEach(id => {
          issues.push({
            table: 'flagged_vehicles',
            issue_type: 'duplicate',
            severity: 'warning',
            record_id: id,
            description: 'Duplicate flagged vehicle entry for same organization and plate',
            auto_fixable: true,
          });
        });
      }
    });
  }
  
  return { issues, count };
}

async function checkBreachAlerts(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  let query = client.from('breach_alerts').select('id, vehicle_record_id, zone_id, organization_id');
  
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }
  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }
  
  const { data: alerts, error } = await query;
    
  if (error) throw error;
  
  const count = alerts?.length || 0;
  
  if (options.check_foreign_keys) {
    // Note: breach_alerts still references vehicle_records (deprecated table)
    // This will be fixed when vehicle_records is fully migrated
    // For now, we skip this check
  }
  
  return { issues, count };
}

async function checkPersonRecords(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  let query = client.from('person_records').select('*');
  
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }
  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }
  
  const { data: persons, error } = await query;
    
  if (error) throw error;
  
  const count = persons?.length || 0;
  
  if (options.check_required_fields) {
    persons?.forEach((person: any) => {
      if (!person.full_name || person.full_name.trim() === '') {
        issues.push({
          table: 'person_records',
          issue_type: 'empty_field',
          severity: 'critical',
          record_id: person.id,
          field_name: 'full_name',
          description: 'Person record missing full name',
          auto_fixable: false,
        });
      }
    });
  }
  
  return { issues, count };
}

async function checkInvestigationJobs(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  let query = client.from('investigation_jobs').select('id, location_address, vehicle_id, organization_id');
  
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }
  // Note: investigation_jobs table does not have zone_id, so we ignore zone filter
  
  const { data: jobs, error } = await query;
    
  if (error) throw error;
  
  const count = jobs?.length || 0;
  
  if (options.check_required_fields) {
    jobs?.forEach((job: any) => {
      if (!job.location_address || job.location_address.trim() === '') {
        issues.push({
          table: 'investigation_jobs',
          issue_type: 'empty_field',
          severity: 'warning',
          record_id: job.id,
          field_name: 'location_address',
          description: 'Investigation job missing location address',
          auto_fixable: false,
        });
      }
    });
  }
  
  if (options.check_foreign_keys) {
    // Note: investigation_jobs references canonical_vehicles_backup_20250203 (old schema)
    // This will be fixed when canonical_vehicles migration is complete
    // For now, we skip this check
  }
  
  return { issues, count };
}

async function checkPlateScans(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  let query = client.from('plate_scans').select('*');
  
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }
  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }
  
  const { data: scans, error } = await query;
    
  if (error) throw error;
  
  const count = scans?.length || 0;
  
  if (options.check_plate_formats) {
    scans?.forEach((scan: any) => {
      if (!isValidNZPlate(scan.plate_number)) {
        issues.push({
          table: 'plate_scans',
          issue_type: 'invalid_plate',
          severity: 'warning',
          record_id: scan.id,
          field_name: 'plate_number',
          current_value: scan.plate_number,
          description: `Bulk scan has invalid plate: ${scan.plate_number}`,
          auto_fixable: false,
        });
      }
    });
  }
  
  return { issues, count };
}

async function checkVehicleMonthlyStays(client: any, options: any, organization_id?: string | null, zone_id?: string | null) {
  const issues: IntegrityIssue[] = [];
  
  let query = client.from('vehicle_monthly_stays').select('id, plate_number, zone_id, organization_id');
  
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }
  if (zone_id) {
    query = query.eq('zone_id', zone_id);
  }
  
  const { data: stays, error } = await query;
    
  if (error) throw error;
  
  const count = stays?.length || 0;
  
  if (options.check_foreign_keys) {
    // Check if plates exist in canonical_vehicles
    const plates = [...new Set(stays?.map((s: any) => s.plate_number) || [])];
    
    if (plates.length > 0) {
      const { data: validPlates, error: platesError } = await client
        .from('canonical_vehicles')
        .select('plate_number')
        .in('plate_number', plates);
        
      if (!platesError) {
        const validPlateSet = new Set(validPlates?.map((v: any) => v.plate_number) || []);
        
        stays?.forEach((stay: any) => {
          if (!validPlateSet.has(stay.plate_number)) {
            issues.push({
              table: 'vehicle_monthly_stays',
              issue_type: 'orphaned',
              severity: 'warning',
              record_id: stay.id,
              field_name: 'plate_number',
              current_value: stay.plate_number,
              description: `Monthly stay record references non-existent plate: ${stay.plate_number}`,
              auto_fixable: false,
            });
          }
        });
      }
    }
  }
  
  return { issues, count };
}

// Apply fixes
async function applyFixes(client: any, issues: IntegrityIssue[]) {
  let fixedCount = 0;
  const errors: any[] = [];
  
  for (const issue of issues) {
    if (!issue.auto_fixable) continue;
    
    try {
      if (issue.issue_type === 'duplicate') {
        // Delete duplicate record
        const { error } = await client
          .from(issue.table)
          .delete()
          .eq('id', issue.record_id);
          
        if (error) throw error;
        fixedCount++;
      }
    } catch (error: any) {
      console.error(`Failed to fix ${issue.table} ${issue.record_id}:`, error);
      errors.push({ issue, error: error.message });
    }
  }
  
  return {
    fixed_count: fixedCount,
    errors: errors,
  };
}
