/**
 * Full Export Utilities
 * Enhanced export functions that fetch complete record data including photos
 */

import { supabase } from './supabase';
import { SessionScan } from '@/components/features/SessionList';

export interface FullExportRecord {
  legacy_id: string;
  source_table: string;
  plate_text: string;
  happened_at: string;
  zone_id: string;
  zone_name: string;
  organization_id: string;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  self_contained: boolean;
  is_compliant: boolean;
  homelessness_status: string;
  hs_issues: boolean;
  image_links: string[];
  notes: string;
  recorded_by_email: string | null;
  detection_confidence: number | null;
  plate_source: string;
  is_flagged: boolean;
  requires_followup: boolean;
  prior_observations_count: number;
}

/**
 * Fetch complete observation data including photos from database
 */
export async function fetchCompleteObservationData(
  observationIds: string[]
): Promise<Map<string, any>> {
  if (observationIds.length === 0) {
    return new Map();
  }

  const { data: observations, error } = await supabase
    .from('observations')
    .select(`
      id as observation_id,
      plate_number,
      organization_id,
      zone_id,
      recorded_at,
      recorded_by,
      self_contained,
      is_compliant,
      gps_latitude,
      gps_longitude,
      gps_accuracy,
      photo,
      officer_notes,
      vehicle_make,
      vehicle_model,
      vehicle_color,
      zones (
        id,
        name
      )
    `)
    .in('id', observationIds);

  if (error) {
    console.error('Failed to fetch observation data:', error);
    return new Map();
  }

  // Also fetch user profiles for recorded_by emails
  const userIds = observations
    ?.map(o => o.recorded_by)
    .filter(Boolean) as string[];
  
  let userEmailMap = new Map<string, string>();
  
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, email')
      .in('id', userIds);
    
    if (users) {
      userEmailMap = new Map(users.map(u => [u.id, u.email]));
    }
  }

  // Build map of observation data
  const dataMap = new Map();
  
  observations?.forEach(obs => {
    dataMap.set(obs.observation_id, {
      ...obs,
      recorded_by_email: obs.recorded_by ? userEmailMap.get(obs.recorded_by) : null,
    });
  });

  return dataMap;
}

/**
 * Export session data as CSV with complete data from database
 */
export async function exportFullSessionCSV(scans: SessionScan[]): Promise<string> {
  // Fetch complete observation data for all scans that have observation IDs
  const observationIds = scans
    .map(s => s.observationId)
    .filter(Boolean) as string[];
  
  const observationData = await fetchCompleteObservationData(observationIds);

  // Build complete export records
  const fullRecords: FullExportRecord[] = scans.map(scan => {
    const obsData = scan.observationId 
      ? observationData.get(scan.observationId) 
      : null;

    // Extract photo URL from single photo field
    let imageLinks: string[] = [];
    if (obsData?.photo) {
      imageLinks = [obsData.photo];
    }

    return {
      legacy_id: scan.id || `scan-${Date.now()}-${Math.random()}`,
      source_table: 'session_export',
      plate_text: scan.plateNumber || '',
      happened_at: scan.timestamp.toISOString(),
      zone_id: scan.zoneId || '',
      zone_name: scan.zoneName || '',
      organization_id: scan.organizationId || '',
      gps_latitude: obsData?.gps_latitude || null,
      gps_longitude: obsData?.gps_longitude || null,
      gps_accuracy: obsData?.gps_accuracy || scan.gpsAccuracy || null,
      vehicle_make: scan.vehicleMake || obsData?.canonical_vehicles?.vehicle_make || null,
      vehicle_model: scan.vehicleModel || obsData?.canonical_vehicles?.vehicle_model || null,
      vehicle_color: scan.vehicleColor || obsData?.canonical_vehicles?.vehicle_color || null,
      self_contained: scan.isSelfContained ?? obsData?.self_contained ?? false,
      is_compliant: scan.isCompliant ?? obsData?.is_compliant ?? true,
      homelessness_status: scan.isHomeless ? 'confirmed' : 'unknown',
      hs_issues: scan.hasHSIssue ?? false,
      image_links: imageLinks,
      notes: obsData?.officer_notes || '',
      recorded_by_email: obsData?.recorded_by_email || null,
      detection_confidence: null, // Not stored in current schema
      plate_source: scan.detectionMethod || 'manual',
      is_flagged: scan.isFlagged ?? false,
      requires_followup: scan.requiresFollowup ?? false,
      prior_observations_count: scan.priorObservationsCount ?? 0,
    };
  });

  // Generate CSV
  const headers = [
    'legacy_id',
    'source_table',
    'plate_text',
    'happened_at',
    'zone_id',
    'zone_name',
    'organization_id',
    'gps_latitude',
    'gps_longitude',
    'gps_accuracy',
    'vehicle_make',
    'vehicle_model',
    'vehicle_color',
    'self_contained',
    'is_compliant',
    'homelessness_status',
    'hs_issues',
    'image_links',
    'notes',
    'recorded_by_email',
    'detection_confidence',
    'plate_source',
    'is_flagged',
    'requires_followup',
    'prior_observations_count',
  ];

  const rows = fullRecords.map(record => [
    record.legacy_id,
    record.source_table,
    record.plate_text,
    record.happened_at,
    record.zone_id,
    record.zone_name,
    record.organization_id,
    record.gps_latitude?.toString() || '',
    record.gps_longitude?.toString() || '',
    record.gps_accuracy?.toString() || '',
    record.vehicle_make || '',
    record.vehicle_model || '',
    record.vehicle_color || '',
    record.self_contained ? 'true' : 'false',
    record.is_compliant ? 'true' : 'false',
    record.homelessness_status,
    record.hs_issues ? 'true' : 'false',
    record.image_links.join('|'), // Pipe-separated photo URLs
    record.notes,
    record.recorded_by_email || '',
    record.detection_confidence?.toString() || '',
    record.plate_source,
    record.is_flagged ? 'true' : 'false',
    record.requires_followup ? 'true' : 'false',
    record.prior_observations_count.toString(),
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => {
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      const cellStr = String(cell);
      const escaped = cellStr.replace(/"/g, '""');
      if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n') || escaped.includes('|')) {
        return `"${escaped}"`;
      }
      return escaped;
    }).join(',')),
  ].join('\n');

  return csv;
}

/**
 * Export complete JSON with all fields
 */
export async function exportFullSessionJSON(scans: SessionScan[]): Promise<string> {
  const observationIds = scans
    .map(s => s.observationId)
    .filter(Boolean) as string[];
  
  const observationData = await fetchCompleteObservationData(observationIds);

  const fullRecords: FullExportRecord[] = scans.map(scan => {
    const obsData = scan.observationId 
      ? observationData.get(scan.observationId) 
      : null;

    let imageLinks: string[] = [];
    if (obsData?.evidence_photos) {
      if (Array.isArray(obsData.evidence_photos)) {
        imageLinks = obsData.evidence_photos;
      } else if (typeof obsData.evidence_photos === 'object') {
        imageLinks = obsData.evidence_photos.photos || [];
      }
    }

    return {
      legacy_id: scan.id || `scan-${Date.now()}-${Math.random()}`,
      source_table: 'session_export',
      plate_text: scan.plateNumber || '',
      happened_at: scan.timestamp.toISOString(),
      zone_id: scan.zoneId || '',
      zone_name: scan.zoneName || '',
      organization_id: scan.organizationId || '',
      gps_latitude: obsData?.gps_latitude || null,
      gps_longitude: obsData?.gps_longitude || null,
      gps_accuracy: obsData?.gps_accuracy || scan.gpsAccuracy || null,
      vehicle_make: scan.vehicleMake || obsData?.canonical_vehicles?.vehicle_make || null,
      vehicle_model: scan.vehicleModel || obsData?.canonical_vehicles?.vehicle_model || null,
      vehicle_color: scan.vehicleColor || obsData?.canonical_vehicles?.vehicle_color || null,
      self_contained: scan.isSelfContained ?? obsData?.self_contained ?? false,
      is_compliant: scan.isCompliant ?? obsData?.is_compliant ?? true,
      homelessness_status: scan.isHomeless ? 'confirmed' : 'unknown',
      hs_issues: scan.hasHSIssue ?? false,
      image_links: imageLinks,
      notes: obsData?.officer_notes || '',
      recorded_by_email: obsData?.recorded_by_email || null,
      detection_confidence: null,
      plate_source: scan.detectionMethod || 'manual',
      is_flagged: scan.isFlagged ?? false,
      requires_followup: scan.requiresFollowup ?? false,
      prior_observations_count: scan.priorObservationsCount ?? 0,
    };
  });

  return JSON.stringify({
    export_version: '1.0',
    export_timestamp: new Date().toISOString(),
    total_records: fullRecords.length,
    records: fullRecords,
  }, null, 2);
}
