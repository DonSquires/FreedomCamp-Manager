/**
 * DispatchConsole — GDS CATS / Zoho FSM-inspired real-time dispatch board.
 *
 * Left panel  : Priority-sorted job queue (pending → dispatched → on-scene).
 * Right panel : Available officers with GPS status.
 * Admin clicks an unassigned job, selects an officer, and dispatches in one step.
 * Officers receive a notification and update their status through the lifecycle:
 *   pending → dispatched → acknowledged → en_route → on_scene → completed
 *
 * Jobs overdue on SLA are highlighted automatically.
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
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
  DialogDescription,
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
  AlertTriangle, Clock, MapPin, User, Radio, CheckCircle,
  XCircle, Navigation, Siren, Plus, RefreshCw, Car, Zap,
  PhoneCall, FileText, Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DispatchJob {
  id: string
  job_number: string
  job_type: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'pending' | 'dispatched' | 'acknowledged' | 'en_route' | 'on_scene' | 'completed' | 'cancelled'
  title: string
  description: string | null
  address: string | null
  caller_name: string | null
  caller_phone: string | null
  created_at: string
  dispatched_at: string | null
  acknowledged_at: string | null
  on_scene_at: string | null
  completed_at: string | null
  response_sla_minutes: number
  sla_breached: boolean
  escalation_level: number
  assigned_officer: { id: string; first_name: string; last_name: string; phone: string | null } | null
  client_site: { name: string; address: string | null } | null
  zone: { name: string } | null
}

interface OfficerStatus {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  role: string
  last_gps_lat: number | null
  last_gps_lng: number | null
  last_gps_update: string | null
  active_job_count: number
  is_on_shift: boolean
}

interface JobForm {
  job_type: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  title: string
  description: string
  address: string
  caller_name: string
  caller_phone: string
  client_site_id: string
  response_sla_minutes: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; colour: string; bg: string; border: string }> = {
  pending:      { label: 'Pending',      colour: 'text-gray-600',   bg: 'bg-gray-50',    border: 'border-gray-200'   },
  dispatched:   { label: 'Dispatched',   colour: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200'   },
  acknowledged: { label: 'Acknowledged', colour: 'text-indigo-700', bg: 'bg-indigo-50',  border: 'border-indigo-200' },
  en_route:     { label: 'En Route',     colour: 'text-cyan-700',   bg: 'bg-cyan-50',    border: 'border-cyan-200'   },
  on_scene:     { label: 'On Scene',     colour: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200'  },
  completed:    { label: 'Completed',    colour: 'text-emerald-700',bg: 'bg-emerald-50', border: 'border-emerald-200'},
  cancelled:    { label: 'Cancelled',    colour: 'text-gray-400',   bg: 'bg-gray-50',    border: 'border-gray-200'   },
}

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  low:    { label: 'Low',    className: 'border-gray-300   text-gray-500'    },
  normal: { label: 'Normal', className: 'border-blue-300   text-blue-700'    },
  high:   { label: 'High',   className: 'border-orange-300 text-orange-700'  },
  urgent: { label: 'URGENT', className: 'border-red-400    text-red-700 font-bold animate-pulse' },
}

const JOB_TYPE_LABELS: Record<string, string> = {
  general: 'General', welfare_check: 'Welfare Check', alarm_response: 'Alarm Response',
  patrol: 'Patrol', noise_complaint: 'Noise Complaint', freedom_camping: 'Freedom Camping',
  parking: 'Parking', medical: 'Medical', fire: 'Fire', suspicious_activity: 'Suspicious Activity',
  escort: 'Escort', lock_unlock: 'Lock/Unlock', property_check: 'Property Check',
  vandalism: 'Vandalism', other: 'Other',
}

const ACTIVE_STATUSES = ['pending', 'dispatched', 'acknowledged', 'en_route', 'on_scene']

function minutesSince(dateStr: string | null): number {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000)
}

function emptyForm(): JobForm {
  return {
    job_type: 'general', priority: 'normal', title: '', description: '',
    address: '', caller_name: '', caller_phone: '', client_site_id: '', response_sla_minutes: 60,
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DispatchConsole() {
  const { user } = useAuthStore()
  const { organizationId: filterOrgId } = useGlobalFiltersStore()
  const qc = useQueryClient()
  const orgId = filterOrgId || user?.organization_id

  const [statusFilter, setStatusFilter] = useState<'active' | 'completed' | 'all'>('active')
  const [selectedJob, setSelectedJob] = useState<DispatchJob | null>(null)
  const [assignTarget, setAssignTarget] = useState<string>('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<JobForm>(emptyForm())

  // Auto-refresh every 30s for real-time feel
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // ── Jobs query ──────────────────────────────────────────────────────────────
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<DispatchJob[]>({
    queryKey: ['dispatch-jobs', orgId, statusFilter, tick],
    queryFn: async () => {
      let q = supabase
        .from('dispatch_jobs')
        .select(`
          id, job_number, job_type, priority, status, title, description,
          address, caller_name, caller_phone, created_at, dispatched_at,
          acknowledged_at, on_scene_at, completed_at,
          response_sla_minutes, sla_breached, escalation_level,
          assigned_officer:user_profiles!assigned_to(id, first_name, last_name, phone),
          client_site:client_sites!client_site_id(name, address),
          zone:zones!zone_id(name)
        `)
        .eq('organization_id', orgId ?? '')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })

      if (statusFilter === 'active') q = q.in('status', ACTIVE_STATUSES)
      else if (statusFilter === 'completed') q = q.in('status', ['completed', 'cancelled'])

      const { data, error } = await q.limit(100)
      if (error) throw error
      return (data ?? []) as unknown as DispatchJob[]
    },
    enabled: !!orgId,
  })

  // ── Officers query (on-shift officers only) ──────────────────────────────
  const { data: officers = [] } = useQuery<OfficerStatus[]>({
    queryKey: ['dispatch-officers', orgId, tick],
    queryFn: async () => {
      // Officers with an active shift (no ended_at)
      const { data: shiftData } = await supabase
        .from('officer_shifts')
        .select('officer_id')
        .eq('organization_id', orgId ?? '')
        .is('ended_at', null)

      const onShiftIds = (shiftData ?? []).map((r: any) => r.officer_id)

      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, phone, role')
        .eq('organization_id', orgId ?? '')
        .in('role', ['officer', 'admin_officer'])
        .eq('is_active', true)

      if (error) throw error

      // Count active jobs per officer
      const { data: jobCounts } = await supabase
        .from('dispatch_jobs')
        .select('assigned_to')
        .eq('organization_id', orgId ?? '')
        .in('status', ACTIVE_STATUSES)

      const countMap: Record<string, number> = {}
      for (const j of jobCounts ?? []) {
        if (j.assigned_to) countMap[j.assigned_to] = (countMap[j.assigned_to] || 0) + 1
      }

      return (data ?? []).map((o: any) => ({
        ...o,
        is_on_shift: onShiftIds.includes(o.id),
        active_job_count: countMap[o.id] ?? 0,
        last_gps_lat: null, last_gps_lng: null, last_gps_update: null,
      })) as OfficerStatus[]
    },
    enabled: !!orgId,
  })

  // ── Client sites for create form ────────────────────────────────────────────
  const { data: clientSites = [] } = useQuery({
    queryKey: ['client-sites-lookup', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_sites').select('id, name, address').eq('organization_id', orgId ?? '').eq('is_active', true)
      return data ?? []
    },
    enabled: !!orgId,
  })

  // ── Summary stats ────────────────────────────────────────────────────────────
  const pending    = jobs.filter(j => j.status === 'pending').length
  const active     = jobs.filter(j => ACTIVE_STATUSES.includes(j.status) && j.status !== 'pending').length
  const breached   = jobs.filter(j => j.sla_breached && ACTIVE_STATUSES.includes(j.status)).length
  const onShift    = officers.filter(o => o.is_on_shift).length

  // ── Assign + dispatch mutation ───────────────────────────────────────────────
  const dispatchMutation = useMutation({
    mutationFn: async ({ jobId, officerId }: { jobId: string; officerId: string }) => {
      const { error } = await supabase.from('dispatch_jobs').update({
        assigned_to:   officerId,
        dispatched_by: user?.id,
        status:        'dispatched',
        dispatched_at: new Date().toISOString(),
      }).eq('id', jobId)
      if (error) throw error

      // Notify the officer
      const job = jobs.find(j => j.id === jobId)
      await supabase.from('notifications').insert({
        user_id:         officerId,
        organization_id: orgId,
        type:            'investigation_assigned',
        title:           `Job Dispatched: ${job?.job_number}`,
        body:            `${job?.title}${job?.address ? ' – ' + job.address : ''}`,
        priority:        job?.priority ?? 'normal',
        data:            { dispatch_job_id: jobId, job_number: job?.job_number },
      })
    },
    onSuccess: () => {
      toast.success('Job dispatched')
      qc.invalidateQueries({ queryKey: ['dispatch-jobs'] })
      setSelectedJob(null)
    },
    onError: (err: any) => toast.error(err.message ?? 'Dispatch failed'),
  })

  // ── Status update mutation (cancel) ────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.from('dispatch_jobs')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job cancelled')
      qc.invalidateQueries({ queryKey: ['dispatch-jobs'] })
      setSelectedJob(null)
    },
    onError: (err: any) => toast.error(err.message ?? 'Cancel failed'),
  })

  // ── Create job mutation ─────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (f: JobForm) => {
      const { error } = await supabase.from('dispatch_jobs').insert({
        organization_id:      orgId,
        created_by:           user?.id,
        job_type:             f.job_type,
        priority:             f.priority,
        title:                f.title,
        description:          f.description || null,
        address:              f.address || null,
        caller_name:          f.caller_name || null,
        caller_phone:         f.caller_phone || null,
        client_site_id:       f.client_site_id || null,
        response_sla_minutes: f.response_sla_minutes,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job created')
      qc.invalidateQueries({ queryKey: ['dispatch-jobs'] })
      setShowCreate(false)
      setForm(emptyForm())
    },
    onError: (err: any) => toast.error(err.message ?? 'Create failed'),
  })

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Title is required'); return }
    createMutation.mutate(form)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <GlobalFilterRibbon />
      <div className="p-4 md:p-6 space-y-4 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Radio className="h-6 w-6 text-primary" />
              Dispatch Console
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              GDS CATS-style job dispatch — assign jobs to officers in real time
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['dispatch-jobs'] })}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> New Job
            </Button>
          </div>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Awaiting Dispatch', value: pending,  icon: Clock,         cls: 'text-gray-600'   },
            { label: 'Active Jobs',        value: active,   icon: Navigation,    cls: 'text-blue-600'   },
            { label: 'SLA Breached',       value: breached, icon: AlertTriangle, cls: 'text-red-600'    },
            { label: 'Officers On Shift',  value: onShift,  icon: User,          cls: 'text-green-600'  },
          ].map(({ label, value, icon: Icon, cls }) => (
            <Card key={label} className={breached > 0 && label === 'SLA Breached' ? 'border-red-300 bg-red-50/30' : ''}>
              <CardContent className="pt-3 pb-2">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${cls}`} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-2xl font-bold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex gap-2">
          {(['active', 'completed', 'all'] as const).map(f => (
            <Button key={f} size="sm" variant={statusFilter === f ? 'default' : 'outline'}
              className="capitalize" onClick={() => setStatusFilter(f)}>
              {f === 'active' ? 'Active Jobs' : f === 'completed' ? 'Completed' : 'All'}
            </Button>
          ))}
        </div>

        {/* Main two-panel layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Job Queue (2/3 width) ──────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-3">
            {jobsLoading && (
              <div className="text-center py-12 text-muted-foreground">Loading jobs…</div>
            )}
            {!jobsLoading && jobs.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                No jobs found. Create one with "New Job".
              </div>
            )}
            {jobs.map(job => {
              const sc    = STATUS_CONFIG[job.status]
              const pc    = PRIORITY_CONFIG[job.priority]
              const ageM  = minutesSince(job.created_at)
              const slaOk = !job.sla_breached && ageM < job.response_sla_minutes
              return (
                <Card
                  key={job.id}
                  onClick={() => setSelectedJob(job)}
                  className={`cursor-pointer transition-all hover:shadow-md border-l-4 ${
                    job.priority === 'urgent' ? 'border-l-red-500' :
                    job.priority === 'high'   ? 'border-l-orange-400' :
                    job.priority === 'normal' ? 'border-l-blue-400' : 'border-l-gray-300'
                  } ${job.sla_breached ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-xs text-muted-foreground">{job.job_number}</span>
                          <Badge variant="outline" className={pc.className}>{pc.label}</Badge>
                          <Badge variant="outline" className={`${sc.colour} ${sc.border}`}>{sc.label}</Badge>
                          {job.sla_breached && (
                            <Badge variant="destructive" className="text-xs animate-pulse">SLA ⚠</Badge>
                          )}
                        </div>
                        <p className="font-semibold text-sm leading-tight">{job.title}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                          {job.address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{job.address}</span>}
                          {job.client_site && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{job.client_site.name}</span>}
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{ageM}m ago</span>
                          {job.caller_name && <span className="flex items-center gap-1"><PhoneCall className="h-3 w-3" />{job.caller_name}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {job.assigned_officer ? (
                          <div className="flex items-center gap-1 text-xs">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{job.assigned_officer.first_name} {job.assigned_officer.last_name}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unassigned</span>
                        )}
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          SLA: {job.response_sla_minutes}m
                          {slaOk ? ` (${job.response_sla_minutes - ageM}m left)` : ''}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* ── Officer Panel (1/3 width) ──────────────────────────────── */}
          <div className="space-y-3">
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4" /> Officers
                  <Badge variant="secondary" className="ml-auto">{onShift} on shift</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {officers.map(o => (
                  <div key={o.id} className={`flex items-center gap-3 rounded-lg p-2 border ${
                    o.is_on_shift ? 'border-green-200 bg-green-50/50 dark:bg-green-950/20' : 'border-gray-100 opacity-60'
                  }`}>
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                      o.is_on_shift && o.active_job_count === 0 ? 'bg-green-500' :
                      o.is_on_shift ? 'bg-orange-400' : 'bg-gray-300'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">
                        {o.first_name} {o.last_name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {o.is_on_shift
                          ? o.active_job_count === 0 ? 'Available' : `${o.active_job_count} active job${o.active_job_count > 1 ? 's' : ''}`
                          : 'Off shift'}
                      </p>
                    </div>
                  </div>
                ))}
                {officers.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No officers found</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* ── Job Detail / Dispatch Dialog ────────────────────────────────────── */}
      {selectedJob && (
        <Dialog open onOpenChange={() => setSelectedJob(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">{selectedJob.job_number}</span>
                {selectedJob.title}
              </DialogTitle>
              <DialogDescription className="flex gap-2 flex-wrap mt-1">
                <Badge variant="outline" className={PRIORITY_CONFIG[selectedJob.priority].className}>
                  {PRIORITY_CONFIG[selectedJob.priority].label}
                </Badge>
                <Badge variant="outline" className={`${STATUS_CONFIG[selectedJob.status].colour} ${STATUS_CONFIG[selectedJob.status].border}`}>
                  {STATUS_CONFIG[selectedJob.status].label}
                </Badge>
                {selectedJob.sla_breached && <Badge variant="destructive">SLA Breached</Badge>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 bg-muted/40 rounded-lg p-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Type</p><p className="font-medium">{JOB_TYPE_LABELS[selectedJob.job_type] ?? selectedJob.job_type}</p></div>
                <div><p className="text-xs text-muted-foreground">Created</p><p className="font-medium">{formatDateTime(selectedJob.created_at)}</p></div>
                {selectedJob.address && <div className="col-span-2"><p className="text-xs text-muted-foreground">Address</p><p className="font-medium">{selectedJob.address}</p></div>}
                {selectedJob.client_site && <div className="col-span-2"><p className="text-xs text-muted-foreground">Site</p><p className="font-medium">{selectedJob.client_site.name}</p></div>}
                {selectedJob.caller_name && <div><p className="text-xs text-muted-foreground">Caller</p><p className="font-medium">{selectedJob.caller_name}</p></div>}
                {selectedJob.caller_phone && <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{selectedJob.caller_phone}</p></div>}
                {selectedJob.description && <div className="col-span-2"><p className="text-xs text-muted-foreground">Details</p><p>{selectedJob.description}</p></div>}
              </div>

              {/* Timeline */}
              <div className="space-y-1 text-xs">
                {[
                  { label: 'Created',     time: selectedJob.created_at     },
                  { label: 'Dispatched',  time: selectedJob.dispatched_at  },
                  { label: 'Acknowledged',time: selectedJob.acknowledged_at},
                  { label: 'On Scene',    time: selectedJob.on_scene_at    },
                  { label: 'Completed',   time: selectedJob.completed_at   },
                ].filter(t => t.time).map(t => (
                  <div key={t.label} className="flex justify-between text-muted-foreground">
                    <span>{t.label}</span>
                    <span>{formatDateTime(t.time!)}</span>
                  </div>
                ))}
              </div>

              {/* Dispatch controls */}
              {selectedJob.status === 'pending' && (
                <div className="space-y-2 pt-2 border-t">
                  <Label>Assign to Officer</Label>
                  <Select value={assignTarget} onValueChange={setAssignTarget}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select officer…" />
                    </SelectTrigger>
                    <SelectContent>
                      {officers.filter(o => o.is_on_shift).map(o => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.first_name} {o.last_name}
                          {o.active_job_count > 0 ? ` (${o.active_job_count} jobs)` : ' – Available'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              {['pending', 'dispatched', 'acknowledged', 'en_route'].includes(selectedJob.status) && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive mr-auto"
                  onClick={() => cancelMutation.mutate(selectedJob.id)}
                  disabled={cancelMutation.isPending}
                >
                  <XCircle className="h-4 w-4 mr-1.5" /> Cancel Job
                </Button>
              )}
              <Button variant="outline" onClick={() => setSelectedJob(null)}>Close</Button>
              {selectedJob.status === 'pending' && (
                <Button
                  disabled={!assignTarget || dispatchMutation.isPending}
                  onClick={() => dispatchMutation.mutate({ jobId: selectedJob.id, officerId: assignTarget })}
                >
                  <Zap className="h-4 w-4 mr-1.5" /> Dispatch
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Create Job Dialog ────────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={v => { setShowCreate(v); if (!v) setForm(emptyForm()) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Dispatch Job</DialogTitle>
            <DialogDescription>Create a new job and optionally dispatch it immediately.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.job_type} onValueChange={v => setForm(f => ({ ...f, job_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(JOB_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as JobForm['priority'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['low','normal','high','urgent'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input placeholder="Brief job description…" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Address / Location</Label>
                <Input placeholder="Street address…" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Client Site</Label>
                <Select value={form.client_site_id} onValueChange={v => setForm(f => ({ ...f, client_site_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {(clientSites as any[]).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Caller Name</Label>
                <Input value={form.caller_name} onChange={e => setForm(f => ({ ...f, caller_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Caller Phone</Label>
                <Input type="tel" value={form.caller_phone} onChange={e => setForm(f => ({ ...f, caller_phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Response SLA (mins)</Label>
                <Input type="number" min="5" value={form.response_sla_minutes} onChange={e => setForm(f => ({ ...f, response_sla_minutes: parseInt(e.target.value) || 60 }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Additional Details</Label>
              <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>Create Job</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
