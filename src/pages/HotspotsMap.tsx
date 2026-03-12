import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { 
  MapPin, 
  TrendingUp,
  AlertTriangle,
  Clock,
  Navigation,
  Layers,
  Eye,
  EyeOff
} from 'lucide-react'

interface HotspotData {
  zone_id: string
  zone_name: string
  total_observations: number
  breach_count: number
  unique_vehicles: number
  avg_latitude: number
  avg_longitude: number
  breach_rate: number
  center_lat: number
  center_lng: number
}

function HotspotsViewportController({
  points,
  selectedZone,
}: {
  points: HotspotData[]
  selectedZone: string | null
}) {
  const map = useMap()

  useEffect(() => {
    if (!points.length) return

    const selected = selectedZone
      ? points.find((p) => p.zone_id === selectedZone) ?? null
      : null

    if (selected) {
      map.setView([selected.center_lat, selected.center_lng], Math.max(map.getZoom(), 13), {
        animate: true,
      })
      return
    }

    const bounds = points.map((p) => [p.center_lat, p.center_lng] as [number, number])
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13, animate: true })
  }, [map, points, selectedZone])

  return null
}

export default function HotspotsMap() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const effectiveOrganizationId =
    user?.role === 'master' ? organizationId || null : user?.organization_id || null
  const startDate = dateFrom ? `${dateFrom}T00:00:00Z` : null
  const endDate = dateTo ? `${dateTo}T23:59:59Z` : null
  const [showBreachesOnly, setShowBreachesOnly] = useState(false)
  const [selectedZone, setSelectedZone] = useState<string | null>(null)

  // Fetch hotspot data
  const { data: hotspots, isLoading } = useQuery({
    queryKey: ['hotspots', organizationId, zoneId, dateFrom, dateTo, showBreachesOnly],
    queryFn: async () => {
      let query = supabase
        .from('observations')
        .select('zone_id, gps_latitude, gps_longitude, is_compliant, plate_number, zones(name)')
        

      if (effectiveOrganizationId) {
        query = query.eq('organization_id', effectiveOrganizationId)
      }

      if (zoneId) {
        query = query.eq('zone_id', zoneId)
      }

      if (startDate) {
        query = query.gte('recorded_at', startDate)
      }
      if (endDate) {
        query = query.lte('recorded_at', endDate)
      }

      if (showBreachesOnly) {
        query = query.eq('is_compliant', false)
      }

      const { data, error } = await query

      if (error) throw error

      // Group by zone
      const zoneData = (data || []).reduce((acc: Record<string, any>, obs: any) => {
        const zoneId = obs.zone_id
        const zoneName = obs.zones?.name || 'Unknown'
        
        if (!acc[zoneId]) {
          acc[zoneId] = {
            zone_id: zoneId,
            zone_name: zoneName,
            total_observations: 0,
            breach_count: 0,
            unique_vehicles: new Set(),
            latitudes: [],
            longitudes: [],
          }
        }

        acc[zoneId].total_observations++
        if (!obs.is_compliant) {
          acc[zoneId].breach_count++
        }
        acc[zoneId].unique_vehicles.add(obs.plate_number)
        if (obs.gps_latitude && obs.gps_longitude) {
          acc[zoneId].latitudes.push(obs.gps_latitude)
          acc[zoneId].longitudes.push(obs.gps_longitude)
        }

        return acc
      }, {})

      // Calculate averages and format data
      return Object.values(zoneData).map((zone: any) => {
        const avgLat = zone.latitudes.length > 0
          ? zone.latitudes.reduce((sum: number, val: number) => sum + val, 0) / zone.latitudes.length
          : 0
        const avgLng = zone.longitudes.length > 0
          ? zone.longitudes.reduce((sum: number, val: number) => sum + val, 0) / zone.longitudes.length
          : 0

        return {
          zone_id: zone.zone_id,
          zone_name: zone.zone_name,
          total_observations: zone.total_observations,
          breach_count: zone.breach_count,
          unique_vehicles: zone.unique_vehicles.size,
          breach_rate: zone.total_observations > 0
            ? (zone.breach_count / zone.total_observations) * 100
            : 0,
          center_lat: avgLat,
          center_lng: avgLng,
        } as HotspotData
      }).sort((a, b) => b.total_observations - a.total_observations)
    },
  })

  // Calculate stats
  const stats = hotspots ? {
    total_zones: hotspots.length,
    high_activity: hotspots.filter(h => h.total_observations > 50).length,
    high_breach_rate: hotspots.filter(h => h.breach_rate > 20).length,
    total_observations: hotspots.reduce((sum, h) => sum + h.total_observations, 0),
  } : null

  const getActivityColor = (count: number) => {
    if (count > 100) return 'bg-red-600'
    if (count > 50) return 'bg-orange-600'
    if (count > 20) return 'bg-yellow-600'
    return 'bg-green-600'
  }

  const getBreachRateColor = (rate: number) => {
    if (rate > 30) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
    if (rate > 15) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
    if (rate > 5) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
  }

  const mappedHotspots = (hotspots || []).filter(
    (h) => Number.isFinite(h.center_lat) && Number.isFinite(h.center_lng) && h.center_lat !== 0 && h.center_lng !== 0
  )

  const defaultCenter: [number, number] = mappedHotspots.length > 0
    ? [mappedHotspots[0].center_lat, mappedHotspots[0].center_lng]
    : [-41.2865, 174.7762]

  const sortedMappedHotspots = useMemo(
    () => [...mappedHotspots].sort((a, b) => b.total_observations - a.total_observations),
    [mappedHotspots]
  )

  const hotspotRadius = (count: number) => {
    if (count > 100) return 20
    if (count > 50) return 16
    if (count > 20) return 12
    return 9
  }

  const hotspotColor = (count: number) => {
    if (count > 100) return '#dc2626'
    if (count > 50) return '#ea580c'
    if (count > 20) return '#ca8a04'
    return '#16a34a'
  }

  return (
    <AppLayout
      title="Hotspots Heatmap"
      description="GPS heatmap showing high-activity enforcement zones"
      showBackButton
    >
      <GlobalFilterRibbon />

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Total Zones
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{stats.total_zones}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-600 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                High Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600">{stats.high_activity}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                High Breach Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{stats.high_breach_rate}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-purple-600 flex items-center gap-2">
                <Navigation className="h-4 w-4" />
                Total Observations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">{stats.total_observations}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 mb-6">
        <Button
          variant={showBreachesOnly ? 'default' : 'outline'}
          onClick={() => setShowBreachesOnly(!showBreachesOnly)}
          size="sm"
        >
          {showBreachesOnly ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
          {showBreachesOnly ? 'Showing Breaches Only' : 'Show All'}
        </Button>
        <Button variant="outline" size="sm">
          <Layers className="h-4 w-4 mr-2" />
          Layer Options
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Map Placeholder - Left 2 columns */}
        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <div className="h-[600px]">
              <MapContainer
                center={defaultCenter}
                zoom={11}
                style={{ height: '100%', width: '100%' }}
              >
                <HotspotsViewportController
                  points={sortedMappedHotspots}
                  selectedZone={selectedZone}
                />

                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {mappedHotspots.map((hotspot) => (
                  <CircleMarker
                    key={hotspot.zone_id}
                    center={[hotspot.center_lat, hotspot.center_lng]}
                    radius={hotspotRadius(hotspot.total_observations)}
                    pathOptions={{
                      color: hotspotColor(hotspot.total_observations),
                      fillColor: hotspotColor(hotspot.total_observations),
                      fillOpacity: selectedZone === hotspot.zone_id ? 0.75 : 0.5,
                      weight: selectedZone === hotspot.zone_id ? 3 : 1,
                    }}
                    eventHandlers={{
                      click: () => setSelectedZone(selectedZone === hotspot.zone_id ? null : hotspot.zone_id),
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-semibold">{hotspot.zone_name}</p>
                        <p>Observations: {hotspot.total_observations}</p>
                        <p>Breaches: {hotspot.breach_count}</p>
                        <p>Breach rate: {hotspot.breach_rate.toFixed(1)}%</p>
                        <p>Vehicles: {hotspot.unique_vehicles}</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          </CardContent>
        </Card>

        {/* Zone List - Right column */}
        <Card>
          <CardHeader>
            <CardTitle>Zone Activity</CardTitle>
            <CardDescription>Ranked by observation count</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              </div>
            ) : hotspots && hotspots.length > 0 ? (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {hotspots.map((hotspot) => (
                  <div
                    key={hotspot.zone_id}
                    className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                      selectedZone === hotspot.zone_id
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-400'
                    }`}
                    onClick={() => setSelectedZone(
                      selectedZone === hotspot.zone_id ? null : hotspot.zone_id
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-3 h-3 ${getActivityColor(hotspot.total_observations)} rounded-full`}></div>
                          <span className="font-semibold text-sm">{hotspot.zone_name}</span>
                        </div>
                        <p className="text-xs text-gray-500 font-mono">
                          {hotspot.center_lat.toFixed(6)}, {hotspot.center_lng.toFixed(6)}
                        </p>
                      </div>
                      <Badge className={getBreachRateColor(hotspot.breach_rate)}>
                        {hotspot.breach_rate.toFixed(0)}%
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-gray-100 dark:bg-gray-800 rounded p-2 text-center">
                        <div className="font-bold text-blue-600">{hotspot.total_observations}</div>
                        <div className="text-gray-600 dark:text-gray-400">Observations</div>
                      </div>
                      <div className="bg-gray-100 dark:bg-gray-800 rounded p-2 text-center">
                        <div className="font-bold text-red-600">{hotspot.breach_count}</div>
                        <div className="text-gray-600 dark:text-gray-400">Breaches</div>
                      </div>
                      <div className="bg-gray-100 dark:bg-gray-800 rounded p-2 text-center">
                        <div className="font-bold text-purple-600">{hotspot.unique_vehicles}</div>
                        <div className="text-gray-600 dark:text-gray-400">Vehicles</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No hotspot data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
