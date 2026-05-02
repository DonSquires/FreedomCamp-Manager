import { describe, it, expect } from 'vitest'
import {
  generateCircularPolygon,
  isPointInLoiGeofence,
  getPolygonBounds,
  buildLoiGeofencePayload,
  LOI_DEFAULT_GEOFENCE_RADIUS_METERS,
  LOI_DEFAULT_GEOFENCE_POINTS,
  type GeoJsonPolygon,
} from '../loiGeofence'

// ── generateCircularPolygon ───────────────────────────────────────────────────

describe('generateCircularPolygon', () => {
  it('returns a GeoJSON Polygon', () => {
    const poly = generateCircularPolygon(-41.2865, 174.7762)
    expect(poly).not.toBeNull()
    expect(poly!.type).toBe('Polygon')
    expect(Array.isArray(poly!.coordinates)).toBe(true)
    expect(Array.isArray(poly!.coordinates[0])).toBe(true)
  })

  it('ring has numPoints + 1 vertices (closed ring)', () => {
    const n = LOI_DEFAULT_GEOFENCE_POINTS
    const poly = generateCircularPolygon(-41.2865, 174.7762, 100, n)
    expect(poly!.coordinates[0]).toHaveLength(n + 1)
  })

  it('first and last vertices are identical (closed ring)', () => {
    const poly = generateCircularPolygon(-41.2865, 174.7762)!
    const ring = poly.coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('coordinates are in [longitude, latitude] GeoJSON order', () => {
    // Wellington: lat ≈ -41.29, lng ≈ 174.78
    const poly = generateCircularPolygon(-41.2865, 174.7762)!
    const [lng, lat] = poly.coordinates[0][0]
    // longitude (174.x) should be larger than |latitude| (-41.x) in NZ
    expect(lng).toBeGreaterThan(170)
    expect(lat).toBeLessThan(-40)
  })

  it('uses default radius of 100 m', () => {
    const polyDefault = generateCircularPolygon(-41.2865, 174.7762)!
    const polyExplicit = generateCircularPolygon(-41.2865, 174.7762, LOI_DEFAULT_GEOFENCE_RADIUS_METERS)!
    expect(polyDefault.coordinates[0]).toEqual(polyExplicit.coordinates[0])
  })

  it('a larger radius produces a wider polygon', () => {
    const small = generateCircularPolygon(-41.2865, 174.7762, 50)!
    const large = generateCircularPolygon(-41.2865, 174.7762, 500)!

    const lngSmall = small.coordinates[0].map(([lng]) => lng)
    const lngLarge = large.coordinates[0].map(([lng]) => lng)

    const spanSmall = Math.max(...lngSmall) - Math.min(...lngSmall)
    const spanLarge = Math.max(...lngLarge) - Math.min(...lngLarge)
    expect(spanLarge).toBeGreaterThan(spanSmall)
  })

  it('returns null for NaN inputs', () => {
    expect(generateCircularPolygon(NaN, 174.7762)).toBeNull()
    expect(generateCircularPolygon(-41.2865, NaN)).toBeNull()
  })

  it('returns null at the poles (lat ≥ 90)', () => {
    expect(generateCircularPolygon(90, 0)).toBeNull()
    expect(generateCircularPolygon(-90, 0)).toBeNull()
  })

  it('returns null for zero or negative radius', () => {
    expect(generateCircularPolygon(-41, 174, 0)).toBeNull()
    expect(generateCircularPolygon(-41, 174, -50)).toBeNull()
  })

  it('returns null when numPoints < 3', () => {
    expect(generateCircularPolygon(-41, 174, 100, 2)).toBeNull()
  })

  it('coordinates are rounded to 7 decimal places', () => {
    const poly = generateCircularPolygon(-41.2865, 174.7762)!
    for (const [lng, lat] of poly.coordinates[0]) {
      expect(Number(lng.toFixed(7))).toBe(lng)
      expect(Number(lat.toFixed(7))).toBe(lat)
    }
  })
})

// ── isPointInLoiGeofence ──────────────────────────────────────────────────────

describe('isPointInLoiGeofence', () => {
  // Nelson, NZ — 41.2706°S 173.2839°E
  const centre = { lat: -41.2706, lng: 173.2839 }
  const poly = generateCircularPolygon(centre.lat, centre.lng, 200)!

  it('centre point is inside its own geofence', () => {
    expect(isPointInLoiGeofence(centre.lat, centre.lng, poly)).toBe(true)
  })

  it('point very close to centre is inside', () => {
    // ~1 metre north
    expect(isPointInLoiGeofence(centre.lat + 0.00001, centre.lng, poly)).toBe(true)
  })

  it('point far away (1 km) is outside', () => {
    // ~0.009 deg ≈ 1 km
    expect(isPointInLoiGeofence(centre.lat + 0.009, centre.lng, poly)).toBe(false)
  })

  it('returns false for a degenerate polygon with < 4 vertices', () => {
    const bad: GeoJsonPolygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] }
    expect(isPointInLoiGeofence(0, 0, bad)).toBe(false)
  })

  it('100 m radius excludes a point 150 m away', () => {
    const smallPoly = generateCircularPolygon(centre.lat, centre.lng, 100)!
    // 0.00135 deg ≈ 150 m
    expect(isPointInLoiGeofence(centre.lat + 0.00135, centre.lng, smallPoly)).toBe(false)
  })

  it('500 m radius includes a point 150 m away', () => {
    const bigPoly = generateCircularPolygon(centre.lat, centre.lng, 500)!
    expect(isPointInLoiGeofence(centre.lat + 0.00135, centre.lng, bigPoly)).toBe(true)
  })
})

// ── getPolygonBounds ──────────────────────────────────────────────────────────

describe('getPolygonBounds', () => {
  const poly = generateCircularPolygon(-41.2706, 173.2839, 100)!

  it('returns non-null bounds for a valid polygon', () => {
    const bounds = getPolygonBounds(poly)
    expect(bounds).not.toBeNull()
  })

  it('centre is within bounds', () => {
    const bounds = getPolygonBounds(poly)!
    expect(bounds.minLat).toBeLessThan(-41.2706)
    expect(bounds.maxLat).toBeGreaterThan(-41.2706)
    expect(bounds.minLng).toBeLessThan(173.2839)
    expect(bounds.maxLng).toBeGreaterThan(173.2839)
  })

  it('returns null for empty polygon', () => {
    const empty: GeoJsonPolygon = { type: 'Polygon', coordinates: [[]] }
    expect(getPolygonBounds(empty)).toBeNull()
  })
})

// ── buildLoiGeofencePayload ───────────────────────────────────────────────────

describe('buildLoiGeofencePayload', () => {
  it('returns a payload with all required fields', () => {
    const payload = buildLoiGeofencePayload(-41.2706, 173.2839)
    expect(payload.gps_lat).toBe(-41.2706)
    expect(payload.gps_lng).toBe(173.2839)
    expect(payload.geofence_radius_meters).toBe(LOI_DEFAULT_GEOFENCE_RADIUS_METERS)
    expect(payload.geofence_geometry).not.toBeNull()
    expect(payload.geofence_geometry!.type).toBe('Polygon')
  })

  it('respects a custom radius', () => {
    const payload = buildLoiGeofencePayload(-41.2706, 173.2839, 250)
    expect(payload.geofence_radius_meters).toBe(250)
    // 250 m radius produces wider bounds than 100 m
    const bounds250 = getPolygonBounds(payload.geofence_geometry!)!
    const bounds100 = getPolygonBounds(buildLoiGeofencePayload(-41.2706, 173.2839, 100).geofence_geometry!)!
    expect(bounds250.maxLat - bounds250.minLat).toBeGreaterThan(bounds100.maxLat - bounds100.minLat)
  })

  it('geofence_geometry is null when NaN coordinates are provided', () => {
    const payload = buildLoiGeofencePayload(NaN, 174.0)
    expect(payload.geofence_geometry).toBeNull()
  })

  it('centre point is inside the generated geofence', () => {
    const payload = buildLoiGeofencePayload(-41.2706, 173.2839)
    expect(isPointInLoiGeofence(-41.2706, 173.2839, payload.geofence_geometry!)).toBe(true)
  })
})
