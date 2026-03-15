/**
 * Geofence Utilities
 * 
 * Functions for automatic zone detection and patrol management based on GPS location
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
 * Find all zones the user is currently inside
 */
export async function detectCurrentZones(
  userLat: number,
  userLng: number,
  organizationId?: string
): Promise<GeofenceZone[]> {
  try {
    // Fetch all active zones
    let query = (supabase.from('zones') as any)
      .select('id, name, location_lat, location_lng, geometry')
      .eq('is_active', true)
    
    if (organizationId) {
      query = query.eq('organization_id', organizationId)
    }
    
    const { data: zones, error } = await query
    
    if (error) throw error
    if (!zones) return []
    
    // Filter zones by distance
    const nearbyZones = zones.filter((zone) => {
      if (!zone.location_lat || !zone.location_lng) return false
      return isInsideGeofence(userLat, userLng, zone as GeofenceZone)
    })
    
    return nearbyZones as GeofenceZone[]
  } catch (error: any) {
    console.error('Geofence detection error:', error)
    return []
  }
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

/**
 * Monitor GPS location and manage patrol status
 * Call this function every 30 seconds while app is active
 */
export async function monitorGeofenceAndPatrol(
  userId: string,
  organizationId: string,
  currentZoneId: string | null,
  onZoneChange: (zoneId: string | null, zoneName: string | null) => void
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
    
    // Detect current zones
    const zones = await detectCurrentZones(userLat, userLng, organizationId)
    
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
