/**
 * CaseBridge — B-37
 *
 * Operational Case Management — link incidents, enforcement events,
 * patrol events, and observations into unified case records.
 *
 * Features:
 *   - KPI cards: Total, Open, Pending, Closed cases
 *   - Filterable / searchable case list (status, type, keyword)
 *   - Create case dialog (type, created_from, title, summary, notes)
 *   - Case detail sheet: metadata + enforcement events linked + comment timeline
 *   - Add comment to case
 *   - Update case status (open → pending → closed → archived)
 */

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import {
  FolderKanban, Plus, Search, MessageSquare, ChevronRight,
  Clock, CheckCircle2, AlertCircle, XCircle, Loader2,
  RefreshCw, Send,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'

// ─── Types ────────────────────────────────────────────────────────────────────

type OperationalCase = {
  id: string
  case_number: string | null
  case_type: string
  created_from: string
  status: string
  title: string | null
  summary: string | null
  officer_notes: string | null
  organization_id: string
  dispatch_job_id: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  user_profiles: { full_name: string | null; email: string | null } | null
}

type CaseComment = {
  id: string
  case_id: string
  comment_text: string
  author_id: string
  organization_id: string
  created_at: string
  updated_at: string
  edited_by: string | null
  user_profiles: { full_name: string | null; email: string | null } | null
}

type EnforcementEvent = {
  id: string
  case_id: string
  event_type: string
  event_timestamp: string
  status: string
  subject_identifier: string | null
  subject_type: string | null
  violation_type: string | null
  outcome: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CASE_TYPES = [
  'dispatch', 'patrol', 'enforcement', 'investigation', 'audit',
  'site_guard', 'access_control', 'identity_check',
  'poi_alert', 'voi_alert', 'evidence_capture', 'client_request',
]

const CREATED_FROM_OPTIONS = [
  'dispatch', 'patrol', 'breach', 'observation', 'manual',
  'site_guard', 'access_control', 'identity_check',
  'poi_match', 'voi_match', 'evidence', 'client_request',
]

const STATUS_OPTIONS = ['open', 'pending', 'closed', 'archived']

function statusColor(status: string) {
  switch (status) {
    case 'open':     return 'bg-blue-100 text-blue-800'
    case 'pending':  return 'bg-yellow-100 text-yellow-800'
    case 'closed':   return 'bg-green-100 text-green-800'
    case 'archived': return 'bg-gray-100 text-gray-600'
    default:         return 'bg-gray-100 text-gray-600'
  }
}

function statusIcon(status: string) {
  switch (status) {
    case 'open':     return <AlertCircle className="h-4 w-4 text-blue-600" />
    case 'pending':  return <Clock className="h-4 w-4 text-yellow-600" />
    case 'closed':   return <CheckCircle2 className="h-4 w-4 text-green-600" />
    case 'archived': return <XCircle className="h-4 w-4 text-gray-400" />
    default:         return null
  }
}

function formatTs(ts: string) {
  try { return format(parseISO(ts), 'dd MMM yyyy HH:mm') } catch { return ts }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CaseBridge() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? ''
  const qc = useQueryClient()

  // List filters
  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterType, setFilterType]   = useState<string>('all')

  // Create dialog
  const [showCreate, setShowCreate]   = useState(false)
  const [newType, setNewType]         = useState('enforcement')
  const [newFrom, setNewFrom]         = useState('manual')
  const [newTitle, setNewTitle]       = useState('')
  const [newSummary, setNewSummary]   = useState('')
  const [newNotes, setNewNotes]       = useState('')

  // Detail sheet
  const [selectedCase, setSelectedCase] = useState<OperationalCase | null>(null)
  const [commentText, setCommentText] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: cases = [], isLoading, refetch } = useQuery({
    queryKey: ['operational_cases', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('operational_cases')
        .select('*, user_profiles!operational_cases_created_by_fkey(full_name, email)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as unknown as OperationalCase[]
    },
  })

  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ['case_comments', selectedCase?.id],
    enabled: !!selectedCase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_comments')
        .select('*, user_profiles!case_comments_author_id_fkey(full_name, email)')
        .eq('case_id', selectedCase!.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as CaseComment[]
    },
  })

  const { data: enforcementEvents = [] } = useQuery({
    queryKey: ['enforcement_events_for_case', selectedCase?.id],
    enabled: !!selectedCase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enforcement_events')
        .select('id, case_id, event_type, event_timestamp, status, subject_identifier, subject_type, violation_type, outcome')
        .eq('case_id', selectedCase!.id)
        .order('event_timestamp', { ascending: false })
      if (error) throw error
      return (data ?? []) as EnforcementEvent[]
    },
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createCase = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('operational_cases')
        .insert({
          organization_id: orgId,
          case_type: newType,
          created_from: newFrom,
          title: newTitle.trim() || null,
          summary: newSummary.trim() || null,
          officer_notes: newNotes.trim() || null,
          created_by: user?.id ?? null,
          status: 'open',
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operational_cases', orgId] })
      toast.success('Case created')
      setShowCreate(false)
      setNewTitle('')
      setNewSummary('')
      setNewNotes('')
      setNewType('enforcement')
      setNewFrom('manual')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addComment = useMutation({
    mutationFn: async () => {
      if (!selectedCase || !commentText.trim()) return
      const { error } = await supabase
        .from('case_comments')
        .insert({
          case_id: selectedCase.id,
          organization_id: orgId,
          author_id: user!.id,
          comment_text: commentText.trim(),
        })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case_comments', selectedCase?.id] })
      setCommentText('')
      toast.success('Comment added')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateStatus = async (newStatus: string) => {
    if (!selectedCase) return
    setUpdatingStatus(true)
    const { error } = await supabase
      .from('operational_cases')
      .update({
        status: newStatus,
        closed_at: newStatus === 'closed' ? new Date().toISOString() : null,
      })
      .eq('id', selectedCase.id)
    setUpdatingStatus(false)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['operational_cases', orgId] })
    setSelectedCase(prev => prev ? { ...prev, status: newStatus } : prev)
    toast.success('Status updated')
  }

  // ── Filtered list ──────────────────────────────────────────────────────────

  const filtered = cases.filter(c => {
    if (filterStatus !== 'all' && c.status !== filterStatus) return false
    if (filterType !== 'all' && c.case_type !== filterType) return false
    if (search) {
      const q = search.toLowerCase()
      if (
        !c.case_number?.toLowerCase().includes(q) &&
        !c.title?.toLowerCase().includes(q) &&
        !c.summary?.toLowerCase().includes(q) &&
        !c.case_type.toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  // ── KPIs ───────────────────────────────────────────────────────────────────

  const kpis = {
    total:   cases.length,
    open:    cases.filter(c => c.status === 'open').length,
    pending: cases.filter(c => c.status === 'pending').length,
    closed:  cases.filter(c => c.status === 'closed').length,
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Case Bridge" description="Operational case management and incident linkage">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-primary" />
          <span className="font-semibold text-lg">Case Bridge</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Case
          </Button>
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Cases', value: kpis.total, color: 'text-foreground' },
          { label: 'Open',        value: kpis.open,    color: 'text-blue-600' },
          { label: 'Pending',     value: kpis.pending, color: 'text-yellow-600' },
          { label: 'Closed',      value: kpis.closed,  color: 'text-green-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-medium">{k.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search case number, title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map(s => (
              <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {CASE_TYPES.map(t => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Case List ──────────────────────────────────────────────────────── */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case #</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Created from</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>By</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading cases…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No cases found.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(c => (
              <TableRow
                key={c.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => { setSelectedCase(c); setCommentText('') }}
              >
                <TableCell className="font-mono text-xs">
                  {c.case_number ?? <span className="text-muted-foreground italic">—</span>}
                </TableCell>
                <TableCell className="max-w-48 truncate">
                  {c.title ?? <span className="text-muted-foreground italic">{c.case_type}</span>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">
                    {c.case_type.replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground capitalize">
                  {c.created_from.replace(/_/g, ' ')}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(c.status)}`}>
                    {statusIcon(c.status)}
                    {c.status}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatTs(c.created_at)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground truncate max-w-24">
                  {c.user_profiles?.full_name ?? c.user_profiles?.email ?? '—'}
                </TableCell>
                <TableCell>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* ── Create Case Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Operational Case</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Case Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CASE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Created From</Label>
                <Select value={newFrom} onValueChange={setNewFrom}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATED_FROM_OPTIONS.map(o => (
                      <SelectItem key={o} value={o}>{o.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Title <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Brief case title"
              />
            </div>
            <div className="space-y-1">
              <Label>Summary <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                value={newSummary}
                onChange={e => setNewSummary(e.target.value)}
                placeholder="Case background and context"
                rows={3}
              />
            </div>
            <div className="space-y-1">
              <Label>Officer Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
                placeholder="Internal notes"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createCase.mutate()}
              disabled={createCase.isPending}
            >
              {createCase.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create Case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Case Detail Sheet ──────────────────────────────────────────────── */}
      <Sheet open={!!selectedCase} onOpenChange={open => { if (!open) setSelectedCase(null) }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedCase && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center gap-2">
                  <FolderKanban className="h-5 w-5 text-primary" />
                  {selectedCase.case_number
                    ? <span className="font-mono">{selectedCase.case_number}</span>
                    : <span className="italic text-muted-foreground">No number</span>}
                </SheetTitle>
              </SheetHeader>

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Type</p>
                  <Badge variant="outline" className="capitalize">{selectedCase.case_type.replace(/_/g, ' ')}</Badge>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Status</p>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(selectedCase.status)}`}>
                      {statusIcon(selectedCase.status)}
                      {selectedCase.status}
                    </span>
                    <Select value={selectedCase.status} onValueChange={updateStatus} disabled={updatingStatus}>
                      <SelectTrigger className="h-6 text-xs w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map(s => (
                          <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Created from</p>
                  <p className="capitalize">{selectedCase.created_from.replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Created</p>
                  <p>{formatTs(selectedCase.created_at)}</p>
                </div>
                {selectedCase.closed_at && (
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Closed</p>
                    <p>{formatTs(selectedCase.closed_at)}</p>
                  </div>
                )}
              </div>

              {selectedCase.title && (
                <div className="mb-3">
                  <p className="text-muted-foreground text-xs mb-0.5">Title</p>
                  <p className="font-medium">{selectedCase.title}</p>
                </div>
              )}
              {selectedCase.summary && (
                <div className="mb-3">
                  <p className="text-muted-foreground text-xs mb-0.5">Summary</p>
                  <p className="text-sm">{selectedCase.summary}</p>
                </div>
              )}
              {selectedCase.officer_notes && (
                <div className="mb-3">
                  <p className="text-muted-foreground text-xs mb-0.5">Officer Notes</p>
                  <p className="text-sm">{selectedCase.officer_notes}</p>
                </div>
              )}

              <Separator className="my-4" />

              {/* Linked enforcement events */}
              {enforcementEvents.length > 0 && (
                <>
                  <p className="text-sm font-semibold mb-2">Linked Enforcement Events ({enforcementEvents.length})</p>
                  <div className="space-y-2 mb-4">
                    {enforcementEvents.map(ev => (
                      <div key={ev.id} className="border rounded-md px-3 py-2 text-sm bg-muted/30">
                        <div className="flex items-center justify-between">
                          <span className="font-medium capitalize">{ev.event_type.replace(/_/g, ' ')}</span>
                          <Badge variant="outline" className="text-xs">{ev.status}</Badge>
                        </div>
                        {ev.subject_identifier && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {ev.subject_type}: {ev.subject_identifier}
                          </p>
                        )}
                        {ev.violation_type && (
                          <p className="text-xs text-muted-foreground">Violation: {ev.violation_type}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">{formatTs(ev.event_timestamp)}</p>
                      </div>
                    ))}
                  </div>
                  <Separator className="my-4" />
                </>
              )}

              {/* Comments timeline */}
              <p className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4" />
                Comments
              </p>
              {commentsLoading && (
                <div className="text-xs text-muted-foreground mb-3">
                  <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> Loading…
                </div>
              )}
              {!commentsLoading && comments.length === 0 && (
                <p className="text-xs text-muted-foreground mb-3">No comments yet.</p>
              )}
              <div className="space-y-3 mb-4">
                {comments.map(cm => (
                  <div key={cm.id} className="border-l-2 border-primary/20 pl-3">
                    <p className="text-xs text-muted-foreground mb-0.5">
                      <span className="font-medium text-foreground">
                        {cm.user_profiles?.full_name ?? cm.user_profiles?.email ?? 'Officer'}
                      </span>
                      {' · '}
                      {formatTs(cm.created_at)}
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{cm.comment_text}</p>
                  </div>
                ))}
              </div>

              {/* Add comment */}
              <div className="flex gap-2 mt-2">
                <Textarea
                  placeholder="Add a comment…"
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  rows={2}
                  className="flex-1"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      addComment.mutate()
                    }
                  }}
                />
                <Button
                  size="icon"
                  onClick={() => addComment.mutate()}
                  disabled={!commentText.trim() || addComment.isPending}
                  className="self-end"
                >
                  {addComment.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Ctrl+Enter to submit</p>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  )
}
