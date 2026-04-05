import { describe, it, expect } from 'vitest'
import { getGeoJsonBounds } from '../geoBounds'

describe('getGeoJsonBounds', () => {
  it('returns null for null input', () => {
    expect(getGeoJsonBounds(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(getGeoJsonBounds(undefined)).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(getGeoJsonBounds('string')).toBeNull()
  })

  it('returns null for empty geometry', () => {
    expect(getGeoJsonBounds({ type: 'Polygon', coordinates: [] })).toBeNull()
  })

  it('calculates bounds for a simple Polygon', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [174.7, -41.3],
          [174.8, -41.3],
          [174.8, -41.2],
          [174.7, -41.2],
          [174.7, -41.3],
        ],
      ],
    }
    const bounds = getGeoJsonBounds(polygon)
    expect(bounds).not.toBeNull()
    expect(bounds![0][0]).toBeCloseTo(-41.3, 1)
    expect(bounds![0][1]).toBeCloseTo(174.7, 1)
    expect(bounds![1][0]).toBeCloseTo(-41.2, 1)
    expect(bounds![1][1]).toBeCloseTo(174.8, 1)
  })

  it('calculates bounds for a Point geometry', () => {
    const point = {
      type: 'Point',
      coordinates: [174.7762, -41.2865],
    }
    const bounds = getGeoJsonBounds(point)
    expect(bounds).not.toBeNull()
    expect(bounds![0][0]).toBeCloseTo(-41.2865, 4)
    expect(bounds![0][1]).toBeCloseTo(174.7762, 4)
    expect(bounds![0]).toEqual(bounds![1])
  })

  it('calculates bounds for a Feature', () => {
    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [174.7762, -41.2865],
      },
      properties: {},
    }
    const bounds = getGeoJsonBounds(feature)
    expect(bounds).not.toBeNull()
    expect(bounds![0][0]).toBeCloseTo(-41.2865, 4)
  })

  it('calculates bounds for a FeatureCollection', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [174.7, -41.3] },
          properties: {},
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [175.0, -41.1] },
          properties: {},
        },
      ],
    }
    const bounds = getGeoJsonBounds(fc)
    expect(bounds).not.toBeNull()
    expect(bounds![0][0]).toBeCloseTo(-41.3, 1)
    expect(bounds![1][0]).toBeCloseTo(-41.1, 1)
    expect(bounds![0][1]).toBeCloseTo(174.7, 1)
    expect(bounds![1][1]).toBeCloseTo(175.0, 1)
  })

  it('calculates bounds for a GeometryCollection', () => {
    const gc = {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [170, -45] },
        { type: 'Point', coordinates: [175, -40] },
      ],
    }
    const bounds = getGeoJsonBounds(gc)
    expect(bounds).not.toBeNull()
    expect(bounds![0][0]).toBeCloseTo(-45, 0)
    expect(bounds![1][0]).toBeCloseTo(-40, 0)
  })

  it('handles LineString geometry', () => {
    const line = {
      type: 'LineString',
      coordinates: [
        [174.7, -41.3],
        [174.8, -41.2],
        [174.9, -41.1],
      ],
    }
    const bounds = getGeoJsonBounds(line)
    expect(bounds).not.toBeNull()
    expect(bounds![0][0]).toBeCloseTo(-41.3, 1)
    expect(bounds![1][0]).toBeCloseTo(-41.1, 1)
    expect(bounds![0][1]).toBeCloseTo(174.7, 1)
    expect(bounds![1][1]).toBeCloseTo(174.9, 1)
  })
})
