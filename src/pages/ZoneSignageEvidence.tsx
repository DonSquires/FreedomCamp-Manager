/**
 * ZoneSignageEvidence — B-87
 *
 * Admin viewer for zone_signage_evidence.
 *
 * Features:
 *  - KPI cards: Total Records / Current / Superseded / Unique Zones
 *  - Filters: is_current toggle, signage_type select, free-text (notes / zone_id prefix)
 *  - Table: zone_id (UUID prefix), signage_type badge, is_current badge,
 *           captured_at, GPS coords, captured_by (UUID prefix)
 *  - Expandable row: notes, full photo_url link, photo_sha256, GPS detail
 *  - Mark as Current action (is_current → true) for non-current records
 *
 * Route: /zone-signage-evidence — admin / admin_officer / master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  SignpostBig, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, Camera, MapPin,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import type { Database } from '@/types/database'
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type ZoneSignage = Database['public']['Tables']['zone_signage_evidence']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function currentBadge(isCurrent: boolean | null) {
  return isCurrent
    ? <Badge variant="secondary" className="text-xs text-green-700"><CheckCircle2 className="h-3 w-3 mr-1 inline" />Current</Badge>
    : <Badge variant="outline" className="text-xs text-muted-foreground">Superseded</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ZoneSignageEvidence() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]           = useState('')
  const [currentFilter, setCurrent]   = useState('all')
  const [typeFilter, setType]         = useState('all')
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // ── Main query ─────────────────────────────────────────────────────────────
  // zone_signage_evidence has no organization_id column — we load all records
  // and let the user filter by zone (they all live within the org's zones).

  const { data: records = [], isLoading, refetch } = useQuery({
    queryKey: ['zone-signage-evidence', currentFilter, typeFilter],
    queryFn: async () => {
      let q = supabase
        .from('zone_signage_evidence')
        .select('*')
        .order('captured_at', { ascending: false })
        .limit(500)

      if (currentFilter === 'current')    q = q.eq('is_current', true)
      if (currentFilter === 'superseded') q = q.eq('is_current', false)
      if (typeFilter !== 'all')           q = q.eq('signage_type', typeFilter)

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ZoneSignage[]
    },
  })

  // ── Mark as current mutation ───────────────────────────────────────────────

  const markCurrent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('zone_signage_evidence')
        .update({ is_current: true })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zone-signage-evidence'] })
      toast.success('Marked as current signage evidence')
    },
    onError: (e: any) => toast.error(e.message || 'Update failed'),
  })

  // ── Dynamic type list ──────────────────────────────────────────────────────

  const types = Array.from(new Set(records.map(r => r.signage_type).filter(Boolean))).sort() as string[]

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:      records.length,
    current:    records.filter(r => r.is_current).length,
    superseded: records.filter(r => !r.is_current).length,
    zones:      new Set(records.map(r => r.zone_id)).size,
  }

  // ── Filtered ──────────────────────────────────────────────────────────────

  const filtered = records.filter(r => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !r.zone_id.toLowerCase().includes(q) &&
        !r.notes?.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Zone Signage Evidence" description="View and manage signage photo evidence for zones">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <SignpostBig className="h-5 w-5 text-indigo-600" />
          <span className="font-semibold text-lg">Zone Signage Evidence</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Records', value: kpis.total,      icon: <Camera className="h-4 w-4" />,       color: 'text-foreground' },
          { label: 'Current',       value: kpis.current,    icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-600' },
          { label: 'Superseded',    value: kpis.superseded, icon: <Camera className="h-4 w-4" />,       color: 'text-muted-foreground' },
          { label: 'Unique Zones',  value: kpis.zones,      icon: <MapPin className="h-4 w-4" />,       color: 'text-indigo-600' },
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
            placeholder="Search zone ID, notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={currentFilter} onValueChange={setCurrent}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="current">Current</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Signage type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {types.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Empty state */}
      {!isLoading && records.length === 0 && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-4 py-3 mb-4 text-sm text-blue-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>No zone signage evidence records found.</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-6" />
              <TableHead>Zone</TableHead>
              <TableHead>Signage Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>GPS</TableHead>
              <TableHead>Captured</TableHead>
              <TableHead>Captured By</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && records.length > 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No records match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(r => {
              const expanded = expandedId === r.id
              const hasGps = r.gps_latitude != null && r.gps_longitude != null
              return [
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                >
                  <TableCell>
                    {expanded
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.zone_id.slice(0, 8)}…
                  </TableCell>
                  <TableCell>
                    {r.signage_type
                      ? <Badge variant="outline" className="text-xs">{r.signage_type}</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>{currentBadge(r.is_current)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {hasGps ? `${r.gps_latitude!.toFixed(4)}, ${r.gps_longitude!.toFixed(4)}` : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDate(r.captured_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.captured_by ? `${r.captured_by.slice(0, 8)}…` : '—'}
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    {!r.is_current && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-green-700 hover:text-green-800 h-7 text-xs"
                        onClick={() => markCurrent.mutate(r.id)}
                        disabled={markCurrent.isPending}
                      >
                        {markCurrent.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : 'Mark Current'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>,

                expanded && (
                  <TableRow key={`${r.id}-detail`} className="bg-muted/20">
                    <TableCell />
                    <TableCell colSpan={7} className="py-3 space-y-2 text-sm">
                      <div>
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          <Camera className="h-3 w-3 inline mr-1" />Photo
                        </span>
                        <a
                          href={r.photo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-xs text-blue-700 underline"
                        >
                          View Photo
                        </a>
                      </div>
                      {r.notes && (
                        <div>
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</span>
                          <p className="mt-0.5">{r.notes}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        {hasGps && (
                          <span><MapPin className="h-3 w-3 inline mr-0.5" />{r.gps_latitude!.toFixed(6)}, {r.gps_longitude!.toFixed(6)}</span>
                        )}
                        <span className="font-mono">SHA256: {r.photo_sha256.slice(0, 16)}…</span>
                        <span>Recorded: {fmtDate(r.created_at)}</span>
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
          Showing {filtered.length} of {records.length} records
        </p>
      )}
    </AppLayout>
  )
}
