/**
 * Utility Library: vehicleAnalysis
 * Advanced vehicle analytics and pattern detection
 */

import { supabase } from './supabase'
import type { Database } from '@/types/database'

// Type aliases for query results
type Observation = Database['public']['Tables']['observations']['Row']
type Zone = Database['public']['Tables']['zones']['Row']

// Partial types for specific query selections
type ObservationCompliance = Pick<Observation, 'is_compliant' | 'breach_type' | 'zone_id' | 'recorded_at'>
type ObservationMovement = Pick<Observation, 'zone_id' | 'recorded_at'> & { zones: Pick<Zone, 'name'> | null }
type ObservationBreach = Pick<Observation, 'plate_number' | 'is_compliant' | 'breach_type' | 'recorded_at'>
type ObservationNight = Pick<Observation, 'plate_number' | 'recorded_at'>
type ObservationZone = Pick<Observation, 'plate_number' | 'zone_id' | 'recorded_at'>

interface VehiclePattern {
  plate_number: string
  pattern_type: 'frequent_visitor' | 'zone_hopper' | 'repeat_offender' | 'night_stay_only' | 'homeless_candidate'
  confidence: number
  evidence: any
  first_detected: string
  last_detected: string
}

interface VehicleCompliance {
  plate_number: string
  total_observations: number
  compliant_observations: number
  breach_count: number
  compliance_rate: number
  breach_types: Record<string, number>
  zones_visited: string[]
  first_seen: string
  last_seen: string
}

interface VehicleMovementPattern {
  plate_number: string
  zones_visited: Array<{
    zone_id: string
    zone_name: string
    visit_count: number
    last_visit: string
  }>
  movement_frequency: 'stationary' | 'occasional' | 'frequent' | 'nomadic'
  average_days_between_moves: number
}

/**
 * Analyze vehicle compliance history
 */
export async function analyzeVehicleCompliance(
  plateNumber: string,
  organizationId?: string
): Promise<VehicleCompliance | null> {
  let query = supabase
    .from('observations')
    .select('is_compliant, breach_type, zone_id, recorded_at')
    .eq('plate_number', plateNumber)
    .order('recorded_at', { ascending: true })

  if (organizationId) {
    query = query.eq('organization_id', organizationId)
  }

  const { data, error } = await query

  if (error || !data || data.length === 0) {
    console.error('Failed to analyze vehicle compliance:', error)
    return null
  }

  const typedData = data as ObservationCompliance[]

  // Calculate compliance metrics
  const total = typedData.length
  const compliant = typedData.filter(obs => obs.is_compliant).length
  const breaches = typedData.filter(obs => !obs.is_compliant)

  // Count breach types
  const breachTypes: Record<string, number> = {}
  breaches.forEach(breach => {
    if (breach.breach_type) {
      breachTypes[breach.breach_type] = (breachTypes[breach.breach_type] || 0) + 1
    }
  })

  // Get unique zones
  const zonesVisited = [...new Set(typedData.map(obs => obs.zone_id).filter(Boolean))]

  return {
    plate_number: plateNumber,
    total_observations: total,
    compliant_observations: compliant,
    breach_count: breaches.length,
    compliance_rate: (compliant / total) * 100,
    breach_types: breachTypes,
    zones_visited: zonesVisited,
    first_seen: typedData[0].recorded_at,
    last_seen: typedData[typedData.length - 1].recorded_at,
  }
}

/**
 * Detect vehicle movement patterns
 */
export async function analyzeMovementPattern(
  plateNumber: string,
  organizationId?: string
): Promise<VehicleMovementPattern | null> {
  let query = supabase
    .from('observations')
    .select(`
      zone_id,
      recorded_at,
      zones!observations_zone_id_fkey (name)
    `)
    .eq('plate_number', plateNumber)
    .order('recorded_at', { ascending: true })

  if (organizationId) {
    query = query.eq('organization_id', organizationId)
  }

  const { data, error } = await query

  if (error || !data || data.length === 0) {
    console.error('Failed to analyze movement pattern:', error)
    return null
  }

  const typedData = data as ObservationMovement[]

  // Group by zone
  const zoneVisits: Record<string, { count: number; lastVisit: string; name: string }> = {}
  
  typedData.forEach(obs => {
    if (!obs.zone_id) return
    
    if (!zoneVisits[obs.zone_id]) {
      zoneVisits[obs.zone_id] = {
        count: 0,
        lastVisit: obs.recorded_at,
        name: obs.zones?.name || 'Unknown',
      }
    }
    
    zoneVisits[obs.zone_id].count++
    zoneVisits[obs.zone_id].lastVisit = obs.recorded_at
  })

  // Calculate average days between moves
  const dates = typedData.map(obs => new Date(obs.recorded_at).getTime())
  const daysBetweenMoves = []
  
  for (let i = 1; i < dates.length; i++) {
    const daysDiff = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24)
    daysBetweenMoves.push(daysDiff)
  }
  
  const avgDaysBetweenMoves = daysBetweenMoves.length > 0
    ? daysBetweenMoves.reduce((a, b) => a + b, 0) / daysBetweenMoves.length
    : 0

  // Determine movement frequency
  let movementFrequency: 'stationary' | 'occasional' | 'frequent' | 'nomadic' = 'stationary'
  
  if (Object.keys(zoneVisits).length === 1) {
    movementFrequency = 'stationary'
  } else if (avgDaysBetweenMoves > 7) {
    movementFrequency = 'occasional'
  } else if (avgDaysBetweenMoves > 2) {
    movementFrequency = 'frequent'
  } else {
    movementFrequency = 'nomadic'
  }

  return {
    plate_number: plateNumber,
    zones_visited: Object.entries(zoneVisits).map(([zoneId, data]) => ({
      zone_id: zoneId,
      zone_name: data.name,
      visit_count: data.count,
      last_visit: data.lastVisit,
    })),
    movement_frequency: movementFrequency,
    average_days_between_moves: avgDaysBetweenMoves,
  }
}

/**
 * Detect repeat offenders (multiple breaches)
 */
export async function detectRepeatOffenders(
  organizationId: string,
  minBreaches: number = 3,
  dateFrom?: string,
  dateTo?: string
): Promise<VehiclePattern[]> {
  let query = supabase
    .from('observations')
    .select('plate_number, is_compliant, breach_type, recorded_at')
    .eq('organization_id', organizationId)
    .eq('is_compliant', false)

  if (dateFrom) query = query.gte('recorded_at', dateFrom)
  if (dateTo) query = query.lte('recorded_at', dateTo)

  const { data, error } = await query

  if (error || !data) {
    console.error('Failed to detect repeat offenders:', error)
    return []
  }

  const typedData = data as ObservationBreach[]

  // Group by plate number
  const breachCounts: Record<string, { count: number; types: string[]; dates: string[] }> = {}
  
  typedData.forEach(obs => {
    if (!breachCounts[obs.plate_number]) {
      breachCounts[obs.plate_number] = { count: 0, types: [], dates: [] }
    }
    breachCounts[obs.plate_number].count++
    if (obs.breach_type) breachCounts[obs.plate_number].types.push(obs.breach_type)
    breachCounts[obs.plate_number].dates.push(obs.recorded_at)
  })

  // Filter and format results
  const patterns: VehiclePattern[] = []
  
  for (const [plateNumber, data] of Object.entries(breachCounts)) {
    if (data.count >= minBreaches) {
      patterns.push({
        plate_number: plateNumber,
        pattern_type: 'repeat_offender',
        confidence: Math.min(data.count / 10, 1), // Higher breach count = higher confidence
        evidence: {
          breach_count: data.count,
          breach_types: [...new Set(data.types)],
        },
        first_detected: data.dates[0],
        last_detected: data.dates[data.dates.length - 1],
      })
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Detect homeless candidates (frequent overnight stays)
 */
export async function detectHomelessCandidates(
  organizationId: string,
  minNights: number = 5
): Promise<VehiclePattern[]> {
  const { data, error } = await supabase
    .from('observations')
    .select('plate_number, recorded_at')
    .eq('organization_id', organizationId)
    .order('recorded_at', { ascending: true })

  if (error || !data) {
    console.error('Failed to detect homeless candidates:', error)
    return []
  }

  const typedData = data as ObservationNight[]

  // Group by plate number and count overnight observations
  const nightCounts: Record<string, { count: number; dates: string[] }> = {}
  
  typedData.forEach(obs => {
    const hour = new Date(obs.recorded_at).getHours()
    
    // Count observations between 10pm and 6am as overnight
    if (hour >= 22 || hour <= 6) {
      if (!nightCounts[obs.plate_number]) {
        nightCounts[obs.plate_number] = { count: 0, dates: [] }
      }
      nightCounts[obs.plate_number].count++
      nightCounts[obs.plate_number].dates.push(obs.recorded_at)
    }
  })

  // Filter and format results
  const patterns: VehiclePattern[] = []
  
  for (const [plateNumber, data] of Object.entries(nightCounts)) {
    if (data.count >= minNights) {
      patterns.push({
        plate_number: plateNumber,
        pattern_type: 'homeless_candidate',
        confidence: Math.min(data.count / 20, 1),
        evidence: {
          overnight_count: data.count,
        },
        first_detected: data.dates[0],
        last_detected: data.dates[data.dates.length - 1],
      })
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Detect zone hoppers (frequent zone changes)
 */
export async function detectZoneHoppers(
  organizationId: string,
  minZones: number = 3
): Promise<VehiclePattern[]> {
  const { data, error } = await supabase
    .from('observations')
    .select('plate_number, zone_id, recorded_at')
    .eq('organization_id', organizationId)
    .order('recorded_at', { ascending: true })

  if (error || !data) {
    console.error('Failed to detect zone hoppers:', error)
    return []
  }

  const typedData = data as ObservationZone[]

  // Group by plate number
  const zoneVisits: Record<string, { zones: Set<string>; dates: string[] }> = {}
  
  typedData.forEach(obs => {
    if (!zoneVisits[obs.plate_number]) {
      zoneVisits[obs.plate_number] = { zones: new Set(), dates: [] }
    }
    if (obs.zone_id) {
      zoneVisits[obs.plate_number].zones.add(obs.zone_id)
    }
    zoneVisits[obs.plate_number].dates.push(obs.recorded_at)
  })

  // Filter and format results
  const patterns: VehiclePattern[] = []
  
  for (const [plateNumber, data] of Object.entries(zoneVisits)) {
    if (data.zones.size >= minZones) {
      patterns.push({
        plate_number: plateNumber,
        pattern_type: 'zone_hopper',
        confidence: Math.min(data.zones.size / 10, 1),
        evidence: {
          zones_visited: data.zones.size,
        },
        first_detected: data.dates[0],
        last_detected: data.dates[data.dates.length - 1],
      })
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Get vehicle stay duration analysis
 */
export async function analyzeStayDuration(
  plateNumber: string,
  organizationId?: string
): Promise<{
  average_stay_hours: number
  longest_stay_hours: number
  shortest_stay_hours: number
  total_stays: number
} | null> {
  // This would require more sophisticated gap analysis
  // For now, return basic placeholder
  return {
    average_stay_hours: 0,
    longest_stay_hours: 0,
    shortest_stay_hours: 0,
    total_stays: 0,
  }
}

/**
 * Get vehicle behavioral score (0-100)
 */
export async function calculateBehavioralScore(
  plateNumber: string,
  organizationId?: string
): Promise<number> {
  const compliance = await analyzeVehicleCompliance(plateNumber, organizationId)
  
  if (!compliance) return 50 // Default neutral score

  // Score based on compliance rate
  return Math.round(compliance.compliance_rate)
}
