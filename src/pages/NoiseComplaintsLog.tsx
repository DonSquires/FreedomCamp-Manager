/**
 * NoiseComplaintsLog — B-58
 *
 * Admin staff view of all public_noise_complaints submitted via
 * the /public/noise-complaint portal.
 *
 * Features:
 *  - KPI cards: Received / Acknowledged / Assigned / Resolved / No Action
 *  - Status workflow: received → acknowledged → assigned → on_scene → resolved / no_action_taken
 *  - Status update + notes dialog
 *  - Filters: status, noise type, date range, free-text (address / reference)
 *  - Expandable row: complainant contact, description, linked assessments
 *
 * Route: /noise-complaints  — admin / admin_officer / master
 * public_noise_complaints is fully typed in database.ts
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Volume2, CheckCircle, Clock, AlertCircle, XCircle,
  Loader2, RefreshCw, ChevronDown, ChevronUp,
  Phone, Mail, User, MapPin, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Link } from 'react-router-dom'

// ─── Types ───────────────────────────────────────────────────────────────────

type NoiseComplaint = Database['public']['Tables']['public_noise_complaints']['Row']
type NoiseStatus = NoiseComplaint['status']

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<NoiseStatus, { label: string; colour: string }> = {
  received:        { label: 'Received',        colour: 'text-blue-700 bg-blue-50 dark:bg-blue-900/30'   },
  acknowledged:    { label: 'Acknowledged',    colour: 'text-yellow-700 bg-yellow-50 dark:bg-yellow-900/30' },
  assigned:        { label: 'Assigned',        colour: 'text-orange-700 bg-orange-50 dark:bg-orange-900/30' },
  on_scene:        { label: 'On Scene',        colour: 'text-purple-700 bg-purple-50 dark:bg-purple-900/30' },
  resolved:        { label: 'Resolved',        colour: 'text-green-700 bg-green-50 dark:bg-green-900/30'  },
  no_action_taken: { label: 'No Action Taken', colour: 'text-gray-600 bg-gray-100 dark:bg-gray-800'       },
}

const NOISE_TYPE_LABELS: Record<string, string> = {
  music:        'Music',
  party:        'Party',
  machinery:    'Machinery',
  animals:      'Animals',
  construction: 'Construction',
  vehicle:      'Vehicle',
  other:        'Other',
}

const NEXT_STATUSES: Partial<Record<NoiseStatus, NoiseStatus[]>> = {
  received:     ['acknowledged', 'assigned'],
  acknowledged: ['assigned', 'no_action_taken'],
  assigned:     ['on_scene', 'no_action_taken'],
  on_scene:     ['resolved', 'no_action_taken'],
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NoiseComplaintsLog() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [updateTarget, setUpdateTarget] = useState<{ id: string; newStatus: NoiseStatus } | null>(null)
  const [statusMessage, setStatusMessage] = useState('')

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: complaints = [], isLoading, error, refetch } = useQuery<NoiseComplaint[]>({
    queryKey: ['noise_complaints', orgId, statusFilter, typeFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = supabase
        .from('public_noise_complaints')
        .select('*')
        .eq('organization_id', orgId as string)
        .order('created_at', { ascending: false })

      if (statusFilter !== 'all') q = q.eq('status', statusFilter as NoiseStatus)
      if (typeFilter  !== 'all') q = q.eq('noise_type', typeFilter as NoiseComplaint['noise_type'])
      if (dateFrom)              q = q.gte('created_at', dateFrom)
      if (dateTo)                q = q.lte('created_at', dateTo + 'T23:59:59')

      const { data, error } = await q
      if (error) throw error
      return data as NoiseComplaint[]
    },
  })

  // ── Mutation ───────────────────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: async ({ id, newStatus, message }: { id: string; newStatus: NoiseStatus; message: string }) => {
      const { error } = await supabase
        .from('public_noise_complaints')
        .update({ status: newStatus, status_message: message || null, updated_at: new Date().toISOString() } as Database['public']['Tables']['public_noise_complaints']['Update'])
        .eq('id', id)
        .eq('organization_id', orgId as string)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Complaint status updated.')
      qc.invalidateQueries({ queryKey: ['noise_complaints'] })
      setUpdateTarget(null)
      setStatusMessage('')
    },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  })

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = complaints.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.reference.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)
  })

  const kpi = {
    received:        complaints.filter(c => c.status === 'received').length,
    acknowledged:    complaints.filter(c => c.status === 'acknowledged').length,
    assigned:        complaints.filter(c => c.status === 'assigned').length,
    resolved:        complaints.filter(c => c.status === 'resolved').length,
    no_action_taken: complaints.filter(c => c.status === 'no_action_taken').length,
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Volume2 className="h-6 w-6 text-violet-600" />
            <div>
              <h1 className="text-2xl font-bold">Noise Complaints Log</h1>
              <p className="text-sm text-muted-foreground">Public noise complaints submitted via the online portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/public/noise-complaint" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" /> Public Portal
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {([
            { key: 'received',        label: 'Received',        Icon: Clock,         colour: 'text-blue-600'  },
            { key: 'acknowledged',    label: 'Acknowledged',    Icon: CheckCircle,   colour: 'text-yellow-600'},
            { key: 'assigned',        label: 'Assigned',        Icon: AlertCircle,   colour: 'text-orange-600'},
            { key: 'resolved',        label: 'Resolved',        Icon: CheckCircle,   colour: 'text-green-600' },
            { key: 'no_action_taken', label: 'No Action',       Icon: XCircle,       colour: 'text-gray-500'  },
          ] as const).map(({ key, label, Icon, colour }) => (
            <Card key={key}>
              <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Icon className={`h-3.5 w-3.5 ${colour}`} />{label}</CardTitle></CardHeader>
              <CardContent><p className={`text-3xl font-bold ${colour}`}>{kpi[key]}</p></CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-xs">Search</Label>
                <Input placeholder="Reference or address…" value={search} onChange={e => setSearch(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Noise Type</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {Object.entries(NOISE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date Range</Label>
                <div className="flex gap-1">
                  <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-xs" />
                  <Input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="text-xs" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive py-8 justify-center"><AlertCircle className="h-5 w-5" /> Failed to load complaints.</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Volume2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No complaints match your filters.</p>
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Reference</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Advance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(c => {
                  const expanded = expandedId === c.id
                  const cfg = STATUS_CONFIG[c.status]
                  const nextStatuses = NEXT_STATUSES[c.status] ?? []
                  return (
                    <>
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setExpandedId(expanded ? null : c.id)}>
                        <TableCell className="py-2">{expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}</TableCell>
                        <TableCell className="font-mono text-xs font-medium">{c.reference}</TableCell>
                        <TableCell className="text-sm max-w-[160px] truncate" title={c.address}>{c.address}</TableCell>
                        <TableCell className="text-xs">{c.noise_type ? NOISE_TYPE_LABELS[c.noise_type] ?? c.noise_type : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{c.created_at ? format(parseISO(c.created_at), 'dd MMM yyyy') : '—'}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.colour}`}>{cfg.label}</span>
                        </TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          {nextStatuses.length > 0 && (
                            <div className="flex items-center justify-end gap-1">
                              {nextStatuses.map(s => (
                                <Button
                                  key={s}
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => { setUpdateTarget({ id: c.id, newStatus: s }); setStatusMessage('') }}
                                >
                                  {STATUS_CONFIG[s].label}
                                </Button>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>

                      {expanded && (
                        <TableRow key={`${c.id}-detail`} className="bg-muted/30">
                          <TableCell colSpan={7} className="py-4 px-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-muted-foreground">Description</p>
                                <p className="text-sm bg-background rounded border p-2 whitespace-pre-line">{c.complaint_description}</p>
                                {c.status_message && (
                                  <>
                                    <p className="text-xs font-semibold text-muted-foreground">Status Note</p>
                                    <p className="text-sm bg-background rounded border p-2">{c.status_message}</p>
                                  </>
                                )}
                              </div>
                              <div className="space-y-2">
                                <p className="text-xs font-semibold text-muted-foreground">Complainant</p>
                                <div className="space-y-0.5">
                                  {c.complainant_name  && <p className="text-sm flex items-center gap-1.5"><User  className="h-3.5 w-3.5 text-muted-foreground" />{c.complainant_name}</p>}
                                  {c.complainant_email && <p className="text-sm flex items-center gap-1.5"><Mail  className="h-3.5 w-3.5 text-muted-foreground" />{c.complainant_email}</p>}
                                  {c.complainant_phone && <p className="text-sm flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{c.complainant_phone}</p>}
                                  {!c.complainant_name && !c.complainant_email && !c.complainant_phone && <p className="text-sm text-muted-foreground italic">Anonymous</p>}
                                </div>
                                <p className="text-xs font-semibold text-muted-foreground mt-2">Location</p>
                                <p className="text-sm flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{c.address}{c.suburb ? `, ${c.suburb}` : ''}</p>
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
          </Card>
        )}

        {/* Status update dialog */}
        <Dialog open={!!updateTarget} onOpenChange={open => { if (!open) { setUpdateTarget(null); setStatusMessage('') } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Update Status → {updateTarget ? STATUS_CONFIG[updateTarget.newStatus].label : ''}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-sm">Status Note <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea rows={3} placeholder="Add a note for this status change…" value={statusMessage} onChange={e => setStatusMessage(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setUpdateTarget(null); setStatusMessage('') }}>Cancel</Button>
              <Button onClick={() => updateTarget && updateStatus.mutate({ id: updateTarget.id, newStatus: updateTarget.newStatus, message: statusMessage })} disabled={updateStatus.isPending}>
                {updateStatus.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  )
}
