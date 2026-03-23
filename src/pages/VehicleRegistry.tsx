import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { LoadingSpinner } from '@/components/features/LoadingSpinner'
import {
  Search, Car, CheckCircle, AlertTriangle, Shield, Calendar,
  ChevronRight, SlidersHorizontal, BookOpen, Camera, Eye, X,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { getObservationPhotoUrl } from '@/lib/photoUtils'
import { HOMELESS_UI_STATUSES, isHomelessForUi } from '@/lib/homelessStatus'

// ─── Types ───────────────────────────────────────────────────────────────────

interface RegistryVehicle {
  vehicle_id: string
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null
  vehicle_color: string | null
  self_contained: boolean
  self_contained_expiry: string | null
  is_exempt: boolean
  homeless_status: string | null
  profile_photo: string | null
  total_observations: number
  total_breaches: number
  last_seen_at: string | null
}

interface CanonicalScvRow {
  plate_number: string
  is_self_contained: boolean
  certificate_expiry: string | null
  source: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface ObservationWithPhoto {
  observation_id: string
  plate_number: string | null
  recorded_at: string
  photo: string | null
  photo_url: string | null
  is_compliant: boolean | null
  self_contained: boolean | null
  sticker_presence: boolean | null
  zone: { name: string } | null
}

interface ScvMismatch {
  plate_number: string
  canonical_is_sc: boolean
  canonical_expiry: string | null
  canonical_source: string | null
  obs_self_contained: boolean | null
  obs_sticker_presence: boolean | null
  obs_recorded_at: string
  obs_zone: string | null
  mismatch_type: string
}

type SelfContainedFilter = 'all' | 'yes' | 'no'
type ComplianceFilter = 'all' | 'compliant' | 'breach' | 'homeless' | 'exempt'

// ─── Tab: Vehicles (existing) ─────────────────────────────────────────────────

function VehiclesTab({
  effectiveOrganizationId,
}: {
  effectiveOrganizationId: string | null
}) {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [selfContainedFilter, setSelfContainedFilter] = useState<SelfContainedFilter>('all')
  const [complianceFilter, setComplianceFilter] = useState<ComplianceFilter>('all')
  const [showFilters, setShowFilters] = useState(false)

  const { data: vehicles, isLoading } = useQuery({
    queryKey: ['vehicle-registry', effectiveOrganizationId, searchQuery, selfContainedFilter, complianceFilter],
    queryFn: async () => {
      let query = (supabase as any)
        .from('canonical_vehicles')
        .select([
          'vehicle_id', 'plate_number', 'vehicle_make', 'vehicle_model', 'vehicle_year', 'vehicle_color',
          'self_contained', 'self_contained_expiry', 'is_exempt',
          'homeless_status', 'profile_photo',
          'total_observations', 'total_breaches', 'last_seen_at',
        ].join(','))
        .order('plate_number', { ascending: true })
        .limit(200)

      if (effectiveOrganizationId) {
        const { data: matchingObservations, error: matchingObsError } = await (supabase as any)
          .from('observations')
          .select('plate_number')
          .eq('organization_id', effectiveOrganizationId)

        if (matchingObsError) throw matchingObsError

        const plateRows = (matchingObservations ?? []) as Array<{ plate_number: string | null }>
        const matchingPlates = [...new Set(plateRows.map((o) => o.plate_number).filter(Boolean) as string[])]

        if (matchingPlates.length === 0) {
          return [] as RegistryVehicle[]
        }

        query = query.in('plate_number', matchingPlates)
      }

      if (searchQuery.trim()) {
        query = query.or(
          `plate_number.ilike.%${searchQuery.trim()}%,vehicle_make.ilike.%${searchQuery.trim()}%,vehicle_model.ilike.%${searchQuery.trim()}%`
        )
      }

      if (selfContainedFilter === 'yes') query = query.eq('self_contained', true)
      else if (selfContainedFilter === 'no') query = query.eq('self_contained', false)

      if (complianceFilter === 'compliant') query = query.eq('total_breaches', 0).eq('is_exempt', false)
      else if (complianceFilter === 'breach') query = query.gt('total_breaches', 0)
      else if (complianceFilter === 'homeless') query = query.in('homeless_status', HOMELESS_UI_STATUSES)
      else if (complianceFilter === 'exempt') query = query.eq('is_exempt', true)

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as RegistryVehicle[]
    },
    enabled: !!user,
  })

  const total = vehicles?.length ?? 0
  const selfContainedCount = vehicles?.filter((v) => v.self_contained).length ?? 0
  const breachCount = vehicles?.filter((v) => v.total_breaches > 0 && !isHomelessForUi(v.homeless_status)).length ?? 0
  const homelessCount = vehicles?.filter((v) => isHomelessForUi(v.homeless_status)).length ?? 0
  const exemptCount = vehicles?.filter((v) => v.is_exempt).length ?? 0

  const complianceBadge = (v: RegistryVehicle) => {
    if (v.is_exempt) return <Badge variant="outline" className="text-purple-700 border-purple-300">Exempt</Badge>
    if (isHomelessForUi(v.homeless_status) && v.total_breaches > 0)
      return <Badge variant="outline" className="text-amber-700 border-amber-300">Breach Exempt (FC Act)</Badge>
    if (v.total_breaches > 0)
      return <Badge variant="destructive">{v.total_breaches} Breach{v.total_breaches !== 1 ? 'es' : ''}</Badge>
    return <Badge variant="outline" className="text-green-700 border-green-300">Compliant</Badge>
  }

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Vehicles', value: total, icon: Car, color: 'text-blue-600' },
          { label: 'Self-Contained', value: selfContainedCount, icon: Shield, color: 'text-green-600' },
          { label: 'With Breaches', value: breachCount, icon: AlertTriangle, color: 'text-red-600' },
          { label: 'Homeless', value: homelessCount, icon: AlertTriangle, color: 'text-orange-600' },
          { label: 'Exempt', value: exemptCount, icon: CheckCircle, color: 'text-purple-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`h-8 w-8 ${color}`} />
              <div>
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search & Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                className="pl-9"
                placeholder="Search by plate, make, or model…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowFilters((v) => !v)} className="gap-1.5">
              <SlidersHorizontal className="h-4 w-4" />
              Filters
            </Button>
          </div>

          {showFilters && (
            <div className="flex flex-wrap gap-3 pt-1">
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Self-Contained</label>
                <Select value={selfContainedFilter} onValueChange={(v) => setSelfContainedFilter(v as SelfContainedFilter)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Compliance</label>
                <Select value={complianceFilter} onValueChange={(v) => setComplianceFilter(v as ComplianceFilter)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="compliant">Compliant</SelectItem>
                    <SelectItem value="breach">Has Breaches</SelectItem>
                    <SelectItem value="homeless">Homeless</SelectItem>
                    <SelectItem value="exempt">Exempt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setSelfContainedFilter('all'); setComplianceFilter('all') }}>
                  Reset
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <LoadingSpinner variant="paperwork" text="Searching vehicle records…" />
      ) : !vehicles || vehicles.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Car className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No vehicles found</p>
            <p className="text-xs text-gray-400 mt-1">Try adjusting your search or filters</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              {total} Vehicle{total !== 1 ? 's' : ''} found
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {vehicles.map((vehicle) => (
                <button
                  key={vehicle.vehicle_id}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-4"
                  onClick={() => navigate(`/vehicles/${vehicle.vehicle_id}`)}
                >
                  <div className="h-10 w-14 rounded bg-gray-100 flex-shrink-0 flex items-center justify-center overflow-hidden">
                    {vehicle.profile_photo ? (
                      <img src={vehicle.profile_photo} alt={vehicle.plate_number} className="h-full w-full object-cover" />
                    ) : (
                      <Car className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm">{vehicle.plate_number}</span>
                      {vehicle.self_contained && (
                        <Badge variant="secondary" className="text-xs py-0">
                          <Shield className="h-3 w-3 mr-1" />SC
                        </Badge>
                      )}
                      {complianceBadge(vehicle)}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      {[vehicle.vehicle_make, vehicle.vehicle_model, vehicle.vehicle_year, vehicle.vehicle_color].filter(Boolean).join(' · ') || 'Vehicle details unknown'}
                    </div>
                  </div>
                  <div className="hidden sm:flex flex-col items-end text-xs text-gray-400 gap-0.5 shrink-0">
                    <span>{vehicle.total_observations} scan{vehicle.total_observations !== 1 ? 's' : ''}</span>
                    {vehicle.last_seen_at && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDateTime(vehicle.last_seen_at)}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Tab: SCV Records (read-only canonical_scv) ───────────────────────────────

function ScvRecordsTab() {
  const [search, setSearch] = useState('')
  const [filterSc, setFilterSc] = useState<'all' | 'yes' | 'no'>('all')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['registry-canonical-scv', search, filterSc],
    queryFn: async () => {
      let q = (supabase.from('canonical_scv') as any)
        .select('*')
        .order('plate_number')
        .limit(500)
      if (filterSc === 'yes') q = q.eq('is_self_contained', true)
      if (filterSc === 'no') q = q.eq('is_self_contained', false)
      if (search.trim()) q = q.ilike('plate_number', `%${search.trim()}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CanonicalScvRow[]
    },
  })

  const scCount = rows.filter((r) => r.is_self_contained).length

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search plate…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterSc} onValueChange={(v) => setFilterSc(v as any)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="yes">Self-contained only</SelectItem>
            <SelectItem value="no">Not self-contained</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{rows.length} records</span>
        <span className="text-green-600 font-medium">{scCount} self-contained</span>
        <span className="text-orange-600 font-medium">{rows.length - scCount} not SC</span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No records found</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y max-h-[60vh] overflow-y-auto">
              {rows.map((row) => (
                <div key={row.plate_number} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <Shield className={`h-4 w-4 shrink-0 ${row.is_self_contained ? 'text-green-600' : 'text-muted-foreground'}`} />
                  <span className="font-mono font-bold text-sm w-28 shrink-0">{row.plate_number}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    {row.is_self_contained ? (
                      <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">SC Certified</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">Not SC</Badge>
                    )}
                    {row.certificate_expiry && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />Exp: {row.certificate_expiry}
                      </span>
                    )}
                    {row.source && <span className="text-xs text-muted-foreground">src: {row.source}</span>}
                    {row.notes && <span className="text-xs text-muted-foreground line-clamp-1">{row.notes}</span>}
                  </div>
                  {row.verified_at && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      Verified: {formatDateTime(row.verified_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Tab: Observations with Photos ────────────────────────────────────────────

function ObservationsTab({
  effectiveOrganizationId,
  zoneId,
  dateFrom,
  dateTo,
}: {
  effectiveOrganizationId: string | null
  zoneId: string | null
  dateFrom: string | null
  dateTo: string | null
}) {
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null
  const [searchPlate, setSearchPlate] = useState('')
  const [selectedPhoto, setSelectedPhoto] = useState<ObservationWithPhoto | null>(null)

  const { data: observations = [], isLoading } = useQuery({
    queryKey: ['registry-observations', effectiveOrganizationId, zoneId, dateFrom, dateTo, searchPlate],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select(`
          observation_id,
          plate_number,
          recorded_at,
          photo,
          photo_url,
          is_compliant,
          self_contained,
          sticker_presence,
          zone:zones!zone_id(name)
        `)
        .order('recorded_at', { ascending: false })
        .limit(200)

      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('recorded_at', startDate)
      if (endDate) q = q.lte('recorded_at', endDate)
      if (searchPlate.trim()) q = q.ilike('plate_number', `%${searchPlate.trim()}%`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ObservationWithPhoto[]
    },
  })

  const withPhoto = observations.filter((o) => !!getObservationPhotoUrl(o as any))

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Filter by plate…" value={searchPlate} onChange={(e) => setSearchPlate(e.target.value)} />
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>{observations.length} observations</span>
        <span className="text-blue-600 font-medium">{withPhoto.length} with photos</span>
      </div>

      {!zoneId && (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground text-sm">
            <Eye className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            Select a zone from the filter bar above to view observations.
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading observations…</div>
      ) : zoneId && observations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Camera className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p>No observations found for the selected zone and filters.</p>
          </CardContent>
        </Card>
      ) : zoneId && (
        <>
          {withPhoto.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No photos available for the selected filters.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {withPhoto.map((obs) => {
                const photoUrl = getObservationPhotoUrl(obs as any)
                return (
                  <div
                    key={obs.observation_id}
                    className="relative group cursor-pointer rounded-lg overflow-hidden aspect-square bg-muted border hover:ring-2 hover:ring-blue-500 transition-all"
                    onClick={() => setSelectedPhoto(obs)}
                  >
                    <img src={photoUrl!} alt={obs.plate_number ?? 'Observation'} className="h-full w-full object-cover" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute bottom-0 left-0 right-0 p-2 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="font-mono font-bold text-xs">{obs.plate_number ?? '—'}</div>
                      <div className="text-[10px] opacity-80">{formatDateTime(obs.recorded_at)}</div>
                      {obs.zone && <div className="text-[10px] opacity-80">{(obs.zone as any).name}</div>}
                    </div>
                    {obs.self_contained && (
                      <div className="absolute top-1 right-1">
                        <Badge variant="secondary" className="text-[10px] px-1 py-0">
                          <Shield className="h-2.5 w-2.5 mr-0.5" />SC
                        </Badge>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Photo lightbox */}
          <Dialog open={!!selectedPhoto} onOpenChange={(open) => { if (!open) setSelectedPhoto(null) }}>
            <DialogContent className="max-w-3xl p-0 overflow-hidden">
              {selectedPhoto && (
                <div>
                  <img
                    src={getObservationPhotoUrl(selectedPhoto as any)!}
                    alt={selectedPhoto.plate_number ?? 'Observation'}
                    className="w-full max-h-[70vh] object-contain bg-black"
                  />
                  <div className="p-4 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold">{selectedPhoto.plate_number ?? '—'}</span>
                      {selectedPhoto.self_contained && (
                        <Badge variant="secondary" className="text-xs">
                          <Shield className="h-3 w-3 mr-1" />SC
                        </Badge>
                      )}
                      {selectedPhoto.is_compliant === false && <Badge variant="destructive">Breach</Badge>}
                      {selectedPhoto.is_compliant === true && <Badge variant="outline" className="text-green-700 border-green-300">Compliant</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatDateTime(selectedPhoto.recorded_at)}
                      {selectedPhoto.zone && <> · {(selectedPhoto.zone as any).name}</>}
                    </div>
                    {selectedPhoto.sticker_presence !== null && (
                      <div className="text-sm text-muted-foreground">
                        SC Sticker: {selectedPhoto.sticker_presence ? 'Detected' : 'Not detected'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}

// ─── Tab: SCV Mismatches ──────────────────────────────────────────────────────

function MismatchesTab({
  effectiveOrganizationId,
  zoneId,
  dateFrom,
  dateTo,
}: {
  effectiveOrganizationId: string | null
  zoneId: string | null
  dateFrom: string | null
  dateTo: string | null
}) {
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  // Fetch observations that have SCV-relevant data
  const { data: observations = [], isLoading: loadingObs } = useQuery({
    queryKey: ['registry-mismatch-obs', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select(`
          observation_id,
          plate_number,
          recorded_at,
          self_contained,
          sticker_presence,
          zone:zones!zone_id(name)
        `)
        .order('recorded_at', { ascending: false })
        .limit(500)

      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('recorded_at', startDate)
      if (endDate) q = q.lte('recorded_at', endDate)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as any[]
    },
    enabled: !!zoneId,
  })

  // Fetch canonical SCV records for plates that appear in observations
  const plateNumbers = useMemo(() => {
    const plates = [...new Set(observations.map((o: any) => o.plate_number).filter(Boolean) as string[])]
    plates.sort()
    return plates
  }, [observations])

  const { data: scvRecords = [], isLoading: loadingScv } = useQuery({
    queryKey: ['registry-mismatch-scv', plateNumbers],
    queryFn: async () => {
      if (plateNumbers.length === 0) return []
      const SUPABASE_IN_CHUNK_SIZE = 100
      const chunks: string[][] = []
      for (let i = 0; i < plateNumbers.length; i += SUPABASE_IN_CHUNK_SIZE) {
        chunks.push(plateNumbers.slice(i, i + SUPABASE_IN_CHUNK_SIZE))
      }
      const allRows: CanonicalScvRow[] = []
      for (const chunk of chunks) {
        const { data, error } = await (supabase.from('canonical_scv') as any)
          .select('*')
          .in('plate_number', chunk)
        if (error) throw error
        allRows.push(...(data ?? []))
      }
      return allRows
    },
    enabled: plateNumbers.length > 0,
  })

  const mismatches = useMemo(() => {
    const scvMap = new Map<string, CanonicalScvRow>()
    for (const r of scvRecords) scvMap.set(r.plate_number, r)

    const result: ScvMismatch[] = []

    for (const obs of observations) {
      const plate = obs.plate_number as string | null
      if (!plate) continue

      const canonical = scvMap.get(plate)
      const obsSc = obs.self_contained as boolean | null
      const obsSticker = obs.sticker_presence as boolean | null

      // Case 1: Observation says SC / sticker present but no canonical record OR canonical says not SC
      if ((obsSc === true || obsSticker === true) && (!canonical || !canonical.is_self_contained)) {
        result.push({
          plate_number: plate,
          canonical_is_sc: canonical?.is_self_contained ?? false,
          canonical_expiry: canonical?.certificate_expiry ?? null,
          canonical_source: canonical?.source ?? null,
          obs_self_contained: obsSc,
          obs_sticker_presence: obsSticker,
          obs_recorded_at: obs.recorded_at,
          obs_zone: obs.zone?.name ?? null,
          mismatch_type: obsSticker === true ? 'sticker_not_in_register' : 'obs_sc_not_in_register',
        })
      }

      // Case 2: Canonical says SC but observation says not SC / no sticker detected
      if (canonical?.is_self_contained && (obsSc === false || obsSticker === false)) {
        result.push({
          plate_number: plate,
          canonical_is_sc: canonical.is_self_contained,
          canonical_expiry: canonical.certificate_expiry,
          canonical_source: canonical.source,
          obs_self_contained: obsSc,
          obs_sticker_presence: obsSticker,
          obs_recorded_at: obs.recorded_at,
          obs_zone: obs.zone?.name ?? null,
          mismatch_type: obsSticker === false ? 'in_register_no_sticker' : 'in_register_obs_not_sc',
        })
      }
    }

    return result
  }, [observations, scvRecords])

  const isLoading = loadingObs || loadingScv

  const mismatchLabel = (type: string) => {
    switch (type) {
      case 'sticker_not_in_register':
        return { label: 'Sticker Present — Not in Register', color: 'bg-amber-100 text-amber-800 border-amber-200' }
      case 'obs_sc_not_in_register':
        return { label: 'Marked SC — Not in Register', color: 'bg-amber-100 text-amber-800 border-amber-200' }
      case 'in_register_no_sticker':
        return { label: 'In Register — No Sticker Detected', color: 'bg-blue-100 text-blue-800 border-blue-200' }
      case 'in_register_obs_not_sc':
        return { label: 'In Register — Obs Not SC', color: 'bg-blue-100 text-blue-800 border-blue-200' }
      default:
        return { label: type, color: 'bg-gray-100 text-gray-800' }
    }
  }

  return (
    <div className="space-y-4">
      {!zoneId && (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground text-sm">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            Select a zone from the filter bar above to view SCV mismatches.
          </CardContent>
        </Card>
      )}

      {isLoading && zoneId ? (
        <div className="py-12 text-center text-muted-foreground">Analysing records…</div>
      ) : zoneId && mismatches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CheckCircle className="h-12 w-12 text-green-300 mx-auto mb-3" />
            <p>No SCV mismatches found for the selected zone and filters.</p>
            <p className="text-xs mt-1">Observation records are consistent with the canonical SCV register.</p>
          </CardContent>
        </Card>
      ) : zoneId && (
        <>
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span className="text-amber-600 font-medium">{mismatches.length} mismatch{mismatches.length !== 1 ? 'es' : ''} found</span>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y max-h-[60vh] overflow-y-auto">
                {mismatches.map((m, i) => {
                  const { label, color } = mismatchLabel(m.mismatch_type)
                  return (
                    <div key={`${m.plate_number}-${m.obs_recorded_at}-${i}`} className="px-4 py-3 hover:bg-muted/40 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm">{m.plate_number}</span>
                        <Badge className={`text-xs ${color}`}>{label}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Observed: {formatDateTime(m.obs_recorded_at)}</span>
                        {m.obs_zone && <span>Zone: {m.obs_zone}</span>}
                        <span>
                          Canonical: {m.canonical_is_sc ? 'SC Certified' : 'Not SC'}
                          {m.canonical_expiry && ` (exp: ${m.canonical_expiry})`}
                        </span>
                        {m.obs_sticker_presence !== null && (
                          <span>Sticker: {m.obs_sticker_presence ? 'Detected' : 'Not detected'}</span>
                        )}
                        {m.obs_self_contained !== null && (
                          <span>Obs SC: {m.obs_self_contained ? 'Yes' : 'No'}</span>
                        )}
                        {m.canonical_source && <span>Source: {m.canonical_source}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VehicleRegistry() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()

  const effectiveOrganizationId =
    organizationId || (user?.role !== 'master' ? user?.organization_id || null : null)

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="h-7 w-7 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Vehicle Registry</h1>
              <p className="text-sm text-gray-500">
                {user?.role === 'nzscv_monitor'
                  ? 'SCV registration monitoring — canonical records, observations & mismatches'
                  : 'Read-only registry of canonical vehicles'}
              </p>
            </div>
          </div>
        </div>

        <GlobalFilterRibbon showDateFilter={true} showZoneFilter={true} />

        <Tabs defaultValue="vehicles">
          <TabsList>
            <TabsTrigger value="vehicles" className="gap-1.5">
              <Car className="h-4 w-4" />Vehicles
            </TabsTrigger>
            <TabsTrigger value="scv-records" className="gap-1.5">
              <Shield className="h-4 w-4" />SCV Records
            </TabsTrigger>
            <TabsTrigger value="observations" className="gap-1.5">
              <Camera className="h-4 w-4" />Observations
            </TabsTrigger>
            <TabsTrigger value="mismatches" className="gap-1.5">
              <AlertTriangle className="h-4 w-4" />Mismatches
            </TabsTrigger>
          </TabsList>

          <TabsContent value="vehicles">
            <VehiclesTab effectiveOrganizationId={effectiveOrganizationId} />
          </TabsContent>

          <TabsContent value="scv-records">
            <ScvRecordsTab />
          </TabsContent>

          <TabsContent value="observations">
            <ObservationsTab
              effectiveOrganizationId={effectiveOrganizationId}
              zoneId={zoneId}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          </TabsContent>

          <TabsContent value="mismatches">
            <MismatchesTab
              effectiveOrganizationId={effectiveOrganizationId}
              zoneId={zoneId}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
