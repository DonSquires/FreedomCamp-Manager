/**
 * CohortAnalysis — B-21
 *
 * Pattern / cohort analysis for freedom camping enforcement.
 * Surfaces three pre-built cohort RPC functions:
 *   cohort_all_breaches     — every breach observation in the date window
 *   cohort_overstayers      — vehicles that exceeded the nights limit
 *   cohort_homeless_exempt  — vehicles that submitted a homeless exemption
 *
 * Admins can filter by date range + zone, then drill into individual plates.
 */

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  BarChart2,
  Users,
  AlertTriangle,
  ShieldOff,
  Search,
  Car,
  MapPin,
  Calendar,
  Download,
  RefreshCw,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { nzNow } from '@/lib/timezone'
import { format, subDays } from 'date-fns'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type AllBreachRow      = Database['public']['Functions']['cohort_all_breaches']['Returns'][number]
type OverstayRow       = Database['public']['Functions']['cohort_overstayers']['Returns'][number]
type HomelessExemptRow = Database['public']['Functions']['cohort_homeless_exempt']['Returns'][number]
type ZoneRow           = Pick<Database['public']['Tables']['zones']['Row'], 'id' | 'name'>

type CohortTab = 'all_breaches' | 'overstayers' | 'homeless_exempt'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function csvRow(cells: string[]): string {
  return cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
}

function downloadCsv(rows: string[], filename: string) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CohortAnalysis() {
  const { user } = useAuthStore()
  const { zoneId } = useGlobalFiltersStore()
  const navigate = useNavigate()

  const today      = format(nzNow(), 'yyyy-MM-dd')
  const thirtyAgo  = format(subDays(nzNow(), 30), 'yyyy-MM-dd')

  const [dateFrom, setDateFrom]   = useState(thirtyAgo)
  const [dateTo,   setDateTo]     = useState(today)
  const [zoneFilter, setZoneFilter] = useState(zoneId ?? 'all')
  const [search, setSearch]       = useState('')
  const [tab, setTab]             = useState<CohortTab>('all_breaches')

  const orgId = user?.organization_id ?? ''

  // ── Zone list ──────────────────────────────────────────────────────────────
  const { data: zones = [] } = useQuery<ZoneRow[]>({
    queryKey: ['zones-simple', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name')
      return (data ?? []) as ZoneRow[]
    },
    enabled: !!orgId,
  })

  // ── Cohort: All Breaches ───────────────────────────────────────────────────
  const { data: allBreaches = [], isFetching: fetchingAll, refetch: refetchAll } = useQuery<AllBreachRow[]>({
    queryKey: ['cohort_all_breaches', orgId, dateFrom, dateTo, zoneFilter],
    queryFn: async () => {
      const args: Record<string, string> = {
        p_from: `${dateFrom}T00:00:00`,
        p_to:   `${dateTo}T23:59:59`,
        p_org_id: orgId,
      }
      if (zoneFilter && zoneFilter !== 'all') args.p_zone_id = zoneFilter
      const { data, error } = await (supabase.rpc as any)('cohort_all_breaches', args)
      if (error) throw error
      return (data ?? []) as AllBreachRow[]
    },
    enabled: !!orgId && tab === 'all_breaches',
  })

  // ── Cohort: Overstayers ────────────────────────────────────────────────────
  const { data: overstayers = [], isFetching: fetchingOver, refetch: refetchOver } = useQuery<OverstayRow[]>({
    queryKey: ['cohort_overstayers', orgId, dateFrom, dateTo, zoneFilter],
    queryFn: async () => {
      const args: Record<string, string> = {
        p_from: `${dateFrom}T00:00:00`,
        p_to:   `${dateTo}T23:59:59`,
        p_org_id: orgId,
      }
      if (zoneFilter && zoneFilter !== 'all') args.p_zone_id = zoneFilter
      const { data, error } = await (supabase.rpc as any)('cohort_overstayers', args)
      if (error) throw error
      return (data ?? []) as OverstayRow[]
    },
    enabled: !!orgId && tab === 'overstayers',
  })

  // ── Cohort: Homeless Exempt ────────────────────────────────────────────────
  const { data: homelessExempt = [], isFetching: fetchingHom, refetch: refetchHom } = useQuery<HomelessExemptRow[]>({
    queryKey: ['cohort_homeless_exempt', orgId, dateFrom, dateTo, zoneFilter],
    queryFn: async () => {
      const args: Record<string, string> = {
        p_from: `${dateFrom}T00:00:00`,
        p_to:   `${dateTo}T23:59:59`,
        p_org_id: orgId,
      }
      if (zoneFilter && zoneFilter !== 'all') args.p_zone_id = zoneFilter
      const { data, error } = await (supabase.rpc as any)('cohort_homeless_exempt', args)
      if (error) throw error
      return (data ?? []) as HomelessExemptRow[]
    },
    enabled: !!orgId && tab === 'homeless_exempt',
  })

  // ── Filtered rows (client-side plate search) ───────────────────────────────
  const filteredAll = useMemo(() => {
    if (!search.trim()) return allBreaches
    return allBreaches.filter(r => r.plate_number?.toLowerCase().includes(search.toLowerCase()))
  }, [allBreaches, search])

  const filteredOver = useMemo(() => {
    if (!search.trim()) return overstayers
    return overstayers.filter(r => r.plate_number?.toLowerCase().includes(search.toLowerCase()))
  }, [overstayers, search])

  const filteredHom = useMemo(() => {
    if (!search.trim()) return homelessExempt
    return homelessExempt.filter(r => r.plate_number?.toLowerCase().includes(search.toLowerCase()))
  }, [homelessExempt, search])

  // ── CSV Export ─────────────────────────────────────────────────────────────
  function exportCsv() {
    if (tab === 'all_breaches') {
      const rows = [
        csvRow(['Plate', 'Zone', 'Recorded At', 'Violation Reasons', 'Homeless Exempt']),
        ...filteredAll.map(r => csvRow([
          r.plate_number,
          r.zone_name,
          r.recorded_at,
          (r.violation_reasons ?? []).join('; '),
          r.is_homeless_exempt ? 'Yes' : 'No',
        ])),
      ]
      downloadCsv(rows, `cohort-all-breaches-${dateFrom}-to-${dateTo}.csv`)
    } else if (tab === 'overstayers') {
      const rows = [
        csvRow(['Plate', 'Zone', 'Recorded At', 'Violation Reasons']),
        ...filteredOver.map(r => csvRow([
          r.plate_number,
          r.zone_name,
          r.recorded_at,
          (r.violation_reasons ?? []).join('; '),
        ])),
      ]
      downloadCsv(rows, `cohort-overstayers-${dateFrom}-to-${dateTo}.csv`)
    } else {
      const rows = [
        csvRow(['Plate', 'Zone', 'Recorded At', 'Violation Reasons']),
        ...filteredHom.map(r => csvRow([
          r.plate_number,
          r.zone_name,
          r.recorded_at,
          (r.violation_reasons ?? []).join('; '),
        ])),
      ]
      downloadCsv(rows, `cohort-homeless-exempt-${dateFrom}-to-${dateTo}.csv`)
    }
  }

  function handleRefresh() {
    if (tab === 'all_breaches')    refetchAll()
    else if (tab === 'overstayers') refetchOver()
    else                            refetchHom()
  }

  const isFetching = fetchingAll || fetchingOver || fetchingHom

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-primary" />
              Cohort / Pattern Analysis
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Identify repeat offenders, overstayers, and pattern trends across zones
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-1.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs mb-1 block">From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Zone</Label>
                <Select value={zoneFilter} onValueChange={setZoneFilter}>
                  <SelectTrigger className="w-44 h-8 text-sm">
                    <SelectValue placeholder="All zones" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All zones</SelectItem>
                    {zones.map(z => (
                      <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-32">
                <Label className="text-xs mb-1 block">Filter by plate</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="pl-7 h-8 text-sm"
                    placeholder="Search plate…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-red-200 dark:border-red-800">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs uppercase tracking-wide text-red-600 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> All Breaches
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-3xl font-bold">{allBreaches.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">observations with violations</p>
            </CardContent>
          </Card>
          <Card className="border-amber-200 dark:border-amber-800">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs uppercase tracking-wide text-amber-600 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Overstayers
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-3xl font-bold">{overstayers.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">vehicles exceeded stay limit</p>
            </CardContent>
          </Card>
          <Card className="border-blue-200 dark:border-blue-800">
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs uppercase tracking-wide text-blue-600 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Homeless Exempt
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-3xl font-bold">{homelessExempt.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">vehicles with exemption claim</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={v => setTab(v as CohortTab)}>
          <TabsList>
            <TabsTrigger value="all_breaches" className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              All Breaches
              <Badge variant="secondary" className="ml-1 text-[10px]">{allBreaches.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="overstayers" className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Overstayers
              <Badge variant="secondary" className="ml-1 text-[10px]">{overstayers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="homeless_exempt" className="flex items-center gap-1.5">
              <ShieldOff className="h-3.5 w-3.5" />
              Homeless Exempt
              <Badge variant="secondary" className="ml-1 text-[10px]">{homelessExempt.length}</Badge>
            </TabsTrigger>
          </TabsList>

          {/* All Breaches */}
          <TabsContent value="all_breaches">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plate</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Recorded</TableHead>
                      <TableHead>Violation Reasons</TableHead>
                      <TableHead className="text-center">Homeless Exempt</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAll.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          {isFetching ? 'Loading…' : 'No breach observations found for the selected period.'}
                        </TableCell>
                      </TableRow>
                    ) : filteredAll.map((r, idx) => (
                      <TableRow
                        key={`${r.observation_id}-${idx}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/vehicles?plate=${encodeURIComponent(r.plate_number)}`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Car className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-mono font-semibold">{r.plate_number}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {r.zone_name}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(r.recorded_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(r.violation_reasons ?? []).slice(0, 3).map((v, i) => (
                              <Badge key={i} variant="destructive" className="text-[10px] px-1.5 py-0">
                                {v}
                              </Badge>
                            ))}
                            {(r.violation_reasons?.length ?? 0) > 3 && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                +{(r.violation_reasons?.length ?? 0) - 3}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {r.is_homeless_exempt
                            ? <Badge variant="outline" className="text-blue-600 border-blue-300 text-[10px]">Exempt</Badge>
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Overstayers */}
          <TabsContent value="overstayers">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plate</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Recorded</TableHead>
                      <TableHead>Violation Reasons</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOver.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          {isFetching ? 'Loading…' : 'No overstayers found for the selected period.'}
                        </TableCell>
                      </TableRow>
                    ) : filteredOver.map((r, idx) => (
                      <TableRow
                        key={`${r.observation_id}-${idx}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/vehicles?plate=${encodeURIComponent(r.plate_number)}`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Car className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-mono font-semibold">{r.plate_number}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {r.zone_name}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(r.recorded_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(r.violation_reasons ?? []).map((v, i) => (
                              <Badge key={i} variant="destructive" className="text-[10px] px-1.5 py-0">
                                {v}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Homeless Exempt */}
          <TabsContent value="homeless_exempt">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plate</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Recorded</TableHead>
                      <TableHead>Violation Reasons (at time of assessment)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHom.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          {isFetching ? 'Loading…' : 'No homeless-exempt records found for the selected period.'}
                        </TableCell>
                      </TableRow>
                    ) : filteredHom.map((r, idx) => (
                      <TableRow
                        key={`${r.observation_id}-${idx}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/vehicles?plate=${encodeURIComponent(r.plate_number)}`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Car className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-mono font-semibold">{r.plate_number}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {r.zone_name}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(r.recorded_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(r.violation_reasons ?? []).map((v, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                                {v}
                              </Badge>
                            ))}
                            {(r.violation_reasons?.length ?? 0) === 0 && (
                              <span className="text-xs text-muted-foreground">No violations on record</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
