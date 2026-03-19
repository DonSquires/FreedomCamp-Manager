import { supabase } from '@/lib/supabase'
import { detectCurrentZones } from '@/lib/geofence'

export type ZoneResolutionSource =
  | 'preferred'
  | 'gps_detected'
  | 'jurisdiction_zone'
  | 'fallback_any_active_zone'

interface ResolvedZone {
  zoneId: string
  source: ZoneResolutionSource
}

export async function resolveObservationZoneForOrg(
  organizationId: string,
  preferredZoneId?: string | null,
  gpsLatitude?: number | null,
  gpsLongitude?: number | null,
): Promise<ResolvedZone> {
  if (preferredZoneId) {
    return { zoneId: preferredZoneId, source: 'preferred' }
  }

  // If we have GPS coordinates, try to detect which zone the officer is in.
  if (gpsLatitude != null && gpsLongitude != null) {
    try {
      const detectedZones = await detectCurrentZones(gpsLatitude, gpsLongitude, organizationId)
      if (detectedZones.length > 0) {
        return { zoneId: detectedZones[0].id, source: 'gps_detected' }
      }
    } catch { /* fall through to other strategies */ }
  }

  // Fall back to the organisation's jurisdiction (parent) zone:
  // zone_type = 'general' with no parent_zone_id, i.e. the top-level zone.
  const { data: jurisdictionZones, error: jzError } = await (supabase.from('zones') as any)
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('zone_type', 'general')
    .is('parent_zone_id', null)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)

  if (!jzError && jurisdictionZones?.[0]?.id) {
    return { zoneId: jurisdictionZones[0].id as string, source: 'jurisdiction_zone' }
  }

  // Ultimate fallback: any active zone in the organisation
  const { data: activeZones, error: activeZonesError } = await (supabase.from('zones') as any)
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(1)

  if (!activeZonesError && activeZones?.[0]?.id) {
    return { zoneId: activeZones[0].id as string, source: 'fallback_any_active_zone' }
  }

  const detail = jzError?.message || activeZonesError?.message || 'No fallback zone available'
  throw new Error(`Could not resolve zone for observation: ${detail}`)
}
