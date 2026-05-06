/**
 * ZoneSignageEvidence — B-87
 * Evidence records for zone signage — photos and verification status.
 * Route: /zone-signage-evidence — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ImageIcon, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, ExternalLink, CheckCircle2,
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

type ZoneSignageEvidenceRow = Database['public']['Tables']['zone_signage_evidence']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ZoneSignageEvidence() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]               = useState('')
  const [filterCurrent, setFilterCurrent] = useState('all')
  const [filterType, setFilterType]       = useState('all')
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: evidence = [], isLoading, error, refetch } = useQuery<ZoneSignageEvidenceRow[]>({
    queryKey: ['zone-signage-evidence', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zone_signage_evidence')
        .select('*')
        .order('captured_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = evidence.filter(e => {
    if (filterCurrent === 'true'  && !e.is_current) return false
    if (filterCurrent === 'false' && e.is_current)  return false
    if (filterType    !== 'all'   && e.signage_type !== filterType) return false
    if (search) {
      const s = search.toLowerCase()
      return e.zone_id?.toLowerCase().includes(s)
    }
    return true
  })

  const total        = evidence.length
  const current      = evidence.filter(e => e.is_current === true).length
  const outdated     = evidence.filter(e => e.is_current === false).length
  const uniqueZones  = new Set(evidence.map(e => e.zone_id)).size

  const signageTypes = Array.from(new Set(evidence.map(e => e.signage_type).filter(Boolean)))

  // ── Mutation ──────────────────────────────────────────────────────────────

  const markCurrent = useMutation({
    mutationFn: async (row: ZoneSignageEvidenceRow) => {
      const { error: e1 } = await supabase
        .from('zone_signage_evidence')
        .update({ is_current: false })
        .eq('zone_id', row.zone_id)
        .neq('id', row.id)
      if (e1) throw e1
      const { error: e2 } = await supabase
        .from('zone_signage_evidence')
        .update({ is_current: true })
        .eq('id', row.id)
      if (e2) throw e2
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['zone-signage-evidence'] }); toast.success('Marked as current signage') },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ImageIcon className="h-7 w-7 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Zone Signage Evidence</h1>
              <p className="text-sm text-muted-foreground">Photos and verification status for zone signage</p>
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
            { label: 'Total',        value: total,       colour: 'text-slate-600' },
            { label: 'Current',      value: current,     colour: 'text-green-600' },
            { label: 'Outdated',     value: outdated,    colour: outdated > 0 ? 'text-orange-600' : 'text-muted-foreground' },
            { label: 'Unique Zones', value: uniqueZones, colour: 'text-blue-600' },
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
              placeholder="Zone ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterCurrent} onValueChange={setFilterCurrent}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Currency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">Current</SelectItem>
              <SelectItem value="false">Outdated</SelectItem>
            </SelectContent>
          </Select>

          {signageTypes.length > 0 && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Signage Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {signageTypes.map(t => (
                  <SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g, ' ')}</SelectItem>
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
              <div className="text-center py-12 text-muted-foreground text-sm">No signage evidence records match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Captured At</TableHead>
                    <TableHead>Zone ID</TableHead>
                    <TableHead>Signage Type</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead>Photo</TableHead>
                    <TableHead>SHA256</TableHead>
                    <TableHead>Action</TableHead>
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
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(e.captured_at)}</TableCell>
                          <TableCell className="text-sm font-mono">{e.zone_id ?? '—'}</TableCell>
                          <TableCell className="text-sm capitalize">{e.signage_type?.replace(/_/g, ' ') ?? '—'}</TableCell>
                          <TableCell>
                            {e.is_current === true && (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Current</Badge>
                            )}
                            {e.is_current === false && (
                              <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">Outdated</Badge>
                            )}
                          </TableCell>
                          <TableCell onClick={ev => ev.stopPropagation()}>
                            {e.photo_url ? (
                              <a href={e.photo_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            ) : <span className="text-muted-foreground text-sm">—</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {e.photo_sha256 ? e.photo_sha256.substring(0, 8) : '—'}
                          </TableCell>
                          <TableCell onClick={ev => ev.stopPropagation()}>
                            {!e.is_current && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                disabled={markCurrent.isPending}
                                onClick={() => markCurrent.mutate(e)}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Mark Current
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${e.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={8} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
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
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">Full SHA256</p>
                                  <p className="font-mono text-xs break-all">{e.photo_sha256 ?? '—'}</p>
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
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
