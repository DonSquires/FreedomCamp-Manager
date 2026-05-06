/**
 * ZoneSignageEvidence — B-87
 *
 * Evidence manager for zone_signage_evidence — photos of zone signage.
 *
 * Features:
 *  - KPI cards: Total / Current / Outdated
 *  - Filters: is_current toggle, signage_type, zone search
 *  - Table: zone_id, signage_type, is_current badge, captured_at, photo link
 *  - Expandable row: GPS coords, notes, SHA256, captured_by
 *  - Mark Current inline action
 *
 * Route: /zone-signage-evidence — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  SignpostBig, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, Image as ImageIcon,
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

type ZoneSignage = Database['public']['Tables']['zone_signage_evidence']['Row']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ZoneSignageEvidence() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [zoneSearch, setZoneSearch]         = useState('')
  const [typeFilter, setTypeFilter]         = useState('all')
  const [currentOnly, setCurrentOnly]       = useState(false)
  const [expandedId, setExpandedId]         = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: rows = [], isLoading, refetch } = useQuery<ZoneSignage[]>({
    queryKey: ['zone-signage-evidence', orgId, typeFilter, currentOnly],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('zone_signage_evidence')
        .select('*')
        .order('captured_at', { ascending: false })
        .limit(500)

      if (typeFilter !== 'all') q = q.eq('signage_type', typeFilter)
      if (currentOnly)          q = q.eq('is_current', true)

      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const signageTypes = [...new Set(rows.map(r => r.signage_type).filter(Boolean))].sort()

  const displayed = zoneSearch
    ? rows.filter(r => r.zone_id.toLowerCase().includes(zoneSearch.toLowerCase()))
    : rows

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const total    = rows.length
  const current  = rows.filter(r => r.is_current).length
  const outdated = rows.filter(r => r.is_current === false).length

  // ── Mutation ──────────────────────────────────────────────────────────────

  const markCurrent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('zone_signage_evidence')
        .update({ is_current: true })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Marked as current signage')
      qc.invalidateQueries({ queryKey: ['zone-signage-evidence'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SignpostBig className="h-6 w-6 text-teal-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Signage Evidence</h1>
              <p className="text-sm text-muted-foreground">Signage photo evidence for freedom camping zones</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total',   value: total,   colour: 'text-gray-700' },
            { label: 'Current', value: current, colour: 'text-green-700' },
            { label: 'Outdated',value: outdated,colour: 'text-gray-500' },
          ].map(kpi => (
            <Card key={kpi.label}>
              <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">{kpi.label}</CardTitle></CardHeader>
              <CardContent className="px-4 pb-3"><p className={`text-2xl font-bold ${kpi.colour}`}>{kpi.value}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <Input placeholder="Search zone…" value={zoneSearch} onChange={e => setZoneSearch(e.target.value)} className="w-44" />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Signage type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {signageTypes.map(t => <SelectItem key={t!} value={t!}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox id="current" checked={currentOnly} onCheckedChange={v => setCurrentOnly(!!v)} />
            <Label htmlFor="current" className="text-sm cursor-pointer">Current only</Label>
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground gap-2">
            <AlertCircle className="h-8 w-8" /><p>No signage evidence found</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Zone</TableHead>
                  <TableHead>Signage Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Captured At</TableHead>
                  <TableHead>Photo</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map(row => {
                  const expanded = expandedId === row.id
                  return (
                    <>
                      <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : row.id)}>
                        <TableCell>{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="font-mono text-xs">{row.zone_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-sm">{row.signage_type ?? '—'}</TableCell>
                        <TableCell>
                          {row.is_current
                            ? <Badge className="bg-green-100 text-green-800">Current</Badge>
                            : <Badge className="bg-gray-100 text-gray-600">Outdated</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(row.captured_at)}</TableCell>
                        <TableCell>
                          <a href={row.photo_url} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" /> View
                          </a>
                        </TableCell>
                        <TableCell className="text-right">
                          {!row.is_current && (
                            <Button
                              size="sm" variant="outline"
                              disabled={markCurrent.isPending}
                              onClick={e => { e.stopPropagation(); markCurrent.mutate(row.id) }}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Mark Current
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${row.id}-exp`} className="bg-muted/30">
                          <TableCell colSpan={7} className="p-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="font-medium mb-1">GPS Lat</p>
                                <p className="text-muted-foreground">{row.gps_latitude ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">GPS Lng</p>
                                <p className="text-muted-foreground">{row.gps_longitude ?? '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Captured By</p>
                                <p className="text-muted-foreground font-mono text-xs">{row.captured_by ? `${row.captured_by.slice(0, 8)}…` : '—'}</p>
                              </div>
                              <div>
                                <p className="font-medium mb-1">Notes</p>
                                <p className="text-muted-foreground">{row.notes ?? 'None'}</p>
                              </div>
                              <div className="col-span-4">
                                <p className="font-medium mb-1">SHA256</p>
                                <p className="text-muted-foreground font-mono text-xs break-all">{row.photo_sha256}</p>
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
