/**
 * Geofencing Utilities
 * Point-in-polygon and distance calculations
 */

export interface Coordinate {
  latitude: number
  longitude: number
}

export interface GeoCircle {
  center: Coordinate
  radius: number // in meters
}

export interface GeoPolygon {
  coordinates: Coordinate[]
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * Returns distance in meters
 */
export function calculateDistance(point1: Coordinate, point2: Coordinate): number {
  const R = 6371e3 // Earth radius in meters
  const φ1 = (point1.latitude * Math.PI) / 180
  const φ2 = (point2.latitude * Math.PI) / 180
  const Δφ = ((point2.latitude - point1.latitude) * Math.PI) / 180
  const Δλ = ((point2.longitude - point1.longitude) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Distance in meters
}

/**
 * Check if point is within a circular geofence
 */
export function isPointInCircle(point: Coordinate, circle: GeoCircle): boolean {
  const distance = calculateDistance(point, circle.center)
  return distance <= circle.radius
}

/**
 * Check if point is within a polygon using ray-casting algorithm
 */
export function isPointInPolygon(point: Coordinate, polygon: GeoPolygon): boolean {
  const { latitude, longitude } = point
  const vertices = polygon.coordinates
  let inside = false

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].longitude
    const yi = vertices[i].latitude
    const xj = vertices[j].longitude
    const yj = vertices[j].latitude

    const intersect =
      yi > latitude !== yj > latitude &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi

    if (intersect) inside = !inside
  }

  return inside
}

/**
 * Find nearest zone to a given point
 */
export function findNearestZone(
  point: Coordinate,
  zones: Array<{
    id: string
    name: string
    center: Coordinate
    geofence_type: 'circle' | 'polygon'
    geofence_radius?: number
    geofence?: GeoPolygon
  }>
): { zoneId: string; zoneName: string; distance: number } | null {
  let nearest: { zoneId: string; zoneName: string; distance: number } | null = null

  for (const zone of zones) {
    const distance = calculateDistance(point, zone.center)
    
    if (!nearest || distance < nearest.distance) {
      nearest = {
        zoneId: zone.id,
        zoneName: zone.name,
        distance
      }
    }
  }

  return nearest
}

/**
 * Check if point is within any zone and return matching zones
 */
export function findMatchingZones(
  point: Coordinate,
  zones: Array<{
    id: string
    name: string
    center: Coordinate
    geofence_type: 'circle' | 'polygon'
    geofence_radius?: number
    geofence?: GeoPolygon
  }>
): Array<{ zoneId: string; zoneName: string }> {
  const matches: Array<{ zoneId: string; zoneName: string }> = []

  for (const zone of zones) {
    let isInside = false

    if (zone.geofence_type === 'circle' && zone.geofence_radius) {
      isInside = isPointInCircle(point, {
        center: zone.center,
        radius: zone.geofence_radius
      })
    } else if (zone.geofence_type === 'polygon' && zone.geofence) {
      isInside = isPointInPolygon(point, zone.geofence)
    }

    if (isInside) {
      matches.push({
        zoneId: zone.id,
        zoneName: zone.name
      })
    }
  }

  return matches
}

/**
 * Calculate center point of polygon
 */
export function calculatePolygonCenter(polygon: GeoPolygon): Coordinate {
  const coords = polygon.coordinates
  const sumLat = coords.reduce((sum, coord) => sum + coord.latitude, 0)
  const sumLng = coords.reduce((sum, coord) => sum + coord.longitude, 0)
  
  return {
    latitude: sumLat / coords.length,
    longitude: sumLng / coords.length
  }
}

/**
 * Calculate bounding box of polygon
 */
export function calculateBounds(polygon: GeoPolygon): {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
} {
  const coords = polygon.coordinates
  
  return {
    minLat: Math.min(...coords.map(c => c.latitude)),
    maxLat: Math.max(...coords.map(c => c.latitude)),
    minLng: Math.min(...coords.map(c => c.longitude)),
    maxLng: Math.max(...coords.map(c => c.longitude))
  }
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`
  }
  return `${(meters / 1000).toFixed(1)}km`
}

/**
 * Validate GPS coordinates
 */
export function validateCoordinates(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

/**
 * Get location confidence based on GPS accuracy
 */
export function getLocationConfidence(accuracyMeters: number): 'high' | 'medium' | 'low' {
  if (accuracyMeters <= 15) return 'high'
  if (accuracyMeters <= 50) return 'medium'
  return 'low'
}
