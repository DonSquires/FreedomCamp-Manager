/**
 * dispatchAssignment — Polygon-based dispatch resource selection service
 *
 * Given a Location of Interest (lat/lng), a job type code, and the time of
 * dispatch, this module selects the best DispatchResource (patrol run /
 * callsign) to handle the job.
 *
 * Algorithm (see docs/DISPATCH_SCHEDULING_ARCHITECTURE.md §6):
 *   1. Find all Zone geofences that contain the LOI point.
 *   2. For each matching zone, load zone_dispatch_resource_rules filtered by
 *      job_type_code, day_of_week, and time window.
 *   3. Filter to DispatchResources that are active and on-shift at dispatch time.
 *   4. Rank by rule priority (lower = higher priority), then by resource type.
 *   5. Return the top candidate (or null → manual assignment required).
 *
 * All database calls are wrapped in try/catch so a lookup failure degrades
 * gracefully to manual dispatch rather than blocking job creation.
 */

import { supabase } from '@/lib/supabase'
import { isPointInLoiGeofence, type GeoJsonPolygon } from '@/lib/loiGeofence'
import { calculateDistance } from '@/lib/geofence'

// ── Types ──────────────────────────────────────────────────────────────────

/** Minimal LOI data needed for dispatch assignment */
export interface LoiForDispatch {
  id: string
  gps_lat: number | null
  gps_lng: number | null
  /** Pre-computed geofence polygon stored on the LOI record */
  geofence_geometry?: GeoJsonPolygon | null
}

/** A candidate patrol run / callsign returned by the selector */
export interface DispatchResourceCandidate {
  dispatch_resource_id: string
  callsign: string
  display_name: string
  resource_type: string
  /** True when this resource accepts automatic job assignment */
  auto_dispatch_enabled: boolean
  /** How this candidate was selected */
  selection_reason: 'zone_rule' | 'fallback_radius' | 'manual'
  /** Rule priority that caused selection (lower = higher priority) */
  rule_priority: number
}

/** Reason why automatic resource selection returned no candidate */
export type DispatchFailureReason =
  | 'no_gps'               // Job has no GPS coordinates — cannot do zone matching
  | 'no_matching_zone'     // Job GPS found but no zone polygon contains it
  | 'no_available_resource' // Zones matched but no eligible resource found
  | 'network_error'        // Supabase query failed

/** Typed result returned by selectDispatchResourceWithReason */
export interface DispatchSelectionResult {
  candidate: DispatchResourceCandidate | null
  failureReason?: DispatchFailureReason
}

/** Context provided to the selector */
export interface DispatchJobContext {
  /** ISO job type code (e.g. 'noise_complaint', 'alarm_response') */
  job_type_code: string
  /** Dispatch time (defaults to now() if omitted) */
  dispatch_at?: Date
  organization_id: string
}

// ── Internal zone/rule types ───────────────────────────────────────────────

interface ZoneRow {
  id: string
  name: string
  location_lat: number | null
  location_lng: number | null
  radius_meters: number | null
  geometry: GeoJsonPolygon | null
}

interface ResourceRuleRow {
  dispatch_resource_id: string
  priority: number
  job_type_code: string | null
  day_of_week: number | null
  time_from: string | null   // e.g. "18:00:00"
  time_to:   string | null   // e.g. "06:00:00"
  dispatch_resource: {
    callsign: string
    display_name: string
    resource_type: string
    auto_dispatch_enabled: boolean
    shift_start_time: string | null
    shift_end_time: string | null
    active_days: number[] | null
    is_active: boolean
  } | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a Postgres TIME string ("HH:MM:SS") to total minutes from midnight.
 */
function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map(Number)
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
}

/**
 * Return true when `timeStr` falls within [fromStr, toStr].
 * Handles overnight ranges (e.g. 22:00–06:00) correctly.
 */
function isTimeInWindow(
  timeStr: string,
  fromStr: string | null,
  toStr: string | null,
): boolean {
  if (!fromStr && !toStr) return true       // no restriction

  const current = timeToMinutes(timeStr)
  const from    = fromStr ? timeToMinutes(fromStr) : 0
  const to      = toStr   ? timeToMinutes(toStr)   : 24 * 60 - 1

  if (from <= to) {
    return current >= from && current <= to
  }
  // Overnight window: e.g. 22:00–06:00
  return current >= from || current <= to
}

/**
 * Return true if the dispatch resource is considered on-shift for the given
 * dispatch time, based on its own shift_start_time / shift_end_time and
 * active_days.  Falls back to true when no shift template is configured.
 */
function isResourceOnShift(resource: ResourceRuleRow['dispatch_resource'], at: Date): boolean {
  if (!resource) return false
  if (!resource.is_active) return false

  // ISO weekday: 1=Monday … 7=Sunday
  const dow = at.getDay() === 0 ? 7 : at.getDay()

  if (resource.active_days && resource.active_days.length > 0) {
    if (!resource.active_days.includes(dow)) return false
  }

  if (resource.shift_start_time && resource.shift_end_time) {
    const hh = String(at.getHours()).padStart(2, '0')
    const mm = String(at.getMinutes()).padStart(2, '0')
    const currentTimeStr = `${hh}:${mm}:00`
    if (!isTimeInWindow(currentTimeStr, resource.shift_start_time, resource.shift_end_time)) {
      return false
    }
  }

  return true
}

/**
 * Check whether a lat/lng point is contained in a zone, using the zone's
 * GeoJSON polygon geometry first, then falling back to centre+radius Haversine.
 */
function pointInZone(lat: number, lng: number, zone: ZoneRow): boolean {
  // 1. Polygon geometry (precise boundary)
  if (
    zone.geometry?.type === 'Polygon' &&
    Array.isArray(zone.geometry.coordinates?.[0]) &&
    zone.geometry.coordinates[0].length > 0
  ) {
    return isPointInLoiGeofence(lat, lng, zone.geometry)
  }

  // 2. Centre-point + radius fallback
  if (zone.location_lat != null && zone.location_lng != null) {
    const dist = calculateDistance(lat, lng, zone.location_lat, zone.location_lng)
    const radius = zone.radius_meters ?? 500
    return dist <= radius
  }

  return false
}

// ── Main selector ──────────────────────────────────────────────────────────

/**
 * Select the best DispatchResource for a given LOI and job context.
 *
 * Returns null when no suitable resource is found (manual assignment needed).
 *
 * @param loi     The Location of Interest for the job
 * @param context Job type, dispatch time, and org scope
 */
export async function selectDispatchResource(
  loi: LoiForDispatch,
  context: DispatchJobContext,
): Promise<DispatchResourceCandidate | null> {
  if (loi.gps_lat == null || loi.gps_lng == null) {
    // Without coordinates we cannot do polygon-based selection.
    // Phase 5: suburb/postcode-based fallback (not yet implemented).
    return null
  }

  const dispatchAt = context.dispatch_at ?? new Date()

  try {
    // ── Step 1: Find zones that contain the LOI point ──────────────────────
    // Cast to `any` — query references columns (radius_meters) not yet in DB types
    const { data: zones, error: zonesErr } = await (supabase as any)
      .from('zones')
      .select('id, name, location_lat, location_lng, radius_meters, geometry')
      .eq('organization_id', context.organization_id)
      .eq('is_active', true)

    if (zonesErr) {
      console.warn('[dispatchAssignment] zone lookup failed:', zonesErr)
      return null
    }

    const matchingZoneIds: string[] = (zones ?? [])
      .filter((z: ZoneRow) => pointInZone(loi.gps_lat!, loi.gps_lng!, z))
      .map((z: ZoneRow) => z.id)

    if (matchingZoneIds.length === 0) {
      // Phase 5: suburb/council boundary fallback (not yet implemented)
      return null
    }

    // ── Step 2: Load dispatch resource rules for matching zones ────────────
    // Cast to `any` — query references columns not yet in DB types
    const { data: rules, error: rulesErr } = await (supabase as any)
      .from('zone_dispatch_resource_rules')
      .select(`
        dispatch_resource_id,
        priority,
        job_type_code,
        day_of_week,
        time_from,
        time_to,
        dispatch_resource:dispatch_resources!dispatch_resource_id(
          callsign,
          display_name,
          resource_type,
          auto_dispatch_enabled,
          shift_start_time,
          shift_end_time,
          active_days,
          is_active
        )
      `)
      .in('zone_id', matchingZoneIds)
      .eq('organization_id', context.organization_id)
      .eq('is_active', true)
      .order('priority', { ascending: true })

    if (rulesErr) {
      console.warn('[dispatchAssignment] rules lookup failed:', rulesErr)
      return null
    }

    if (!rules || rules.length === 0) return null

    // ── Step 3: Filter rules by job_type, day-of-week, time window, and shift ─
    const dow = dispatchAt.getDay() === 0 ? 7 : dispatchAt.getDay()
    const hh  = String(dispatchAt.getHours()).padStart(2, '0')
    const mm  = String(dispatchAt.getMinutes()).padStart(2, '0')
    const currentTimeStr = `${hh}:${mm}:00`

    const candidates: DispatchResourceCandidate[] = []

    for (const rule of rules as ResourceRuleRow[]) {
      const res = rule.dispatch_resource
      if (!res || !res.is_active) continue

      // Job type filter (null = all job types)
      if (rule.job_type_code && rule.job_type_code !== context.job_type_code) continue

      // Day-of-week filter (null = all days)
      if (rule.day_of_week != null && rule.day_of_week !== dow) continue

      // Time window filter
      if (!isTimeInWindow(currentTimeStr, rule.time_from, rule.time_to)) continue

      // Resource must be on-shift at dispatch time
      if (!isResourceOnShift(res, dispatchAt)) continue

      candidates.push({
        dispatch_resource_id: rule.dispatch_resource_id,
        callsign:             res.callsign,
        display_name:         res.display_name,
        resource_type:        res.resource_type,
        auto_dispatch_enabled: res.auto_dispatch_enabled,
        selection_reason:     'zone_rule',
        rule_priority:        rule.priority,
      })
    }

    if (candidates.length === 0) return null

    // ── Step 4: Return the highest-priority (lowest priority number) candidate ─
    // Rules are already ordered by priority ASC from the DB query
    return candidates[0]
  } catch (err) {
    console.error('[dispatchAssignment] unexpected error:', err)
    return null
  }
}

/**
 * Check whether an LOI point falls inside any active LOI geofence on record.
 *
 * This is useful for deduplication: before creating a new LOI, check whether
 * the incoming address is already within an existing LOI's geofence.
 *
 * @param lat            Incoming address latitude
 * @param lng            Incoming address longitude
 * @param organizationId Organisation scope
 * @returns The first matching LOI record, or null
 */
export async function findExistingLoiByGeofence(
  lat: number,
  lng: number,
  organizationId: string,
): Promise<{ id: string; display_address: string } | null> {
  // Phase 5: use PostGIS ST_Within when available for server-side filtering.
  // For now, fetch nearby candidates using a bounding-box approximation and
  // then apply the precise polygon check client-side.

  // ~0.009 degrees ≈ 1 km at NZ latitudes — fetch candidates within ~1 km
  const delta = 0.009
  const { data, error } = await supabase
    .from('locations_of_interest')
    .select('id, display_address, gps_lat, gps_lng, geofence_geometry')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .not('gps_lat', 'is', null)
    .gte('gps_lat', lat - delta)
    .lte('gps_lat', lat + delta)
    .gte('gps_lng', lng - delta)
    .lte('gps_lng', lng + delta)

  if (error || !data) return null

  for (const loi of data) {
    if (!loi.geofence_geometry) continue
    try {
      const geomParsed: GeoJsonPolygon = typeof loi.geofence_geometry === 'string' 
        ? JSON.parse(loi.geofence_geometry) 
        : (loi.geofence_geometry as any)
      if (isPointInLoiGeofence(lat, lng, geomParsed)) {
        return { id: loi.id, display_address: loi.display_address }
      }
    } catch (parseErr) {
      console.warn('[dispatchAssignment] failed to parse LOI geofence geometry:', parseErr)
    }
  }

  return null
}

/**
 * Typed wrapper that preserves the existing selection behavior while exposing
 * a machine-readable failure reason for UI fallback messaging.
 */
export async function selectDispatchResourceWithReason(
  loi: LoiForDispatch,
  context: DispatchJobContext,
): Promise<DispatchSelectionResult> {
  if (loi.gps_lat == null || loi.gps_lng == null) {
    return { candidate: null, failureReason: 'no_gps' }
  }

  try {
    const candidate = await selectDispatchResource(loi, context)
    if (candidate) return { candidate }
    return { candidate: null, failureReason: 'no_available_resource' }
  } catch {
    return { candidate: null, failureReason: 'network_error' }
  }
}
