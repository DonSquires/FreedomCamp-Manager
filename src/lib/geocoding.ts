/**
 * Utility Library: geocoding
 * Reverse geocoding (GPS coordinates to address)
 *
 * Primary:  Google Maps Geocoding API  (requires VITE_GOOGLE_MAPS_API_KEY)
 * Fallback: Nominatim (OpenStreetMap) — free, no key needed
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
  source?: 'google' | 'nominatim'
}

export interface ForwardGeocodingResult extends GeocodingResult {
  latitude: number
  longitude: number
}

// ── Google Maps Geocoding ──────────────────────────────────────────────────

/**
 * Reverse geocode using Google Maps Geocoding API.
 * Returns null if the API key is not configured or the request fails.
 */
async function reverseGeocodeGoogle(
  latitude: number,
  longitude: number,
): Promise<GeocodingResult | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  if (!apiKey) return null

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${latitude},${longitude}&key=${encodeURIComponent(apiKey)}&result_type=street_address|premise|route`

    const response = await fetch(url)
    if (!response.ok) throw new Error(`Google geocode HTTP ${response.status}`)

    const json = await response.json()
    if (json.status !== 'OK' || !json.results?.length) return null

    const result = json.results[0]
    const components: Record<string, string> = {}
    for (const c of result.address_components ?? []) {
      for (const type of c.types ?? []) {
        components[type] = c.long_name
      }
    }

    return {
      formatted_address: result.formatted_address ?? '',
      street_number:     components['street_number'],
      street_name:       components['route'],
      suburb:            components['sublocality_level_1'] ?? components['sublocality'] ?? components['neighborhood'],
      city:              components['locality'] ?? components['postal_town'],
      region:            components['administrative_area_level_1'],
      postal_code:       components['postal_code'],
      country:           components['country'],
      confidence:        1,
      source:            'google',
    }
  } catch (error) {
    console.warn('Google geocoding failed:', error)
    return null
  }
}

// ── Nominatim (OpenStreetMap) fallback ────────────────────────────────────

async function reverseGeocodeNominatim(
  latitude: number,
  longitude: number,
): Promise<GeocodingResult | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`

    const response = await fetch(url, {
      headers: { 'User-Agent': 'FieldOps-Manager/1.0' },
    })

    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`)

    const data = await response.json()
    if (!data || data.error) return null

    const addr = data.address || {}
    return {
      formatted_address: data.display_name || 'Unknown location',
      street_number:     addr.house_number,
      street_name:       addr.road || addr.street,
      suburb:            addr.suburb || addr.neighbourhood,
      city:              addr.city || addr.town || addr.village,
      region:            addr.state || addr.region,
      postal_code:       addr.postcode,
      country:           addr.country,
      confidence:        data.importance || 0,
      source:            'nominatim',
    }
  } catch (error) {
    // Network/cors/adblock failures are expected in some client environments;
    // keep this non-fatal so auto error reporting does not treat it as a crash.
    console.warn('Nominatim geocoding failed:', error)
    return null
  }
}

// ── Forward geocoding (address -> coordinates) ─────────────────────────────

async function forwardGeocodeGoogle(query: string): Promise<ForwardGeocodingResult | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  if (!apiKey) return null

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}&components=country:NZ`

    const response = await fetch(url)
    if (!response.ok) throw new Error(`Google geocode HTTP ${response.status}`)

    const json = await response.json()
    if (json.status !== 'OK' || !json.results?.length) return null

    const result = json.results[0]
    const components: Record<string, string> = {}
    for (const c of result.address_components ?? []) {
      for (const type of c.types ?? []) {
        components[type] = c.long_name
      }
    }

    return {
      formatted_address: result.formatted_address ?? query,
      street_number: components['street_number'],
      street_name: components['route'],
      suburb: components['sublocality_level_1'] ?? components['sublocality'] ?? components['neighborhood'],
      city: components['locality'] ?? components['postal_town'],
      region: components['administrative_area_level_1'],
      postal_code: components['postal_code'],
      country: components['country'],
      confidence: 1,
      source: 'google',
      latitude: result.geometry?.location?.lat ?? null,
      longitude: result.geometry?.location?.lng ?? null,
    }
  } catch (error) {
    console.warn('Google forward geocoding failed:', error)
    return null
  }
}

async function forwardGeocodeNominatim(query: string): Promise<ForwardGeocodingResult | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=1&countrycodes=nz`

    const response = await fetch(url, {
      headers: { 'User-Agent': 'FieldOps-Manager/1.0' },
    })

    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`)

    const data = await response.json()
    if (!Array.isArray(data) || data.length === 0) return null

    const result = data[0]
    const addr = result.address || {}
    const latitude = Number.parseFloat(result.lat)
    const longitude = Number.parseFloat(result.lon)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null
    }

    return {
      formatted_address: result.display_name || query,
      street_number: addr.house_number,
      street_name: addr.road || addr.street,
      suburb: addr.suburb || addr.neighbourhood,
      city: addr.city || addr.town || addr.village,
      region: addr.state || addr.region,
      postal_code: addr.postcode,
      country: addr.country,
      confidence: typeof result.importance === 'number' ? result.importance : 0,
      source: 'nominatim',
      latitude,
      longitude,
    }
  } catch (error) {
    console.warn('Nominatim forward geocoding failed:', error)
    return null
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Reverse geocode GPS coordinates to address.
 * Tries Google Maps first (if VITE_GOOGLE_MAPS_API_KEY is set),
 * then falls back to Nominatim (OpenStreetMap).
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<GeocodingResult | null> {
  const googleResult = await reverseGeocodeGoogle(latitude, longitude)
  if (googleResult) return googleResult

  return reverseGeocodeNominatim(latitude, longitude)
}

/**
 * Forward geocode an address to GPS coordinates.
 * Tries Google Maps first (if VITE_GOOGLE_MAPS_API_KEY is set),
 * then falls back to Nominatim (OpenStreetMap).
 */
export async function forwardGeocode(
  address: string,
  city?: string,
): Promise<ForwardGeocodingResult | null> {
  const query = [address, city, 'New Zealand']
    .map(part => (part ?? '').trim())
    .filter(Boolean)
    .join(', ')

  if (!query) return null

  const googleResult = await forwardGeocodeGoogle(query)
  if (googleResult) return googleResult

  return forwardGeocodeNominatim(query)
}

/**
 * Get simple location description (street name or suburb)
 */
export async function getSimpleLocation(
  latitude: number,
  longitude: number,
): Promise<string> {
  const result = await reverseGeocode(latitude, longitude)

  if (!result) return 'Unknown location'

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
  longitude: number,
): Promise<string> {
  const result = await reverseGeocode(latitude, longitude)

  if (!result) return 'Unknown Zone'

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
 * Batch geocode multiple coordinates (rate-limited for Nominatim, concurrent for Google)
 */
export async function batchReverseGeocode(
  coordinates: Array<{ lat: number; lng: number }>,
): Promise<Array<GeocodingResult | null>> {
  const hasGoogleKey = !!(import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)

  if (hasGoogleKey) {
    // Google allows concurrent requests
    return Promise.all(coordinates.map(c => reverseGeocode(c.lat, c.lng)))
  }

  // Nominatim requires ≤1 req/s
  const results: Array<GeocodingResult | null> = []
  for (const coord of coordinates) {
    const result = await reverseGeocode(coord.lat, coord.lng)
    results.push(result)
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
  lon2: number,
): number {
  const R = 6371e3 // Earth's radius in metres
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // metres
}

/**
 * Format GPS coordinates for display
 */
export function formatCoordinates(
  latitude: number,
  longitude: number,
  precision = 6,
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
export function validateCoordinates(
  latitude: number,
  longitude: number,
): { valid: boolean; error?: string } {
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
  const NZ_BOUNDS = { north: -34, south: -47.5, east: 179, west: 166 }
  return (
    latitude  >= NZ_BOUNDS.south &&
    latitude  <= NZ_BOUNDS.north &&
    longitude >= NZ_BOUNDS.west  &&
    longitude <= NZ_BOUNDS.east
  )
}

/**
 * Get region from coordinates (North Island vs South Island)
 */
export function getNZRegion(latitude: number, longitude: number): string {
  if (!isInNewZealand(latitude, longitude)) return 'Outside NZ'
  // Approximate Cook Strait division
  return latitude > -41.5 ? 'North Island' : 'South Island'
}
