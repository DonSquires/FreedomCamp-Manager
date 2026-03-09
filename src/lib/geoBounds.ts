type BoundsTuple = [[number, number], [number, number]]

function walkCoordinates(value: unknown, out: Array<[number, number]>): void {
  if (!Array.isArray(value)) return

  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    const lng = value[0]
    const lat = value[1]
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out.push([lat, lng])
    }
    return
  }

  for (const item of value) {
    walkCoordinates(item, out)
  }
}

function collectCoordinatesFromGeoJson(geom: any, out: Array<[number, number]>): void {
  if (!geom || typeof geom !== 'object') return

  if (geom.type === 'Feature') {
    collectCoordinatesFromGeoJson(geom.geometry, out)
    return
  }

  if (geom.type === 'FeatureCollection' && Array.isArray(geom.features)) {
    for (const feature of geom.features) {
      collectCoordinatesFromGeoJson(feature, out)
    }
    return
  }

  if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
    for (const geometry of geom.geometries) {
      collectCoordinatesFromGeoJson(geometry, out)
    }
    return
  }

  walkCoordinates(geom.coordinates, out)
}

export function getGeoJsonBounds(geom: any): BoundsTuple | null {
  const points: Array<[number, number]> = []
  collectCoordinatesFromGeoJson(geom, points)

  if (points.length === 0) return null

  let minLat = points[0][0]
  let maxLat = points[0][0]
  let minLng = points[0][1]
  let maxLng = points[0][1]

  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }

  return [[minLat, minLng], [maxLat, maxLng]]
}
