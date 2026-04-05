import { describe, it, expect } from 'vitest'
import { calculateDistance, isInsideGeofence, GeofenceZone } from '../geofence'

// ── calculateDistance (Haversine) ────────────────────────────────────────────

describe('calculateDistance', () => {
  it('returns 0 for the same point', () => {
    expect(calculateDistance(-41.2865, 174.7762, -41.2865, 174.7762)).toBe(0)
  })

  it('calculates distance between Wellington and Auckland (~493 km)', () => {
    const distance = calculateDistance(-41.2865, 174.7762, -36.8485, 174.7633)
    expect(distance).toBeGreaterThan(490_000)
    expect(distance).toBeLessThan(497_000)
  })

  it('calculates short distances accurately (< 1km)', () => {
    // Two points ~111 meters apart (0.001 degrees lat ≈ 111m)
    const distance = calculateDistance(-41.2865, 174.7762, -41.2855, 174.7762)
    expect(distance).toBeGreaterThan(100)
    expect(distance).toBeLessThan(120)
  })

  it('calculates distance across the equator', () => {
    const distance = calculateDistance(1, 0, -1, 0)
    expect(distance).toBeGreaterThan(220_000)
    expect(distance).toBeLessThan(224_000)
  })

  it('handles negative longitudes', () => {
    const d = calculateDistance(0, -10, 0, 10)
    expect(d).toBeGreaterThan(0)
  })
})

// ── isInsideGeofence ────────────────────────────────────────────────────────

describe('isInsideGeofence', () => {
  const zone: GeofenceZone = {
    id: 'zone-1',
    name: 'Test Zone',
    location_lat: -41.2865,
    location_lng: 174.7762,
    radius_meters: 500,
  }

  it('returns true for a point at the center', () => {
    expect(isInsideGeofence(-41.2865, 174.7762, zone)).toBe(true)
  })

  it('returns true for a point just inside the radius', () => {
    expect(isInsideGeofence(-41.2855, 174.7762, zone)).toBe(true)
  })

  it('returns false for a point far outside the radius', () => {
    expect(isInsideGeofence(-41.3300, 174.7762, zone)).toBe(false)
  })

  it('uses default 500m radius when radius_meters is not set', () => {
    const zoneNoRadius: GeofenceZone = {
      id: 'zone-2',
      name: 'No Radius Zone',
      location_lat: -41.2865,
      location_lng: 174.7762,
    }
    expect(isInsideGeofence(-41.2855, 174.7762, zoneNoRadius)).toBe(true)
    expect(isInsideGeofence(-41.3050, 174.7762, zoneNoRadius)).toBe(false)
  })

  it('respects custom radius', () => {
    const smallZone: GeofenceZone = {
      id: 'zone-3',
      name: 'Small Zone',
      location_lat: -41.2865,
      location_lng: 174.7762,
      radius_meters: 50,
    }
    expect(isInsideGeofence(-41.2855, 174.7762, smallZone)).toBe(false)
  })

  it('returns true for a point exactly at center', () => {
    const testZone: GeofenceZone = {
      id: 'zone-4',
      name: 'Boundary Zone',
      location_lat: 0,
      location_lng: 0,
      radius_meters: 1000,
    }
    expect(isInsideGeofence(0, 0, testZone)).toBe(true)
  })
})
