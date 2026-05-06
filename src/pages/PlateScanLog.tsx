/**
 * PlateScanLog — B-71
 *
 * Admin log for plate_scans — ALPR / manual plate scan records.
 *
 * Features:
 *  - KPI cards: Total Scans / Breach Detected / Flagged Vehicle / Unreviewed
 *  - Filters: scan_mode, breach/flagged toggles, search (plate number / zone)
 *  - Table: scanned_at, plate, zone, mode, confidence, breach, flagged, reviewed
 *  - Mark Reviewed action (bulk or per-row)
 *  - AI details in expandable row (make/model/colour + violation summary)
 *
 * Route: /plate-scans-log — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ScanSearch, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Car,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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

type PlateScan = Database['public']['Tables']['plate_scans']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function confidenceBar(score: number | null | undefined) {
  if (score == null) return null
  const pct = Math.round(score * 100)
  const colour = pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PlateScanLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]           = useState('')
  const [filterMode, setFilterMode]   = useState('all')
  const [filterBreach, setFilterBreach] = useState(false)
  const [filterFlagged, setFilterFlagged] = useState(false)
  const [filterUnreviewed, setFilterUnreviewed] = useState(false)
  const [expandedId, setExpandedId]   = useState<string | null>(null)
  const [selected, setSelected]       = useState<Set<string>>(new Set())

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: scans = [], isLoading, error, refetch } = useQuery<PlateScan[]>({
    queryKey: ['plate-scans', orgId],
    queryFn: async () => {
      let q = supabase
        .from('plate_scans')
        .select('*')
        .order('scanned_at', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = scans.filter(s => {
    if (filterMode !== 'all' && s.scan_mode !== filterMode) return false
    if (filterBreach && !s.breach_detected) return false
    if (filterFlagged && !s.flagged_vehicle_detected) return false
    if (filterUnreviewed && s.reviewed) return false
    if (search) {
      const lo = search.toLowerCase()
      return (
        s.plate_number?.toLowerCase().includes(lo) ||
        s.zone_id?.toLowerCase().includes(lo) ||
        s.ai_vehicle_make?.toLowerCase().includes(lo)
      )
    }
    return true
  })

  const total       = scans.length
  const breachCount = scans.filter(s => s.breach_detected).length
  const flaggedCount= scans.filter(s => s.flagged_vehicle_detected).length
  const unreviewed  = scans.filter(s => !s.reviewed).length

  const scanModes = Array.from(new Set(scans.map(s => s.scan_mode).filter(Boolean)))

  // ── Mark reviewed mutation ────────────────────────────────────────────────

  const markReviewed = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('plate_scans')
        .update({ reviewed: true, review_action: 'reviewed', created_at: undefined })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: (_, ids) => {
      qc.invalidateQueries({ queryKey: ['plate-scans'] })
      toast.success(`${ids.length} scan${ids.length > 1 ? 's' : ''} marked reviewed`)
      setSelected(new Set())
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ScanSearch className="h-7 w-7 text-cyan-500" />
            <div>
              <h1 className="text-2xl font-bold">Plate Scan Log</h1>
              <p className="text-sm text-muted-foreground">ALPR and manual plate scan records</p>
            </div>
          </div>
          <div className="flex gap-2">
            {selected.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={markReviewed.isPending}
                onClick={() => markReviewed.mutate(Array.from(selected))}
              >
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                Mark {selected.size} Reviewed
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Scans',      value: total,        icon: ScanSearch,    colour: 'text-slate-600' },
            { label: 'Breach Detected',  value: breachCount,  icon: AlertTriangle, colour: breachCount > 0 ? 'text-red-600' : 'text-muted-foreground' },
            { label: 'Flagged Vehicle',  value: flaggedCount, icon: Car,           colour: flaggedCount > 0 ? 'text-orange-600' : 'text-muted-foreground' },
            { label: 'Unreviewed',       value: unreviewed,   icon: AlertCircle,   colour: unreviewed > 0 ? 'text-amber-600' : 'text-muted-foreground' },
          ].map(({ label, value, icon: Icon, colour }) => (
            <Card key={label}>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${colour}`} />
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
              placeholder="Plate, zone, make…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {scanModes.length > 0 && (
            <Select value={filterMode} onValueChange={setFilterMode}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Scan Mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modes</SelectItem>
                {scanModes.map(m => (
                  <SelectItem key={m} value={m} className="capitalize">{m?.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant={filterBreach ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterBreach(f => !f)}
          >
            <AlertTriangle className="h-4 w-4 mr-1.5" />
            Breach Only
          </Button>
          <Button
            variant={filterFlagged ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterFlagged(f => !f)}
          >
            <Car className="h-4 w-4 mr-1.5" />
            Flagged Only
          </Button>
          <Button
            variant={filterUnreviewed ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterUnreviewed(f => !f)}
          >
            <AlertCircle className="h-4 w-4 mr-1.5" />
            Unreviewed
          </Button>
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
              <div className="text-center py-12 text-muted-foreground text-sm">No scans match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={selected.size > 0 && filtered.every(s => selected.has(s.id))}
                        onChange={e => {
                          if (e.target.checked) setSelected(new Set(filtered.map(s => s.id)))
                          else setSelected(new Set())
                        }}
                        className="cursor-pointer"
                      />
                    </TableHead>
                    <TableHead>Scanned At</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Breach</TableHead>
                    <TableHead>Flagged</TableHead>
                    <TableHead>Reviewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(s => {
                    const isExpanded = expandedId === s.id
                    return (
                      <>
                        <TableRow
                          key={s.id}
                          className={`cursor-pointer hover:bg-muted/40 ${s.breach_detected ? 'bg-red-50/40 dark:bg-red-950/10' : ''}`}
                          onClick={() => setExpandedId(isExpanded ? null : s.id)}
                        >
                          <TableCell>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label="Select scan"
                              checked={selected.has(s.id)}
                              onChange={() => toggleSelect(s.id)}
                              className="cursor-pointer"
                            />
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(s.scanned_at)}</TableCell>
                          <TableCell className="font-mono font-semibold">{s.plate_number ?? '—'}</TableCell>
                          <TableCell className="text-sm capitalize">{s.scan_mode?.replace(/_/g, ' ') ?? '—'}</TableCell>
                          <TableCell>{confidenceBar(s.confidence_score)}</TableCell>
                          <TableCell>
                            {s.breach_detected ? (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Yes</Badge>
                            ) : <span className="text-xs text-muted-foreground">No</span>}
                          </TableCell>
                          <TableCell>
                            {s.flagged_vehicle_detected ? (
                              <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">Flagged</Badge>
                            ) : <span className="text-xs text-muted-foreground">No</span>}
                          </TableCell>
                          <TableCell>
                            {s.reviewed ? (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Yes
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                disabled={markReviewed.isPending}
                                onClick={e => { e.stopPropagation(); markReviewed.mutate([s.id]) }}
                              >
                                Review
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${s.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={9} className="py-3 px-6">
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                                {(s.ai_vehicle_make || s.ai_vehicle_model || s.ai_vehicle_color) && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">AI Vehicle Data</p>
                                    <p>{[s.ai_vehicle_color, s.ai_vehicle_make, s.ai_vehicle_model].filter(Boolean).join(' ')}</p>
                                  </div>
                                )}
                                {s.violation_summary && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Violation Summary</p>
                                    <p>{s.violation_summary}</p>
                                  </div>
                                )}
                                {(s.gps_latitude != null && s.gps_longitude != null) && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">GPS</p>
                                    <p>{s.gps_latitude?.toFixed(5)}, {s.gps_longitude?.toFixed(5)}</p>
                                    {s.gps_accuracy != null && (
                                      <p className="text-xs text-muted-foreground">±{s.gps_accuracy}m</p>
                                    )}
                                  </div>
                                )}
                                {s.review_action && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Review Action</p>
                                    <p className="capitalize">{s.review_action?.replace(/_/g, ' ')}</p>
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
