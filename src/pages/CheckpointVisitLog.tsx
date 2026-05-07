/**
 * CheckpointVisitLog — B-82
 * Log of checkpoint_visits — GPS scan events at patrol checkpoints.
 * Route: /checkpoint-visits-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MapPinCheck, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckpointVisitRow = Database['public']['Tables']['checkpoint_visits']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CheckpointVisitLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch]                 = useState('')
  const [filterScanMethod, setFilterScanMethod] = useState('all')
  const [filterInRadius, setFilterInRadius] = useState('all')
  const [filterMonth, setFilterMonth]       = useState('all')
  const [expandedId, setExpandedId]         = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: events = [], isLoading, error, refetch } = useQuery<CheckpointVisitRow[]>({
    queryKey: ['checkpoint-visits', orgId],
    queryFn: async () => {
      let q = supabase
        .from('checkpoint_visits')
        .select('*')
        .order('visited_at', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = events.filter(e => {
    if (filterScanMethod !== 'all' && e.scan_method !== filterScanMethod) return false
    if (filterInRadius   === 'true'  && e.within_radius !== true)  return false
    if (filterInRadius   === 'false' && e.within_radius !== false) return false
    if (filterMonth      !== 'all' && e.visited_at?.substring(0, 7) !== filterMonth) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        e.officer_id?.toLowerCase().includes(s) ||
        e.checkpoint_id?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total       = events.length
  const inRadius    = events.filter(e => e.within_radius === true).length
  const outOfRadius = events.filter(e => e.within_radius === false).length
  const accuracyVals = events.map(e => e.gps_accuracy).filter(v => v != null) as number[]
  const avgAccuracy  = accuracyVals.length > 0
    ? (accuracyVals.reduce((a, b) => a + b, 0) / accuracyVals.length).toFixed(1) + ' m'
    : '—'

  const scanMethods = Array.from(new Set(events.map(e => e.scan_method).filter(Boolean)))
  const months      = Array.from(new Set(events.map(e => e.visited_at?.substring(0, 7)).filter(Boolean))).sort().reverse()

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <MapPinCheck className="h-7 w-7 text-green-600" />
            <div>
              <h1 className="text-2xl font-bold">Checkpoint Visit Log</h1>
              <p className="text-sm text-muted-foreground">GPS scan events at patrol checkpoints</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total',          value: total,        colour: 'text-slate-600' },
            { label: 'In Radius',      value: inRadius,     colour: 'text-green-600' },
            { label: 'Out of Radius',  value: outOfRadius,  colour: outOfRadius > 0 ? 'text-red-600' : 'text-muted-foreground' },
            { label: 'Avg GPS Accuracy', value: avgAccuracy, colour: 'text-blue-600' },
          ].map(({ label, value, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <span className={`text-2xl font-bold ${colour}`}>{value}</span>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Officer ID, checkpoint ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {scanMethods.length > 0 && (
            <Select value={filterScanMethod} onValueChange={setFilterScanMethod}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Scan Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                {scanMethods.map(m => (
                  <SelectItem key={m} value={m} className="capitalize">{m?.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={filterInRadius} onValueChange={setFilterInRadius}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="In Radius" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">In Radius</SelectItem>
              <SelectItem value="false">Out of Radius</SelectItem>
            </SelectContent>
          </Select>

          {months.length > 0 && (
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {months.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            {(error as Error).message}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No checkpoint visits match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Visited At</TableHead>
                    <TableHead>Checkpoint</TableHead>
                    <TableHead>Officer</TableHead>
                    <TableHead>Scan Method</TableHead>
                    <TableHead>In Radius</TableHead>
                    <TableHead>Distance (m)</TableHead>
                    <TableHead>GPS Accuracy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => {
                    const isExpanded = expandedId === e.id
                    return (
                      <>
                        <TableRow
                          key={e.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setExpandedId(isExpanded ? null : e.id)}
                        >
                          <TableCell>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.visited_at)}</TableCell>
                          <TableCell className="font-mono text-xs">{e.checkpoint_id ? e.checkpoint_id.substring(0, 8) + '…' : '—'}</TableCell>
                          <TableCell className="font-mono text-xs">{e.officer_id ? e.officer_id.substring(0, 8) + '…' : '—'}</TableCell>
                          <TableCell className="text-sm capitalize">{e.scan_method?.replace(/_/g, ' ') ?? '—'}</TableCell>
                          <TableCell>
                            {e.within_radius === true && (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Yes</Badge>
                            )}
                            {e.within_radius === false && (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">No</Badge>
                            )}
                            {e.within_radius == null && <span className="text-muted-foreground text-sm">—</span>}
                          </TableCell>
                          <TableCell className="text-sm">{e.gps_distance_from_checkpoint != null ? e.gps_distance_from_checkpoint.toFixed(1) : '—'}</TableCell>
                          <TableCell className="text-sm">{e.gps_accuracy != null ? `${e.gps_accuracy} m` : '—'}</TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${e.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={8} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">Patrol ID</p>
                                  <p className="font-mono text-xs">{e.patrol_id ?? '—'}</p>
                                </div>
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">GPS Coordinates</p>
                                  <p className="font-mono text-xs">
                                    {e.gps_latitude != null ? e.gps_latitude.toFixed(6) : '—'}, {e.gps_longitude != null ? e.gps_longitude.toFixed(6) : '—'}
                                  </p>
                                </div>
                                {e.notes && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Notes</p>
                                    <p>{e.notes}</p>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
