import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone'
import {
  ClipboardList,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  User,
  MapPin,
  Calendar,
  AlertTriangle,
  Activity,
  Plus,
  Car,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

interface InvestigationJob {
  id: string
  reference_number: string
  job_type: string
  location_address: string | null
  priority: string
  status: string
  notes: string | null
  created_at: string
  completed_at: string | null
  completion_summary: string | null
  assigned_user: {
    first_name: string
    last_name: string
  } | null
  created_by_user: {
    first_name: string
    last_name: string
  } | null
  zone: { name: string } | null
}

interface Officer {
  id: string
  first_name: string
  last_name: string
  role: string
}

interface JobType {
  id: string
  label: string
  value: string
}

const toTitleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const PRIORITY_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; color: string }> = {
  low:    { label: 'Low',    variant: 'secondary',   color: '#6b7280' },
  normal: { label: 'Normal', variant: 'default',     color: '#1d4ed8' },
  high:   { label: 'High',   variant: 'default',     color: '#b45309' },
  urgent: { label: 'Urgent', variant: 'destructive', color: '#dc2626' },
}

const STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending:    { label: 'Pending',     variant: 'secondary' },
  assigned:   { label: 'Assigned',   variant: 'default' },
  in_progress:{ label: 'In Progress', variant: 'default' },
  completed:  { label: 'Completed',  variant: 'secondary' },
  cancelled:  { label: 'Cancelled',  variant: 'outline' },
  overdue:    { label: 'Overdue',    variant: 'destructive' },
}

export default function InvestigationJobsPage() {
  const { user } = useAuthStore()
  const { organizationId, zoneId, dateFrom, dateTo } = useGlobalFiltersStore()
  const location = useLocation()
  const queryClient = useQueryClient()
  const startDate = dateFrom ? nzDateToUTCStart(dateFrom) : null
  const endDate = dateTo ? nzDateToUTCEnd(dateTo) : null

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [assignTarget, setAssignTarget] = useState<InvestigationJob | null>(null)
  const [assignOfficerId, setAssignOfficerId] = useState('')
  const [assignNotes, setAssignNotes] = useState('')
  const [completeTarget, setCompleteTarget] = useState<InvestigationJob | null>(null)
  const [completeSummary, setCompleteSummary] = useState('')

  const selectedJobId = new URLSearchParams(location.search).get('job_id') || ''

  const orgId = (user?.role === 'master' || user?.role === 'grand_master') ? (organizationId || undefined) : user?.organization_id

  // Fetch jobs
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['investigation-jobs', orgId, zoneId, startDate, endDate, statusFilter, priorityFilter],
    queryFn: async () => {
      let q = supabase
        .from('investigation_jobs')
        .select(`
          id, reference_number, job_type, location_address, priority, status,
          notes, created_at, completed_at, completion_summary,
          assigned_user:user_profiles!assigned_to(first_name, last_name),
          created_by_user:user_profiles!created_by(first_name, last_name),
          zone:zones!associated_zone_id(name)
        `)
        .order('created_at', { ascending: false })
        .limit(200)

      if (orgId) q = q.eq('organization_id', orgId)
      if (zoneId) q = q.eq('associated_zone_id', zoneId)
      if (startDate) q = q.gte('created_at', startDate)
      if (endDate) q = q.lte('created_at', endDate)

      if (statusFilter === 'active') {
        q = q.in('status', ['pending', 'assigned', 'in_progress'])
      } else if (statusFilter !== 'all') {
        q = q.eq('status', statusFilter)
      }

      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter)

      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as InvestigationJob[]
    },
    enabled: !!user,
    refetchInterval: 30000,
  })

  // Fetch officers for assignment
  const { data: officers = [] } = useQuery({
    queryKey: ['officers-for-jobs', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, role')
        .eq('organization_id', orgId!)
        .in('role', ['officer', 'admin_officer'])
        .eq('is_active', true)
        .order('first_name')
      return (data || []) as Officer[]
    },
    enabled: !!orgId,
  })

  // Assign job
  const assignJob = useMutation({
    mutationFn: async ({ id, officerId, notes }: { id: string; officerId: string; notes?: string }) => {
      const { error } = await (supabase.from('investigation_jobs') as any)
        .update({
          assigned_to: officerId,
          status: 'assigned',
          notes: notes || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job assigned')
      setAssignTarget(null)
      setAssignOfficerId('')
      setAssignNotes('')
      queryClient.invalidateQueries({ queryKey: ['investigation-jobs'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Complete job
  const completeJob = useMutation({
    mutationFn: async ({ id, summary }: { id: string; summary: string }) => {
      const { error } = await (supabase.from('investigation_jobs') as any)
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completion_summary: summary,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job marked completed')
      setCompleteTarget(null)
      setCompleteSummary('')
      queryClient.invalidateQueries({ queryKey: ['investigation-jobs'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  // Cancel job
  const cancelJob = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('investigation_jobs') as any)
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job cancelled')
      queryClient.invalidateQueries({ queryKey: ['investigation-jobs'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const filtered = jobs.filter(j => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      j.reference_number?.toLowerCase().includes(q) ||
      j.job_type?.toLowerCase().includes(q) ||
      j.location_address?.toLowerCase().includes(q) ||
      j.zone?.name?.toLowerCase().includes(q) ||
      j.assigned_user?.first_name?.toLowerCase().includes(q) ||
      j.assigned_user?.last_name?.toLowerCase().includes(q)
    )
  })

  const stats = {
    total: jobs.length,
    pending: jobs.filter(j => j.status === 'pending').length,
    assigned: jobs.filter(j => j.status === 'assigned').length,
    overdue: jobs.filter(j => j.status === 'overdue').length,
    urgent: jobs.filter(j => j.priority === 'urgent' && ['pending', 'assigned', 'in_progress'].includes(j.status)).length,
  }

  const isAdmin = ['admin', 'admin_officer', 'master'].includes(user?.role || '')

  useEffect(() => {
    if (!selectedJobId || isLoading) return
    const timer = window.setTimeout(() => {
      const card = document.getElementById(`investigation-job-${selectedJobId}`)
      if (!card) return
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [selectedJobId, isLoading, filtered.length])

  return (
    <AppLayout title="Investigation Jobs" description="Assign and track investigation job types">
      <GlobalFilterRibbon showDateFilter showZoneFilter />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Active', value: stats.total, icon: <ClipboardList className="h-5 w-5 text-blue-600" /> },
          { label: 'Pending', value: stats.pending, icon: <Clock className="h-5 w-5 text-orange-500" /> },
          { label: 'Overdue', value: stats.overdue, icon: <AlertTriangle className="h-5 w-5 text-red-600" /> },
          { label: 'Urgent', value: stats.urgent, icon: <Activity className="h-5 w-5 text-red-700" /> },
        ].map(s => (
          <Card key={s.label} className={(s.label === 'Overdue' || s.label === 'Urgent') && s.value > 0 ? 'border-red-300' : ''}>
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
            placeholder="Search by reference, type, location or officer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {Object.entries(PRIORITY_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Jobs list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-lg font-semibold text-muted-foreground">No investigation jobs found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(job => {
            const priorityMeta = PRIORITY_META[job.priority] || PRIORITY_META.normal
            const statusMeta = STATUS_META[job.status] || STATUS_META.pending
            const isActive = ['pending', 'assigned', 'in_progress'].includes(job.status)

            return (
              <Card
                key={job.id}
                id={`investigation-job-${job.id}`}
                className={
                  [
                    selectedJobId === job.id ? 'ring-2 ring-indigo-500 border-indigo-400 bg-indigo-50/40' : '',
                    job.status === 'overdue' ? 'border-red-300 bg-red-50/40' : '',
                    job.priority === 'urgent' && isActive ? 'border-orange-300 bg-orange-50/40' : '',
                  ].filter(Boolean).join(' ')
                }
              >
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{toTitleCase(job.job_type)}</span>
                        <Badge variant={priorityMeta.variant}>{priorityMeta.label}</Badge>
                        <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">{job.reference_number}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        {job.location_address && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {job.location_address}
                          </span>
                        )}
                        {job.zone && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {job.zone.name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDateTime(job.created_at)}
                        </span>
                        {job.assigned_user ? (
                          <span className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            {job.assigned_user.first_name} {job.assigned_user.last_name}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-orange-600">
                            <User className="h-3.5 w-3.5" />
                            Unassigned
                          </span>
                        )}
                      </div>
                      {job.notes && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{job.notes}</p>
                      )}
                      {job.completion_summary && (
                        <p className="text-sm text-green-700 line-clamp-2">
                          ✓ {job.completion_summary}
                        </p>
                      )}
                    </div>
                    {isAdmin && isActive && (
                      <div className="flex gap-2 shrink-0 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setAssignTarget(job)
                            setAssignOfficerId(officers[0]?.id || '')
                            setAssignNotes('')
                          }}
                        >
                          <User className="h-3.5 w-3.5 mr-1" />
                          Assign
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCompleteTarget(job)
                            setCompleteSummary('')
                          }}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />
                          Complete
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => cancelJob.mutate(job.id)}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Assign Dialog */}
      <Dialog open={!!assignTarget} onOpenChange={() => setAssignTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Job</DialogTitle>
            <DialogDescription>
              {toTitleCase(assignTarget?.job_type ?? '')} — {assignTarget?.location_address || assignTarget?.zone?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Assign to Officer</Label>
              <Select value={assignOfficerId} onValueChange={setAssignOfficerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select officer…" />
                </SelectTrigger>
                <SelectContent>
                  {officers.map(o => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.first_name} {o.last_name} ({o.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea
                value={assignNotes}
                onChange={e => setAssignNotes(e.target.value)}
                placeholder="Assignment notes…"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button
              onClick={() =>
                assignJob.mutate({
                  id: assignTarget!.id,
                  officerId: assignOfficerId,
                  notes: assignNotes,
                })
              }
              disabled={!assignOfficerId || assignJob.isPending}
            >
              <User className="h-4 w-4 mr-2" />
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Dialog */}
      <Dialog open={!!completeTarget} onOpenChange={() => setCompleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mark Job Completed</DialogTitle>
            <DialogDescription>
              {toTitleCase(completeTarget?.job_type ?? '')} — {completeTarget?.location_address || completeTarget?.zone?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Completion Summary</Label>
              <Textarea
                value={completeSummary}
                onChange={e => setCompleteSummary(e.target.value)}
                placeholder="Briefly describe what was found and any actions taken…"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteTarget(null)}>Cancel</Button>
            <Button
              onClick={() =>
                completeJob.mutate({ id: completeTarget!.id, summary: completeSummary })
              }
              disabled={completeJob.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Mark Completed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
