import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/utils'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import { getObservationPhotoUrl } from '@/lib/photoUtils'
import { Car, Search, RefreshCw, Image as ImageIcon } from 'lucide-react'

interface ObservationRow {
  id: string
  plate_number: string
  recorded_at: string
  zone_id: string
  photo_url: string | null
  is_compliant: boolean
  officer_notes: string | null
  gps_latitude: number | null
  gps_longitude: number | null
  zone: { name: string } | null
}

interface CanonicalVehicleRow {
  plate_number: string
  make: string | null
  model: string | null
  year: number | null
  colour: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  self_contained: boolean | null
  is_flagged: boolean | null
  is_exempt: boolean | null
}

function formatVehicleSummary(v: CanonicalVehicleRow | undefined): string {
  if (!v) return 'No canonical metadata'
  const base = [v.year, v.make, v.model, v.colour].filter(Boolean).join(' ')
  return base || 'No canonical metadata'
}

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
    data: observations = [],
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

      const primarySelects = [
        'id, plate_number, recorded_at, zone_id, photo_url, is_compliant, officer_notes, gps_latitude, gps_longitude, zone:zones!observations_zone_id_fkey(name)',
        'id:observation_id, plate_number, recorded_at, zone_id, photo_url, is_compliant, officer_notes, gps_latitude, gps_longitude, zone:zones!observations_zone_id_fkey(name)',
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
          return (primary.data || []) as ObservationRow[]
        }
      }

      // Fallback path: fetch observations without join and resolve zone names manually.
      let fallback: any = null
      const fallbackSelects = [
        'id, plate_number, recorded_at, zone_id, photo_url, is_compliant, officer_notes, gps_latitude, gps_longitude',
        'id:observation_id, plate_number, recorded_at, zone_id, photo_url, is_compliant, officer_notes, gps_latitude, gps_longitude',
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
        zone: row.zone_id ? { name: zoneNameById.get(row.zone_id) || 'Unknown zone' } : null,
      })) as ObservationRow[]
    },
  })

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
        .select('plate_number, make, model, year, colour, owner_first_name, owner_last_name, self_contained, is_flagged, is_exempt')
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

  return (
    <AppLayout
      title="Observation Records"
      description="Canonical vehicle records with date-filtered observations and visible photo evidence"
      showBackButton
    >
      <GlobalFilterRibbon />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
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
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Observations with photos</p>
            <p className="text-2xl font-bold">{observations.filter((o) => !!getObservationPhotoUrl(o)).length}</p>
          </CardContent>
        </Card>
      </div>

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
        <Card>
          <CardContent className="py-8 text-sm text-red-600">
            Failed to load observations: {(observationsError as any)?.message || 'Unknown error'}
          </CardContent>
        </Card>
      ) : observationsLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Loading observation records...</CardContent>
        </Card>
      ) : (
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
              {selectedPlate && (
                <div className="text-xs text-muted-foreground">
                  {formatVehicleSummary(selectedCanonical)}
                </div>
              )}
            </CardHeader>
            <CardContent>
              {selectedRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Select a canonical vehicle to view observations.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Photo</TableHead>
                      <TableHead>Recorded</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>GPS</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRows.map((obs) => {
                      const photoUrl = getObservationPhotoUrl(obs)
                      return (
                        <TableRow key={obs.id}>
                          <TableCell>
                            {photoUrl ? (
                              <button
                                type="button"
                                onClick={() => window.open(photoUrl, '_blank')}
                                className="block rounded overflow-hidden border hover:opacity-90"
                              >
                                <img
                                  src={photoUrl}
                                  alt={`Observation ${obs.id}`}
                                  className="h-16 w-28 object-cover"
                                  loading="lazy"
                                  onError={(e) => {
                                    ;(e.target as HTMLImageElement).style.display = 'none'
                                  }}
                                />
                              </button>
                            ) : (
                              <div className="h-16 w-28 border rounded bg-muted flex items-center justify-center text-muted-foreground text-xs">
                                <span className="inline-flex items-center gap-1">
                                  <ImageIcon className="h-3 w-3" />
                                  No Photo
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{formatDateTime(obs.recorded_at)}</TableCell>
                          <TableCell className="text-xs">{obs.zone?.name || 'Unknown'}</TableCell>
                          <TableCell>
                            <Badge variant={obs.is_compliant ? 'default' : 'destructive'}>
                              {obs.is_compliant ? 'Compliant' : 'Breach'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {obs.gps_latitude && obs.gps_longitude
                              ? `${Number(obs.gps_latitude).toFixed(5)}, ${Number(obs.gps_longitude).toFixed(5)}`
                              : 'No GPS'}
                          </TableCell>
                          <TableCell className="text-xs max-w-[240px] truncate">{obs.officer_notes || '-'}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AppLayout>
  )
}
