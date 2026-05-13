import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Circle, Polygon, CircleMarker, useMapEvents } from 'react-leaflet'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { JurisdictionMapViewport } from '@/components/features/JurisdictionMapViewport'
import { MapFocusToolbar } from '@/components/features/MapFocusToolbar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { 
  MapPin, 
  Circle as CircleIcon, 
  Square, 
  Save, 
  Trash2, 
  AlertCircle,
  Info,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { toast } from 'sonner'

interface Coordinate {
  lat: number
  lng: number
}

interface ZoneGeofenceEditorProps {
  zoneId?: string
  initialGeometry?: any
  onSave: (geometry: any) => Promise<void>
  onCancel?: () => void
}

function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (event) => {
      onClick(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}

function parseInitialGeometry(initialGeometry?: any): {
  geometryType: 'circle' | 'polygon'
  center: Coordinate
  radius: number
  points: Coordinate[]
} {
  const defaultCenter = { lat: -36.8485, lng: 174.7633 }
  const defaultState = {
    geometryType: 'circle' as const,
    center: defaultCenter,
    radius: 100,
    points: [] as Coordinate[],
  }

  if (!initialGeometry) {
    return defaultState
  }

  const geometry = initialGeometry.type === 'Feature' ? initialGeometry.geometry : initialGeometry
  if (!geometry || !geometry.type) {
    return defaultState
  }

  // Legacy custom format support.
  if (geometry.type === 'circle' && geometry.center) {
    return {
      geometryType: 'circle',
      center: {
        lat: Number(geometry.center.lat) || defaultCenter.lat,
        lng: Number(geometry.center.lng) || defaultCenter.lng,
      },
      radius: Number(geometry.radius) || 100,
      points: [],
    }
  }

  if (geometry.type === 'polygon' && Array.isArray(geometry.coordinates)) {
    return {
      geometryType: 'polygon',
      center: defaultCenter,
      radius: 100,
      points: geometry.coordinates
        .map((p: any) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
        .filter((p: Coordinate) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    }
  }

  // GeoJSON Point + radius (used by check_location_in_org for circular zones).
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    return {
      geometryType: 'circle',
      center: {
        lat: Number(geometry.coordinates[1]) || defaultCenter.lat,
        lng: Number(geometry.coordinates[0]) || defaultCenter.lng,
      },
      radius: Number(geometry.radius) || 100,
      points: [],
    }
  }

  // GeoJSON Polygon.
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates?.[0])) {
    const ring = geometry.coordinates[0] as any[]
    const points = ring
      .map((coord: any) => ({ lat: Number(coord?.[1]), lng: Number(coord?.[0]) }))
      .filter((p: Coordinate) => Number.isFinite(p.lat) && Number.isFinite(p.lng))

    // Remove duplicated closing vertex for editing convenience.
    const normalizedPoints = points.length > 1
      && points[0].lat === points[points.length - 1].lat
      && points[0].lng === points[points.length - 1].lng
      ? points.slice(0, -1)
      : points

    return {
      geometryType: 'polygon',
      center: normalizedPoints[0] || defaultCenter,
      radius: 100,
      points: normalizedPoints,
    }
  }

  return defaultState
}

export function ZoneGeofenceEditor({ 
  zoneId, 
  initialGeometry, 
  onSave, 
  onCancel 
}: ZoneGeofenceEditorProps) {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const effectiveOrganizationId =
    user?.role === 'master' ? organizationId || null : user?.organization_id || null

  const parsedInitial = parseInitialGeometry(initialGeometry)
  const [geometryType, setGeometryType] = useState<'circle' | 'polygon'>(
    parsedInitial.geometryType
  )
  const [centerLat, setCenterLat] = useState<number>(
    parsedInitial.center.lat
  )
  const [centerLng, setCenterLng] = useState<number>(
    parsedInitial.center.lng
  )
  const [radius, setRadius] = useState<number>(
    parsedInitial.radius
  )
  const [polygonPoints, setPolygonPoints] = useState<Coordinate[]>(
    parsedInitial.points
  )
  const [focusKey, setFocusKey] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [useCurrentLocation, setUseCurrentLocation] = useState(false)

  // Get current GPS location
  const getCurrentLocation = () => {
    setUseCurrentLocation(true)
    
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser')
      setUseCurrentLocation(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCenterLat(position.coords.latitude)
        setCenterLng(position.coords.longitude)
        toast.success('Location updated to your current position')
        setUseCurrentLocation(false)
      },
      (error) => {
        toast.error('Failed to get current location: ' + error.message)
        setUseCurrentLocation(false)
      }
    )
  }

  // Add polygon point
  const addPolygonPoint = () => {
    setPolygonPoints([...polygonPoints, { lat: centerLat, lng: centerLng }])
  }

  const handleMapClick = (lat: number, lng: number) => {
    if (geometryType === 'circle') {
      setCenterLat(lat)
      setCenterLng(lng)
      return
    }

    setPolygonPoints((prev) => [...prev, { lat, lng }])
  }

  // Remove polygon point
  const removePolygonPoint = (index: number) => {
    setPolygonPoints(polygonPoints.filter((_, i) => i !== index))
  }

  // Update polygon point
  const updatePolygonPoint = (index: number, lat: number, lng: number) => {
    const updated = [...polygonPoints]
    updated[index] = { lat, lng }
    setPolygonPoints(updated)
  }

  // Save geometry
  const handleSave = async () => {
    setIsSaving(true)

    try {
      let geometry: any

      if (geometryType === 'circle') {
        if (!centerLat || !centerLng || !radius) {
          toast.error('Please provide center coordinates and radius')
          setIsSaving(false)
          return
        }

        geometry = {
          type: 'Point',
          coordinates: [centerLng, centerLat],
          radius,
        }
      } else {
        if (polygonPoints.length < 3) {
          toast.error('Polygon must have at least 3 points')
          setIsSaving(false)
          return
        }

        const ring = polygonPoints.map((p) => [p.lng, p.lat])
        ring.push([polygonPoints[0].lng, polygonPoints[0].lat])

        geometry = {
          type: 'Polygon',
          coordinates: [ring],
        }
      }

      await onSave(geometry)
      toast.success('Geofence saved successfully')
    } catch (error: any) {
      toast.error(error.message || 'Failed to save geofence')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-900/10">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="flex-1 text-sm text-blue-900 dark:text-blue-100">
              <p className="font-semibold">Geofence Editor</p>
              <p className="mt-1">
                Define a geographic boundary for this zone using either a circular radius or a custom polygon.
                GPS coordinates will be used to automatically assign observations to this zone.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Geometry Type Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Boundary Type</CardTitle>
          <CardDescription>
            Choose how you want to define the zone boundary
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Button
              variant={geometryType === 'circle' ? 'default' : 'outline'}
              onClick={() => setGeometryType('circle')}
              className="h-auto py-4"
            >
              <div className="flex flex-col items-center gap-2">
                <CircleIcon className="h-8 w-8" />
                <div>
                  <div className="font-semibold">Circle</div>
                  <div className="text-xs opacity-70">Center + radius</div>
                </div>
              </div>
            </Button>

            <Button
              variant={geometryType === 'polygon' ? 'default' : 'outline'}
              onClick={() => setGeometryType('polygon')}
              className="h-auto py-4"
            >
              <div className="flex flex-col items-center gap-2">
                <Square className="h-8 w-8" />
                <div>
                  <div className="font-semibold">Polygon</div>
                  <div className="text-xs opacity-70">Custom shape</div>
                </div>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Interactive map editor */}
      <Card>
        <CardHeader>
          <CardTitle>Map Editor</CardTitle>
          <CardDescription>
            {geometryType === 'circle'
              ? 'Click map to set circle center, then adjust radius.'
              : 'Click map to add polygon vertices. Use reset to clear and redraw.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-[420px] rounded-md overflow-hidden border">
            <MapContainer
              center={[centerLat, centerLng]}
              zoom={14}
              style={{ height: '100%', width: '100%' }}
            >
              <JurisdictionMapViewport
                organizationId={effectiveOrganizationId}
                fallbackCenter={[centerLat, centerLng]}
                fallbackZoom={14}
                focusKey={focusKey}
              />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapClickHandler onClick={handleMapClick} />

              {geometryType === 'circle' ? (
                <>
                  <Circle center={[centerLat, centerLng]} radius={radius} pathOptions={{ color: '#2563eb', fillOpacity: 0.15 }} />
                  <CircleMarker center={[centerLat, centerLng]} radius={7} pathOptions={{ color: '#1d4ed8', fillColor: '#1d4ed8', fillOpacity: 0.9 }} />
                </>
              ) : (
                <>
                  {polygonPoints.map((point, index) => (
                    <CircleMarker
                      key={`${point.lat}-${point.lng}-${index}`}
                      center={[point.lat, point.lng]}
                      radius={6}
                      pathOptions={{ color: '#0f766e', fillColor: '#0f766e', fillOpacity: 0.9 }}
                    />
                  ))}
                  {polygonPoints.length >= 3 && (
                    <Polygon
                      positions={polygonPoints.map((point) => [point.lat, point.lng])}
                      pathOptions={{ color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 0.2 }}
                    />
                  )}
                </>
              )}
            </MapContainer>
          </div>

          <div className="flex gap-2">
            <MapFocusToolbar onFocus={() => setFocusKey((k) => k + 1)} className="flex-1" />
            {geometryType === 'polygon' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setPolygonPoints([])}
                className="flex-1"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Reset Polygon
              </Button>
            )}
            <Badge variant="outline" className="flex-1 justify-center py-2">
              {geometryType === 'circle'
                ? `Center: ${centerLat.toFixed(5)}, ${centerLng.toFixed(5)}`
                : `Vertices: ${polygonPoints.length}`}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Circle Configuration */}
      {geometryType === 'circle' && (
        <Card>
          <CardHeader>
            <CardTitle>Circle Configuration</CardTitle>
            <CardDescription>
              Define the center point and radius for the circular boundary
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="center-lat">Center Latitude</Label>
                <Input
                  id="center-lat"
                  type="number"
                  step="0.000001"
                  value={centerLat}
                  onChange={(e) => setCenterLat(parseFloat(e.target.value))}
                  placeholder="-36.8485"
                />
              </div>

              <div>
                <Label htmlFor="center-lng">Center Longitude</Label>
                <Input
                  id="center-lng"
                  type="number"
                  step="0.000001"
                  value={centerLng}
                  onChange={(e) => setCenterLng(parseFloat(e.target.value))}
                  placeholder="174.7633"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="radius">Radius (meters)</Label>
              <Input
                id="radius"
                type="number"
                value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value))}
                placeholder="100"
              />
              <p className="text-xs text-gray-500 mt-1">
                Current radius: {radius}m ({(radius / 1000).toFixed(2)}km)
              </p>
            </div>

            <Button
              variant="outline"
              onClick={getCurrentLocation}
              disabled={useCurrentLocation}
              className="w-full"
            >
              <MapPin className="h-4 w-4 mr-2" />
              {useCurrentLocation ? 'Getting location...' : 'Use My Current Location'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Polygon Configuration */}
      {geometryType === 'polygon' && (
        <Card>
          <CardHeader>
            <CardTitle>Polygon Configuration</CardTitle>
            <CardDescription>
              Add at least 3 points to define the polygon boundary
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {polygonPoints.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Square className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                <p>No points added yet</p>
                <p className="text-sm mt-1">Click "Add Point" to start drawing</p>
              </div>
            ) : (
              <div className="space-y-3">
                {polygonPoints.map((point, index) => (
                  <div key={index} className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-[#1E1E1E] rounded-lg">
                    <Badge variant="outline" className="w-8 h-8 flex items-center justify-center">
                      {index + 1}
                    </Badge>
                    
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        step="0.000001"
                        value={point.lat}
                        onChange={(e) => updatePolygonPoint(index, parseFloat(e.target.value), point.lng)}
                        placeholder="Latitude"
                        className="text-sm"
                      />
                      <Input
                        type="number"
                        step="0.000001"
                        value={point.lng}
                        onChange={(e) => updatePolygonPoint(index, point.lat, parseFloat(e.target.value))}
                        placeholder="Longitude"
                        className="text-sm"
                      />
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removePolygonPoint(index)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" onClick={addPolygonPoint} className="w-full">
              Add Point From Center
            </Button>

            {polygonPoints.length < 3 && polygonPoints.length > 0 && (
              <div className="flex items-start gap-2 text-orange-600 text-sm bg-orange-50 dark:bg-orange-900/20 p-3 rounded-lg">
                <AlertCircle className="h-4 w-4 mt-0.5" />
                <span>At least 3 points required to form a polygon</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
        )}
        
        <Button 
          onClick={handleSave} 
          disabled={isSaving}
          className="flex-1"
        >
          {isSaving ? (
            <>Saving...</>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Geofence
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
