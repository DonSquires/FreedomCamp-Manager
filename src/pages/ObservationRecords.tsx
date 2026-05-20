import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { AppLayout } from '@/components/features/AppLayout'
import { AsyncStateWrapper } from '@/components/features/AsyncStateWrapper'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { getObservationPhotoUrl } from '@/lib/photoUtils'
import { Car, Search, RefreshCw, Image as ImageIcon, Camera, Loader2, MapPin, Calendar, Clock, AlertTriangle, Shield, Flag } from 'lucide-react'
import { toast } from 'sonner'

const PHOTO_SYNC_LIMIT = 500
const PHOTO_SYNC_WINDOW_MINUTES = 120

interface ObservationRow {
  id: string
  plate_number: string
  recorded_at: string
  zone_id: string
  photo?: string | null
  photo_url: string | null
  is_compliant: boolean
  officer_notes: string | null
  gps_latitude: number | null
  gps_longitude: number | null
  breach_type: string | null
  breach_reason: string | null
  nights_stayed_this_month: number | null
  zone: { name: string } | null
}

interface CanonicalVehicleRow {
  plate_number: string
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_year: number | null   // INTEGER (normalized in 20260411000003)
  vehicle_color: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  self_contained: boolean | null
  is_flagged: boolean | null
  is_exempt: boolean | null
}

function normalizeNote(note: string | null | undefined): string {
  return (note || '').trim()
}

function observationDedupKey(row: ObservationRow): string {
  const lat = row.gps_latitude == null ? '' : Number(row.gps_latitude).toFixed(5)
  const lng = row.gps_longitude == null ? '' : Number(row.gps_longitude).toFixed(5)
  return [
    row.plate_number || '',
    row.recorded_at || '',
    row.zone_id || '',
    row.is_compliant === true ? '1' : row.is_compliant === false ? '0' : 'n',
    lat,
    lng,
  ].join('|')
}

function observationPriorityScore(row: ObservationRow): number {
  const note = normalizeNote(row.officer_notes)
  const hasPhoto = !!getObservationPhotoUrl(row)
  const hasUsefulNote = !!note && note !== '-'

  return (
    (hasPhoto ? 100 : 0) +
    (hasUsefulNote ? 20 : 0) +
    Math.min(note.length, 20) +
    (row.zone?.name ? 5 : 0)
  )
}

function formatVehicleSummary(v: CanonicalVehicleRow | undefined): string {
  if (!v) return 'No canonical metadata'
  const base = [v.vehicle_year, v.vehicle_make, v.vehicle_model, v.vehicle_color].filter(Boolean).join(' ')
  return base || 'No canonical metadata'
}

function hasCanonicalMetadata(v: CanonicalVehicleRow | undefined): boolean {
  if (!v) return false
  return !!(v.vehicle_make || v.vehicle_model || v.vehicle_year || v.vehicle_color)
}

const toTitleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function ObservationRecords() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const [searchPlate, setSearchPlate] = useState('')
  const [selectedPlate, setSelectedPlate] = useState<string | null>(null)
  const requestedPlate = (searchParams.get('plate') || '').trim().toUpperCase()

  const effectiveOrganizationId =
    user?.role === 'master' ? organizationId || null : user?.organization_id || null
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  const {
    data: rawObservations = [],
    isLoading: observationsLoading,
    isError: observationsIsError,
    error: observationsError,
    refetch,
  } = useQuery({
    queryKey: ['observation-records-observations', effectiveOrganizationId, zoneId, dateFrom, dateTo],
    queryFn: async () => {
      const applyFilters = (query: any) => {
        if (effectiveOrganizationId) query = query.eq('organization_id', effectiveOrganizationId)
        if (zoneId) query = query.eq('zone_id', zoneId)
        if (startDate) query = query.gte('recorded_at', startDate)
        if (endDate) query = query.lte('recorded_at', endDate)
        return query
      }

      const extraCols = ', breach_type, breach_reason, nights_stayed_this_month'
      const zoneJoin = ', zone:zones!vehicle_observations_v2_zone_id_fkey(name)'
      // Select BOTH photo columns so getObservationPhotoUrl() can find
      // the URL regardless of which column stores it.
      const primarySelects = [
        `observation_id, plate_number, recorded_at, zone_id, photo, photo_url, is_compliant, officer_notes, gps_latitude, gps_longitude${extraCols}${zoneJoin}`,
      ]

      // Primary path: use relationship join when schema cache has it.
      for (const selectClause of primarySelects) {
        let primaryQuery = (supabase.from('observations') as any)
          .select(selectClause)
          .order('recorded_at', { ascending: false })
          .limit(2500)

        primaryQuery = applyFilters(primaryQuery)
        const primary = await primaryQuery
        if (!primary.error) {
          return ((primary.data || []) as any[]).map((row: any) => ({
            ...row,
            id: row.observation_id,
          })) as ObservationRow[]
        }
      }

      // Fallback path: fetch observations without join and resolve zone names manually.
      let fallback: any = null
      const fallbackSelects = [
        `observation_id, plate_number, recorded_at, zone_id, photo, photo_url, is_compliant, officer_notes, gps_latitude, gps_longitude${extraCols}`,
      ]

      for (const selectClause of fallbackSelects) {
        let fallbackQuery = (supabase.from('observations') as any)
          .select(selectClause)
          .order('recorded_at', { ascending: false })
          .limit(2500)

        fallbackQuery = applyFilters(fallbackQuery)
        fallback = await fallbackQuery
        if (!fallback.error) break
      }

      if (!fallback || fallback.error) throw fallback?.error

      const rawRows = (fallback.data || []) as any[]
      const zoneIds = Array.from(new Set(rawRows.map((r) => r.zone_id).filter(Boolean)))

      let zoneNameById = new Map<string, string>()
      if (zoneIds.length > 0) {
        const zonesRes = await (supabase.from('zones') as any).select('id, name').in('id', zoneIds)
        if (!zonesRes.error && zonesRes.data) {
          zoneNameById = new Map((zonesRes.data as any[]).map((z) => [z.id, z.name]))
        }
      }

      return rawRows.map((row) => ({
        ...row,
        id: row.observation_id,
        zone: row.zone_id ? { name: zoneNameById.get(row.zone_id) || 'Unknown zone' } : null,
      })) as ObservationRow[]
    },
  })

  const observations = useMemo(() => {
    if (!rawObservations || rawObservations.length === 0) return [] as ObservationRow[]

    const bestByKey = new Map<string, ObservationRow>()
    for (const row of rawObservations) {
      const key = observationDedupKey(row)
      const current = bestByKey.get(key)
      if (!current) {
        bestByKey.set(key, row)
        continue
      }

      if (observationPriorityScore(row) > observationPriorityScore(current)) {
        bestByKey.set(key, row)
      }
    }

    return Array.from(bestByKey.values()).sort((a, b) =>
      a.recorded_at < b.recorded_at ? 1 : -1
    )
  }, [rawObservations])

  const duplicateCount = Math.max(0, (rawObservations?.length || 0) - observations.length)

  const groupedByPlate = useMemo(() => {
    const map = new Map<string, ObservationRow[]>()
    for (const row of observations) {
      if (!row.plate_number) continue
      if (!map.has(row.plate_number)) map.set(row.plate_number, [])
      map.get(row.plate_number)!.push(row)
    }
    return map
  }, [observations])

  const plateRecords = useMemo(() => {
    const records = Array.from(groupedByPlate.entries()).map(([plate, rows]) => ({
      plate,
      rows,
      latestAt: rows[0]?.recorded_at || '',
      breaches: rows.filter((r) => !r.is_compliant).length,
      photos: rows.filter((r) => !!getObservationPhotoUrl(r)).length,
    }))

    const term = searchPlate.trim().toUpperCase()
    const filtered = term
      ? records.filter((r) => r.plate.toUpperCase().includes(term))
      : records

    return filtered.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1))
  }, [groupedByPlate, searchPlate])

  useEffect(() => {
    if (requestedPlate) {
      setSearchPlate(requestedPlate)
    }
  }, [requestedPlate])

  useEffect(() => {
    if (plateRecords.length === 0) {
      setSelectedPlate(null)
      return
    }

    if (requestedPlate) {
      const matched = plateRecords.find((r) => r.plate.toUpperCase() === requestedPlate)
      if (matched) {
        setSelectedPlate(matched.plate)
        return
      }
    }

    if (!selectedPlate || !plateRecords.some((r) => r.plate === selectedPlate)) {
      setSelectedPlate(plateRecords[0].plate)
    }
  }, [plateRecords, selectedPlate, requestedPlate])

  const selectedRows = selectedPlate ? groupedByPlate.get(selectedPlate) || [] : []

  const plateNumbersForCanonical = plateRecords.map((r) => r.plate)

  const { data: canonicalVehicles = [] } = useQuery({
    queryKey: ['observation-records-canonical', effectiveOrganizationId, plateNumbersForCanonical.join('|')],
    queryFn: async () => {
      if (plateNumbersForCanonical.length === 0) return [] as CanonicalVehicleRow[]

      let q = (supabase.from('canonical_vehicles') as any)
        .select('plate_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, owner_first_name, owner_last_name, self_contained, is_flagged, is_exempt')
        .in('plate_number', plateNumbersForCanonical)

      if (effectiveOrganizationId) q = q.eq('organization_id', effectiveOrganizationId)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as CanonicalVehicleRow[]
    },
    enabled: plateNumbersForCanonical.length > 0,
  })

  const canonicalByPlate = useMemo(() => {
    const map = new Map<string, CanonicalVehicleRow>()
    for (const row of canonicalVehicles) map.set(row.plate_number, row)
    return map
  }, [canonicalVehicles])

  const selectedCanonical = selectedPlate ? canonicalByPlate.get(selectedPlate) : undefined
  const breachSearchPlate = selectedPlate || requestedPlate

  // ── ParkPow Photo Sync ──────────────────────────────────────────────
  const [photoSyncing, setPhotoSyncing] = useState(false)
  const [photoSyncResult, setPhotoSyncResult] = useState<{
    scanned: number
    candidates: number
    linked: number
    no_match: number
    errors: number
    apply: boolean
  } | null>(null)

  const missingPhotoCount = observations.filter((o) => !getObservationPhotoUrl(o)).length
  const withPhotoCount = observations.filter((o) => !!getObservationPhotoUrl(o)).length

  const handlePhotoSync = async (dryRun: boolean) => {
    setPhotoSyncing(true)
    setPhotoSyncResult(null)
    try {
      const { data, error } = await edgeFunctions.syncParkPowPhotos({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        apply: !dryRun,
        require_empty_photo: true,
        limit: PHOTO_SYNC_LIMIT,
        window_minutes: PHOTO_SYNC_WINDOW_MINUTES,
      })

      if (error) {
        toast.error('Photo sync failed. Check ParkPow API credentials and try again.')
        console.error('[ParkPow Photo Sync]', error)
        return
      }

      if (data) {
        setPhotoSyncResult({
          scanned: data.scanned ?? 0,
          candidates: data.candidates ?? 0,
          linked: data.linked ?? 0,
          no_match: data.no_match ?? 0,
          errors: data.errors ?? 0,
          apply: data.apply ?? false,
        })

        if (data.apply && data.linked > 0) {
          toast.success(`Linked ${data.linked} photos from ParkPow`)
          refetch()
        } else if (!data.apply) {
          toast.info(`Dry run: ${data.candidates} observations could be linked`)
        } else {
          toast.info('No matching ParkPow photos found')
        }
      }
    } catch {
      toast.error('Photo sync request failed')
    } finally {
      setPhotoSyncing(false)
    }
  }

  return (
    <AppLayout
      title="Observation Records"
      description="Canonical vehicle records with date-filtered observations and visible photo evidence"
      showBackButton
    >
      <GlobalFilterRibbon />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Canonical records</p>
            <p className="text-2xl font-bold">{plateRecords.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Observations in filter</p>
            <p className="text-2xl font-bold">{observations.length}</p>
            {duplicateCount > 0 && (
              <p className="text-xs text-muted-foreground mt-1">{duplicateCount} duplicates removed</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Observations with photos</p>
            <p className="text-2xl font-bold">{withPhotoCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Missing photos</p>
            <p className="text-2xl font-bold text-orange-600">{missingPhotoCount}</p>
            {missingPhotoCount > 0 && (
              <div className="flex gap-1 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  disabled={photoSyncing}
                  onClick={() => handlePhotoSync(true)}
                >
                  {photoSyncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Camera className="h-3 w-3 mr-1" />}
                  Preview
                </Button>
                <Button
                  size="sm"
                  className="text-xs h-7"
                  disabled={photoSyncing}
                  onClick={() => handlePhotoSync(false)}
                >
                  {photoSyncing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Camera className="h-3 w-3 mr-1" />}
                  Sync Photos
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {photoSyncResult && (
        <Card className="mb-4 border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">
                  ParkPow Photo Sync {photoSyncResult.apply ? 'Result' : '(Dry Run Preview)'}
                </span>
              </div>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setPhotoSyncResult(null)}>
                Dismiss
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">
              <div>
                <p className="text-xs text-muted-foreground">Scanned</p>
                <p className="text-lg font-bold">{photoSyncResult.scanned}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Candidates</p>
                <p className="text-lg font-bold">{photoSyncResult.candidates}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Linked</p>
                <p className="text-lg font-bold text-green-600">{photoSyncResult.linked}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">No Match</p>
                <p className="text-lg font-bold text-orange-600">{photoSyncResult.no_match}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Errors</p>
                <p className="text-lg font-bold text-red-600">{photoSyncResult.errors}</p>
              </div>
            </div>
            {!photoSyncResult.apply && photoSyncResult.candidates > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Click &quot;Sync Photos&quot; to apply — this will download images from ParkPow and link them to observations.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchPlate}
            onChange={(e) => setSearchPlate(e.target.value)}
            placeholder="Search canonical plate..."
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            navigate(
              breachSearchPlate
                ? `/breaches?search=${encodeURIComponent(breachSearchPlate)}`
                : '/breaches'
            )
          }
        >
          Back to Breaches
        </Button>
      </div>

      {observationsIsError ? (
        <Card className="border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20">
          <CardContent className="py-8">
            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold text-red-800 dark:text-red-200">Observation records failed to load</p>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                  {(observationsError as any)?.message || 'We could not fetch observation data right now. Try again or return to the dashboard while data recovers.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry observations
                </Button>
                <Button variant="ghost" onClick={() => navigate('/admin')}>
                  Return to dashboard
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <AsyncStateWrapper
          isLoading={observationsLoading}
          isEmpty={observations.length === 0}
          loadingText="Loading observation records..."
          emptyTitle="No observations found"
          emptyDescription="No observation records match your current filters. Try adjusting date range, organization, or zone filters."
          emptyActionLabel="Open patrol map"
          onEmptyAction={() => navigate('/live-patrol')}
        >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Canonical Vehicles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
              {plateRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground">No canonical vehicles in current filter.</p>
              ) : (
                plateRecords.map((record) => {
                  const canonical = canonicalByPlate.get(record.plate)
                  const selected = selectedPlate === record.plate
                  return (
                    <button
                      key={record.plate}
                      type="button"
                      onClick={() => setSelectedPlate(record.plate)}
                      className={`w-full text-left rounded-md border p-3 transition-colors ${selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-muted/40'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold">{record.plate}</span>
                        <Badge variant={record.breaches > 0 ? 'destructive' : 'default'}>
                          {record.breaches > 0 ? `${record.breaches} breach` : 'Compliant'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{formatVehicleSummary(canonical)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {record.rows.length} observations, {record.photos} photos
                      </p>
                    </button>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Car className="h-4 w-4" />
                {selectedPlate || 'No vehicle selected'}
              </CardTitle>
              {selectedPlate && selectedCanonical && hasCanonicalMetadata(selectedCanonical) && (
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                  {selectedCanonical.vehicle_make && (
                    <div><span className="text-muted-foreground">Make:</span> {selectedCanonical.vehicle_make}</div>
                  )}
                  {selectedCanonical.vehicle_model && (
                    <div><span className="text-muted-foreground">Model:</span> {selectedCanonical.vehicle_model}</div>
                  )}
                  {selectedCanonical.vehicle_year && (
                    <div><span className="text-muted-foreground">Year:</span> {selectedCanonical.vehicle_year}</div>
                  )}
                  {selectedCanonical.vehicle_color && (
                    <div><span className="text-muted-foreground">Color:</span> {selectedCanonical.vehicle_color}</div>
                  )}
                  {(selectedCanonical.owner_first_name || selectedCanonical.owner_last_name) && (
                    <div><span className="text-muted-foreground">Owner:</span> {[selectedCanonical.owner_first_name, selectedCanonical.owner_last_name].filter(Boolean).join(' ')}</div>
                  )}
                  <div className="flex items-center gap-1">
                    <Shield className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">SC:</span> {selectedCanonical.self_contained ? 'Yes' : 'No'}
                  </div>
                  {selectedCanonical.is_flagged && (
                    <div className="flex items-center gap-1 text-orange-600">
                      <Flag className="h-3 w-3" />
                      Flagged
                    </div>
                  )}
                  {selectedCanonical.is_exempt && (
                    <div className="flex items-center gap-1 text-purple-600">
                      <Shield className="h-3 w-3" />
                      Exempt
                    </div>
                  )}
                </div>
              )}
              {selectedPlate && !selectedCanonical && (
                <div className="text-xs text-muted-foreground">No canonical metadata</div>
              )}
            </CardHeader>
            <CardContent>
              {selectedRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Select a canonical vehicle to view observations.</p>
              ) : (
                <div className="space-y-3 max-h-[65vh] overflow-y-auto">
                  <p className="text-xs text-muted-foreground">{selectedRows.length} observation{selectedRows.length !== 1 ? 's' : ''}</p>
                  {selectedRows.map((obs) => {
                    const photoUrl = getObservationPhotoUrl(obs)
                    return (
                      <Card key={obs.id || observationDedupKey(obs)} className="border">
                        <CardContent className="p-3">
                          <div className="flex items-start gap-3">
                            {/* Photo */}
                            <div className="w-28 h-20 rounded border overflow-hidden shrink-0 bg-muted">
                              {photoUrl ? (
                                <button
                                  type="button"
                                  onClick={() => window.open(photoUrl, '_blank')}
                                  className="block w-full h-full hover:opacity-90"
                                >
                                  <img
                                    src={photoUrl}
                                    alt={`Observation ${obs.id}`}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                      ;(e.target as HTMLImageElement).style.display = 'none'
                                    }}
                                  />
                                </button>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                                  <span className="inline-flex items-center gap-1">
                                    <ImageIcon className="h-3 w-3" />
                                    No Photo
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Observation details */}
                            <div className="flex-1 min-w-0 space-y-1">
                              {/* Status badges */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant={obs.is_compliant ? 'default' : 'destructive'}>
                                  {obs.is_compliant ? 'Compliant' : 'Breach'}
                                </Badge>
                                {obs.breach_type && !obs.is_compliant && (
                                  <span className="text-xs text-red-500 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    {toTitleCase(obs.breach_type)}
                                  </span>
                                )}
                              </div>

                              {/* Breach reason */}
                              {obs.breach_reason && !obs.is_compliant && (
                                <p className="text-xs text-muted-foreground">{obs.breach_reason}</p>
                              )}

                              {/* Metadata row */}
                              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatDateTime(obs.recorded_at)}
                                </span>
                                {obs.zone?.name && (
                                  <span className="flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {obs.zone.name}
                                  </span>
                                )}
                                {obs.nights_stayed_this_month != null && obs.nights_stayed_this_month > 0 && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {obs.nights_stayed_this_month} night{obs.nights_stayed_this_month !== 1 ? 's' : ''} this month
                                  </span>
                                )}
                              </div>

                              {/* GPS */}
                              {obs.gps_latitude && obs.gps_longitude && (
                                <p className="text-xs text-muted-foreground">
                                  GPS: {Number(obs.gps_latitude).toFixed(5)}, {Number(obs.gps_longitude).toFixed(5)}
                                </p>
                              )}

                              {/* Officer notes */}
                              {obs.officer_notes && obs.officer_notes !== '-' && (
                                <div className="mt-1 p-2 bg-muted rounded text-xs">
                                  <span className="text-muted-foreground">Notes: </span>{obs.officer_notes}
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        </AsyncStateWrapper>
      )}
    </AppLayout>
  )
}
