/**
 * VehicleDiscrepancyLog — B-75
 *
 * Admin log for vehicle_discrepancies — conflicts between data sources for vehicle info.
 *
 * Features:
 *  - KPI cards: Total / Requires Review / High Severity / SC Law Active
 *  - Filters: discrepancy_type, severity, requires_review toggle, search (plate / source)
 *  - Table: created_at, plate, type, severity, source_a vs source_b, value_a vs value_b, reviewed
 *  - Mark Reviewed action per row (writes reviewed_at + reviewed_by + reviewed = true)
 *
 * Route: /vehicle-discrepancies — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  GitCompareArrows, Search, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, AlertTriangle,
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

type VehicleDiscrepancy = Database['public']['Tables']['vehicle_discrepancies']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const SEVERITY_COLOURS: Record<string, string> = {
  low:      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  medium:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function VehicleDiscrepancyLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]             = useState('')
  const [filterType, setFilterType]     = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterReview, setFilterReview] = useState(false)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: discrepancies = [], isLoading, error, refetch } = useQuery<VehicleDiscrepancy[]>({
    queryKey: ['vehicle-discrepancies', orgId],
    queryFn: async () => {
      let q = supabase
        .from('vehicle_discrepancies')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = discrepancies.filter(d => {
    if (filterType !== 'all' && d.discrepancy_type !== filterType) return false
    if (filterSeverity !== 'all' && d.severity !== filterSeverity) return false
    if (filterReview && !d.requires_review) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        d.plate_number?.toLowerCase().includes(s) ||
        d.source_a?.toLowerCase().includes(s) ||
        d.source_b?.toLowerCase().includes(s) ||
        d.discrepancy_type?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total      = discrepancies.length
  const needsReview = discrepancies.filter(d => d.requires_review && !d.reviewed_at).length
  const highSev    = discrepancies.filter(d => d.severity === 'high' || d.severity === 'critical').length
  const scLawActive = discrepancies.filter(d => d.sc_law_active).length

  const discrepancyTypes = Array.from(new Set(discrepancies.map(d => d.discrepancy_type).filter(Boolean)))
  const severities       = Array.from(new Set(discrepancies.map(d => d.severity).filter(Boolean)))

  // ── Mutation ──────────────────────────────────────────────────────────────

  const markReviewed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('vehicle_discrepancies')
        .update({ reviewed_at: new Date().toISOString(), reviewed_by: user?.id, requires_review: false } as any)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vehicle-discrepancies'] }); toast.success('Discrepancy marked reviewed') },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <GitCompareArrows className="h-7 w-7 text-rose-500" />
            <div>
              <h1 className="text-2xl font-bold">Vehicle Discrepancy Log</h1>
              <p className="text-sm text-muted-foreground">Conflicts between data sources for vehicle information</p>
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
            { label: 'Total',           value: total,        icon: GitCompareArrows, colour: 'text-slate-600' },
            { label: 'Requires Review', value: needsReview,  icon: AlertCircle,      colour: needsReview > 0 ? 'text-orange-600' : 'text-muted-foreground' },
            { label: 'High Severity',   value: highSev,      icon: AlertTriangle,    colour: highSev > 0 ? 'text-red-600' : 'text-muted-foreground' },
            { label: 'SC Law Active',   value: scLawActive,  icon: AlertTriangle,    colour: scLawActive > 0 ? 'text-purple-600' : 'text-muted-foreground' },
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
              placeholder="Plate, source, type…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Discrepancy Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {discrepancyTypes.map(t => (
                <SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              {severities.map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={filterReview ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterReview(f => !f)}
          >
            <AlertCircle className="h-4 w-4 mr-1.5" />
            Needs Review{filterReview && ` (${needsReview})`}
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
              <div className="text-center py-12 text-muted-foreground text-sm">No discrepancies match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Detected</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Source A</TableHead>
                    <TableHead>Source B</TableHead>
                    <TableHead>SC Law</TableHead>
                    <TableHead>Reviewed</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(d => (
                    <TableRow
                      key={d.id}
                      className={d.severity === 'critical' ? 'bg-red-50/30 dark:bg-red-950/10' : d.severity === 'high' ? 'bg-orange-50/20 dark:bg-orange-950/10' : ''}
                    >
                      <TableCell className="text-sm whitespace-nowrap">{fmtDate(d.created_at)}</TableCell>
                      <TableCell className="font-mono font-semibold">{d.plate_number ?? '—'}</TableCell>
                      <TableCell className="text-sm capitalize">{d.discrepancy_type?.replace(/_/g, ' ')}</TableCell>
                      <TableCell>
                        <Badge className={`capitalize ${SEVERITY_COLOURS[d.severity] ?? ''}`}>
                          {d.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="text-xs text-muted-foreground">{d.source_a}</div>
                        <div className="font-medium">{d.value_a ?? '—'}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="text-xs text-muted-foreground">{d.source_b}</div>
                        <div className="font-medium">{d.value_b ?? '—'}</div>
                      </TableCell>
                      <TableCell className="text-center">
                        {d.sc_law_active ? (
                          <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 text-xs">Active</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {d.reviewed_at ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                            <CheckCircle2 className="h-3 w-3 mr-1" />Reviewed
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {!d.reviewed_at && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs px-2"
                            disabled={markReviewed.isPending}
                            onClick={() => markReviewed.mutate(d.id)}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Review
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
