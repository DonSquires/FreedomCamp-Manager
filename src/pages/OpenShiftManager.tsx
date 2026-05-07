/**
 * OpenShiftManager — B-81
 * Manager for open_shifts — unclaimed shift publishing and claiming.
 * Route: /open-shifts-manager — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  CalendarClock, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2,
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

type OpenShiftRow = Database['public']['Tables']['open_shifts']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

const PRIORITY_COLOURS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  high:     'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  medium:   'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low:      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function OpenShiftManager() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]               = useState('')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterShiftType, setFilterShiftType] = useState('all')
  const [filterClaimed, setFilterClaimed] = useState('all')
  const [filterMonth, setFilterMonth]     = useState('all')
  const [expandedId, setExpandedId]       = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: shifts = [], isLoading, error, refetch } = useQuery<OpenShiftRow[]>({
    queryKey: ['open-shifts', orgId],
    queryFn: async () => {
      let q = supabase
        .from('open_shifts')
        .select('*')
        .order('shift_date', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = shifts.filter(e => {
    if (filterPriority  !== 'all' && e.priority !== filterPriority) return false
    if (filterShiftType !== 'all' && e.shift_type !== filterShiftType) return false
    if (filterClaimed   === 'unclaimed' && e.claimed_by) return false
    if (filterClaimed   === 'claimed'   && !e.claimed_by) return false
    if (filterMonth     !== 'all' && e.shift_date?.substring(0, 7) !== filterMonth) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        e.shift_type?.toLowerCase().includes(s) ||
        e.description?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total        = shifts.length
  const unclaimed    = shifts.filter(e => !e.claimed_by).length
  const claimed      = shifts.filter(e => !!e.claimed_by).length
  const highPriority = shifts.filter(e => e.priority === 'high' || e.priority === 'critical').length

  const shiftTypes = Array.from(new Set(shifts.map(e => e.shift_type).filter(Boolean)))
  const months     = Array.from(new Set(shifts.map(e => e.shift_date?.substring(0, 7)).filter(Boolean))).sort().reverse()

  // ── Mutation ──────────────────────────────────────────────────────────────

  const markClaimed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('open_shifts')
        .update({
          claimed_at: new Date().toISOString(),
          claimed_by: user?.id,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['open-shifts'] }); toast.success('Shift marked as claimed') },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CalendarClock className="h-7 w-7 text-cyan-600" />
            <div>
              <h1 className="text-2xl font-bold">Open Shift Manager</h1>
              <p className="text-sm text-muted-foreground">Unclaimed shift publishing and claiming</p>
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
            { label: 'Total',         value: total,        colour: 'text-slate-600' },
            { label: 'Unclaimed',     value: unclaimed,    colour: unclaimed > 0 ? 'text-orange-600' : 'text-muted-foreground' },
            { label: 'Claimed',       value: claimed,      colour: 'text-green-600' },
            { label: 'High Priority', value: highPriority, colour: highPriority > 0 ? 'text-red-600' : 'text-muted-foreground' },
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
              placeholder="Shift type, description…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              {['critical', 'high', 'medium', 'low'].map(p => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {shiftTypes.length > 0 && (
            <Select value={filterShiftType} onValueChange={setFilterShiftType}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Shift Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {shiftTypes.map(t => (
                  <SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={filterClaimed} onValueChange={setFilterClaimed}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Claim Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unclaimed">Unclaimed</SelectItem>
              <SelectItem value="claimed">Claimed</SelectItem>
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
              <div className="text-center py-12 text-muted-foreground text-sm">No open shifts match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Shift Date</TableHead>
                    <TableHead>Shift Type</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Requirements</TableHead>
                    <TableHead>Claimed By</TableHead>
                    <TableHead>Claimed At</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(e => {
                    const isExpanded = expandedId === e.id
                    const reqPreview = e.requirements ? JSON.stringify(e.requirements).substring(0, 40) : '—'
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
                          <TableCell className="text-sm whitespace-nowrap">{e.shift_date ?? '—'}</TableCell>
                          <TableCell className="text-sm capitalize">{e.shift_type?.replace(/_/g, ' ') ?? '—'}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {e.start_time ?? '—'} – {e.end_time ?? '—'}
                          </TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${PRIORITY_COLOURS[e.priority ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                              {e.priority ?? '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">{reqPreview}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{e.claimed_by?.substring(0, 8) ?? '—'}</TableCell>
                          <TableCell className="text-sm">{fmtDate(e.claimed_at)}</TableCell>
                          <TableCell onClick={ev => ev.stopPropagation()}>
                            {!e.claimed_by && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs px-2"
                                disabled={markClaimed.isPending}
                                onClick={() => markClaimed.mutate(e.id)}
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Claim
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${e.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={9} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                {e.description && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Description</p>
                                    <p>{e.description}</p>
                                  </div>
                                )}
                                {e.requirements && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Requirements</p>
                                    <pre className="text-xs bg-muted rounded p-2 overflow-x-auto max-h-32">
                                      {JSON.stringify(e.requirements, null, 2)}
                                    </pre>
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
