/**
 * EnforcementReview — Admin page for reviewing enforcement actions that are
 * pending escalation or approval.
 *
 * Shows actions in `pending_review` or `pending_approval` status and lets
 * admin approve, reject, or escalate each one to the next stage.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import {
  Shield,
  Search,
  CheckCircle,
  XCircle,
  ArrowRight,
  Clock,
  AlertTriangle,
  Car,
  MapPin,
  User,
  Calendar,
  FileText,
  Gavel,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface EnforcementAction {
  id: string
  action_type: string
  status: string
  notes: string | null
  completion_outcome: string | null
  created_at: string
  completed_at: string | null
  plate_number: string | null
  breach_status: string | null
  zone: { name: string } | null
  assigned_user: {
    first_name: string
    last_name: string
  } | null
  user_profile: {
    first_name: string
    last_name: string
  } | null
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending:          { label: 'Pending',          variant: 'secondary' },
  pending_review:   { label: 'Pending Review',   variant: 'default' },
  pending_approval: { label: 'Pending Approval', variant: 'default' },
  in_progress:      { label: 'In Progress',      variant: 'default' },
  completed:        { label: 'Completed',        variant: 'secondary' },
  approved:         { label: 'Approved',         variant: 'default' },
  rejected:         { label: 'Rejected',         variant: 'destructive' },
  escalated:        { label: 'Escalated',        variant: 'destructive' },
  cancelled:        { label: 'Cancelled',        variant: 'outline' },
}

const ACTION_TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  warning:         { label: 'Warning',         icon: <AlertTriangle className="h-3.5 w-3.5 text-orange-500" /> },
  notice_to_vacate: { label: 'Notice to Vacate', icon: <FileText className="h-3.5 w-3.5 text-blue-600" /> },
  tow:             { label: 'Tow Request',     icon: <Car className="h-3.5 w-3.5 text-red-600" /> },
  referral:        { label: 'Council Referral', icon: <Gavel className="h-3.5 w-3.5 text-purple-600" /> },
  infringement:    { label: 'Infringement',    icon: <Gavel className="h-3.5 w-3.5 text-red-700" /> },
}

const REVIEW_STATUSES = ['pending_review', 'pending_approval', 'in_progress', 'completed']

const toTitleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export default function EnforcementReview() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending_review')
  const [actionTypeFilter, setActionTypeFilter] = useState('all')
  const [reviewTarget, setReviewTarget] = useState<EnforcementAction | null>(null)
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected' | 'escalated'>('approved')
  const [reviewNotes, setReviewNotes] = useState('')

  const orgId = user?.role === 'master' ? (organizationId || undefined) : user?.organization_id

  const { data: actions = [], isLoading } = useQuery({
    queryKey: ['enforcement-review', orgId, zoneId, startDate, endDate, statusFilter, actionTypeFilter],
    queryFn: async () => {
      let q = supabase
        .from('enforcement_actions')
        .select(`
          id, action_type, status, notes, completion_outcome, created_at, completed_at,
          plate_number, breach_status,
          zone:zones(name),
          assigned_user:user_profiles!enforcement_actions_assigned_to_fkey(first_name, last_name),
          user_profile:user_profiles!enforcement_actions_created_by_fkey(first_name, last_name)
        `)
        .order('created_at', { ascending: false })
        .limit(200)

      if (orgId) q = q.eq('organization_id', orgId)

      if (statusFilter === 'pending_review') {
        q = q.in('status', ['pending_review', 'pending_approval'])
      } else if (statusFilter !== 'all') {
        q = q.eq('status', statusFilter)
      }

      if (actionTypeFilter !== 'all') q = q.eq('action_type', actionTypeFilter)
      if (zoneId) q = q.eq('zone_id', zoneId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate) q = q.lte('created_at', endDate)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as EnforcementAction[]
    },
    enabled: !!user,
    refetchInterval: 30000,
  })

  const submitReview = useMutation({
    mutationFn: async ({
      id,
      decision,
      notes,
    }: {
      id: string
      decision: string
      notes: string
    }) => {
      const updates: any = {
        status: decision,
        notes: notes || undefined,
      }
      if (decision === 'approved') {
        updates.completed_at = new Date().toISOString()
        updates.completion_outcome = 'approved_by_admin'
      }
      const { error } = await (supabase.from('enforcement_actions') as any)
        .update(updates)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Review submitted')
      setReviewTarget(null)
      setReviewNotes('')
      queryClient.invalidateQueries({ queryKey: ['enforcement-review'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const filtered = actions.filter(a => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      a.plate_number?.toLowerCase().includes(q) ||
      a.zone?.name?.toLowerCase().includes(q) ||
      a.action_type?.toLowerCase().includes(q)
    )
  })

  const pendingCount = actions.filter(a =>
    ['pending_review', 'pending_approval'].includes(a.status)
  ).length

  const stats = {
    pendingReview: pendingCount,
    inProgress: actions.filter(a => a.status === 'in_progress').length,
    completed: actions.filter(a => a.status === 'completed').length,
    escalated: actions.filter(a => a.status === 'escalated').length,
  }

  return (
    <AppLayout
      title="Enforcement Review"
      description="Review and approve pending enforcement actions"
    >
      <GlobalFilterRibbon showDateFilter showZoneFilter />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Pending Review', value: stats.pendingReview, icon: <Clock className="h-5 w-5 text-orange-500" /> },
          { label: 'In Progress',    value: stats.inProgress,    icon: <ArrowRight className="h-5 w-5 text-blue-600" /> },
          { label: 'Completed',      value: stats.completed,     icon: <CheckCircle className="h-5 w-5 text-green-600" /> },
          { label: 'Escalated',      value: stats.escalated,     icon: <AlertTriangle className="h-5 w-5 text-red-600" /> },
        ].map(s => (
          <Card key={s.label} className={s.label === 'Pending Review' && stats.pendingReview > 0 ? 'border-orange-300' : ''}>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                </div>
                {s.icon}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by plate or zone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending_review">Pending Review</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="escalated">Escalated</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={actionTypeFilter} onValueChange={setActionTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Action type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(ACTION_TYPE_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Actions list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold text-muted-foreground">No actions to review</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(action => {
            const statusMeta = STATUS_META[action.status] || STATUS_META.pending
            const typeMeta = ACTION_TYPE_META[action.action_type]
            const isPending = ['pending_review', 'pending_approval'].includes(action.status)

            return (
              <Card key={action.id} className={isPending ? 'border-orange-200 bg-orange-50/40' : ''}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {typeMeta?.icon}
                        <span className="font-semibold">{typeMeta?.label || action.action_type}</span>
                        <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                        {action.plate_number && (
                          <span className="font-mono font-bold text-sm">
                            {action.plate_number}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        {action.zone && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {action.zone.name}
                          </span>
                        )}
                        {action.breach_status && action.breach_status !== 'active' && (
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {toTitleCase(action.breach_status)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDateTime(action.created_at)}
                        </span>
                        {action.user_profile && (
                          <span className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            Created by {action.user_profile.first_name} {action.user_profile.last_name}
                          </span>
                        )}
                        {action.assigned_user && (
                          <span className="flex items-center gap-1">
                            <Shield className="h-3.5 w-3.5" />
                            Assigned to {action.assigned_user.first_name} {action.assigned_user.last_name}
                          </span>
                        )}
                      </div>
                      {action.notes && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{action.notes}</p>
                      )}
                      {action.completion_outcome && (
                        <p className="text-xs text-muted-foreground">Outcome: {toTitleCase(action.completion_outcome)}</p>
                      )}
                    </div>
                    {isPending && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setReviewTarget(action)
                          setReviewDecision('approved')
                          setReviewNotes('')
                        }}
                        className="shrink-0"
                      >
                        <Shield className="h-3.5 w-3.5 mr-1" />
                        Review
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Review Dialog */}
      <Dialog open={!!reviewTarget} onOpenChange={() => setReviewTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review Enforcement Action</DialogTitle>
            <DialogDescription>
              {reviewTarget && (
                <>
                  {ACTION_TYPE_META[reviewTarget.action_type]?.label || reviewTarget.action_type} for{' '}
                  <strong>{reviewTarget.plate_number || 'Unknown'}</strong> at{' '}
                  {reviewTarget.zone?.name || 'Unknown Zone'}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Decision</Label>
              <Select
                value={reviewDecision}
                onValueChange={v => setReviewDecision(v as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">✅ Approve</SelectItem>
                  <SelectItem value="rejected">❌ Reject</SelectItem>
                  <SelectItem value="escalated">⚠️ Escalate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
                placeholder="Optional review notes…"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button
              variant={reviewDecision === 'rejected' ? 'destructive' : 'default'}
              disabled={submitReview.isPending}
              onClick={() =>
                submitReview.mutate({
                  id: reviewTarget!.id,
                  decision: reviewDecision,
                  notes: reviewNotes,
                })
              }
            >
              {reviewDecision === 'approved' && <CheckCircle className="h-4 w-4 mr-2" />}
              {reviewDecision === 'rejected' && <XCircle className="h-4 w-4 mr-2" />}
              {reviewDecision === 'escalated' && <AlertTriangle className="h-4 w-4 mr-2" />}
              {submitReview.isPending ? 'Submitting…' : 'Submit Review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
