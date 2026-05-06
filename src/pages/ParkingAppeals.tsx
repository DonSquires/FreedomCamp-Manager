/**
 * ParkingAppeals — B-53
 *
 * Admin view for reviewing and deciding parking infringement appeals.
 *
 * Features:
 *  - KPI cards: Received / Under Review / Upheld / Dismissed
 *  - Status workflow: received → under_review → upheld | dismissed | withdrawn
 *  - Reviewer notes dialog for upheld/dismissed decisions
 *  - Filters: status, date range, free-text search (infringement # / plate / name)
 *  - Expandable row: grounds, evidence statement, appellant contact details
 *
 * Route: /parking-appeals  — admin / admin_officer / master
 * Note: parking_appeals not in database.ts snapshot — uses (supabase as any)
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Gavel, Clock, CheckCircle, XCircle, RotateCcw,
  Loader2, RefreshCw, ChevronDown, ChevronUp,
  FileSearch, AlertCircle, Phone, Mail, User, ClipboardList,
} from 'lucide-react'
import { toast } from 'sonner'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// ─── Types ───────────────────────────────────────────────────────────────────

type AppealStatus = 'received' | 'under_review' | 'upheld' | 'dismissed' | 'withdrawn'

interface ParkingAppeal {
  id: string
  organization_id: string
  parking_infringement_id: string | null
  infringement_number: string
  plate_number: string
  appellant_name: string | null
  appellant_email: string | null
  appellant_phone: string | null
  grounds: string
  evidence_statement: string | null
  status: AppealStatus
  reviewer_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  submitted_at: string
  updated_at: string
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AppealStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; colour: string }> = {
  received:     { label: 'Received',     variant: 'secondary',    colour: 'text-blue-700 bg-blue-50 dark:bg-blue-900/30' },
  under_review: { label: 'Under Review', variant: 'default',      colour: 'text-yellow-700 bg-yellow-50 dark:bg-yellow-900/30' },
  upheld:       { label: 'Upheld',       variant: 'outline',      colour: 'text-green-700 bg-green-50 dark:bg-green-900/30' },
  dismissed:    { label: 'Dismissed',    variant: 'destructive',  colour: 'text-red-700 bg-red-50 dark:bg-red-900/30' },
  withdrawn:    { label: 'Withdrawn',    variant: 'secondary',    colour: 'text-gray-600 bg-gray-100 dark:bg-gray-800' },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParkingAppeals() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const qc = useQueryClient()

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Expand/collapse
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Decision dialog
  const [decisionTarget, setDecisionTarget] = useState<{ id: string; action: 'upheld' | 'dismissed' | 'under_review' | 'withdrawn' } | null>(null)
  const [reviewerNotes, setReviewerNotes] = useState('')

  // ── Query ──────────────────────────────────────────────────────────────────
  const { data: appeals = [], isLoading, error, refetch } = useQuery<ParkingAppeal[]>({
    queryKey: ['parking_appeals', orgId, statusFilter, dateFrom, dateTo],
    enabled: !!orgId,
    queryFn: async () => {
      let q = (supabase as any)
        .from('parking_appeals')
        .select('*')
        .eq('organization_id', orgId)
        .order('submitted_at', { ascending: false })

      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (dateFrom)               q = q.gte('submitted_at', dateFrom)
      if (dateTo)                 q = q.lte('submitted_at', dateTo + 'T23:59:59')

      const { data, error } = await q
      if (error) throw error
      return data as ParkingAppeal[]
    },
  })

  // ── Mutation: update status ────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: AppealStatus; notes: string }) => {
      const payload: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
      if (['upheld', 'dismissed'].includes(status)) {
        payload.reviewer_notes = notes || null
        payload.reviewed_by    = user?.id ?? null
        payload.reviewed_at    = new Date().toISOString()
      }
      const { error } = await (supabase as any)
        .from('parking_appeals')
        .update(payload)
        .eq('id', id)
        .eq('organization_id', orgId)
      if (error) throw error
    },
    onSuccess: (_, { status }) => {
      toast.success(`Appeal ${STATUS_CONFIG[status as AppealStatus].label.toLowerCase()}.`)
      qc.invalidateQueries({ queryKey: ['parking_appeals'] })
      setDecisionTarget(null)
      setReviewerNotes('')
    },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  })

  const openDecision = (id: string, action: typeof decisionTarget['action']) => {
    setDecisionTarget({ id, action })
    setReviewerNotes('')
  }

  const confirmDecision = () => {
    if (!decisionTarget) return
    updateStatus.mutate({ id: decisionTarget.id, status: decisionTarget.action as AppealStatus, notes: reviewerNotes })
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = appeals.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.infringement_number.toLowerCase().includes(q) ||
      a.plate_number.toLowerCase().includes(q) ||
      (a.appellant_name?.toLowerCase().includes(q) ?? false)
    )
  })

  const kpi = {
    received:     appeals.filter(a => a.status === 'received').length,
    under_review: appeals.filter(a => a.status === 'under_review').length,
    upheld:       appeals.filter(a => a.status === 'upheld').length,
    dismissed:    appeals.filter(a => a.status === 'dismissed').length,
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gavel className="h-6 w-6 text-orange-600" />
            <div>
              <h1 className="text-2xl font-bold">Parking Appeals</h1>
              <p className="text-sm text-muted-foreground">Review and decide infringement notice appeals</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Received</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-blue-600">{kpi.received}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><FileSearch className="h-3.5 w-3.5" /> Under Review</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-yellow-600">{kpi.under_review}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Upheld</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-green-600">{kpi.upheld}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1"><XCircle className="h-3.5 w-3.5" /> Dismissed</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold text-red-600">{kpi.dismissed}</p></CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Search</Label>
                <div className="relative">
                  <Input
                    placeholder="Infringement #, plate, appellant…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-3 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                    <SelectItem value="under_review">Under Review</SelectItem>
                    <SelectItem value="upheld">Upheld</SelectItem>
                    <SelectItem value="dismissed">Dismissed</SelectItem>
                    <SelectItem value="withdrawn">Withdrawn</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Submitted From</Label>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Submitted To</Label>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="text-sm" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : error ? (
          <div className="flex items-center gap-2 text-destructive py-8 justify-center">
            <AlertCircle className="h-5 w-5" /> Failed to load appeals.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No appeals match your filters.</p>
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Infringement #</TableHead>
                  <TableHead>Plate</TableHead>
                  <TableHead>Appellant</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(appeal => {
                  const expanded = expandedId === appeal.id
                  const cfg = STATUS_CONFIG[appeal.status]
                  return (
                    <>
                      <TableRow
                        key={appeal.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedId(expanded ? null : appeal.id)}
                      >
                        <TableCell className="py-2">
                          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium">{appeal.infringement_number}</TableCell>
                        <TableCell className="font-mono text-xs">{appeal.plate_number}</TableCell>
                        <TableCell className="text-sm">{appeal.appellant_name ?? <span className="text-muted-foreground italic">Anonymous</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(parseISO(appeal.submitted_at), 'dd MMM yyyy')}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.colour}`}>{cfg.label}</span>
                        </TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {appeal.status === 'received' && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDecision(appeal.id, 'under_review')}>
                                <RotateCcw className="h-3 w-3 mr-1" /> Review
                              </Button>
                            )}
                            {['received', 'under_review'].includes(appeal.status) && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50" onClick={() => openDecision(appeal.id, 'upheld')}>
                                  <CheckCircle className="h-3 w-3 mr-1" /> Uphold
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50" onClick={() => openDecision(appeal.id, 'dismissed')}>
                                  <XCircle className="h-3 w-3 mr-1" /> Dismiss
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded detail row */}
                      {expanded && (
                        <TableRow key={`${appeal.id}-detail`} className="bg-muted/30">
                          <TableCell colSpan={7} className="py-4 px-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-3">
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">Appellant Contact</p>
                                  <div className="space-y-1">
                                    {appeal.appellant_name  && <p className="text-sm flex items-center gap-1.5"><User  className="h-3.5 w-3.5 text-muted-foreground" />{appeal.appellant_name}</p>}
                                    {appeal.appellant_email && <p className="text-sm flex items-center gap-1.5"><Mail  className="h-3.5 w-3.5 text-muted-foreground" />{appeal.appellant_email}</p>}
                                    {appeal.appellant_phone && <p className="text-sm flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{appeal.appellant_phone}</p>}
                                    {!appeal.appellant_name && !appeal.appellant_email && !appeal.appellant_phone && (
                                      <p className="text-sm text-muted-foreground italic">No contact details provided</p>
                                    )}
                                  </div>
                                </div>
                                {appeal.reviewer_notes && (
                                  <div>
                                    <p className="text-xs font-semibold text-muted-foreground mb-1">Reviewer Notes</p>
                                    <p className="text-sm bg-background rounded border p-2">{appeal.reviewer_notes}</p>
                                    {appeal.reviewed_at && (
                                      <p className="text-xs text-muted-foreground mt-1">Reviewed {format(parseISO(appeal.reviewed_at), 'dd MMM yyyy HH:mm')}</p>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="space-y-3">
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">Grounds for Appeal</p>
                                  <p className="text-sm bg-background rounded border p-2 whitespace-pre-line">{appeal.grounds}</p>
                                </div>
                                {appeal.evidence_statement && (
                                  <div>
                                    <p className="text-xs font-semibold text-muted-foreground mb-1">Evidence / Circumstances</p>
                                    <p className="text-sm bg-background rounded border p-2 whitespace-pre-line">{appeal.evidence_statement}</p>
                                  </div>
                                )}
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

        {/* Decision dialog */}
        <Dialog open={!!decisionTarget} onOpenChange={open => { if (!open) { setDecisionTarget(null); setReviewerNotes('') } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {decisionTarget?.action === 'upheld'       && 'Uphold Appeal'}
                {decisionTarget?.action === 'dismissed'    && 'Dismiss Appeal'}
                {decisionTarget?.action === 'under_review' && 'Mark as Under Review'}
                {decisionTarget?.action === 'withdrawn'    && 'Mark as Withdrawn'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              {['upheld', 'dismissed'].includes(decisionTarget?.action ?? '') && (
                <div className="space-y-1">
                  <Label className="text-sm">Reviewer Notes <span className="text-muted-foreground">(optional)</span></Label>
                  <Textarea
                    rows={4}
                    placeholder="Enter your decision reasoning or notes for the record…"
                    value={reviewerNotes}
                    onChange={e => setReviewerNotes(e.target.value)}
                  />
                </div>
              )}
              {decisionTarget?.action === 'under_review' && (
                <p className="text-sm text-muted-foreground">This will mark the appeal as currently under review.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDecisionTarget(null); setReviewerNotes('') }}>Cancel</Button>
              <Button
                onClick={confirmDecision}
                disabled={updateStatus.isPending}
                variant={decisionTarget?.action === 'dismissed' ? 'destructive' : 'default'}
              >
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
