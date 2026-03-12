import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import {
  Search, Car, AlertTriangle, CheckCircle, Calendar, RefreshCw, Database, Globe,
  MapPin, Clock, BarChart3, ZoomIn,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { HOMELESS_UI_STATUSES, isHomelessForUi, normalizeHomelessStatus } from '@/lib/homelessStatus'
import { checkNZSCVCertification, enrichVehicleFromMotorWeb } from '@/lib/railwayServices'
import { getObservationPhotoUrl, getVehiclePhotoUrl } from '@/lib/photoUtils'
import { PhotoWithFallback } from '@/components/features/PhotoWithFallback'
import { toast } from 'sonner'

interface Vehicle {
  id: string
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  year: number | null
  vehicle_color: string | null
  self_contained: boolean
  self_contained_expiry: string | null
  homeless_status: string | null
  is_exempt: boolean
  enforcement_count: number
  last_enforcement_at: string | null
  profile_photo: string | null
  total_observations: number
  total_breaches: number
}

type StatusFilter = 'all' | 'compliant' | 'breaches' | 'homeless' | 'exempt'

export default function VehicleManagement() {
  const { user } = useAuthStore()
  const {
    organizationId,
    zoneId,
    dateFrom,
    dateTo,
    setDateRange,
    setOrganization,
    setZone,
  } = useGlobalFiltersStore()

  const effectiveOrganizationId =
    organizationId || (user?.role !== 'master' ? user?.organization_id || null : null)

  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [checkingNZSCV, setCheckingNZSCV] = useState(false)
  const [enrichingMotorWeb, setEnrichingMotorWeb] = useState(false)
  const [scrapingSales, setScrapingSales] = useState(false)
  const [nzscvResult, setNzscvResult] = useState<any>(null)
  // Photo lightbox state
  const [enlargedPhoto, setEnlargedPhoto] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState('info')

  // Handle URL search params (status, search, dates, org, zone)
  useEffect(() => {
    const status = searchParams.get('status') as StatusFilter | null
    if (status && ['all', 'compliant', 'breaches', 'homeless', 'exempt'].includes(status)) {
      setStatusFilter(status)
    }
    const search = searchParams.get('search')
    if (search) setSearchQuery(search)

    const qDateFrom = searchParams.get('dateFrom')
    const qDateTo = searchParams.get('dateTo')
    if (qDateFrom && qDateTo) setDateRange(qDateFrom, qDateTo, 'custom')

    const qOrgId = searchParams.get('orgId')
    if (qOrgId && user?.role === 'master') setOrganization(qOrgId, null)

    const qZoneId = searchParams.get('zoneId')
    if (qZoneId) setZone(qZoneId, null)
  }, [searchParams, setDateRange, setOrganization, setZone, user?.role])

  // ─── Vehicle List Query ───────────────────────────────────────────────────
  // Queries canonical_vehicles, scoped by org/zone via observations lookup.
  // Date range is intentionally NOT applied here so all known vehicles show up.
  const { data: vehicles, isLoading, error: vehiclesError } = useQuery({
    queryKey: ['vehicles', effectiveOrganizationId, zoneId, statusFilter, searchQuery],
    queryFn: async () => {
      const fetchScopedPlates = async (scopeOrgId: string | null, scopeZoneId: string | null) => {
        let obsQuery = supabase
          .from('observations')
          .select('plate_number')
          .neq('plate_number', 'PROCESSING...')
          .limit(10000)

        if (scopeOrgId) {
          obsQuery = obsQuery.eq('organization_id', scopeOrgId)
        }
        if (scopeZoneId) {
          obsQuery = obsQuery.eq('zone_id', scopeZoneId)
        }

        const { data: matchingObs, error: obsError } = await obsQuery
        if (obsError) throw obsError

        return new Set(
          (matchingObs ?? [])
            .map((o: any) => o.plate_number)
            .filter((p: any) => p && typeof p === 'string' && p.trim()) as string[]
        )
      }

      const applyVehicleFilters = (query: any) => {
        query = query.order('plate_number', { ascending: true })

        if (searchQuery) {
          query = query.or(
            `plate_number.ilike.%${searchQuery}%,vehicle_make.ilike.%${searchQuery}%,vehicle_model.ilike.%${searchQuery}%`
          )
        }

        if (statusFilter === 'compliant') {
          query = query.eq('total_breaches', 0)
        } else if (statusFilter === 'breaches') {
          query = query.gt('total_breaches', 0)
        } else if (statusFilter === 'homeless') {
          query = query.in('homeless_status', HOMELESS_UI_STATUSES)
        } else if (statusFilter === 'exempt') {
          query = query.eq('is_exempt', true)
        }

        return query
      }

      let rows: Vehicle[] = []

      // Primary path: scope canonical vehicles by organization_id directly (if available).
      let primaryQuery = applyVehicleFilters(
        supabase.from('canonical_vehicles').select('*')
      )

      if (effectiveOrganizationId) {
        primaryQuery = primaryQuery.eq('organization_id', effectiveOrganizationId)
      }

      const primary = await primaryQuery

      if (!primary.error) {
        rows = (primary.data ?? []) as Vehicle[]

        // Some environments have canonical_vehicles.organization_id present but
        // sparsely populated; if org-scoped query returns empty while there are
        // observed plates for the org, switch to plate-based scoping.
        if (effectiveOrganizationId && rows.length === 0) {
          const orgPlates = await fetchScopedPlates(effectiveOrganizationId, null)
          if (orgPlates.size > 0) {
            const fallback = await applyVehicleFilters(supabase.from('canonical_vehicles').select('*'))
            if (fallback.error) throw fallback.error
            rows = ((fallback.data ?? []) as Vehicle[]).filter((v) => orgPlates.has(v.plate_number))
          }
        }
      } else if (effectiveOrganizationId) {
        // Fallback for schema variants where canonical_vehicles has no organization_id.
        const fallback = await applyVehicleFilters(supabase.from('canonical_vehicles').select('*'))
        if (fallback.error) throw fallback.error

        const orgPlates = await fetchScopedPlates(effectiveOrganizationId, null)
        rows = ((fallback.data ?? []) as Vehicle[]).filter((v) => orgPlates.has(v.plate_number))
      } else {
        throw primary.error
      }

      // Apply zone scoping in-memory to avoid massive IN(...) URL queries.
      if (zoneId) {
        const zonePlates = await fetchScopedPlates(effectiveOrganizationId, zoneId)
        rows = rows.filter((v) => zonePlates.has(v.plate_number))
      }

      if (rows.length === 0) return rows

      // Backfill profile_photo from latest observation photo when missing
      const missingPhotoPlates = rows
        .filter((v) => !getVehiclePhotoUrl(v))
        .map((v) => v.plate_number)

      if (missingPhotoPlates.length === 0) return rows

      // Chunk plate filters to avoid oversized query URLs.
      const photoByPlate: Record<string, string> = {}

      const plateChunks: string[][] = []
      for (let i = 0; i < missingPhotoPlates.length; i += 200) {
        plateChunks.push(missingPhotoPlates.slice(i, i + 200))
      }

      for (const chunk of plateChunks) {
        let photoQuery = (supabase.from('observations') as any)
          .select('plate_number, photo_url, recorded_at')
          .in('plate_number', chunk)
          .not('photo_url', 'is', null)
          .order('recorded_at', { ascending: false })
          .limit(Math.max(300, chunk.length * 4))

        if (effectiveOrganizationId) {
          photoQuery = photoQuery.eq('organization_id', effectiveOrganizationId)
        }

        const { data: latestPhotos } = await photoQuery

        for (const row of latestPhotos ?? []) {
          const plate = row.plate_number as string | null
          if (!plate || photoByPlate[plate]) continue
          const resolved = getObservationPhotoUrl(row as any)
          if (resolved) photoByPlate[plate] = resolved
        }
      }

      return rows.map((v) => ({
        ...v,
        profile_photo: getVehiclePhotoUrl(v, photoByPlate[v.plate_number] ?? null),
      }))
    },
    retry: 1,
  })

  // ─── Dialog: open & reset ────────────────────────────────────────────────
  const openDetails = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle)
    setShowDetailsDialog(true)
    setNzscvResult(null)
    setDetailTab('info')
  }

  // ─── Dialog: observations (org/zone/date filtered) ───────────────────────
  const { data: dialogObservations = [], isLoading: loadingDialogObs } = useQuery({
    queryKey: [
      'vehicle-dialog-obs',
      selectedVehicle?.plate_number,
      effectiveOrganizationId,
      zoneId,
      dateFrom,
      dateTo,
    ],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select(`
          id, recorded_at, photo_url, is_compliant, breach_type,
          nights_stayed_this_month, organization_id,
          zone:zones!zone_id(id, name),
          recorded_by_user:user_profiles!recorded_by(first_name, last_name),
          org:organizations!organization_id(name)
        `)
        .eq('plate_number', selectedVehicle!.plate_number)
        .order('recorded_at', { ascending: false })
        .limit(100)

      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (dateFrom) q = q.gte('recorded_at', `${dateFrom}T00:00:00Z`)
      if (dateTo) q = q.lte('recorded_at', `${dateTo}T23:59:59Z`)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as any[]
    },
    enabled: showDetailsDialog && !!selectedVehicle?.plate_number,
  })

  // ─── KPI computed from dialog observations ───────────────────────────────
  const kpiData = useMemo(() => {
    if (dialogObservations.length === 0) return null

    const byZone: Record<
      string,
      { name: string; count: number; compliant: number; breach: number; pending: number }
    > = {}
    const byOrg: Record<string, { name: string; count: number }> = {}
    let compliant = 0, breach = 0, pending = 0

    for (const obs of dialogObservations) {
      const zoneName = obs.zone?.name || 'Unknown Zone'
      const zoneKey = obs.zone?.id || 'unknown'
      if (!byZone[zoneKey])
        byZone[zoneKey] = { name: zoneName, count: 0, compliant: 0, breach: 0, pending: 0 }
      byZone[zoneKey].count++

      const orgName = obs.org?.name || 'Unknown Org'
      const orgKey = obs.organization_id || 'unknown'
      if (!byOrg[orgKey]) byOrg[orgKey] = { name: orgName, count: 0 }
      byOrg[orgKey].count++

      if (obs.is_compliant === true) { compliant++; byZone[zoneKey].compliant++ }
      else if (obs.is_compliant === false) { breach++; byZone[zoneKey].breach++ }
      else { pending++; byZone[zoneKey].pending++ }
    }

    return {
      total: dialogObservations.length,
      compliant,
      breach,
      pending,
      complianceRate:
        dialogObservations.length > 0
          ? Math.round((compliant / dialogObservations.length) * 100)
          : 0,
      byZone: Object.values(byZone).sort((a, b) => b.count - a.count),
      byOrg: Object.values(byOrg).sort((a, b) => b.count - a.count),
    }
  }, [dialogObservations])

  // ─── NZSCV check ─────────────────────────────────────────────────────────
  const handleCheckNZSCV = async (plateNumber: string) => {
    setCheckingNZSCV(true)
    try {
      const { data, error } = await checkNZSCVCertification(plateNumber)
      if (error) { toast.error(error); return }
      if (data) {
        setNzscvResult(data)
        toast.success(
          data.is_certified
            ? `✓ Self-Contained Certification Found (${data.warrant_type})`
            : 'No certification found'
        )
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to check NZSCV status')
    } finally {
      setCheckingNZSCV(false)
    }
  }

  // ─── MotorWeb enrichment ──────────────────────────────────────────────────
  const handleEnrichMotorWeb = async (plateNumber: string) => {
    setEnrichingMotorWeb(true)
    try {
      const { data, error } = await enrichVehicleFromMotorWeb(plateNumber)
      if (error) { toast.error(error); return }
      if (data) {
        const { error: updateError } = await (supabase.from('canonical_vehicles') as any)
          .update({
            vehicle_make: data.make,
            vehicle_model: data.model,
            year: data.year,
            vehicle_color: data.colour,
            owner_first_name: data.owner_name?.split(' ')[0],
            owner_last_name: data.owner_name?.split(' ').slice(1).join(' '),
            owner_address: data.owner_address,
          })
          .eq('plate_number', plateNumber)
        if (updateError) { toast.error('Failed to update vehicle data'); return }
        toast.success('Vehicle data enriched from MotorWeb')
        queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to enrich from MotorWeb')
    } finally {
      setEnrichingMotorWeb(false)
    }
  }

  // ─── Scrape sales sites ───────────────────────────────────────────────────
  const handleScrapeVehicle = async (plateNumber: string, forceUpdate = false) => {
    setScrapingSales(true)
    try {
      const { data, error } = await supabase.functions.invoke('scrape-vehicle-photos', {
        body: { plate_number: plateNumber, force_update: forceUpdate },
      })
      if (error) { toast.error(`Scrape failed: ${error.message}`); return }
      if (data?.skipped) {
        toast.info('Vehicle already has a profile photo. Use "Force Update" to replace it.')
        return
      }
      if (!data?.found) {
        toast.warning(`No listing found for ${plateNumber} on Trade Me or cars.co.nz`)
        return
      }
      toast.success(
        `Photo found on ${data.source === 'trademe' ? 'Trade Me' : 'cars.co.nz'} and saved`
      )
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      if (selectedVehicle?.plate_number === plateNumber && data.canonical_record) {
        setSelectedVehicle((prev) => ({
          ...prev!,
          profile_photo: data.canonical_record.profile_photo,
        }))
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to scrape vehicle sales sites')
    } finally {
      setScrapingSales(false)
    }
  }

  // ─── Summary stats ────────────────────────────────────────────────────────
  const stats = vehicles
    ? {
        total: vehicles.length,
        compliant: vehicles.filter((v) => v.total_breaches === 0).length,
        breaches: vehicles.filter((v) => v.total_breaches > 0).length,
        selfContained: vehicles.filter((v) => v.self_contained).length,
        homeless: vehicles.filter((v) => isHomelessForUi(v.homeless_status)).length,
        exempt: vehicles.filter((v) => v.is_exempt).length,
      }
    : null

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <AppLayout title="Vehicle Management" description="Search and manage vehicles" showBackButton>
      <GlobalFilterRibbon />

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6 mb-8">
          {[
            { label: 'Total', value: stats.total, color: '' },
            { label: 'Compliant', value: stats.compliant, color: 'text-green-600' },
            { label: 'Breaches', value: stats.breaches, color: 'text-red-600' },
            { label: 'Self-Contained', value: stats.selfContained, color: 'text-blue-600' },
            { label: 'Homeless', value: stats.homeless, color: 'text-orange-600' },
            { label: 'Exempt', value: stats.exempt, color: 'text-purple-600' },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm font-medium ${color || 'text-gray-600'}`}>
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Search and Status Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by plate number, make, or model..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {(
                [
                  { key: 'all', label: 'All' },
                  { key: 'compliant', label: 'Compliant', icon: <CheckCircle className="h-4 w-4 mr-1" /> },
                  { key: 'breaches', label: 'Breaches', icon: <AlertTriangle className="h-4 w-4 mr-1" /> },
                  { key: 'homeless', label: 'Homeless' },
                  { key: 'exempt', label: 'Exempt' },
                ] as Array<{ key: StatusFilter; label: string; icon?: ReactNode }>
              ).map(({ key, label, icon }) => (
                <Button
                  key={key}
                  variant={statusFilter === key ? 'default' : 'outline'}
                  onClick={() => setStatusFilter(key)}
                  size="sm"
                >
                  {icon}
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vehicle Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading vehicles...</p>
        </div>
      ) : vehiclesError ? (
        <Card>
          <CardContent className="text-center py-12">
            <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">Failed to load vehicles</p>
            <p className="text-sm text-gray-500 mt-1">
              {vehiclesError instanceof Error ? vehiclesError.message : 'Unknown error'}
            </p>
          </CardContent>
        </Card>
      ) : !vehicles || vehicles.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Car className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No vehicles found</p>
            <p className="text-sm text-gray-500 mt-1">
              {effectiveOrganizationId || zoneId
                ? 'No vehicles have been observed for the current organisation / zone filters.'
                : 'No canonical vehicle records exist yet.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => {
            const profileUrl = vehicle.profile_photo
            return (
              <Card
                key={vehicle.id}
                className="hover:shadow-lg transition-shadow overflow-hidden cursor-pointer group"
                onClick={() => navigate(`/vehicles/${vehicle.id}`)}
              >
                {/* Profile Photo — prominent, clickable to enlarge */}
                <div
                  className="relative w-full h-44 bg-gray-100 dark:bg-gray-800 overflow-hidden"
                  onClick={(e) => {
                    if (profileUrl) {
                      e.stopPropagation()
                      setEnlargedPhoto(profileUrl)
                    }
                  }}
                >
                  <PhotoWithFallback
                    src={profileUrl}
                    alt={vehicle.plate_number}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    placeholderClassName="w-full h-full"
                  />
                  {profileUrl && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow" />
                    </div>
                  )}
                </div>

                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg font-bold font-mono">
                        {vehicle.plate_number}
                      </CardTitle>
                      <CardDescription>
                        {[
                          vehicle.vehicle_make,
                          vehicle.vehicle_model,
                          vehicle.year && `(${vehicle.year})`,
                        ]
                          .filter(Boolean)
                          .join(' ') || 'Details unknown'}
                      </CardDescription>
                    </div>
                    {vehicle.vehicle_color && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        {vehicle.vehicle_color}
                      </Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Observations:</span>
                      <span className="font-medium">{vehicle.total_observations}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Breaches:</span>
                      <span
                        className={`font-medium ${vehicle.total_breaches > 0 ? 'text-red-600' : 'text-green-600'}`}
                      >
                        {vehicle.total_breaches}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-3">
                      {vehicle.self_contained && (
                        <Badge variant="outline" className="text-xs">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Self-Contained
                        </Badge>
                      )}
                      {isHomelessForUi(vehicle.homeless_status) && (
                        <Badge variant="outline" className="text-xs bg-orange-50">
                          Homeless ({normalizeHomelessStatus(vehicle.homeless_status)})
                        </Badge>
                      )}
                      {vehicle.is_exempt && (
                        <Badge variant="outline" className="text-xs bg-purple-50">
                          Exempt
                        </Badge>
                      )}
                      {vehicle.total_breaches > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Active Breach
                        </Badge>
                      )}
                    </div>

                    <div className="pt-3 mt-3 border-t flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetails(vehicle)
                        }}
                      >
                        Quick Tools
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/vehicles/${vehicle.id}`)
                        }}
                      >
                        Drill Down
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Photo Lightbox ── */}
      <Dialog open={!!enlargedPhoto} onOpenChange={() => setEnlargedPhoto(null)}>
        <DialogContent className="max-w-4xl p-2 bg-black border-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Photo viewer</DialogTitle>
          </DialogHeader>
          {enlargedPhoto && (
            <img
              src={enlargedPhoto}
              alt="Enlarged vehicle photo"
              className="w-full max-h-[85vh] object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Vehicle Details Dialog ── */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold font-mono">
              {selectedVehicle?.plate_number}
            </DialogTitle>
            <DialogDescription>
              {[
                selectedVehicle?.vehicle_make,
                selectedVehicle?.vehicle_model,
                selectedVehicle?.year && `(${selectedVehicle.year})`,
              ]
                .filter(Boolean)
                .join(' ') || 'Vehicle details unknown'}
            </DialogDescription>
          </DialogHeader>

          {selectedVehicle && (
            <Tabs value={detailTab} onValueChange={setDetailTab} className="mt-2">
              <TabsList className="w-full">
                <TabsTrigger value="info" className="flex-1">Vehicle Info</TabsTrigger>
                <TabsTrigger value="observations" className="flex-1">
                  Observations
                  {dialogObservations.length > 0 && ` (${dialogObservations.length})`}
                </TabsTrigger>
                <TabsTrigger value="kpi" className="flex-1">
                  <BarChart3 className="h-4 w-4 mr-1" />
                  KPI
                </TabsTrigger>
              </TabsList>

              {/* ── Info Tab ── */}
              <TabsContent value="info" className="space-y-5 mt-4">
                {/* Prominent profile photo */}
                <div
                  className="relative rounded-lg overflow-hidden h-56 bg-gray-100 dark:bg-gray-800 cursor-pointer group"
                  onClick={() => {
                    const url = selectedVehicle.profile_photo
                    if (url) setEnlargedPhoto(url)
                  }}
                >
                  <PhotoWithFallback
                    src={selectedVehicle.profile_photo}
                    alt={selectedVehicle.plate_number}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    placeholderClassName="w-full h-full"
                  />
                  {selectedVehicle.profile_photo && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <ZoomIn className="h-10 w-10 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow" />
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2">
                    <Badge className="bg-black/60 text-white border-0 text-xs">
                      Profile Photo · Click to enlarge
                    </Badge>
                  </div>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Colour', value: selectedVehicle.vehicle_color || '—' },
                    { label: 'Total Observations', value: selectedVehicle.total_observations },
                    {
                      label: 'Total Breaches',
                      value: selectedVehicle.total_breaches,
                      color: selectedVehicle.total_breaches > 0 ? 'text-red-600' : 'text-green-600',
                    },
                    { label: 'Enforcement Actions', value: selectedVehicle.enforcement_count },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <div className="text-sm text-gray-600">{label}</div>
                      <div className={`font-medium ${color || ''}`}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Status badges */}
                <div className="flex flex-wrap gap-2">
                  {selectedVehicle.self_contained && (
                    <Badge variant="outline" className="bg-blue-50">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Self-Contained
                    </Badge>
                  )}
                  {selectedVehicle.self_contained_expiry && (
                    <Badge variant="outline">
                      <Calendar className="h-3 w-3 mr-1" />
                      Expires: {new Date(selectedVehicle.self_contained_expiry).toLocaleDateString()}
                    </Badge>
                  )}
                  {isHomelessForUi(selectedVehicle.homeless_status) && (
                    <Badge variant="outline" className="bg-orange-50">
                      Homeless ({normalizeHomelessStatus(selectedVehicle.homeless_status)})
                    </Badge>
                  )}
                  {selectedVehicle.is_exempt && (
                    <Badge variant="outline" className="bg-purple-50">
                      Exempt
                    </Badge>
                  )}
                  {selectedVehicle.total_breaches > 0 && (
                    <Badge variant="destructive">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Active Breach
                    </Badge>
                  )}
                </div>

                {/* Last enforcement */}
                {selectedVehicle.last_enforcement_at && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
                    <div className="font-semibold mb-1">Last Enforcement</div>
                    <div className="text-gray-600">
                      {formatDateTime(selectedVehicle.last_enforcement_at)}
                    </div>
                  </div>
                )}

                {/* NZSCV Check */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">NZSCV Certification Check</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCheckNZSCV(selectedVehicle.plate_number)}
                      disabled={checkingNZSCV}
                    >
                      {checkingNZSCV ? (
                        <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Checking...</>
                      ) : (
                        <><CheckCircle className="h-4 w-4 mr-2" />Check Warrant</>
                      )}
                    </Button>
                  </div>
                  {nzscvResult && (
                    <div className="text-sm space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-600">Status:</span>
                        <Badge variant={nzscvResult.is_certified ? 'default' : 'secondary'}>
                          {nzscvResult.is_certified ? 'Certified' : 'Not Certified'}
                        </Badge>
                      </div>
                      {nzscvResult.warrant_type && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-600">Warrant Type:</span>
                          <Badge variant="outline">
                            {nzscvResult.warrant_type === 'green' ? '🟢 Green' : '🔵 Blue'}
                          </Badge>
                        </div>
                      )}
                      {nzscvResult.warrant_number && (
                        <div className="text-gray-600">Warrant #: {nzscvResult.warrant_number}</div>
                      )}
                      {nzscvResult.expires_on && (
                        <div className="text-gray-600">
                          Expires: {new Date(nzscvResult.expires_on).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* MotorWeb */}
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">MotorWeb Data Enrichment</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEnrichMotorWeb(selectedVehicle.plate_number)}
                      disabled={enrichingMotorWeb}
                    >
                      {enrichingMotorWeb ? (
                        <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Enriching...</>
                      ) : (
                        <><Database className="h-4 w-4 mr-2" />Enrich Data</>
                      )}
                    </Button>
                  </div>
                  <div className="text-xs text-gray-600 mt-2">
                    Pull vehicle details, owner info, and more from MotorWeb database.
                  </div>
                </div>

                {/* Scrape sales sites */}
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Scrape Sales Sites</div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleScrapeVehicle(selectedVehicle.plate_number, false)}
                        disabled={scrapingSales}
                      >
                        {scrapingSales ? (
                          <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Searching...</>
                        ) : (
                          <><Globe className="h-4 w-4 mr-2" />Find Photo</>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleScrapeVehicle(selectedVehicle.plate_number, true)}
                        disabled={scrapingSales}
                        title="Force update even if a photo already exists"
                      >
                        Force Update
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-600">
                    Search Trade Me Motors and cars.co.nz for listings matching this plate. Downloads
                    the best available photo and enriches vehicle details.
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="default"
                    className="flex-1"
                    onClick={() => {
                      setShowDetailsDialog(false)
                      navigate(`/vehicles/${selectedVehicle.id}`)
                    }}
                  >
                    Full Detail Page
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowDetailsDialog(false)}
                  >
                    Close
                  </Button>
                </div>
              </TabsContent>

              {/* ── Observations Tab ── */}
              <TabsContent value="observations" className="mt-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Observations for this vehicle
                  {(effectiveOrganizationId || zoneId || dateFrom || dateTo) &&
                    ' matching current filters'}
                  . Click any photo to enlarge.
                </p>

                {loadingDialogObs ? (
                  <div className="text-center py-8 text-muted-foreground">Loading observations…</div>
                ) : dialogObservations.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No observations found for the current filters.
                  </div>
                ) : (
                  dialogObservations.map((obs: any) => {
                    const obsPhotoUrl = getObservationPhotoUrl(obs)
                    return (
                      <Card key={obs.id}>
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            {/* Observation photo — clickable */}
                            <div
                              className="relative w-24 h-18 rounded border overflow-hidden shrink-0 cursor-pointer group"
                              style={{ minWidth: '6rem', height: '4.5rem' }}
                              onClick={() => obsPhotoUrl && setEnlargedPhoto(obsPhotoUrl)}
                            >
                              <PhotoWithFallback
                                src={obsPhotoUrl}
                                alt="Observation"
                                className="w-full h-full object-cover"
                                placeholderClassName="w-full h-full"
                              />
                              {obsPhotoUrl && (
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                  <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-90 transition-opacity" />
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {obs.is_compliant === true && (
                                  <Badge className="bg-green-600 text-xs">Compliant</Badge>
                                )}
                                {obs.is_compliant === false && (
                                  <Badge variant="destructive" className="text-xs">
                                    Breach{obs.breach_type ? ` · ${obs.breach_type}` : ''}
                                  </Badge>
                                )}
                                {obs.is_compliant === null && (
                                  <Badge variant="secondary" className="text-xs">Pending</Badge>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatDateTime(obs.recorded_at)}
                                </span>
                                {obs.zone && (
                                  <span className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {obs.zone.name}
                                  </span>
                                )}
                                {obs.nights_stayed_this_month != null && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    Night {obs.nights_stayed_this_month}
                                  </span>
                                )}
                                {obs.recorded_by_user && (
                                  <span>
                                    By {obs.recorded_by_user.first_name} {obs.recorded_by_user.last_name}
                                  </span>
                                )}
                                {obs.org && (
                                  <span className="text-xs text-gray-400">{obs.org.name}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </TabsContent>

              {/* ── KPI Tab ── */}
              <TabsContent value="kpi" className="mt-4 space-y-4">
                {loadingDialogObs ? (
                  <div className="text-center py-8 text-muted-foreground">Loading analytics…</div>
                ) : !kpiData ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No data available for the current filters.
                  </div>
                ) : (
                  <>
                    {/* Compliance overview */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'Total Visits', value: kpiData.total, color: '' },
                        { label: 'Compliant', value: kpiData.compliant, color: 'text-green-600' },
                        { label: 'Breach', value: kpiData.breach, color: 'text-red-600' },
                        { label: 'Pending', value: kpiData.pending, color: 'text-gray-500' },
                      ].map(({ label, value, color }) => (
                        <Card key={label}>
                          <CardContent className="pt-4 pb-3">
                            <div className={`text-2xl font-bold ${color}`}>{value}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {/* Compliance rate bar */}
                    <Card>
                      <CardContent className="pt-4 pb-3">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="font-medium">Compliance Rate</span>
                          <span className={kpiData.complianceRate >= 80 ? 'text-green-600 font-bold' : 'text-orange-600 font-bold'}>
                            {kpiData.complianceRate}%
                          </span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${kpiData.complianceRate >= 80 ? 'bg-green-500' : kpiData.complianceRate >= 50 ? 'bg-orange-500' : 'bg-red-500'}`}
                            style={{ width: `${kpiData.complianceRate}%` }}
                          />
                        </div>
                      </CardContent>
                    </Card>

                    {/* Visits by Zone */}
                    {kpiData.byZone.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            Visits by Zone
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {kpiData.byZone.map((zone) => (
                            <div key={zone.name} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="font-medium truncate">{zone.name}</span>
                                <span className="text-muted-foreground shrink-0 ml-2">
                                  {zone.count} visit{zone.count !== 1 ? 's' : ''}
                                </span>
                              </div>
                              <div className="flex gap-1 text-xs">
                                {zone.compliant > 0 && (
                                  <Badge className="bg-green-100 text-green-800 border-0 px-1.5 py-0">
                                    {zone.compliant} compliant
                                  </Badge>
                                )}
                                {zone.breach > 0 && (
                                  <Badge className="bg-red-100 text-red-800 border-0 px-1.5 py-0">
                                    {zone.breach} breach
                                  </Badge>
                                )}
                                {zone.pending > 0 && (
                                  <Badge className="bg-gray-100 text-gray-700 border-0 px-1.5 py-0">
                                    {zone.pending} pending
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}

                    {/* Visits by Organisation (master role only or multiple orgs) */}
                    {kpiData.byOrg.length > 1 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm">Visits by Organisation</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                          {kpiData.byOrg.map((org) => (
                            <div key={org.name} className="flex justify-between text-sm">
                              <span className="truncate">{org.name}</span>
                              <span className="text-muted-foreground shrink-0 ml-2">
                                {org.count}
                              </span>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
