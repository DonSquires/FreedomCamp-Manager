/**
 * CheckpointVisitLog — B-82
 *
 * Admin log viewer for checkpoint_visits.
 *
 * Features:
 *  - KPI cards: Total Visits / Within Radius / Outside Radius / Unique Checkpoints
 *  - Filters: scan_method select, within_radius toggle, date-range, free-text (notes)
 *  - Table: officer_id (UUID prefix), checkpoint_id (UUID prefix), scan_method, within_radius badge,
 *           GPS accuracy, visited_at
 *  - Expandable row: notes, GPS coords, patrol_id, gps_distance_from_checkpoint
 *
 * Route: /checkpoint-visits-log — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  MapPin, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, XCircle,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import type { Database } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type CheckpointVisit = Database['public']['Tables']['checkpoint_visits']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function radiusBadge(within: boolean | null) {
  if (within === true)  return <Badge variant="secondary" className="text-xs text-green-700"><CheckCircle2 className="h-3 w-3 mr-1 inline" />Within</Badge>
  if (within === false) return <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1 inline" />Outside</Badge>
  return <Badge variant="outline" className="text-xs text-muted-foreground">Unknown</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CheckpointVisitLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [search, setSearch]             = useState('')
  const [methodFilter, setMethod]       = useState('all')
  const [radiusFilter, setRadius]       = useState('all')
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data: visits = [], isLoading, refetch } = useQuery({
    queryKey: ['checkpoint-visits-log', orgId, methodFilter, radiusFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('checkpoint_visits')
        .select('*')
        .eq('organization_id', orgId!)
        .order('visited_at', { ascending: false })
        .limit(500)

      if (methodFilter !== 'all') q = q.eq('scan_method', methodFilter)
      if (radiusFilter === 'within')  q = q.eq('within_radius', true)
      if (radiusFilter === 'outside') q = q.eq('within_radius', false)
      if (dateFrom) q = q.gte('visited_at', dateFrom)
      if (dateTo)   q = q.lte('visited_at', `${dateTo}T23:59:59`)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CheckpointVisit[]
    },
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:       visits.length,
    within:      visits.filter(v => v.within_radius === true).length,
    outside:     visits.filter(v => v.within_radius === false).length,
    uniqueCPs:   new Set(visits.map(v => v.checkpoint_id)).size,
  }

  // ── Dynamic scan methods ───────────────────────────────────────────────────

  const methods = Array.from(new Set(visits.map(v => v.scan_method))).sort()

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = visits.filter(v => {
    if (search) {
      const q = search.toLowerCase()
      if (!v.notes?.toLowerCase().includes(q)) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Checkpoint Visit Log" description="Review all checkpoint visits and GPS compliance for this organisation">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-teal-600" />
          <span className="font-semibold text-lg">Checkpoint Visit Log</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Visits',         value: kpis.total,     icon: <MapPin className="h-4 w-4" />,        color: 'text-foreground' },
          { label: 'Within Radius',        value: kpis.within,    icon: <CheckCircle2 className="h-4 w-4" />,  color: 'text-green-600' },
          { label: 'Outside Radius',       value: kpis.outside,   icon: <XCircle className="h-4 w-4" />,       color: 'text-red-600' },
          { label: 'Unique Checkpoints',   value: kpis.uniqueCPs, icon: <MapPin className="h-4 w-4" />,        color: 'text-teal-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                {k.icon}{k.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={methodFilter} onValueChange={setMethod}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Scan method" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methods</SelectItem>
            {methods.map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={radiusFilter} onValueChange={setRadius}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Radius" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="within">Within radius</SelectItem>
            <SelectItem value="outside">Outside radius</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">From</Label>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">To</Label>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 h-9 text-sm" />
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && visits.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No checkpoint visits found for this organisation.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Officer</TableHead>
              <TableHead>Checkpoint</TableHead>
              <TableHead>Scan Method</TableHead>
              <TableHead>Radius</TableHead>
              <TableHead>GPS Accuracy</TableHead>
              <TableHead>Visited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && visits.length > 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No visits match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(v => {
              const expanded = expandedId === v.id
              return [
                <TableRow
                  key={v.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : v.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {v.officer_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {v.checkpoint_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{v.scan_method}</Badge>
                  </TableCell>
                  <TableCell>{radiusBadge(v.within_radius)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {v.gps_accuracy != null ? `±${v.gps_accuracy.toFixed(1)} m` : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(v.visited_at)}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${v.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={6} className="py-3 space-y-2 text-sm">
                      {v.notes && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
                          <p className="mt-0.5">{v.notes}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        {v.gps_latitude != null && v.gps_longitude != null && (
                          <span><MapPin className="h-3 w-3 inline mr-0.5" />{v.gps_latitude.toFixed(6)}, {v.gps_longitude.toFixed(6)}</span>
                        )}
                        {v.gps_distance_from_checkpoint != null && (
                          <span>Distance: {v.gps_distance_from_checkpoint.toFixed(1)} m</span>
                        )}
                        {v.patrol_id && (
                          <span>Patrol: <code className="bg-muted px-1 rounded">{v.patrol_id.slice(0, 8)}…</code></span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              ]
            })}
          </TableBody>
        </Table>
      </Card>

      {!isLoading && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 text-right">
          Showing {filtered.length} of {visits.length} visits
        </p>
      )}
    </AppLayout>
  )
}
