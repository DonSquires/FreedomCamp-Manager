/**
 * Geofence Utilities
 * 
 * Functions for automatic zone detection and patrol management based on GPS location
 */

import { supabase } from './supabase'
import { toast } from 'sonner'
import { toZonedTime } from 'date-fns-tz'

export interface GeofenceZone {
  id: string
  name: string
  organization_id: string
  location_lat: number
  location_lng: number
  radius_meters?: number
  geometry?: any
}

interface ActivePatrol {
  patrol_id: string
  zone_id: string
  zone_name: string
  geofence_radius: number | null
  auto_checkin_enabled: boolean | null
  status: string
  checked_in_at: string | null
  completed_at: string | null
  zone_center_lat: number | null
  zone_center_lng: number | null
}

interface MonitorOptions {
  onLocationUpdate?: (coords: { latitude: number; longitude: number; accuracy: number }) => void
  activityType?: string
  currentZoneName?: string | null
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
 * Ray-casting point-in-polygon test for GeoJSON polygon rings.
 * Polygon coordinates are in GeoJSON order: [[lng, lat], ...]
 */
function isPointInPolygon(
  lat: number,
  lng: number,
  polygon: [number, number][]  // GeoJSON ring: [[lng, lat], ...]
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]  // lng
    const yi = polygon[i][1]  // lat
    const xj = polygon[j][0]  // lng
    const yj = polygon[j][1]  // lat
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Find all zones the user is currently inside
 */
export async function detectCurrentZones(
  userLat: number,
  userLng: number,
  organizationScope?: string | string[]
): Promise<GeofenceZone[]> {
  try {
    // Fetch all active zones – include zone_type so we can sort by specificity.
    // Some environments may not yet have zones.radius_meters; retry without it.
    let query = (supabase.from('zones') as any)
      .select('id, name, organization_id, location_lat, location_lng, geometry, zone_type, radius_meters, parent_zone_id')
      .eq('is_active', true)
    
    if (Array.isArray(organizationScope) && organizationScope.length > 0) {
      query = query.in('organization_id', organizationScope)
    } else if (typeof organizationScope === 'string' && organizationScope.length > 0) {
      query = query.eq('organization_id', organizationScope)
    }
    
    let { data: zones, error } = await query

    if (error?.code === '42703' && String(error.message || '').includes('radius_meters')) {
      let fallbackQuery = (supabase.from('zones') as any)
        .select('id, name, organization_id, location_lat, location_lng, geometry, zone_type, parent_zone_id')
        .eq('is_active', true)

      if (Array.isArray(organizationScope) && organizationScope.length > 0) {
        fallbackQuery = fallbackQuery.in('organization_id', organizationScope)
      } else if (typeof organizationScope === 'string' && organizationScope.length > 0) {
        fallbackQuery = fallbackQuery.eq('organization_id', organizationScope)
      }

      const fallback = await fallbackQuery
      zones = (fallback.data || []).map((z: any) => ({ ...z, radius_meters: null }))
      error = fallback.error
    }

    if (error) throw error
    if (!zones) return []
    
    // Filter zones the user is inside, and compute distance to centre for sorting.
    // Check polygon geometry first (precise boundary), then fall back to centre+radius.
    const matches: Array<{ zone: any; distance: number }> = []
    const matchedIds = new Set<string>()
    for (const zone of zones) {
      let matched = false
      let dist = 0

      // 1. Polygon geometry check (GeoJSON Polygon) — handles child zones with drawn boundaries
      if (zone.geometry?.type === 'Polygon' && Array.isArray(zone.geometry.coordinates?.[0]) && zone.geometry.coordinates[0].length > 0) {
        if (isPointInPolygon(userLat, userLng, zone.geometry.coordinates[0])) {
          matched = true
          if (zone.location_lat && zone.location_lng) {
            dist = calculateDistance(userLat, userLng, zone.location_lat, zone.location_lng)
          }
        }
      }

      // 2. Centre-point + radius fallback (for zones without polygon geometry)
      if (!matched && zone.location_lat && zone.location_lng) {
        if (isInsideGeofence(userLat, userLng, zone as GeofenceZone)) {
          matched = true
          dist = calculateDistance(userLat, userLng, zone.location_lat, zone.location_lng)
        }
      }

      if (matched && !matchedIds.has(zone.id)) {
        matchedIds.add(zone.id)
        matches.push({ zone, distance: dist })
      }
    }
    
    // Sort so the most *specific* zone appears first:
    //  1. Child zones (have parent_zone_id) before parent/jurisdiction zones
    //  2. Non-general zone_type before general
    //  3. Smaller radius before larger
    //  4. Closer distance to centre as tie-breaker
    matches.sort((a, b) => {
      const aIsChild = a.zone.parent_zone_id ? 0 : 1
      const bIsChild = b.zone.parent_zone_id ? 0 : 1
      if (aIsChild !== bIsChild) return aIsChild - bIsChild

      const aIsGeneral = a.zone.zone_type === 'general' ? 1 : 0
      const bIsGeneral = b.zone.zone_type === 'general' ? 1 : 0
      if (aIsGeneral !== bIsGeneral) return aIsGeneral - bIsGeneral

      const aRadius = a.zone.radius_meters || 500
      const bRadius = b.zone.radius_meters || 500
      if (aRadius !== bRadius) return aRadius - bRadius

      return a.distance - b.distance
    })
    
    return matches.map((m) => m.zone) as GeofenceZone[]
  } catch (error: any) {
    console.error('Geofence detection error:', error)
    return []
  }
}

async function logOfficerGpsUpdate(
  userId: string,
  gpsLat: number,
  gpsLng: number,
  gpsAccuracy: number,
  activityType = 'gps_update'
): Promise<void> {
  try {
    const { error } = await (supabase as any).rpc('log_officer_gps_update', {
      p_user_id: userId,
      p_latitude: gpsLat,
      p_longitude: gpsLng,
      p_accuracy: gpsAccuracy,
      p_activity_type: activityType,
    })

    if (error) {
      console.warn('GPS activity logging failed:', error)
    }
  } catch (error) {
    console.warn('GPS activity logging exception:', error)
  }
}

async function getOfficerActivePatrols(userId: string, organizationScope?: string | string[]): Promise<ActivePatrol[]> {
  try {
    const { data, error } = await (supabase as any).rpc('get_officer_active_patrols', {
      p_officer_id: userId,
    })

    if (error) {
      const isMissingCheckedInColumn =
        error?.code === '42703' && String(error?.message || '').includes('checked_in_at')

      if (!isMissingCheckedInColumn) {
        console.warn('Could not load active patrols for geofence auto-checkin:', error)
        return []
      }

      // Compatibility fallback for tenants with older patrol schema.
      let patrolQuery = (supabase as any)
        .from('patrols')
        .select('id, zone_id, status, completed_at, auto_checkin_enabled, assigned_to')
        .eq('assigned_to', userId)
        .in('status', ['scheduled', 'in_progress'])
        .is('completed_at', null)

      if (Array.isArray(organizationScope) && organizationScope.length > 0) {
        patrolQuery = patrolQuery.in('organization_id', organizationScope)
      } else if (typeof organizationScope === 'string' && organizationScope.length > 0) {
        patrolQuery = patrolQuery.eq('organization_id', organizationScope)
      }

      const { data: patrolRows, error: patrolError } = await patrolQuery

      if (patrolError) {
        console.warn('Fallback patrol lookup failed:', patrolError)
        return []
      }

      const zoneIds = Array.from(new Set((patrolRows || []).map((p: any) => p.zone_id).filter(Boolean)))
      let zoneMap = new Map<string, any>()

      if (zoneIds.length) {
        let zoneQuery = (supabase as any)
          .from('zones')
          .select('id, name, location_lat, location_lng, radius_meters')
          .in('id', zoneIds)

        if (Array.isArray(organizationScope) && organizationScope.length > 0) {
          zoneQuery = zoneQuery.in('organization_id', organizationScope)
        } else if (typeof organizationScope === 'string' && organizationScope.length > 0) {
          zoneQuery = zoneQuery.eq('organization_id', organizationScope)
        }

        const { data: zoneRows, error: zoneError } = await zoneQuery

        if (!zoneError) {
          zoneMap = new Map((zoneRows || []).map((z: any) => [z.id, z]))
        } else if (zoneError.code === '42703' && String(zoneError.message || '').includes('radius_meters')) {
          let zoneFallbackQuery = (supabase as any)
            .from('zones')
            .select('id, name, location_lat, location_lng')
            .in('id', zoneIds)

          if (Array.isArray(organizationScope) && organizationScope.length > 0) {
            zoneFallbackQuery = zoneFallbackQuery.in('organization_id', organizationScope)
          } else if (typeof organizationScope === 'string' && organizationScope.length > 0) {
            zoneFallbackQuery = zoneFallbackQuery.eq('organization_id', organizationScope)
          }

          const { data: zoneRowsNoRadius } = await zoneFallbackQuery
          zoneMap = new Map((zoneRowsNoRadius || []).map((z: any) => [z.id, { ...z, radius_meters: null }]))
        }
      }

      return (patrolRows || []).map((p: any) => {
        const z = zoneMap.get(p.zone_id)
        return {
          patrol_id: p.id,
          zone_id: p.zone_id,
          zone_name: z?.name || 'Unknown Zone',
          geofence_radius: z?.radius_meters ?? null,
          auto_checkin_enabled: p.auto_checkin_enabled ?? true,
          status: p.status,
          checked_in_at: null,
          completed_at: p.completed_at ?? null,
          zone_center_lat: z?.location_lat ?? null,
          zone_center_lng: z?.location_lng ?? null,
        } as ActivePatrol
      })
    }

    return (data || []) as ActivePatrol[]
  } catch (error) {
    console.warn('Active patrol lookup failed:', error)
    return []
  }
}

function findPatrolInGeofence(
  patrols: ActivePatrol[],
  userLat: number,
  userLng: number
): ActivePatrol | null {
  const candidates = patrols
    .map((patrol) => {
      if (!patrol.zone_center_lat || !patrol.zone_center_lng) return null
      const distance = calculateDistance(
        userLat,
        userLng,
        Number(patrol.zone_center_lat),
        Number(patrol.zone_center_lng)
      )
      const radius = patrol.geofence_radius || 100
      return distance <= radius ? { patrol, distance } : null
    })
    .filter((v): v is { patrol: ActivePatrol; distance: number } => v !== null)
    .sort((a, b) => a.distance - b.distance)

  return candidates[0]?.patrol || null
}

async function rpcPatrolAutoCheckin(patrolId: string, gpsLat: number, gpsLng: number): Promise<void> {
  try {
    const { data, error } = await (supabase as any).rpc('patrol_auto_checkin_verified', {
      p_patrol_id: patrolId,
      p_gps_lat: gpsLat,
      p_gps_lng: gpsLng,
    })

    const missingVerifiedRpc = error?.code === '42883'

    if (missingVerifiedRpc) {
      const legacy = await (supabase as any).rpc('patrol_auto_checkin', {
        p_patrol_id: patrolId,
        p_gps_lat: gpsLat,
        p_gps_lng: gpsLng,
      })

      if (legacy.error) {
        console.warn('patrol_auto_checkin fallback failed:', legacy.error)
        return
      }

      if (legacy.data?.success) {
        toast.success(legacy.data?.message || 'Patrol auto sign-on completed')
      }
      return
    }

    if (error) {
      console.warn('patrol_auto_checkin_verified failed:', error)
      return
    }

    if (data?.success) {
      toast.success(data?.message || 'Patrol auto sign-on verified')
    }
  } catch (error) {
    console.warn('patrol_auto_checkin_verified exception:', error)
  }
}

async function rpcPatrolAutoCheckout(patrolId: string, gpsLat: number, gpsLng: number): Promise<void> {
  try {
    const { data, error } = await (supabase as any).rpc('patrol_auto_checkout_verified', {
      p_patrol_id: patrolId,
      p_gps_lat: gpsLat,
      p_gps_lng: gpsLng,
    })

    const missingVerifiedRpc = error?.code === '42883'

    if (missingVerifiedRpc) {
      const legacy = await (supabase as any).rpc('patrol_auto_checkout', {
        p_patrol_id: patrolId,
      })

      if (legacy.error) {
        console.warn('patrol_auto_checkout fallback failed:', legacy.error)
        return
      }

      if (legacy.data?.success) {
        toast.info(legacy.data?.message || 'Patrol auto sign-off completed')
      }
      return
    }

    if (error) {
      console.warn('patrol_auto_checkout_verified failed:', error)
      return
    }

    if (data?.success) {
      toast.info(data?.message || 'Patrol auto sign-off verified')
    }
  } catch (error) {
    console.warn('patrol_auto_checkout_verified exception:', error)
  }
}

/**
 * Detect the current shift based on the NZ timezone (Pacific/Auckland).
 * Shift boundaries:
 *   day     06:00–13:59
 *   evening 14:00–21:59
 *   night   22:00–05:59
 */
function detectShift(): 'day' | 'evening' | 'night' {
  const nzDate = toZonedTime(new Date(), 'Pacific/Auckland')
  const hour = nzDate.getHours()
  if (hour >= 6 && hour < 14) return 'day'
  if (hour >= 14 && hour < 22) return 'evening'
  return 'night'
}

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
      .eq('organization_id', organizationId)
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
        shift: detectShift(),
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
  zoneId: string,
  organizationId?: string
): Promise<{ success: boolean }> {
  try {
    // Find active patrol
    let patrolQuery = (supabase.from('patrols') as any)
      .select('id')
      .eq('assigned_to', userId)
      .eq('zone_id', zoneId)
      .eq('patrol_date', new Date().toISOString().split('T')[0])
      .eq('status', 'in_progress')

    if (organizationId) {
      patrolQuery = patrolQuery.eq('organization_id', organizationId)
    }

    const { data: patrol, error: findError } = await patrolQuery.maybeSingle()
    
    if (findError) throw findError
    if (!patrol) {
      console.log('No active patrol to stop')
      return { success: true }
    }
    
    // Update patrol to completed
    let updateQuery = (supabase.from('patrols') as any)
      .update({
        ended_at: new Date().toISOString(),
        status: 'completed',
      })
      .eq('id', patrol.id)

    if (organizationId) {
      updateQuery = updateQuery.eq('organization_id', organizationId)
    }

    const { error: updateError } = await updateQuery
    
    if (updateError) throw updateError
    
    toast.info('Patrol completed (left geofence)')
    return { success: true }
  } catch (error: any) {
    console.error('Auto-stop patrol error:', error)
    toast.error('Failed to stop patrol automatically')
    return { success: false }
  }
}

/**
 * Monitor GPS location and manage patrol status
 * Call this function every 30 seconds while app is active
 */
export async function monitorGeofenceAndPatrol(
  userId: string,
  organizationScope: string | string[],
  currentZoneId: string | null,
  onZoneChange: (zoneId: string | null, zoneName: string | null, organizationId?: string | null) => void,
  options?: MonitorOptions
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
    const userAccuracy = position.coords.accuracy || 0

    options?.onLocationUpdate?.({
      latitude: userLat,
      longitude: userLng,
      accuracy: userAccuracy,
    })

    await logOfficerGpsUpdate(
      userId,
      userLat,
      userLng,
      userAccuracy,
      options?.activityType || 'gps_update'
    )

    const activePatrols = await getOfficerActivePatrols(userId, organizationScope)
    const inProgressPatrol = activePatrols.find(
      (patrol) => patrol.status === 'in_progress' && !patrol.completed_at
    ) || null
    const patrolInGeofence = findPatrolInGeofence(activePatrols, userLat, userLng)

    if (patrolInGeofence) {
      if (inProgressPatrol && inProgressPatrol.patrol_id !== patrolInGeofence.patrol_id) {
        await rpcPatrolAutoCheckout(inProgressPatrol.patrol_id, userLat, userLng)
      }

      const canAutoCheckin = patrolInGeofence.auto_checkin_enabled !== false
      const needsCheckin = !patrolInGeofence.checked_in_at || patrolInGeofence.status === 'scheduled'

      if (canAutoCheckin && needsCheckin) {
        await rpcPatrolAutoCheckin(patrolInGeofence.patrol_id, userLat, userLng)
      }

      if (patrolInGeofence.zone_id !== currentZoneId) {
        onZoneChange(patrolInGeofence.zone_id, patrolInGeofence.zone_name)
      }
      return
    }

    if (inProgressPatrol) {
      await rpcPatrolAutoCheckout(inProgressPatrol.patrol_id, userLat, userLng)
    }
    
    // Detect current zones
    const zones = await detectCurrentZones(userLat, userLng, organizationScope)
    
    if (zones.length > 0) {
      // Inside a geofence
      const primaryZone = zones[0] // Use first detected zone
      
      if (primaryZone.id !== currentZoneId) {
        if (activePatrols.length === 0) {
          // Legacy fallback: for tenants not using scheduled patrol assignments
          if (currentZoneId) {
            const scopedOrgId = typeof organizationScope === 'string' ? organizationScope : undefined
            await autoStopPatrol(userId, currentZoneId, scopedOrgId)
          }
          await autoStartPatrol(userId, primaryZone.id, primaryZone.organization_id, userLat, userLng)
        }

        onZoneChange(primaryZone.id, primaryZone.name, primaryZone.organization_id)
      }
    } else {
      // Outside all geofences
      if (currentZoneId) {
        if (activePatrols.length === 0) {
          const scopedOrgId = typeof organizationScope === 'string' ? organizationScope : undefined
          await autoStopPatrol(userId, currentZoneId, scopedOrgId)
        }
        onZoneChange(null, 'Other Location', null)
      } else if (options?.currentZoneName !== 'Other Location') {
        onZoneChange(null, 'Other Location', null)
      }
    }
  } catch (error: any) {
    console.error('Geofence monitoring error:', error)
  }
}

// ── Patrol Location Event helpers ────────────────────────────────────────────
// These functions record onsite/offsite transitions in patrol_location_events
// for audit trail and KPI calculation.

export interface PatrolLocationEventParams {
  patrolId: string
  organizationId: string
  officerId: string
  eventType: 'onsite' | 'offsite' | 'override_onsite' | 'override_offsite'
  gpsLat?: number | null
  gpsLng?: number | null
  gpsAccuracyM?: number | null
  isManualOverride?: boolean
  overrideReason?: string | null
}

/**
 * Insert a patrol_location_event row (onsite/offsite/override).
 * Call this whenever the officer crosses a geofence boundary or manually
 * confirms their location.
 */
export async function recordPatrolLocationEvent(
  params: PatrolLocationEventParams,
): Promise<void> {
  try {
    const { error } = await (supabase as any).from('patrol_location_events').insert({
      patrol_id: params.patrolId,
      organization_id: params.organizationId,
      officer_id: params.officerId,
      event_type: params.eventType,
      gps_lat: params.gpsLat ?? null,
      gps_lng: params.gpsLng ?? null,
      gps_accuracy_m: params.gpsAccuracyM ?? null,
      is_manual_override: params.isManualOverride ?? false,
      override_reason: params.overrideReason ?? null,
    })
    if (error) {
      console.warn('patrol_location_events insert failed:', error)
    }
  } catch (err) {
    console.warn('patrol_location_events exception:', err)
  }
}

/**
 * Determine whether a patrol zone has any geofence configured.
 * Returns false if neither geometry nor radius_meters is set.
 */
export function zoneHasGeofence(zone: GeofenceZone | null | undefined): boolean {
  if (!zone) return false
  if (zone.radius_meters && zone.radius_meters > 0) return true
  if (zone.geometry) {
    const geo = zone.geometry as any
    if (geo?.type && (geo.coordinates?.length > 0 || geo.features?.length > 0)) return true
  }
  // A zone with only a centre point still supports geofencing via the default 100 m radius.
  if (zone.location_lat && zone.location_lng) return true
  return false
}

/**
 * Enhanced geofence monitor that also:
 * - Records onsite/offsite events in patrol_location_events
 * - Calls onOffsiteDetected when officer leaves the patrol zone
 * - Passes hasGeofence=false to caller when zone has no geofence configured
 */
export interface EnhancedMonitorOptions extends MonitorOptions {
  organizationId?: string | null
  /** Active patrol id — used to associate location events */
  patrolId?: string | null
  /** Called when officer moves outside the patrol zone */
  onOffsiteDetected?: (patrolId: string) => void
  /** Called when officer re-enters the patrol zone */
  onOnsiteDetected?: (patrolId: string) => void
  /** Called to indicate whether the active zone has a geofence configured */
  onGeofenceAvailability?: (hasGeofence: boolean) => void
  /** Track previous inside/outside state per patrolId to avoid duplicate events */
  insideStateRef?: { current: Record<string, boolean> }
}

export async function monitorGeofenceAndPatrolEnhanced(
  userId: string,
  organizationScope: string | string[],
  currentZoneId: string | null,
  onZoneChange: (zoneId: string | null, zoneName: string | null, organizationId?: string | null) => void,
  options?: EnhancedMonitorOptions,
): Promise<void> {
  await monitorGeofenceAndPatrol(userId, organizationScope, currentZoneId, onZoneChange, options)

  // Enhanced: also detect offsite transitions and record location events
  if (!options?.patrolId || !options?.organizationId) return

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      })
    })

    const userLat = position.coords.latitude
    const userLng = position.coords.longitude
    const userAccuracy = position.coords.accuracy || 0

    const activePatrols = await getOfficerActivePatrols(userId, organizationScope)
    const patrolInGeofence = findPatrolInGeofence(activePatrols, userLat, userLng)
    const targetPatrol = activePatrols.find((p) => p.patrol_id === options.patrolId)

    if (!targetPatrol) return

    const patrolHasGeofence = zoneHasGeofence({
      id: targetPatrol.patrol_id,
      name: targetPatrol.zone_name || '',
      organization_id: '',
      location_lat: targetPatrol.zone_center_lat ?? 0,
      location_lng: targetPatrol.zone_center_lng ?? 0,
      radius_meters: targetPatrol.geofence_radius ?? undefined,
    })
    options.onGeofenceAvailability?.(patrolHasGeofence)

    const isCurrentlyInside = patrolInGeofence?.patrol_id === options.patrolId
    const stateRef = options.insideStateRef
    const prevInside = stateRef ? stateRef.current[options.patrolId] : undefined

    if (stateRef) {
      stateRef.current[options.patrolId] = isCurrentlyInside
    }

    // Only emit events when state changes to avoid duplicates
    if (prevInside === undefined) return

    if (!prevInside && isCurrentlyInside) {
      // Transitioned onsite
      options.onOnsiteDetected?.(options.patrolId)
      await recordPatrolLocationEvent({
        patrolId: options.patrolId,
        organizationId: options.organizationId,
        officerId: userId,
        eventType: 'onsite',
        gpsLat: userLat,
        gpsLng: userLng,
        gpsAccuracyM: userAccuracy,
      })
    } else if (prevInside && !isCurrentlyInside) {
      // Transitioned offsite
      options.onOffsiteDetected?.(options.patrolId)
      await recordPatrolLocationEvent({
        patrolId: options.patrolId,
        organizationId: options.organizationId,
        officerId: userId,
        eventType: 'offsite',
        gpsLat: userLat,
        gpsLng: userLng,
        gpsAccuracyM: userAccuracy,
      })
    }
  } catch {
    // GPS failure is handled silently — already reported by the base monitor
  }
}
