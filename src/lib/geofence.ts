/**
 * Geofence Utilities
 * 
 * Functions for automatic zone detection, patrol management,
 * shift lifecycle (parent zone entry/exit) and site visit
 * tracking (child zone entry/exit) based on GPS location.
 */

import { supabase } from './supabase'
import { toast } from 'sonner'

export interface GeofenceZone {
  id: string
  name: string
  location_lat: number
  location_lng: number
  radius_meters?: number
  geometry?: any
  parent_zone_id?: string | null
  zone_type?: string
}

/**
 * Calculate distance between two GPS coordinates (in meters)
 * Uses Haversine formula
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371e3 // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Distance in meters
}

/**
 * Check if a point is inside a geofence zone
 */
export function isInsideGeofence(
  userLat: number,
  userLng: number,
  zone: GeofenceZone
): boolean {
  const distance = calculateDistance(
    userLat,
    userLng,
    zone.location_lat,
    zone.location_lng
  )
  
  const radius = zone.radius_meters || 500 // Default 500m radius
  return distance <= radius
}

/**
 * Determine whether a zone is a parent (jurisdiction) zone.
 * Parent zones have no parent_zone_id and zone_type 'general'.
 */
export function isParentZone(zone: GeofenceZone): boolean {
  return !zone.parent_zone_id && zone.zone_type === 'general'
}

/**
 * Ray-casting point-in-polygon check for a GeoJSON exterior ring.
 * Coordinates must be in GeoJSON [lng, lat] order.
 *
 * Casts a horizontal ray from the test point to the right (+∞) and counts
 * how many polygon edges it crosses. An odd count means the point is inside.
 * Assumes the ring is closed (first === last coordinate) and any winding order.
 */
function isPointInGeoJSONPolygon(userLng: number, userLat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if (((yi > userLat) !== (yj > userLat)) && (userLng < (xj - xi) * (userLat - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Find all zones the user is currently inside.
 * Handles GeoJSON Polygon, GeoJSON Point+radius circles, and legacy center-point zones.
 */
export async function detectCurrentZones(
  userLat: number,
  userLng: number,
  organizationId?: string
): Promise<GeofenceZone[]> {
  try {
    // Fetch all active zones including hierarchy fields
    let query = (supabase.from('zones') as any)
      .select('id, name, location_lat, location_lng, geometry, parent_zone_id, zone_type')
      .eq('is_active', true)
    
    if (organizationId) {
      query = query.eq('organization_id', organizationId)
    }
    
    const { data: zones, error } = await query
    
    if (error) throw error
    if (!zones) return []
    
    const nearbyZones = zones.filter((zone) => {
      const g = zone.geometry

      // GeoJSON Polygon — ray-casting inside check
      if (g?.type === 'Polygon' && Array.isArray(g.coordinates?.[0])) {
        return isPointInGeoJSONPolygon(userLng, userLat, g.coordinates[0])
      }

      // GeoJSON Point with radius — circle check (coordinates are [lng, lat])
      if (g?.type === 'Point' && Array.isArray(g.coordinates)) {
        const radius = g.radius ?? zone.radius_meters ?? 500
        const dist = calculateDistance(userLat, userLng, g.coordinates[1], g.coordinates[0])
        return dist <= radius
      }

      // Fallback: dedicated center-point columns (legacy zones)
      if (zone.location_lat && zone.location_lng) {
        return isInsideGeofence(userLat, userLng, zone as GeofenceZone)
      }

      return false
    })
    
    return nearbyZones as GeofenceZone[]
  } catch (error: any) {
    console.error('Geofence detection error:', error)
    return []
  }
}

// ─── Shift Management ───────────────────────────────────────────────────

/**
 * Start an officer shift when entering a parent (jurisdiction) zone.
 * Returns the shift ID if created or already active.
 */
export async function startShift(
  userId: string,
  organizationId: string,
  parentZoneId: string,
  gpsLat: number,
  gpsLng: number
): Promise<{ success: boolean; shiftId?: string }> {
  try {
    // Check for already-active shift
    const { data: existing } = await (supabase.from('officer_shifts') as any)
      .select('id')
      .eq('officer_id', userId)
      .is('ended_at', null)
      .maybeSingle()

    if (existing) {
      return { success: true, shiftId: existing.id }
    }

    const { data: shift, error } = await (supabase.from('officer_shifts') as any)
      .insert({
        officer_id: userId,
        organization_id: organizationId,
        parent_zone_id: parentZoneId,
        gps_start_lat: gpsLat,
        gps_start_lng: gpsLng,
      })
      .select('id')
      .single()

    if (error) throw error
    toast.success('Shift started')
    return { success: true, shiftId: shift?.id }
  } catch (error: any) {
    console.error('Start shift error:', error)
    return { success: false }
  }
}

/**
 * End the officer's active shift.
 */
export async function endShift(
  userId: string,
  reason: 'logout' | 'app_timeout' | 'manual' | 'zone_exit',
  gpsLat?: number,
  gpsLng?: number
): Promise<{ success: boolean }> {
  try {
    const { data: shift } = await (supabase.from('officer_shifts') as any)
      .select('id')
      .eq('officer_id', userId)
      .is('ended_at', null)
      .maybeSingle()

    if (!shift) return { success: true }

    // Close any open site visits first
    await closeAllOpenSiteVisits(userId, gpsLat, gpsLng)

    const { error } = await (supabase.from('officer_shifts') as any)
      .update({
        ended_at: new Date().toISOString(),
        end_reason: reason,
        gps_end_lat: gpsLat ?? null,
        gps_end_lng: gpsLng ?? null,
      })
      .eq('id', shift.id)

    if (error) throw error
    toast.info('Shift ended')
    return { success: true }
  } catch (error: any) {
    console.error('End shift error:', error)
    return { success: false }
  }
}

/**
 * Get the current active shift for the officer.
 */
export async function getActiveShift(
  userId: string
): Promise<{ id: string; parent_zone_id: string | null } | null> {
  try {
    const { data } = await (supabase.from('officer_shifts') as any)
      .select('id, parent_zone_id')
      .eq('officer_id', userId)
      .is('ended_at', null)
      .maybeSingle()
    return data ?? null
  } catch {
    return null
  }
}

// ─── Site Visit Tracking ────────────────────────────────────────────────

/**
 * Start a site visit when entering a child zone (specific site).
 */
export async function startSiteVisit(
  userId: string,
  organizationId: string,
  zoneId: string,
  gpsLat: number,
  gpsLng: number
): Promise<{ success: boolean; visitId?: string }> {
  try {
    // Check for already-active visit in this zone
    const { data: existing } = await (supabase.from('patrol_site_visits') as any)
      .select('id')
      .eq('officer_id', userId)
      .eq('zone_id', zoneId)
      .is('exited_at', null)
      .maybeSingle()

    if (existing) {
      return { success: true, visitId: existing.id }
    }

    // Link to active shift if available
    const shift = await getActiveShift(userId)

    const { data: visit, error } = await (supabase.from('patrol_site_visits') as any)
      .insert({
        officer_id: userId,
        organization_id: organizationId,
        shift_id: shift?.id ?? null,
        zone_id: zoneId,
        gps_entry_lat: gpsLat,
        gps_entry_lng: gpsLng,
      })
      .select('id')
      .single()

    if (error) throw error
    toast.success('Site visit started')
    return { success: true, visitId: visit?.id }
  } catch (error: any) {
    console.error('Start site visit error:', error)
    return { success: false }
  }
}

/**
 * End a site visit when exiting a child zone.
 */
export async function endSiteVisit(
  userId: string,
  zoneId: string,
  gpsLat?: number,
  gpsLng?: number
): Promise<{ success: boolean }> {
  try {
    const { data: visit } = await (supabase.from('patrol_site_visits') as any)
      .select('id')
      .eq('officer_id', userId)
      .eq('zone_id', zoneId)
      .is('exited_at', null)
      .maybeSingle()

    if (!visit) return { success: true }

    const { error } = await (supabase.from('patrol_site_visits') as any)
      .update({
        exited_at: new Date().toISOString(),
        gps_exit_lat: gpsLat ?? null,
        gps_exit_lng: gpsLng ?? null,
      })
      .eq('id', visit.id)

    if (error) throw error
    toast.info('Site visit ended')
    return { success: true }
  } catch (error: any) {
    console.error('End site visit error:', error)
    return { success: false }
  }
}

/**
 * Close all open site visits for an officer (used on shift end).
 */
async function closeAllOpenSiteVisits(
  userId: string,
  gpsLat?: number,
  gpsLng?: number
): Promise<void> {
  try {
    await (supabase.from('patrol_site_visits') as any)
      .update({
        exited_at: new Date().toISOString(),
        gps_exit_lat: gpsLat ?? null,
        gps_exit_lng: gpsLng ?? null,
      })
      .eq('officer_id', userId)
      .is('exited_at', null)
  } catch (error: any) {
    console.error('Close open site visits error:', error)
  }
}

// ─── Patrol Auto Start/Stop ─────────────────────────────────────────────

/**
 * Start a patrol automatically when entering a geofence
 */
export async function autoStartPatrol(
  userId: string,
  zoneId: string,
  organizationId: string,
  gpsLat: number,
  gpsLng: number
): Promise<{ success: boolean; patrolId?: string }> {
  try {
    // Check if patrol already active
    const { data: existingPatrol } = await (supabase.from('patrols') as any)
      .select('id')
      .eq('assigned_to', userId)
      .eq('zone_id', zoneId)
      .eq('patrol_date', new Date().toISOString().split('T')[0])
      .eq('status', 'in_progress')
      .maybeSingle()
    
    if (existingPatrol) {
      console.log('Patrol already active:', existingPatrol.id)
      return { success: true, patrolId: existingPatrol.id }
    }
    
    // Create new patrol
    const { data: patrol, error } = await (supabase
      .from('patrols') as any)
      .insert({
        organization_id: organizationId,
        zone_id: zoneId,
        patrol_date: new Date().toISOString().split('T')[0],
        shift: 'day', // TODO: Detect shift based on time
        assigned_to: userId,
        status: 'in_progress',
        notes: 'Auto-started via geofence entry',
      })
      .select()
      .single()
    
    if (error) throw error
    
    toast.success(`Patrol started in ${zoneId}`)
    return { success: true, patrolId: patrol?.id }
  } catch (error: any) {
    console.error('Auto-start patrol error:', error)
    toast.error('Failed to start patrol automatically')
    return { success: false }
  }
}

/**
 * Stop a patrol automatically when exiting a geofence
 */
export async function autoStopPatrol(
  userId: string,
  zoneId: string
): Promise<{ success: boolean }> {
  try {
    // Find active patrol
    const { data: patrol, error: findError } = await (supabase.from('patrols') as any)
      .select('id')
      .eq('assigned_to', userId)
      .eq('zone_id', zoneId)
      .eq('patrol_date', new Date().toISOString().split('T')[0])
      .eq('status', 'in_progress')
      .maybeSingle()
    
    if (findError) throw findError
    if (!patrol) {
      console.log('No active patrol to stop')
      return { success: true }
    }
    
    // Update patrol to completed
    const { error: updateError } = await (supabase.from('patrols') as any)
      .update({
        ended_at: new Date().toISOString(),
        status: 'completed',
      })
      .eq('id', patrol.id)
    
    if (updateError) throw updateError
    
    toast.info('Patrol completed (left geofence)')
    return { success: true }
  } catch (error: any) {
    console.error('Auto-stop patrol error:', error)
    toast.error('Failed to stop patrol automatically')
    return { success: false }
  }
}

// ─── Geofence Monitor ───────────────────────────────────────────────────

/** 15-minute inactivity timeout (in ms) for shift auto-end */
export const SHIFT_TIMEOUT_MS = 15 * 60 * 1000

/**
 * Monitor GPS location and manage patrol status, shifts, and site visits.
 * Call this function every 30 seconds while app is active.
 *
 * - Parent zone entry → shift start (login)
 * - Child zone entry  → site visit start
 * - Child zone exit   → site visit end
 * - All zone exit     → patrol stop; shift continues until logout / timeout
 */
export async function monitorGeofenceAndPatrol(
  userId: string,
  organizationId: string,
  currentZoneId: string | null,
  onZoneChange: (zoneId: string | null, zoneName: string | null) => void,
  onLocationUpdate?: (lat: number, lng: number) => void
): Promise<void> {
  try {
    // Get current GPS location
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      })
    })
    
    const userLat = position.coords.latitude
    const userLng = position.coords.longitude

    // Notify caller of the fresh GPS position so UI can stay up-to-date
    onLocationUpdate?.(userLat, userLng)
    
    // Detect current zones (includes parent_zone_id, zone_type)
    const zones = await detectCurrentZones(userLat, userLng, organizationId)

    // Separate parent and child zones
    const parentZones = zones.filter(z => isParentZone(z))
    const childZones = zones.filter(z => !isParentZone(z))

    // ── Shift management (parent zone) ──
    if (parentZones.length > 0) {
      const parentZone = parentZones[0]
      await startShift(userId, organizationId, parentZone.id, userLat, userLng)
    }

    // ── Site visit management (child zones) ──
    // Start visits for all child zones the officer is inside
    for (const zone of childZones) {
      await startSiteVisit(userId, organizationId, zone.id, userLat, userLng)
    }

    // End visits for child zones the officer has left
    try {
      const { data: openVisits } = await (supabase.from('patrol_site_visits') as any)
        .select('id, zone_id')
        .eq('officer_id', userId)
        .is('exited_at', null)

      const currentChildZoneIds = new Set(childZones.map(z => z.id))
      for (const visit of openVisits ?? []) {
        if (!currentChildZoneIds.has(visit.zone_id)) {
          await endSiteVisit(userId, visit.zone_id, userLat, userLng)
        }
      }
    } catch (err: any) {
      console.error('Site visit cleanup error:', err)
    }

    // ── Patrol management (legacy behaviour) ──
    if (zones.length > 0) {
      // Inside a geofence
      const primaryZone = zones[0] // Use first detected zone
      
      if (primaryZone.id !== currentZoneId) {
        // Zone changed - stop old patrol, start new patrol
        if (currentZoneId) {
          await autoStopPatrol(userId, currentZoneId)
        }
        
        await autoStartPatrol(userId, primaryZone.id, organizationId, userLat, userLng)
        onZoneChange(primaryZone.id, primaryZone.name)
      }
    } else {
      // Outside all geofences
      if (currentZoneId) {
        // Left the zone - stop patrol
        await autoStopPatrol(userId, currentZoneId)
        onZoneChange(null, 'Other Location')
      } else {
        // Still outside - set to "Other Location"
        onZoneChange(null, 'Other Location')
      }
    }
  } catch (error: any) {
    console.error('Geofence monitoring error:', error)
  }
}

/**
 * Sync all geofenced zones as patrol checkpoints for an organisation.
 * Calls the server-side sync_geofence_zone_checkpoints RPC.
 */
export async function syncZoneCheckpoints(
  organizationId: string
): Promise<{ success: boolean; count?: number }> {
  try {
    const { data, error } = await (supabase as any).rpc('sync_geofence_zone_checkpoints', {
      p_organization_id: organizationId,
    })

    if (error) throw error
    const count = typeof data === 'number' ? data : 0
    if (count > 0) {
      toast.success(`${count} zone checkpoint(s) created`)
    } else {
      toast.info('All zone checkpoints already exist')
    }
    return { success: true, count }
  } catch (error: any) {
    console.error('Sync zone checkpoints error:', error)
    toast.error('Failed to sync zone checkpoints')
    return { success: false }
  }
}
