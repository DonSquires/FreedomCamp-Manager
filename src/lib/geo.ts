/**
 * Geo utilities — distance / proximity helpers.
 * No PostGIS / no external dependencies required.
 */

/**
 * Returns the great-circle distance in kilometres between two lat/lng points
 * using the Haversine formula. Accuracy is ±0.5% — sufficient for
 * dispatch-proximity sorting within a city or region.
 */
export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Formats a distance in kilometres as a human-readable string.
 * < 1 km → "350m", ≥ 1 km → "3.4km"
 */
export function formatDistance(km: number | null): string {
  if (km === null) return ''
  if (km < 1) return `${Math.round(km * 1000)}m`
  return `${km.toFixed(1)}km`
}
