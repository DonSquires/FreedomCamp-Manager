/**
 * NoiseNoticeLog — B-68
 *
 * Tabbed admin log for noise enforcement notices and equipment seizures.
 *
 * Notices tab (noise_notices):
 *  - KPIs: Total / Active / Complied / Escalated
 *  - Filters: status, notice_type, search
 *  - Table: notice_number, type, recipient, issued_at, comply_by, status, penalty
 *  - Mark Complied action (status → complied)
 *
 * Seizures tab (noise_seizures):
 *  - KPIs: Total / Active / Returned
 *  - Table: seizure_number, equipment, owner, seized_at, status, storage_location
 *
 * Route: /noise-notices — admin/admin_officer/master
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  Volume2, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, Clock, Package,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Database } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type NoiseNotice  = Database['public']['Tables']['noise_notices']['Row']
type NoiseSeizure = Database['public']['Tables']['noise_seizures']['Row']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

function fmtDateShort(ts: string | null | undefined) {
  if (!ts) return '—'
  try { return format(parseISO(ts), 'dd MMM yyyy') } catch { return ts }
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

const NOTICE_STATUS_COLOURS: Record<string, string> = {
  active:    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  served:    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  complied:  'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  escalated: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  withdrawn: 'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-300',
}

const SEIZURE_STATUS_COLOURS: Record<string, string> = {
  active:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  returned: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  disposed: 'bg-gray-100 text-gray-700 dark:bg-[#1E1E1E] dark:text-gray-300',
  forfeited:'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NoiseNoticeLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()
  const [tab, setTab] = useState('notices')

  const [noticeSearch, setNoticeSearch]   = useState('')
  const [filterStatus, setFilterStatus]   = useState('all')
  const [filterType, setFilterType]       = useState('all')
  const [seizureSearch, setSeizureSearch] = useState('')

  // ── Notices query ─────────────────────────────────────────────────────────

  const { data: notices = [], isLoading: loadingNotices, refetch: refetchNotices } = useQuery<NoiseNotice[]>({
    queryKey: ['noise-notices', orgId],
    queryFn: async () => {
      let q = supabase
        .from('noise_notices')
        .select('*')
        .order('issued_at', { ascending: false })
        .limit(300)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Seizures query ────────────────────────────────────────────────────────

  const { data: seizures = [], isLoading: loadingSeizures, refetch: refetchSeizures } = useQuery<NoiseSeizure[]>({
    queryKey: ['noise-seizures', orgId],
    queryFn: async () => {
      let q = supabase
        .from('noise_seizures')
        .select('*')
        .order('seized_at', { ascending: false })
        .limit(200)
      if (orgId) q = q.eq('organization_id', orgId)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Mark complied mutation ────────────────────────────────────────────────

  const markComplied = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('noise_notices')
        .update({ status: 'complied', complied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['noise-notices'] })
      toast.success('Notice marked as complied')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Derived ───────────────────────────────────────────────────────────────

  const filteredNotices = notices.filter(n => {
    if (filterStatus !== 'all' && n.status !== filterStatus) return false
    if (filterType !== 'all' && n.notice_type !== filterType) return false
    if (noticeSearch) {
      const s = noticeSearch.toLowerCase()
      return (
        n.notice_number.toLowerCase().includes(s) ||
        n.recipient_name.toLowerCase().includes(s) ||
        n.recipient_address.toLowerCase().includes(s)
      )
    }
    return true
  })

  const filteredSeizures = seizures.filter(s => {
    if (seizureSearch) {
      const lo = seizureSearch.toLowerCase()
      return (
        s.seizure_number.toLowerCase().includes(lo) ||
        s.equipment_description.toLowerCase().includes(lo) ||
        s.owner_name?.toLowerCase().includes(lo)
      )
    }
    return true
  })

  const noticeTypes       = Array.from(new Set(notices.map(n => n.notice_type).filter(Boolean)))
  const activeNotices     = notices.filter(n => n.status === 'active').length
  const compliedNotices   = notices.filter(n => n.status === 'complied').length
  const escalatedNotices  = notices.filter(n => n.status === 'escalated').length
  const activeSeizures    = seizures.filter(s => s.status === 'active').length
  const returnedSeizures  = seizures.filter(s => s.status === 'returned').length

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Volume2 className="h-7 w-7 text-yellow-500" />
            <div>
              <h1 className="text-2xl font-bold">Noise Notice Log</h1>
              <p className="text-sm text-muted-foreground">Noise enforcement notices and equipment seizures</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => tab === 'notices' ? refetchNotices() : refetchSeizures()}
            disabled={loadingNotices || loadingSeizures}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${(loadingNotices || loadingSeizures) ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="notices">
              Notices
              {activeNotices > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {activeNotices}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="seizures">
              Seizures
              {activeSeizures > 0 && (
                <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {activeSeizures}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Notices Tab ─────────────────────────────────────────────── */}
          <TabsContent value="notices" className="space-y-4 mt-4">
            {/* KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total',     value: notices.length,  icon: Volume2,      colour: 'text-slate-600' },
                { label: 'Active',    value: activeNotices,   icon: AlertCircle,  colour: 'text-red-600' },
                { label: 'Complied',  value: compliedNotices, icon: CheckCircle2, colour: 'text-green-600' },
                { label: 'Escalated', value: escalatedNotices,icon: Clock,        colour: 'text-orange-600' },
              ].map(({ label, value, icon: Icon, colour }) => (
                <Card key={label}>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${colour}`} />
                    <span className="text-2xl font-bold">{value}</span>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="relative flex-1 min-w-[180px]">
                <Input
                  placeholder="Notice #, recipient, address…"
                  value={noticeSearch}
                  onChange={e => setNoticeSearch(e.target.value)}
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="served">Served</SelectItem>
                  <SelectItem value="complied">Complied</SelectItem>
                  <SelectItem value="escalated">Escalated</SelectItem>
                  <SelectItem value="withdrawn">Withdrawn</SelectItem>
                </SelectContent>
              </Select>
              {noticeTypes.length > 0 && (
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-[170px]">
                    <SelectValue placeholder="Notice Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {noticeTypes.map(t => (
                      <SelectItem key={t} value={t} className="capitalize">{t?.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {loadingNotices ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : filteredNotices.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">No notices match your filters.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Notice #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Issued</TableHead>
                        <TableHead>Comply By</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Penalty</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredNotices.map(n => (
                        <TableRow key={n.id}>
                          <TableCell className="font-mono text-sm font-semibold">{n.notice_number}</TableCell>
                          <TableCell className="text-sm capitalize">{n.notice_type?.replace(/_/g, ' ')}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{n.recipient_name}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[160px]">{n.recipient_address}</div>
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDateShort(n.issued_at)}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDateShort(n.comply_by)}</TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${NOTICE_STATUS_COLOURS[n.status] ?? ''}`}>
                              {n.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">{fmtCurrency(n.penalty_amount_nzd)}</TableCell>
                          <TableCell>
                            {(n.status === 'active' || n.status === 'served') && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={markComplied.isPending}
                                onClick={() => markComplied.mutate(n.id)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                Complied
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
          </TabsContent>

          {/* ── Seizures Tab ─────────────────────────────────────────────── */}
          <TabsContent value="seizures" className="space-y-4 mt-4">
            {/* KPIs */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Total Seizures', value: seizures.length,  icon: Package,     colour: 'text-slate-600' },
                { label: 'Active',         value: activeSeizures,   icon: AlertCircle, colour: 'text-red-600' },
                { label: 'Returned',       value: returnedSeizures, icon: CheckCircle2,colour: 'text-green-600' },
              ].map(({ label, value, icon: Icon, colour }) => (
                <Card key={label}>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${colour}`} />
                    <span className="text-2xl font-bold">{value}</span>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Search */}
            <Input
              placeholder="Seizure #, equipment description, owner…"
              value={seizureSearch}
              onChange={e => setSeizureSearch(e.target.value)}
              className="max-w-md"
            />

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {loadingSeizures ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : filteredSeizures.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">No seizures recorded.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Seizure #</TableHead>
                        <TableHead>Equipment</TableHead>
                        <TableHead>Count</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Seized At</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Storage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSeizures.map(s => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-sm font-semibold">{s.seizure_number}</TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">{s.equipment_description}</div>
                            {s.equipment_type && (
                              <div className="text-xs text-muted-foreground capitalize">{s.equipment_type}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{s.equipment_count}</TableCell>
                          <TableCell className="text-sm">{s.owner_name ?? '—'}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{fmtDate(s.seized_at)}</TableCell>
                          <TableCell>
                            <Badge className={`capitalize ${SEIZURE_STATUS_COLOURS[s.status] ?? ''}`}>
                              {s.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{s.storage_location ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  )
}
