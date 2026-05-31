/**
 * NoticeToVacateLog — B-73
 *
 * Admin log for notices_to_vacate — Freedom Camping Act enforcement notices.
 *
 * Features:
 *  - KPI cards: Total / Active (awaiting compliance) / Overdue / Complied
 *  - Filters: status, delivery_method, search (plate / reference / recipient)
 *  - Table: reference, issued_at, plate, zone, vacate_deadline, status, delivery_method
 *  - Status workflow: pending → delivered → complied / escalated
 *  - Expandable row: breach details, nights_stayed, authorized_by, escalation notes
 *
 * Route: /notices-to-vacate — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO, isPast } from 'date-fns'
import {
  FileWarning, Search, RefreshCw, AlertCircle, Loader2,
  ChevronDown, ChevronRight, CheckCircle2, TruckIcon, CalendarClock,
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

type NoticeToVacate = Database['public']['Tables']['notices_to_vacate']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDateShort(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

const STATUS_COLOURS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  issued:     'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  delivered:  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  complied:   'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  escalated:  'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  overdue:    'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200',
  withdrawn:  'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-300',
}

function deadlineColour(vacate_deadline: string | null | undefined, status: string | null) {
  if (!vacate_deadline || status === 'complied' || status === 'withdrawn') return ''
  if (isPast(parseISO(vacate_deadline))) return 'text-red-600 font-semibold'
  return 'text-amber-600'
}

// ─── Status transition matrix ─────────────────────────────────────────────────

const NEXT_ACTIONS: Record<string, { label: string; newStatus: string; variant: 'default' | 'outline' | 'destructive' }[]> = {
  pending:   [{ label: 'Mark Issued',    newStatus: 'issued',    variant: 'outline' }],
  issued:    [{ label: 'Mark Delivered', newStatus: 'delivered', variant: 'outline' }],
  delivered: [
    { label: 'Mark Complied',  newStatus: 'complied',  variant: 'default' },
    { label: 'Escalate',       newStatus: 'escalated', variant: 'destructive' },
  ],
  escalated: [{ label: 'Mark Complied',  newStatus: 'complied',  variant: 'default' }],
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NoticeToVacateLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [search, setSearch]         = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDelivery, setFilterDelivery] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Query ─────────────────────────────────────────────────────────────────

  const { data: notices = [], isLoading, error, refetch } = useQuery<NoticeToVacate[]>({
    queryKey: ['notices-to-vacate', orgId],
    queryFn: async () => {
      let q = supabase
        .from('notices_to_vacate')
        .select('*')
        .order('issued_at', { ascending: false })
        .limit(500)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = notices.filter(n => {
    if (filterStatus !== 'all' && n.status !== filterStatus) return false
    if (filterDelivery !== 'all' && n.delivery_method !== filterDelivery) return false
    if (search) {
      const s = search.toLowerCase()
      return (
        n.plate_number?.toLowerCase().includes(s) ||
        n.reference_number?.toLowerCase().includes(s) ||
        n.recipient_name?.toLowerCase().includes(s) ||
        n.zone_id?.toLowerCase().includes(s)
      )
    }
    return true
  })

  const total    = notices.length
  const active   = notices.filter(n => !['complied', 'withdrawn'].includes(n.status ?? '')).length
  const overdue  = notices.filter(n => n.vacate_deadline && isPast(parseISO(n.vacate_deadline)) && !['complied', 'withdrawn'].includes(n.status ?? '')).length
  const complied = notices.filter(n => n.status === 'complied').length

  const statuses       = Array.from(new Set(notices.map(n => n.status).filter(Boolean)))
  const deliveryMethods = Array.from(new Set(notices.map(n => n.delivery_method).filter(Boolean)))

  // ── Mutation ──────────────────────────────────────────────────────────────

  const updateStatus = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: string }) => {
      const patch: Partial<NoticeToVacate> = { status: newStatus }
      if (newStatus === 'delivered')  patch.delivered_at = new Date().toISOString()
      if (newStatus === 'escalated')  patch.escalated_at = new Date().toISOString()
      if (newStatus === 'complied')   patch.complied_at  = new Date().toISOString()
      const { error } = await supabase.from('notices_to_vacate').update(patch as any).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notices-to-vacate'] }); toast.success('Notice status updated') },
    onError: (e: Error) => toast.error(e.message),
  })

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileWarning className="h-7 w-7 text-orange-500" />
            <div>
              <h1 className="text-2xl font-bold">Notice to Vacate Log</h1>
              <p className="text-sm text-muted-foreground">Freedom Camping Act enforcement notices and compliance tracking</p>
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
            { label: 'Total',          value: total,    icon: FileWarning,  colour: 'text-slate-600' },
            { label: 'Active',         value: active,   icon: CalendarClock, colour: active > 0 ? 'text-blue-600' : 'text-muted-foreground' },
            { label: 'Overdue',        value: overdue,  icon: AlertCircle,  colour: overdue > 0 ? 'text-red-600' : 'text-muted-foreground' },
            { label: 'Complied',       value: complied, icon: CheckCircle2, colour: 'text-green-600' },
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
              placeholder="Plate, reference, recipient…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statuses.map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s?.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {deliveryMethods.length > 0 && (
            <Select value={filterDelivery} onValueChange={setFilterDelivery}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Delivery" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                {deliveryMethods.map(m => (
                  <SelectItem key={m} value={m} className="capitalize">{m?.replace(/_/g, ' ')}</SelectItem>
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
              <div className="text-center py-12 text-muted-foreground text-sm">No notices match your filters.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Reference</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Plate</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(n => {
                    const isExpanded = expandedId === n.id
                    const actions = NEXT_ACTIONS[n.status ?? ''] ?? []
                    return (
                      <>
                        <TableRow
                          key={n.id}
                          className={`cursor-pointer hover:bg-muted/40 ${n.status === 'escalated' ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}
                          onClick={() => setExpandedId(isExpanded ? null : n.id)}
                        >
                          <TableCell>
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{n.reference_number}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(n.issued_at)}</TableCell>
                          <TableCell className="font-mono font-semibold">{n.plate_number}</TableCell>
                          <TableCell className={`text-sm ${deadlineColour(n.vacate_deadline, n.status)}`}>
                            {fmtDateShort(n.vacate_deadline)}
                          </TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${STATUS_COLOURS[n.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                              {n.status?.replace(/_/g, ' ') ?? '—'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {n.delivery_method ? (
                              <span className="flex items-center gap-1 text-sm capitalize text-muted-foreground">
                                <TruckIcon className="h-3.5 w-3.5" />
                                {n.delivery_method?.replace(/_/g, ' ')}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell onClick={e => e.stopPropagation()}>
                            <div className="flex gap-1.5">
                              {actions.map(a => (
                                <Button
                                  key={a.newStatus}
                                  size="sm"
                                  variant={a.variant}
                                  className="h-6 text-xs px-2"
                                  disabled={updateStatus.isPending}
                                  onClick={() => updateStatus.mutate({ id: n.id, newStatus: a.newStatus })}
                                >
                                  {a.label}
                                </Button>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>

                        {isExpanded && (
                          <TableRow key={`${n.id}-detail`} className="bg-muted/20">
                            <TableCell colSpan={8} className="py-3 px-6">
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">Breach Reason</p>
                                  <p>{n.breach_reason}</p>
                                </div>
                                <div>
                                  <p className="font-semibold text-muted-foreground mb-1">Nights Stayed</p>
                                  <p>{n.nights_stayed ?? '—'}</p>
                                </div>
                                {n.recipient_name && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Recipient</p>
                                    <p>{n.recipient_name}</p>
                                  </div>
                                )}
                                {n.delivered_at && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Delivered At</p>
                                    <p>{fmtDate(n.delivered_at)}</p>
                                  </div>
                                )}
                                {n.complied_at && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Complied At</p>
                                    <p className="text-green-600">{fmtDate(n.complied_at)}</p>
                                  </div>
                                )}
                                {n.escalation_notes && (
                                  <div>
                                    <p className="font-semibold text-muted-foreground mb-1">Escalation Notes</p>
                                    <p className="text-red-600">{n.escalation_notes}</p>
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
