/**
 * ZoneMapViewer Component
 * Interactive map with zone boundaries
 */

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Map,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  MapPin,
  Navigation,
} from 'lucide-react'

interface Zone {
  id: string
  name: string
  geometry?: {
    type: string
    coordinates: number[][][]
  }
  location_lat?: number
  location_lng?: number
  is_active: boolean
  zone_type?: string
}

interface ZoneMapViewerProps {
  zones: Zone[]
  selectedZoneId?: string
  onZoneClick?: (zoneId: string) => void
  showLabels?: boolean
  interactive?: boolean
}

export function ZoneMapViewer({
  zones,
  selectedZoneId,
  onZoneClick,
  showLabels = true,
  interactive = true,
}: ZoneMapViewerProps) {
  const [mapCenter, setMapCenter] = useState<[number, number]>([-41.2865, 174.7762]) // Wellington, NZ
  const [zoomLevel, setZoomLevel] = useState(13)
  const [showInactive, setShowInactive] = useState(false)

  // Calculate bounds from all zones
  useEffect(() => {
    if (zones && zones.length > 0) {
      const coordinates = zones
        .filter(z => z.location_lat && z.location_lng)
        .map(z => [z.location_lat!, z.location_lng!])

      if (coordinates.length > 0) {
        const avgLat = coordinates.reduce((sum, [lat]) => sum + lat, 0) / coordinates.length
        const avgLng = coordinates.reduce((sum, [, lng]) => sum + lng, 0) / coordinates.length
        setMapCenter([avgLat, avgLng])
      }
    }
  }, [zones])

  const getZoneColor = (zone: Zone) => {
    if (!zone.is_active) return '#999999'
    
    switch (zone.zone_type) {
      case 'specific':
        return '#3b82f6' // blue
      case 'general':
        return '#10b981' // green
      default:
        return '#6366f1' // indigo
    }
  }

  const filteredZones = zones.filter(z => showInactive || z.is_active)

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 1, 18))
  }

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 1, 8))
  }

  const handleRecenter = () => {
    if (zones && zones.length > 0) {
      const coordinates = zones
        .filter(z => z.location_lat && z.location_lng)
        .map(z => [z.location_lat!, z.location_lng!])

      if (coordinates.length > 0) {
        const avgLat = coordinates.reduce((sum, [lat]) => sum + lat, 0) / coordinates.length
        const avgLng = coordinates.reduce((sum, [, lng]) => sum + lng, 0) / coordinates.length
        setMapCenter([avgLat, avgLng])
        setZoomLevel(13)
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Map className="h-5 w-5" />
              Zone Map
            </CardTitle>
            <CardDescription className="mt-1">
              Interactive zone boundaries visualization
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {filteredZones.length} zone{filteredZones.length !== 1 ? 's' : ''}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInactive(!showInactive)}
            >
              <Layers className="h-4 w-4 mr-2" />
              {showInactive ? 'Hide Inactive' : 'Show Inactive'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Map container */}
        <div className="relative bg-muted rounded-lg overflow-hidden" style={{ height: '500px' }}>
          {/* Map placeholder (would integrate with Leaflet/Mapbox) */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Map className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-20" />
              <p className="text-muted-foreground">
                Map integration ready
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Center: {mapCenter[0].toFixed(4)}, {mapCenter[1].toFixed(4)}
              </p>
              <p className="text-sm text-muted-foreground">
                Zoom: {zoomLevel}
              </p>
            </div>
          </div>

          {/* Map controls */}
          {interactive && (
            <div className="absolute top-4 right-4 flex flex-col gap-2">
              <Button
                variant="secondary"
                size="icon"
                onClick={handleZoomIn}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                onClick={handleZoomOut}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                onClick={handleRecenter}
              >
                <Navigation className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Zone markers visualization */}
          <div className="absolute bottom-4 left-4 max-w-xs">
            <div className="bg-background/95 backdrop-blur-sm p-3 rounded-lg border space-y-2 max-h-48 overflow-y-auto">
              {filteredZones.slice(0, 5).map((zone) => (
                <button
                  key={zone.id}
                  className={`w-full text-left p-2 rounded hover:bg-muted transition-colors ${
                    selectedZoneId === zone.id ? 'bg-primary/10 border border-primary' : ''
                  }`}
                  onClick={() => onZoneClick?.(zone.id)}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: getZoneColor(zone) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{zone.name}</div>
                      {zone.location_lat && zone.location_lng && (
                        <div className="text-xs text-muted-foreground">
                          {zone.location_lat.toFixed(4)}, {zone.location_lng.toFixed(4)}
                        </div>
                      )}
                    </div>
                    {!zone.is_active && (
                      <Badge variant="outline" className="text-xs">Inactive</Badge>
                    )}
                  </div>
                </button>
              ))}
              {filteredZones.length > 5 && (
                <div className="text-xs text-center text-muted-foreground pt-1 border-t">
                  +{filteredZones.length - 5} more zones
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-600" />
            <span>Specific Zone</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-600" />
            <span>General Zone</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-400" />
            <span>Inactive</span>
          </div>
        </div>

        {/* Instructions */}
        <div className="text-xs text-muted-foreground text-center border-t pt-3">
          <p>Click on zone markers to view details • Use controls to zoom and navigate</p>
          <p className="mt-1">
            Map integration ready for Leaflet or Mapbox GL JS
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
