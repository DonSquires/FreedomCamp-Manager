const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const configuredTileUrl = String(import.meta.env.VITE_INHOUSE_MAP_TILE_URL || '').trim()
const configuredTileAttribution = String(import.meta.env.VITE_INHOUSE_MAP_TILE_ATTRIBUTION || '').trim()

const configuredCoordsTemplate = String(import.meta.env.VITE_INHOUSE_MAP_COORDS_URL || '').trim()
const configuredAddressTemplate = String(import.meta.env.VITE_INHOUSE_MAP_ADDRESS_URL || '').trim()

export const PRIMARY_MAP_TILE_URL = configuredTileUrl || OSM_TILE_URL
export const PRIMARY_MAP_TILE_ATTRIBUTION =
  configuredTileAttribution ||
  (configuredTileUrl
    ? '&copy; OnSpace AI in-house mapping'
    : OSM_TILE_ATTRIBUTION)

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
