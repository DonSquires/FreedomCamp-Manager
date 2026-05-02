/**
 * loiGeofence — Client-side LOI circular polygon generator
 *
 * Mirrors the SQL function `generate_loi_circular_polygon` so that the same
 * circular geofence can be previewed in the UI before the record is saved,
 * or recomputed locally without a round-trip to the database.
 *
 * The generated polygon is a GeoJSON Polygon with coordinates in
 * [longitude, latitude] order — compatible with the existing
 * `isPointInPolygon` / `detectCurrentZones` pipeline in geofence.ts.
 *
 * Automatic geofence creation:
 *   The database trigger `trg_loi_auto_geofence` calls the SQL equivalent of
 *   `generateCircularPolygon` whenever `gps_lat` or `gps_lng` are set on an
 *   LOI record, so `geofence_geometry` is always kept in sync server-side.
 *   This module provides the same calculation on the client for preview use.
 */

/** Default radius in metres for an LOI address geofence */
export const LOI_DEFAULT_GEOFENCE_RADIUS_METERS = 100

/** Default number of polygon vertices (higher = smoother circle) */
export const LOI_DEFAULT_GEOFENCE_POINTS = 32

/** GeoJSON Polygon geometry object */
export interface GeoJsonPolygon {
  type: 'Polygon'
  /** Outer ring only (no holes). Each coordinate is [longitude, latitude]. */
  coordinates: [number, number][][]
}

/**
 * Generate a circular GeoJSON Polygon approximation around a lat/lng point.
 *
 * Uses pure trigonometry (no PostGIS / spatial library required), matching the
 * existing Haversine geofence pattern used throughout this codebase.
 *
 * @param lat           Centre latitude  (degrees, WGS-84)
 * @param lng           Centre longitude (degrees, WGS-84)
 * @param radiusMeters  Circle radius in metres          (default: 100 m)
 * @param numPoints     Polygon vertex count             (default: 32)
 * @returns GeoJSON Polygon with a single closed outer ring, or null when
 *          inputs are invalid (NaN, out-of-range poles, etc.)
 */
export function generateCircularPolygon(
  lat: number,
  lng: number,
  radiusMeters: number = LOI_DEFAULT_GEOFENCE_RADIUS_METERS,
  numPoints: number = LOI_DEFAULT_GEOFENCE_POINTS,
): GeoJsonPolygon | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) >= 90) return null
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return null
  if (!Number.isFinite(numPoints) || numPoints < 3) return null

  const EARTH_RADIUS_M = 6_371_000

  // Degrees of latitude per metre (constant)
  const latDegPerMeter = 1 / ((EARTH_RADIUS_M * Math.PI) / 180)
  // Degrees of longitude per metre at this latitude
  const lngDegPerMeter = 1 / ((EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180) * Math.PI) / 180)

  const ring: [number, number][] = []

  for (let i = 0; i < numPoints; i++) {
    const angle = (2 * Math.PI * i) / numPoints
    const ptLat = lat + radiusMeters * Math.sin(angle) * latDegPerMeter
    const ptLng = lng + radiusMeters * Math.cos(angle) * lngDegPerMeter
    // GeoJSON uses [longitude, latitude]
    ring.push([
      Math.round(ptLng * 1e7) / 1e7,
      Math.round(ptLat * 1e7) / 1e7,
    ])
  }

  // Close the ring — GeoJSON requires the first and last coordinate to be identical
  ring.push(ring[0])

  return { type: 'Polygon', coordinates: [ring] }
}

/**
 * Check whether a lat/lng point falls inside a GeoJSON Polygon ring using
 * the ray-casting algorithm.
 *
 * This is the same algorithm used in `src/lib/geofence.ts::isPointInPolygon`
 * and is provided here so LOI geofence containment checks can be done without
 * importing the full geofence module.
 *
 * @param lat     Point latitude
 * @param lng     Point longitude
 * @param polygon GeoJSON Polygon geometry (outer ring only; holes ignored)
 */
export function isPointInLoiGeofence(
  lat: number,
  lng: number,
  polygon: GeoJsonPolygon,
): boolean {
  const ring = polygon.coordinates[0]
  if (!ring || ring.length < 4) return false

  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]  // lng
    const yi = ring[i][1]  // lat
    const xj = ring[j][0]  // lng
    const yj = ring[j][1]  // lat
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Return the approximate bounding box of a GeoJSON Polygon ring.
 * Useful for map viewport fitting.
 */
export function getPolygonBounds(polygon: GeoJsonPolygon): {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
} | null {
  const ring = polygon.coordinates[0]
  if (!ring || ring.length === 0) return null

  let minLat = Infinity, maxLat = -Infinity
  let minLng = Infinity, maxLng = -Infinity

  for (const [lng, lat] of ring) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }

  return { minLat, maxLat, minLng, maxLng }
}

/**
 * Build a complete LOI geofence payload ready to UPSERT into
 * `locations_of_interest`.
 *
 * In normal usage the database trigger will regenerate `geofence_geometry`
 * automatically, so callers do not need to call this unless they want to
 * preview the polygon before saving or to set a custom radius.
 *
 * @param lat            Geocoded latitude
 * @param lng            Geocoded longitude
 * @param radiusMeters   Desired geofence radius (default 100 m)
 */
export function buildLoiGeofencePayload(
  lat: number,
  lng: number,
  radiusMeters: number = LOI_DEFAULT_GEOFENCE_RADIUS_METERS,
): {
  gps_lat: number
  gps_lng: number
  geofence_radius_meters: number
  geofence_geometry: GeoJsonPolygon | null
} {
  return {
    gps_lat: lat,
    gps_lng: lng,
    geofence_radius_meters: radiusMeters,
    geofence_geometry: generateCircularPolygon(lat, lng, radiusMeters),
  }
}
