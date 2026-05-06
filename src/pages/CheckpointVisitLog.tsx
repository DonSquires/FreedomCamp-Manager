/**
 * CheckpointVisitLog — B-82
 *
 * Log viewer for checkpoint_visits — officer scan-ins at patrol checkpoints.
 *
 * Features:
 *  - KPI cards: Total / Within Radius / Outside Radius / Avg GPS Accuracy
 *  - Filters: scan_method, within_radius toggle, date range
 *  - Table: checkpoint_id, officer_id, scan_method, within_radius badge, visited_at
 *  - Expandable row: GPS lat/lng, accuracy, distance from checkpoint, notes, patrol_id
 *
 * Route: /checkpoint-visits-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ScanLine, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, XCircle,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
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
import type { Database } from '@/types/database'

// ─── Types ─────────────────────────────────────────────────────────────────────

type CheckpointVisit = Database['public']['Tables']['checkpoint_visits']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CheckpointVisitLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id

  const [scanMethod, setScanMethod]       = useState('all')
  const [outsideOnly, setOutsideOnly]     = useState(false)
  const [dateFrom, setDateFrom]           = useState('')
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<CheckpointVisit[]>({
    queryKey: ['checkpoint-visits-log', orgId, scanMethod, outsideOnly, dateFrom],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('checkpoint_visits')
        .select('*')
        .eq('organization_id', orgId!)
        .order('visited_at', { ascending: false })
        .limit(500)

      if (scanMethod !== 'all')   q = q.eq('scan_method', scanMethod)
      if (outsideOnly)            q = q.eq('within_radius', false)
      if (dateFrom)               q = q.gte('visited_at', dateFrom)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const scanMethods = [...new Set(rows.map(r => r.scan_method).filter(Boolean))].sort()

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total        = rows.length
  const withinRadius = rows.filter(r => r.within_radius === true).length
  const outside      = rows.filter(r => r.within_radius === false).length
  const accuracyVals = rows.map(r => r.gps_accuracy).filter(v => v != null) as number[]
  const avgAccuracy  = accuracyVals.length > 0
    ? (accuracyVals.reduce((a, b) => a + b, 0) / accuracyVals.length).toFixed(1)
    : '—'

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScanLine className="h-6 w-6 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Checkpoint Visit Log</h1>
              <p className="text-sm text-muted-foreground">Officer scan-ins at patrol checkpoints</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total',         value: total,        colour: 'text-gray-700' },
            { label: 'Within Radius', value: withinRadius, colour: 'text-green-700' },
            { label: 'Outside',       value: outside,      colour: 'text-red-700' },
            { label: 'Avg GPS Acc (m)',value: avgAccuracy,  colour: 'text-blue-700' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={scanMethod} onValueChange={setScanMethod}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Scan method" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methods</SelectItem>
              {scanMethods.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-40" />
          <div className="flex items-center gap-2">
            <Checkbox id="outside" checked={outsideOnly} onCheckedChange={v => setOutsideOnly(!!v)} />
            <Label htmlFor="outside" className="text-sm cursor-pointer">Outside radius only</Label>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No checkpoint visits found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Checkpoint</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Scan Method</TableHead>
                  <TableHead>Radius</TableHead>
                  <TableHead>Visited At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-mono text-xs">{row.checkpoint_id.slice(0, 8)}…</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{row.officer_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-sm">{row.scan_method}</TableCell>
                        <TableCell>
                          {row.within_radius === true
                            ? <Badge className="bg-green-100 text-green-800"><CheckCircle2 className="h-3 w-3 mr-1" />Within</Badge>
                            : row.within_radius === false
                              ? <Badge className="bg-red-100 text-red-800"><XCircle className="h-3 w-3 mr-1" />Outside</Badge>
                              : <span className="text-muted-foreground text-sm">—</span>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.visited_at)}</TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={6} className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">GPS Latitude</p>
                                <p className="text-muted-foreground">{row.gps_latitude ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">GPS Longitude</p>
                                <p className="text-muted-foreground">{row.gps_longitude ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">GPS Accuracy (m)</p>
                                <p className="text-muted-foreground">{row.gps_accuracy ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Distance from CP (m)</p>
                                <p className="text-muted-foreground">{row.gps_distance_from_checkpoint != null ? row.gps_distance_from_checkpoint.toFixed(1) : '—'}</p>
                              </div>
                              <div className="col-span-2">
                                <p className="font-medium mb-1">Patrol ID</p>
                                <p className="text-muted-foreground font-mono text-xs">{row.patrol_id ?? '—'}</p>
                              </div>
                              <div className="col-span-2">
                                <p className="font-medium mb-1">Notes</p>
                                <p className="text-muted-foreground">{row.notes ?? 'None'}</p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
