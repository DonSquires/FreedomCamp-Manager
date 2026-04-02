import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface OrganizationBoundary {
  id: string
  name: string
  type: string
  geom: any
  bbox: [number, number, number, number] | null
  area_km2: number | null
  updated_at: string
}

/**
 * Extract a [minLng, minLat, maxLng, maxLat] bounding box from a GeoJSON geometry.
 * Supabase/PostGIS returns geometry columns as GeoJSON objects when selected.
 */
function bboxFromGeoJson(geom: any): [number, number, number, number] | null {
  if (!geom) return null

  const coords: number[][] = []

  function collectCoords(obj: any) {
    if (!obj) return
    if (typeof obj.type === 'string') {
      switch (obj.type) {
        case 'Point':
          if (Array.isArray(obj.coordinates)) coords.push(obj.coordinates)
          break
        case 'LineString':
        case 'MultiPoint':
          if (Array.isArray(obj.coordinates)) obj.coordinates.forEach((c: number[]) => coords.push(c))
          break
        case 'Polygon':
        case 'MultiLineString':
          if (Array.isArray(obj.coordinates))
            obj.coordinates.forEach((ring: number[][]) => ring.forEach((c: number[]) => coords.push(c)))
          break
        case 'MultiPolygon':
          if (Array.isArray(obj.coordinates))
            obj.coordinates.forEach((poly: number[][][]) =>
              poly.forEach((ring: number[][]) => ring.forEach((c: number[]) => coords.push(c)))
            )
          break
        case 'GeometryCollection':
          if (Array.isArray(obj.geometries)) obj.geometries.forEach(collectCoords)
          break
        case 'Feature':
          collectCoords(obj.geometry)
          break
        case 'FeatureCollection':
          if (Array.isArray(obj.features)) obj.features.forEach(collectCoords)
          break
      }
    }
  }

  collectCoords(geom)

  if (coords.length === 0) return null

  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }

  return [minLng, minLat, maxLng, maxLat]
}

/**
 * Estimate the approximate area in km² from a bounding box.
 * Uses the haversine-based approximation for small regions.
 */
function areaFromBbox(bbox: [number, number, number, number]): number {
  const [minLng, minLat, maxLng, maxLat] = bbox
  const R = 6371 // Earth radius in km

  const latDiff = ((maxLat - minLat) * Math.PI) / 180
  const lngDiff = ((maxLng - minLng) * Math.PI) / 180
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180)

  const heightKm = R * latDiff
  const widthKm = R * lngDiff * Math.cos(midLat)

  return Math.abs(heightKm * widthKm)
}

export function useOrganizationBoundary(organizationId?: string) {
  return useQuery({
    queryKey: ['organization-boundary', organizationId],
    queryFn: async () => {
      if (!organizationId) return null

      const { data, error } = await supabase
        .from('organizations')
        .select(`
          id,
          name,
          type,
          geom,
          updated_at
        `)
        .eq('id', organizationId)
        .single()

      if (error) throw error

      const bbox = bboxFromGeoJson((data as any).geom)
      const area_km2 = bbox ? areaFromBbox(bbox) : null

      const boundary: OrganizationBoundary = {
        ...(data as any),
        bbox,
        area_km2,
      }

      return boundary
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })
}
