const configuredFallbackTileUrl = String(import.meta.env.VITE_INHOUSE_MAP_FALLBACK_TILE_URL || '').trim()
const configuredFallbackAttribution = String(import.meta.env.VITE_INHOUSE_MAP_FALLBACK_TILE_ATTRIBUTION || '').trim()

export const FALLBACK_MAP_TILE_URL = configuredFallbackTileUrl || ''
export const FALLBACK_MAP_TILE_ATTRIBUTION =
  configuredFallbackAttribution ||
  (configuredFallbackTileUrl
    ? '&copy; OnSpace AI in-house fallback mapping'
    : '')

const configuredTileUrl = String(import.meta.env.VITE_INHOUSE_MAP_TILE_URL || '').trim()
const configuredTileAttribution = String(import.meta.env.VITE_INHOUSE_MAP_TILE_ATTRIBUTION || '').trim()
const configuredSatelliteTileUrl = String(import.meta.env.VITE_INHOUSE_MAP_SATELLITE_TILE_URL || '').trim()
const configuredSatelliteAttribution = String(import.meta.env.VITE_INHOUSE_MAP_SATELLITE_TILE_ATTRIBUTION || '').trim()

const configuredCoordsTemplate = String(import.meta.env.VITE_INHOUSE_MAP_COORDS_URL || '').trim()
const configuredAddressTemplate = String(import.meta.env.VITE_INHOUSE_MAP_ADDRESS_URL || '').trim()

export const HAS_INTERNAL_STREET_MAP_TILE =
  configuredTileUrl.length > 0 || configuredFallbackTileUrl.length > 0
export const HAS_INTERNAL_SATELLITE_MAP_TILE = configuredSatelliteTileUrl.length > 0

export const PRIMARY_MAP_TILE_URL = configuredTileUrl || FALLBACK_MAP_TILE_URL
export const PRIMARY_MAP_TILE_ATTRIBUTION =
  configuredTileAttribution ||
  (configuredTileUrl || configuredFallbackTileUrl
    ? '&copy; OnSpace AI in-house mapping'
    : FALLBACK_MAP_TILE_ATTRIBUTION)

export const SATELLITE_MAP_TILE_URL = configuredSatelliteTileUrl || ''
export const SATELLITE_MAP_TILE_ATTRIBUTION =
  configuredSatelliteAttribution ||
  (configuredSatelliteTileUrl
    ? '&copy; OnSpace AI in-house satellite mapping'
    : '')

function applyTemplate(
  template: string,
  tokens: Record<string, string>,
): string {
  if (!template) return ''
  let result = template
  for (const [key, value] of Object.entries(tokens)) {
    result = result.split(`{${key}}`).join(value)
  }
  return result
}

function getAppOrigin(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

export function buildInHouseOperationsFocusUrl(lat: number, lng: number): string {
  const latStr = lat.toFixed(5)
  const lngStr = lng.toFixed(5)

  if (configuredCoordsTemplate) {
    return applyTemplate(configuredCoordsTemplate, {
      lat: latStr,
      lng: lngStr,
      query: encodeURIComponent(`${latStr},${lngStr}`),
    })
  }

  const origin = getAppOrigin()
  const path = `/operations-map?focus=${latStr},${lngStr}`
  return origin ? `${origin}${path}` : path
}

export function buildPreferredMapUrlForCoordinates(lat: number, lng: number): string {
  return buildInHouseOperationsFocusUrl(lat, lng)
}

export function buildPreferredMapUrlForAddress(address: string): string {
  const query = String(address || '').trim()
  if (!query) return 'https://maps.google.com/'

  if (configuredAddressTemplate) {
    return applyTemplate(configuredAddressTemplate, {
      query: encodeURIComponent(query),
    })
  }

  return `https://maps.google.com/?q=${encodeURIComponent(query)}`
}
