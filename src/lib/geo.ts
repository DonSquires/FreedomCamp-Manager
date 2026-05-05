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

// ─── ETA helpers (B-07) ───────────────────────────────────────────────────────

/**
 * Average assumed patrol vehicle speed for ETA calculations.
 * 30 km/h reflects urban / suburban driving with traffic stops.
 * A road-factor of 1.3 converts straight-line (Haversine) distance to a
 * realistic road distance (typical urban detour ratio).
 */
const AVG_SPEED_KMH  = 30
const ROAD_FACTOR    = 1.3  // Haversine → road distance multiplier
const MIN_ETA_MINS   = 1    // never display 0 min even for very close units

/**
 * Estimates travel time in minutes from a straight-line (Haversine) distance.
 * Uses a road factor to account for detours and an average urban patrol speed.
 */
export function estimateEtaMinutes(distanceKm: number): number {
  const roadKm = distanceKm * ROAD_FACTOR
  const mins   = (roadKm / AVG_SPEED_KMH) * 60
  return Math.max(MIN_ETA_MINS, Math.round(mins))
}

/**
 * Formats an ETA in minutes as a human-readable string.
 * < 60 min → "~4 min", ≥ 60 min → "~1 h 10 min"
 */
export function formatEta(minutes: number): string {
  if (minutes < 60) return `~${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `~${h} h` : `~${h} h ${m} min`
}
