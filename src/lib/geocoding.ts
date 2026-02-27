/**
 * Utility Library: geocoding
 * Reverse geocoding (GPS coordinates to address)
 */

interface GeocodingResult {
  formatted_address: string
  street_number?: string
  street_name?: string
  suburb?: string
  city?: string
  region?: string
  postal_code?: string
  country?: string
  confidence?: number
}

/**
 * Reverse geocode GPS coordinates to address using Nominatim (OpenStreetMap)
 * Free, no API key required, suitable for NZ addresses
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<GeocodingResult | null> {
  try {
    // Use Nominatim (OpenStreetMap) reverse geocoding
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'FreedomCamp-Manager/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`Geocoding failed: ${response.statusText}`)
    }

    const data = await response.json()

    if (!data || data.error) {
      return null
    }

    // Parse address components
    const address = data.address || {}
    
    return {
      formatted_address: data.display_name || 'Unknown location',
      street_number: address.house_number,
      street_name: address.road || address.street,
      suburb: address.suburb || address.neighbourhood,
      city: address.city || address.town || address.village,
      region: address.state || address.region,
      postal_code: address.postcode,
      country: address.country,
      confidence: data.importance || 0,
    }
  } catch (error) {
    console.error('Reverse geocoding failed:', error)
    return null
  }
}

/**
 * Get simple location description (street name or suburb)
 */
export async function getSimpleLocation(
  latitude: number,
  longitude: number
): Promise<string> {
  const result = await reverseGeocode(latitude, longitude)
  
  if (!result) return 'Unknown location'

  // Return most relevant location descriptor
  if (result.street_name && result.suburb) {
    return `${result.street_name}, ${result.suburb}`
  } else if (result.street_name) {
    return result.street_name
  } else if (result.suburb) {
    return result.suburb
  } else if (result.city) {
    return result.city
  }

  return result.formatted_address
}

/**
 * Get zone-appropriate address (for zone name suggestions)
 */
export async function getZoneAddress(
  latitude: number,
  longitude: number
): Promise<string> {
  const result = await reverseGeocode(latitude, longitude)
  
  if (!result) return 'Unknown Zone'

  // Prioritize suburb/area name for zone naming
  if (result.suburb) {
    return result.suburb
  } else if (result.city) {
    return result.city
  } else if (result.street_name) {
    return `${result.street_name} Area`
  }

  return 'Unnamed Zone'
}

/**
 * Batch geocode multiple coordinates
 */
export async function batchReverseGeocode(
  coordinates: Array<{ lat: number; lng: number }>
): Promise<Array<GeocodingResult | null>> {
  const results: Array<GeocodingResult | null> = []

  // Rate limit: 1 request per second for Nominatim
  for (const coord of coordinates) {
    const result = await reverseGeocode(coord.lat, coord.lng)
    results.push(result)
    
    // Wait 1 second between requests
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return results
}

/**
 * Calculate distance between two GPS points (Haversine formula)
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3 // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Distance in meters
}

/**
 * Format GPS coordinates for display
 */
export function formatCoordinates(
  latitude: number,
  longitude: number,
  precision: number = 6
): string {
  const lat = latitude.toFixed(precision)
  const lon = longitude.toFixed(precision)
  const latDir = latitude >= 0 ? 'N' : 'S'
  const lonDir = longitude >= 0 ? 'E' : 'W'
  
  return `${Math.abs(parseFloat(lat))}°${latDir}, ${Math.abs(parseFloat(lon))}°${lonDir}`
}

/**
 * Validate GPS coordinates
 */
export function validateCoordinates(latitude: number, longitude: number): {
  valid: boolean
  error?: string
} {
  if (latitude < -90 || latitude > 90) {
    return { valid: false, error: 'Latitude must be between -90 and 90' }
  }

  if (longitude < -180 || longitude > 180) {
    return { valid: false, error: 'Longitude must be between -180 and 180' }
  }

  return { valid: true }
}

/**
 * Check if coordinates are in New Zealand
 */
export function isInNewZealand(latitude: number, longitude: number): boolean {
  // NZ bounding box (approximate)
  const NZ_BOUNDS = {
    north: -34,
    south: -47.5,
    east: 179,
    west: 166,
  }

  return (
    latitude >= NZ_BOUNDS.south &&
    latitude <= NZ_BOUNDS.north &&
    longitude >= NZ_BOUNDS.west &&
    longitude <= NZ_BOUNDS.east
  )
}

/**
 * Get region from coordinates (North Island vs South Island)
 */
export function getNZRegion(latitude: number, longitude: number): string {
  if (!isInNewZealand(latitude, longitude)) {
    return 'Outside NZ'
  }

  // Approximate division at Cook Strait
  if (latitude > -41.5) {
    return 'North Island'
  } else {
    return 'South Island'
  }
}
