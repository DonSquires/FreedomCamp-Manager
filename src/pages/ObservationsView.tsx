import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { supabase } from '@/lib/supabase'
import { JurisdictionMapViewport } from '@/components/features/JurisdictionMapViewport'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { MapFocusToolbar } from '@/components/features/MapFocusToolbar'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  List,
  Map,
  Image as ImageIcon,
  Search,
  CheckCircle,
  AlertTriangle,
  MapPin,
  Clock,
  Car,
  RefreshCw,
  Flame,
  Eye,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { getObservationPhotoUrl } from '@/lib/photoUtils'

interface Observation {
  id: string
  plate_number: string
  recorded_at: string
  gps_latitude: number | null
  gps_longitude: number | null
  photo_url: string | null
  is_compliant: boolean
  processing_status: string | null
  zone: { name: string } | null
  recorded_by_profile: { first_name: string; last_name: string } | null
}

// Compute a simple opacity-based "heat" colour from 0–1 intensity
function heatColor(intensity: number): string {
  // blue → yellow → red
  const r = Math.round(Math.min(255, intensity * 510))
  const g = Math.round(Math.max(0, 255 - Math.abs(intensity - 0.5) * 510))
  const b = Math.round(Math.max(0, 255 - intensity * 510))
  return `rgb(${r},${g},${b})`
}

export default function ObservationsView() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const effectiveOrganizationId =
    user?.role === 'master' ? organizationId || null : user?.organization_id || null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null
  const [searchPlate, setSearchPlate] = useState('')
  const [activeTab, setActiveTab] = useState('list')
  const [heatmapMode, setHeatmapMode] = useState(false)
  const [selectedPhoto, setSelectedPhoto] = useState<Observation | null>(null)
  const [focusKey, setFocusKey] = useState(0)

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const { data: observations = [], isLoading, refetch } = useQuery({
    queryKey: ['observations-view', organizationId, zoneId, dateFrom, dateTo, user?.organization_id],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select(`
          id,
          plate_number,
          recorded_at,
          gps_latitude,
          gps_longitude,
          photo_url,
          is_compliant,
          processing_status,
          zone:zones!zone_id(name),
          recorded_by_profile:user_profiles!recorded_by(first_name, last_name)
        `)
        
        .order('recorded_at', { ascending: false })
        .limit(500)

      if (effectiveOrganizationId) {
        q = q.eq('organization_id', effectiveOrganizationId)
      }

      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('recorded_at', startDate)
      if (endDate)   q = q.lte('recorded_at', endDate)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as Observation[]
    },
  })

  // ── Derived data ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!searchPlate.trim()) return observations
    const term = searchPlate.trim().toUpperCase()
    return observations.filter((o) => o.plate_number?.toUpperCase().includes(term))
  }, [observations, searchPlate])

  const withGPS = useMemo(() => filtered.filter((o) => o.gps_latitude && o.gps_longitude), [filtered])
  const withPhoto = useMemo(() => filtered.filter((o) => getObservationPhotoUrl(o as any)), [filtered])

  // For heatmap: cluster GPS points into a grid and calculate density
  const heatCells = useMemo(() => {
    if (!heatmapMode || withGPS.length === 0) return []
    const grid: Record<string, { lat: number; lng: number; count: number }> = {}
    withGPS.forEach((o) => {
      const lat = Math.round(o.gps_latitude! * 200) / 200   // ~500m grid
      const lng = Math.round(o.gps_longitude! * 200) / 200
      const key = `${lat},${lng}`
      if (!grid[key]) grid[key] = { lat, lng, count: 0 }
      grid[key].count += 1
    })
    const cells = Object.values(grid)
    const max = Math.max(...cells.map((c) => c.count))
    return cells.map((c) => ({ ...c, intensity: c.count / max }))
  }, [withGPS, heatmapMode])

  const defaultCenter: [number, number] =
    withGPS.length > 0
      ? [withGPS[0].gps_latitude!, withGPS[0].gps_longitude!]
      : [-36.848, 174.763]  // Auckland, NZ

  const totalCount = filtered.length
  const breachCount = filtered.filter((o) => !o.is_compliant).length
  const compliantCount = filtered.filter((o) => o.is_compliant).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout title="Observations" description="Map, photos and list of all field observations" showBackButton>
      <GlobalFilterRibbon />

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
          <Car className="h-5 w-5 text-blue-500 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-bold">{totalCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
          <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">Compliant</p>
            <p className="text-xl font-bold text-green-600">{compliantCount}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
          <div>
            <p className="text-xs text-muted-foreground">In Breach</p>
            <p className="text-xl font-bold text-red-600">{breachCount}</p>
          </div>
        </div>
      </div>

      {/* Search + Refresh */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search plate number..."
            value={searchPlate}
            onChange={(e) => setSearchPlate(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="list" className="flex-1 gap-1.5">
            <List className="h-4 w-4" /> List
          </TabsTrigger>
          <TabsTrigger value="map" className="flex-1 gap-1.5">
            <Map className="h-4 w-4" /> Map
          </TabsTrigger>
          <TabsTrigger value="photos" className="flex-1 gap-1.5">
            <ImageIcon className="h-4 w-4" /> Photos
          </TabsTrigger>
        </TabsList>

        {/* ── LIST TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="list">
          {isLoading ? (
            <Card><CardContent className="pt-6 text-center text-muted-foreground py-12">Loading...</CardContent></Card>
          ) : filtered.length === 0 ? (
            <Card><CardContent className="pt-6 text-center text-muted-foreground py-12">No observations found</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((obs) => (
                <Card
                  key={obs.id}
                  className={`border-l-4 ${obs.is_compliant ? 'border-l-green-500' : 'border-l-red-500'}`}
                >
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-start gap-3">
                      {/* Thumbnail */}
                      <div
                        className="h-14 w-14 shrink-0 rounded-md overflow-hidden bg-muted cursor-pointer"
                        onClick={() => getObservationPhotoUrl(obs as any) && setSelectedPhoto(obs)}
                      >
                        {getObservationPhotoUrl(obs as any) ? (
                          <img
                            src={getObservationPhotoUrl(obs as any)!}
                            alt={obs.plate_number}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-full flex items-center justify-center">
                            <Car className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-mono font-bold text-base">{obs.plate_number || '—'}</span>
                          <Badge variant={obs.is_compliant ? 'default' : 'destructive'} className="shrink-0">
                            {obs.is_compliant ? 'Compliant' : 'In Breach'}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {obs.zone?.name || 'Unknown zone'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(obs.recorded_at)}
                          </span>
                          {obs.gps_latitude && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 text-blue-400" />
                              {obs.gps_latitude.toFixed(4)}, {obs.gps_longitude!.toFixed(4)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── MAP TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="map">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Observation Locations ({withGPS.length} with GPS)
                </CardTitle>
                <div className="flex items-center gap-2">
                  <MapFocusToolbar onFocus={() => setFocusKey((k) => k + 1)} className="gap-1.5" />
                  <Button
                    variant={heatmapMode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setHeatmapMode(!heatmapMode)}
                    className="gap-1.5"
                  >
                    <Flame className="h-4 w-4" />
                    {heatmapMode ? 'Heatmap on' : 'Heatmap'}
                  </Button>
                </div>
              </div>
              <CardDescription className="text-xs">
                {heatmapMode
                  ? 'Density heatmap — red = more observations, blue = fewer'
                  : 'Green = compliant, red = breach. Click a marker for details.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {withGPS.length === 0 ? (
                <div className="text-center text-muted-foreground py-16">
                  No GPS data available for the selected filters
                </div>
              ) : (
                <div style={{ height: '520px' }}>
                  <MapContainer
                    center={defaultCenter}
                    zoom={12}
                    style={{ height: '100%', width: '100%', borderRadius: '0 0 0.5rem 0.5rem' }}
                  >
                    <JurisdictionMapViewport
                      organizationId={effectiveOrganizationId}
                      fallbackCenter={defaultCenter}
                      fallbackZoom={12}
                      focusKey={focusKey}
                    />
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {heatmapMode ? (
                      // Heatmap: render density circles
                      heatCells.map((cell, i) => (
                        <CircleMarker
                          key={i}
                          center={[cell.lat, cell.lng]}
                          radius={14 + cell.intensity * 20}
                          pathOptions={{
                            fillColor: heatColor(cell.intensity),
                            fillOpacity: 0.55,
                            stroke: false,
                          }}
                        >
                          <Popup>
                            <div className="text-sm">
                              <strong>{cell.count}</strong> observation{cell.count !== 1 ? 's' : ''}
                            </div>
                          </Popup>
                        </CircleMarker>
                      ))
                    ) : (
                      // Marker mode: clustered dots coloured by compliance
                      <MarkerClusterGroup chunkedLoading>
                        {withGPS.map((obs) => (
                          <CircleMarker
                            key={obs.id}
                            center={[obs.gps_latitude!, obs.gps_longitude!]}
                            radius={7}
                            pathOptions={{
                              fillColor: obs.is_compliant ? '#22c55e' : '#ef4444',
                              fillOpacity: 0.85,
                              color: obs.is_compliant ? '#16a34a' : '#dc2626',
                              weight: 1.5,
                            }}
                          >
                            <Popup>
                              <div className="space-y-1 text-sm min-w-[160px]">
                                <div className="font-mono font-bold text-base">{obs.plate_number}</div>
                                <div className="text-muted-foreground">{obs.zone?.name}</div>
                                <div className="text-xs">{formatDateTime(obs.recorded_at)}</div>
                                <Badge
                                  variant={obs.is_compliant ? 'default' : 'destructive'}
                                  className="mt-1"
                                >
                                  {obs.is_compliant ? 'Compliant' : 'In Breach'}
                                </Badge>
                                {getObservationPhotoUrl(obs as any) && (
                                  <button
                                    className="flex items-center gap-1 text-xs text-blue-600 mt-1 underline"
                                    onClick={() => setSelectedPhoto(obs)}
                                  >
                                    <Eye className="h-3 w-3" /> View photo
                                  </button>
                                )}
                              </div>
                            </Popup>
                          </CircleMarker>
                        ))}
                      </MarkerClusterGroup>
                    )}
                  </MapContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PHOTOS TAB ───────────────────────────────────────────────── */}
        <TabsContent value="photos">
          {withPhoto.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground py-12">
                No photos available for the selected filters
              </CardContent>
            </Card>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {withPhoto.length} observation{withPhoto.length !== 1 ? 's' : ''} with photos
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {withPhoto.map((obs) => (
                  <div
                    key={obs.id}
                    className="relative group cursor-pointer rounded-md overflow-hidden aspect-square bg-muted border hover:ring-2 hover:ring-blue-500 transition-all"
                    onClick={() => setSelectedPhoto(obs)}
                  >
                    <img
                      src={getObservationPhotoUrl(obs as any)!}
                      alt={obs.plate_number}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {/* Overlay on hover */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                    {/* Bottom caption */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white px-1.5 py-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold truncate">{obs.plate_number}</span>
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${obs.is_compliant ? 'bg-green-400' : 'bg-red-400'}`}
                        />
                      </div>
                      <div className="text-[10px] text-white/70 truncate">{obs.zone?.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Full-size photo dialog ───────────────────────────────────────── */}
      <Dialog open={!!selectedPhoto} onOpenChange={(open) => { if (!open) setSelectedPhoto(null) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-lg">
              {selectedPhoto?.plate_number}
              <span className="ml-3 text-sm font-normal text-muted-foreground">
                {selectedPhoto?.zone?.name} — {selectedPhoto && formatDateTime(selectedPhoto.recorded_at)}
              </span>
            </DialogTitle>
          </DialogHeader>
          {getObservationPhotoUrl(selectedPhoto as any) && (
            <div className="mt-2">
              <img
                src={getObservationPhotoUrl(selectedPhoto as any)!}
                alt={selectedPhoto.plate_number}
                className="w-full rounded-md object-contain max-h-[60vh]"
              />
              <div className="flex items-center gap-3 mt-3">
                <Badge variant={selectedPhoto.is_compliant ? 'default' : 'destructive'}>
                  {selectedPhoto.is_compliant ? 'Compliant' : 'In Breach'}
                </Badge>
                {selectedPhoto.gps_latitude && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {selectedPhoto.gps_latitude.toFixed(5)}, {selectedPhoto.gps_longitude!.toFixed(5)}
                  </span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
