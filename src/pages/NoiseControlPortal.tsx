/**
 * NoiseControlPortal.tsx
 *
 * Admin-facing Noise Control management portal.
 *
 * NZ RMA s.319-333 compliant workflow:
 *   Jobs       — create / dispatch noise complaints to field officers
 *   Notices    — register Abatement (AN), Direction (DN), Enforcement (END) notices
 *   Seizures   — log & track equipment seizures under RMA s.328
 *   Analytics  — repeat addresses, notice types, officer workload
 *
 * Officer context system: when dispatching a job the admin sees all prior
 * notices, permanent ENDs, H&S flags for that address — mirroring how
 * Auckland Council, Wellington City Council and Christchurch City Council
 * brief officers before attendance.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import {
  Volume2, AlertTriangle, ShieldAlert, Gavel, Package,
  PlusCircle, RefreshCw, MapPin, Clock, Users, BarChart3,
  CheckCircle, XCircle, FileText, Zap, Radio, Eye,
  TrendingUp, Filter,
} from 'lucide-react'

// ─── Status / type helpers ────────────────────────────────────────────────────

const JOB_STATUS: Record<string, { label: string; colour: string }> = {
  pending:    { label: 'Pending',    colour: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  assigned:   { label: 'Assigned',   colour: 'bg-blue-100 text-blue-800 border-blue-200' },
  en_route:   { label: 'En Route',   colour: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  on_scene:   { label: 'On Scene',   colour: 'bg-purple-100 text-purple-800 border-purple-200' },
  completed:  { label: 'Completed',  colour: 'bg-green-100 text-green-800 border-green-200' },
  cancelled:  { label: 'Cancelled',  colour: 'bg-gray-100 text-gray-500 border-gray-200' },
  referred:   { label: 'Referred',   colour: 'bg-orange-100 text-orange-800 border-orange-200' },
}

const NOTICE_TYPE: Record<string, { label: string; colour: string; abbr: string }> = {
  abatement_notice:    { label: 'Abatement Notice',   colour: 'bg-yellow-100 text-yellow-800 border-yellow-200', abbr: 'AN' },
  direction_notice:    { label: 'Direction Notice',   colour: 'bg-blue-100 text-blue-800 border-blue-200',   abbr: 'DN' },
  enforcement_notice:  { label: 'Enforcement Notice', colour: 'bg-red-100 text-red-800 border-red-200',    abbr: 'END' },
}

const NOTICE_STATUS: Record<string, { label: string; colour: string }> = {
  issued:        { label: 'Issued',        colour: 'bg-blue-100 text-blue-800 border-blue-200' },
  complied:      { label: 'Complied',      colour: 'bg-green-100 text-green-800 border-green-200' },
  breached:      { label: 'Breached',      colour: 'bg-red-100 text-red-800 border-red-200' },
  escalated:     { label: 'Escalated',     colour: 'bg-orange-100 text-orange-800 border-orange-200' },
  withdrawn:     { label: 'Withdrawn',     colour: 'bg-gray-100 text-gray-500 border-gray-200' },
  court_referred:{ label: 'Court Referred',colour: 'bg-purple-100 text-purple-800 border-purple-200' },
  paid:          { label: 'Paid',          colour: 'bg-teal-100 text-teal-800 border-teal-200' },
}

const SEIZURE_STATUS: Record<string, { label: string; colour: string }> = {
  held:            { label: 'Held',            colour: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  returned:        { label: 'Returned',        colour: 'bg-green-100 text-green-800 border-green-200' },
  disposed:        { label: 'Disposed',        colour: 'bg-gray-100 text-gray-500 border-gray-200' },
  sold_at_auction: { label: 'Sold at Auction', colour: 'bg-blue-100 text-blue-800 border-blue-200' },
  court_ordered:   { label: 'Court Ordered',   colour: 'bg-purple-100 text-purple-800 border-purple-200' },
}

const PRIORITY_COLOUR: Record<string, string> = {
  low:    'bg-gray-100 text-gray-600',
  normal: 'bg-blue-100 text-blue-700',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

// ─── Types ────────────────────────────────────────────────────────────────────

type NoiseJob = {
  id: string
  job_number: string
  title: string
  address: string
  suburb: string
  city: string
  noise_type: string
  priority: string
  status: string
  assigned_to: string | null
  has_prior_end: boolean
  has_permanent_end: boolean
  has_hs_incident: boolean
  has_prior_abatement: boolean
  prior_notice_count: number
  safety_notes: string | null
  created_at: string
  completed_at: string | null
}

type NoiseNotice = {
  id: string
  notice_number: string
  notice_type: string
  recipient_name: string
  recipient_address: string
  offence_description: string
  issued_at: string
  comply_by: string | null
  status: string
  penalty_amount_nzd: number | null
  daily_penalty_nzd: number | null
  is_permanent_end: boolean
  previous_notice_count: number
  issuing_officer_name: string | null
}

type NoiseSeizure = {
  id: string
  seizure_number: string
  address: string
  seized_at: string
  equipment_description: string
  equipment_count: number
  estimated_value_nzd: number | null
  status: string
  storage_location: string | null
  seizing_officer_name: string | null
}

type Officer = { id: string; full_name?: string; first_name: string | null; last_name: string | null; email: string }

// ─── Component ───────────────────────────────────────────────────────────────

export default function NoiseControlPortal() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const queryClient = useQueryClient()

  const [tab, setTab] = useState('jobs')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [searchText, setSearchText] = useState('')
  const [showNewJobDialog, setShowNewJobDialog] = useState(false)
  const [showJobDetail, setShowJobDetail] = useState<NoiseJob | null>(null)
  const [showNewNoticeDialog, setShowNewNoticeDialog] = useState(false)
  const [showNoticeDetail, setShowNoticeDetail] = useState<NoiseNotice | null>(null)

  // New job form
  const [newJob, setNewJob] = useState({
    title: '',
    address: '',
    suburb: '',
    city: '',
    noise_type: 'music',
    priority: 'normal',
    complaint_source: 'public',
    complaint_description: '',
    assigned_to: '',
    has_hs_incident: false,
    safety_notes: '',
    prior_notice_summary: '',
  })

  // New notice form
  const [newNotice, setNewNotice] = useState({
    noise_job_id: '',
    notice_type: 'abatement_notice',
    recipient_name: '',
    recipient_address: '',
    offence_description: '',
    rma_section: 'RMA s.326(1)(a)',
    penalty_amount_nzd: '',
    daily_penalty_nzd: '',
    notes: '',
  })

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ['noise_jobs', orgId, filterStatus, filterPriority],
    queryFn: async () => {
      if (!orgId) return []
      let q = supabase
        .from('noise_jobs' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (filterStatus !== 'all') q = q.eq('status', filterStatus)
      if (filterPriority !== 'all') q = q.eq('priority', filterPriority)
      const { data, error } = await q
      if (error) throw error
      return (data || []) as unknown as NoiseJob[]
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  })

  const { data: notices = [], isLoading: noticesLoading, refetch: refetchNotices } = useQuery({
    queryKey: ['noise_notices', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await supabase
        .from('noise_notices' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('issued_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data || []) as unknown as NoiseNotice[]
    },
    enabled: !!orgId,
  })

  const { data: seizures = [], isLoading: seizuresLoading, refetch: refetchSeizures } = useQuery({
    queryKey: ['noise_seizures', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await supabase
        .from('noise_seizures' as any)
        .select('*')
        .eq('organization_id', orgId)
        .order('seized_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data || []) as unknown as NoiseSeizure[]
    },
    enabled: !!orgId,
  })

  const { data: officers = [] } = useQuery({
    queryKey: ['officers', orgId],
    queryFn: async () => {
      if (!orgId) return []
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, email, first_name, last_name')
        .eq('organization_id', orgId)
        .in('role', ['officer', 'admin_officer'])
        .order('first_name')
      if (error) throw error
      return (data || []) as unknown as Officer[]
    },
    enabled: !!orgId,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createJobMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id) throw new Error('Not authenticated')
      // Look up prior notices for this address to populate context flags
      const addr = newJob.address.trim().toLowerCase()
      const { data: priorNotices } = await supabase
        .from('noise_notices' as any)
        .select('notice_type, is_permanent_end, recipient_address')
        .eq('organization_id', orgId)
        .ilike('recipient_address', `%${addr}%`)
      const priorCount = priorNotices?.length || 0
      const hasPriorEnd = (priorNotices || []).some((n: any) => n.notice_type === 'enforcement_notice')
      const hasPermanentEnd = (priorNotices || []).some((n: any) => n.is_permanent_end)
      const hasPriorAN = (priorNotices || []).some((n: any) => n.notice_type === 'abatement_notice')
      // Generate job number via RPC or DB counter
      const { data: counterRow } = await supabase
        .from('noise_job_counters' as any)
        .select('last_number')
        .eq('organization_id', orgId)
        .maybeSingle()
      const nextNum = ((counterRow as any)?.last_number || 0) + 1
      const jobNumber = `NCJ-${new Date().getFullYear()}-${String(nextNum).padStart(6, '0')}`
      await supabase
        .from('noise_job_counters' as any)
        .upsert({ organization_id: orgId, last_number: nextNum }, { onConflict: 'organization_id' })
      const { error } = await supabase
        .from('noise_jobs' as any)
        .insert({
          organization_id: orgId,
          job_number: jobNumber,
          title: newJob.title,
          address: newJob.address,
          suburb: newJob.suburb || null,
          city: newJob.city || null,
          noise_type: newJob.noise_type,
          priority: newJob.priority,
          complaint_source: newJob.complaint_source,
          complaint_description: newJob.complaint_description || null,
          assigned_to: newJob.assigned_to || null,
          assigned_at: newJob.assigned_to ? new Date().toISOString() : null,
          dispatched_by: user?.id,
          has_prior_end: hasPriorEnd,
          has_permanent_end: hasPermanentEnd,
          has_hs_incident: newJob.has_hs_incident,
          has_prior_abatement: hasPriorAN,
          prior_notice_count: priorCount,
          prior_notice_summary: newJob.prior_notice_summary || null,
          safety_notes: newJob.safety_notes || null,
          status: newJob.assigned_to ? 'assigned' : 'pending',
        })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job created and dispatched')
      setShowNewJobDialog(false)
      setNewJob({ title: '', address: '', suburb: '', city: '', noise_type: 'music', priority: 'normal', complaint_source: 'public', complaint_description: '', assigned_to: '', has_hs_incident: false, safety_notes: '', prior_notice_summary: '' })
      queryClient.invalidateQueries({ queryKey: ['noise_jobs', orgId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createNoticeMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id) throw new Error('Not authenticated')
      const { data: counterRow } = await supabase
        .from('noise_notice_counters' as any)
        .select('last_number')
        .eq('organization_id', orgId)
        .maybeSingle()
      const nextNum = ((counterRow as any)?.last_number || 0) + 1
      const noticeNumber = `NCN-${new Date().getFullYear()}-${String(nextNum).padStart(6, '0')}`
      await supabase
        .from('noise_notice_counters' as any)
        .upsert({ organization_id: orgId, last_number: nextNum }, { onConflict: 'organization_id' })
      const isEnd = newNotice.notice_type === 'enforcement_notice'
      const { error } = await supabase
        .from('noise_notices' as any)
        .insert({
          organization_id: orgId,
          notice_number: noticeNumber,
          noise_job_id: newNotice.noise_job_id || null,
          notice_type: newNotice.notice_type,
          recipient_name: newNotice.recipient_name,
          recipient_address: newNotice.recipient_address,
          offence_description: newNotice.offence_description,
          rma_section: newNotice.rma_section || null,
          penalty_amount_nzd: isEnd && newNotice.penalty_amount_nzd ? parseFloat(newNotice.penalty_amount_nzd) : null,
          daily_penalty_nzd: isEnd && newNotice.daily_penalty_nzd ? parseFloat(newNotice.daily_penalty_nzd) : null,
          issuing_officer_id: user?.id,
          issuing_officer_name: user?.full_name || null,
          notes: newNotice.notes || null,
          status: 'issued',
        })
      if (error) throw error
      // If END issued, update linked job context flags
      if (newNotice.noise_job_id && isEnd) {
        await supabase
          .from('noise_jobs' as any)
          .update({ has_prior_end: true })
          .eq('id', newNotice.noise_job_id)
      }
    },
    onSuccess: () => {
      toast.success('Notice issued and recorded')
      setShowNewNoticeDialog(false)
      setNewNotice({ noise_job_id: '', notice_type: 'abatement_notice', recipient_name: '', recipient_address: '', offence_description: '', rma_section: 'RMA s.326(1)(a)', penalty_amount_nzd: '', daily_penalty_nzd: '', notes: '' })
      queryClient.invalidateQueries({ queryKey: ['noise_notices', orgId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateJobStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('noise_jobs' as any)
        .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job status updated')
      queryClient.invalidateQueries({ queryKey: ['noise_jobs', orgId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Filtered lists ─────────────────────────────────────────────────────────

  const filteredJobs = jobs.filter(j =>
    searchText === '' ||
    j.job_number.toLowerCase().includes(searchText.toLowerCase()) ||
    j.address.toLowerCase().includes(searchText.toLowerCase()) ||
    j.title.toLowerCase().includes(searchText.toLowerCase())
  )

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = {
    activeJobs: jobs.filter(j => ['pending','assigned','en_route','on_scene'].includes(j.status)).length,
    issuedNotices: notices.filter(n => n.status === 'issued').length,
    endNotices: notices.filter(n => n.notice_type === 'enforcement_notice').length,
    heldSeizures: seizures.filter(s => s.status === 'held').length,
    urgentJobs: jobs.filter(j => j.priority === 'urgent' && j.status !== 'completed').length,
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Volume2 className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Noise Control</h1>
              <p className="text-sm text-gray-500">NZ RMA s.319–333 enforcement portal — jobs, AN / DN / END notices, seizures</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => { refetchJobs(); refetchNotices(); refetchSeizures() }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowNewJobDialog(true)}>
              <Radio className="h-4 w-4 mr-1" /> Dispatch Job
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowNewNoticeDialog(true)}>
              <FileText className="h-4 w-4 mr-1" /> Issue Notice
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { icon: <Radio className="h-5 w-5 text-blue-500" />,    label: 'Active Jobs',     value: stats.activeJobs,     bg: 'bg-blue-50' },
            { icon: <Zap className="h-5 w-5 text-yellow-500" />,    label: 'Urgent Jobs',     value: stats.urgentJobs,     bg: 'bg-yellow-50' },
            { icon: <FileText className="h-5 w-5 text-orange-500" />,label: 'Open Notices',   value: stats.issuedNotices,  bg: 'bg-orange-50' },
            { icon: <ShieldAlert className="h-5 w-5 text-red-500" />,label: 'END Notices',    value: stats.endNotices,     bg: 'bg-red-50' },
            { icon: <Package className="h-5 w-5 text-purple-500" />, label: 'Equipment Held', value: stats.heldSeizures,   bg: 'bg-purple-50' },
          ].map(s => (
            <Card key={s.label} className={`${s.bg} border-0`}>
              <CardContent className="p-4 flex items-center gap-3">
                {s.icon}
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="text-xl font-bold text-gray-900">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="jobs">
              <Radio className="h-4 w-4 mr-1" /> Jobs ({jobs.length})
            </TabsTrigger>
            <TabsTrigger value="notices">
              <FileText className="h-4 w-4 mr-1" /> Notices ({notices.length})
            </TabsTrigger>
            <TabsTrigger value="seizures">
              <Package className="h-4 w-4 mr-1" /> Seizures ({seizures.length})
            </TabsTrigger>
            <TabsTrigger value="analytics">
              <BarChart3 className="h-4 w-4 mr-1" /> Analytics
            </TabsTrigger>
          </TabsList>

          {/* ── Jobs tab ─────────────────────────────────────────────────── */}
          <TabsContent value="jobs" className="mt-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-4">
              <Input
                placeholder="Search address or job #…"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                className="w-60"
              />
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {Object.entries(JOB_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  {['low','normal','high','urgent'].map(p => <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {jobsLoading ? (
              <div className="text-center py-12 text-gray-400">Loading jobs…</div>
            ) : filteredJobs.length === 0 ? (
              <div className="text-center py-12 text-gray-400">No jobs found</div>
            ) : (
              <div className="space-y-3">
                {filteredJobs.map(job => (
                  <Card key={job.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-mono text-sm font-semibold text-gray-700">{job.job_number}</span>
                            <Badge className={`text-xs border ${JOB_STATUS[job.status]?.colour}`}>{JOB_STATUS[job.status]?.label}</Badge>
                            <Badge className={`text-xs ${PRIORITY_COLOUR[job.priority]}`}>{job.priority.toUpperCase()}</Badge>
                            {job.has_permanent_end && <Badge className="text-xs bg-red-600 text-white">PERMANENT END</Badge>}
                            {job.has_prior_end && !job.has_permanent_end && <Badge className="text-xs bg-red-100 text-red-700 border-red-200">Prior END</Badge>}
                            {job.has_hs_incident && <Badge className="text-xs bg-yellow-600 text-white">H&S FLAG</Badge>}
                          </div>
                          <p className="font-semibold text-gray-900 truncate">{job.title}</p>
                          <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" />
                            {job.address}{job.suburb ? `, ${job.suburb}` : ''}{job.city ? `, ${job.city}` : ''}
                          </p>
                          {job.prior_notice_count > 0 && (
                            <p className="text-xs text-orange-600 mt-1">{job.prior_notice_count} prior notice{job.prior_notice_count !== 1 ? 's' : ''} at this address</p>
                          )}
                          {job.safety_notes && (
                            <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> {job.safety_notes}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <p className="text-xs text-gray-400">{formatDateTime(job.created_at)}</p>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => setShowJobDetail(job)}>
                              <Eye className="h-3 w-3 mr-1" /> View
                            </Button>
                            {['pending','assigned'].includes(job.status) && (
                              <Button size="sm" variant="outline" onClick={() => updateJobStatusMutation.mutate({ id: job.id, status: 'completed' })}>
                                <CheckCircle className="h-3 w-3 mr-1" /> Complete
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Notices tab ──────────────────────────────────────────────── */}
          <TabsContent value="notices" className="mt-4">
            {noticesLoading ? (
              <div className="text-center py-12 text-gray-400">Loading notices…</div>
            ) : notices.length === 0 ? (
              <div className="text-center py-12 text-gray-400">No notices recorded</div>
            ) : (
              <div className="space-y-3">
                {notices.map(notice => {
                  const nt = NOTICE_TYPE[notice.notice_type]
                  const ns = NOTICE_STATUS[notice.status]
                  return (
                    <Card key={notice.id} className={`hover:shadow-md transition-shadow ${notice.notice_type === 'enforcement_notice' ? 'border-red-200' : ''}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-mono text-sm font-semibold text-gray-700">{notice.notice_number}</span>
                              <Badge className={`text-xs border font-bold ${nt?.colour}`}>{nt?.abbr}</Badge>
                              <Badge className={`text-xs border ${ns?.colour}`}>{ns?.label}</Badge>
                              {notice.is_permanent_end && <Badge className="text-xs bg-red-600 text-white">PERMANENT</Badge>}
                            </div>
                            <p className="font-semibold text-gray-900 truncate">{notice.recipient_name}</p>
                            <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                              <MapPin className="h-3 w-3" /> {notice.recipient_address}
                            </p>
                            <p className="text-sm text-gray-600 mt-1 line-clamp-2">{notice.offence_description}</p>
                            {notice.penalty_amount_nzd && (
                              <p className="text-xs text-red-600 mt-1">Penalty: ${notice.penalty_amount_nzd.toLocaleString()} NZD{notice.daily_penalty_nzd ? ` + $${notice.daily_penalty_nzd}/day` : ''}</p>
                            )}
                            {notice.previous_notice_count > 0 && (
                              <p className="text-xs text-orange-500 mt-0.5">{notice.previous_notice_count} prior notices at this address</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <p className="text-xs text-gray-400">{formatDateTime(notice.issued_at)}</p>
                            {notice.issuing_officer_name && <p className="text-xs text-gray-500">{notice.issuing_officer_name}</p>}
                            {notice.comply_by && <p className="text-xs text-orange-600 flex items-center gap-1"><Clock className="h-3 w-3" /> Comply by {formatDateTime(notice.comply_by)}</p>}
                            <Button size="sm" variant="ghost" onClick={() => setShowNoticeDetail(notice)}>
                              <Eye className="h-3 w-3 mr-1" /> Detail
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Seizures tab ─────────────────────────────────────────────── */}
          <TabsContent value="seizures" className="mt-4">
            {seizuresLoading ? (
              <div className="text-center py-12 text-gray-400">Loading seizures…</div>
            ) : seizures.length === 0 ? (
              <div className="text-center py-12 text-gray-400">No equipment seizures recorded</div>
            ) : (
              <div className="space-y-3">
                {seizures.map(s => (
                  <Card key={s.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-mono text-sm font-semibold text-gray-700">{s.seizure_number}</span>
                            <Badge className={`text-xs border ${SEIZURE_STATUS[s.status]?.colour}`}>{SEIZURE_STATUS[s.status]?.label}</Badge>
                          </div>
                          <p className="font-semibold text-gray-900 truncate">{s.equipment_description}</p>
                          <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" /> {s.address}
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            {s.equipment_count} item{s.equipment_count !== 1 ? 's' : ''}
                            {s.estimated_value_nzd ? ` · Est. $${s.estimated_value_nzd.toLocaleString()} NZD` : ''}
                            {s.storage_location ? ` · Stored: ${s.storage_location}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <p className="text-xs text-gray-400">{formatDateTime(s.seized_at)}</p>
                          {s.seizing_officer_name && <p className="text-xs text-gray-500">{s.seizing_officer_name}</p>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Analytics tab ────────────────────────────────────────────── */}
          <TabsContent value="analytics" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Notice type breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Notice Type Breakdown</CardTitle>
                  <CardDescription>All-time issued notices by type</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(NOTICE_TYPE).map(([k, v]) => {
                    const count = notices.filter(n => n.notice_type === k).length
                    const pct = notices.length ? Math.round(count / notices.length * 100) : 0
                    return (
                      <div key={k}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="flex items-center gap-1">
                            <Badge className={`text-xs border ${v.colour}`}>{v.abbr}</Badge>
                            {v.label}
                          </span>
                          <span className="font-semibold">{count}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-orange-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>

              {/* Job status breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Job Status Distribution</CardTitle>
                  <CardDescription>Current job queue composition</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(JOB_STATUS).map(([k, v]) => {
                    const count = jobs.filter(j => j.status === k).length
                    const pct = jobs.length ? Math.round(count / jobs.length * 100) : 0
                    return (
                      <div key={k}>
                        <div className="flex justify-between text-sm mb-1">
                          <span><Badge className={`text-xs border ${v.colour}`}>{v.label}</Badge></span>
                          <span className="font-semibold">{count}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>

              {/* High-risk addresses */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-red-500" /> Repeat Addresses (≥ 2 notices)
                  </CardTitle>
                  <CardDescription>Addresses requiring escalated response planning</CardDescription>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const addrCount: Record<string, number> = {}
                    notices.forEach(n => { addrCount[n.recipient_address] = (addrCount[n.recipient_address] || 0) + 1 })
                    const repeat = Object.entries(addrCount).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])
                    if (repeat.length === 0) return <p className="text-sm text-gray-400">No repeat addresses yet</p>
                    return (
                      <div className="space-y-2">
                        {repeat.slice(0, 10).map(([addr, count]) => (
                          <div key={addr} className="flex items-center justify-between text-sm p-2 bg-red-50 rounded-lg">
                            <span className="flex items-center gap-1 text-gray-700"><MapPin className="h-3 w-3 text-red-400" />{addr}</span>
                            <Badge className="bg-red-100 text-red-700 border-red-200">{count} notices</Badge>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Dispatch Job Dialog ──────────────────────────────────────────────── */}
      <Dialog open={showNewJobDialog} onOpenChange={setShowNewJobDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-orange-500" /> Dispatch Noise Control Job
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Address — looked up automatically for prior notices */}
            <div className="space-y-1">
              <Label>Complaint Address *</Label>
              <Input placeholder="123 Example Street, Suburb" value={newJob.address} onChange={e => setNewJob(p => ({ ...p, address: e.target.value }))} />
              <p className="text-xs text-gray-400">Prior notices at this address will be auto-detected and shown to the officer.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Suburb</Label>
                <Input placeholder="Suburb" value={newJob.suburb} onChange={e => setNewJob(p => ({ ...p, suburb: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>City</Label>
                <Input placeholder="City" value={newJob.city} onChange={e => setNewJob(p => ({ ...p, city: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Job Title / Description *</Label>
              <Input placeholder="e.g. Loud music – residential party" value={newJob.title} onChange={e => setNewJob(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Noise Type</Label>
                <Select value={newJob.noise_type} onValueChange={v => setNewJob(p => ({ ...p, noise_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['music','party','machinery','construction','barking_dog','industrial','motor_vehicle','other'].map(t => (
                      <SelectItem key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Priority</Label>
                <Select value={newJob.priority} onValueChange={v => setNewJob(p => ({ ...p, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['low','normal','high','urgent'].map(t => (
                      <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Assign to Officer</Label>
              <Select value={newJob.assigned_to} onValueChange={v => setNewJob(p => ({ ...p, assigned_to: v }))}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {officers.map(o => <SelectItem key={o.id} value={o.id}>{[o.first_name, o.last_name].filter(Boolean).join(' ') || o.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Complaint Details</Label>
              <Textarea placeholder="Describe the complaint…" rows={3} value={newJob.complaint_description} onChange={e => setNewJob(p => ({ ...p, complaint_description: e.target.value }))} />
            </div>
            {/* H&S flag */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hs_flag"
                checked={newJob.has_hs_incident}
                onChange={e => setNewJob(p => ({ ...p, has_hs_incident: e.target.checked }))}
                className="h-4 w-4 rounded"
              />
              <Label htmlFor="hs_flag" className="text-red-600 font-medium">H&S Incident Flag — officer safety briefing required</Label>
            </div>
            {newJob.has_hs_incident && (
              <div className="space-y-1">
                <Label>Safety Notes for Officer</Label>
                <Textarea placeholder="Describe H&S risk e.g. aggressive occupant, dogs, hazardous materials…" rows={2} value={newJob.safety_notes} onChange={e => setNewJob(p => ({ ...p, safety_notes: e.target.value }))} />
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowNewJobDialog(false)}>Cancel</Button>
              <Button
                onClick={() => createJobMutation.mutate()}
                disabled={createJobMutation.isPending || !newJob.title || !newJob.address}
              >
                {createJobMutation.isPending ? 'Dispatching…' : 'Dispatch Job'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Issue Notice Dialog ──────────────────────────────────────────────── */}
      <Dialog open={showNewNoticeDialog} onOpenChange={setShowNewNoticeDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-orange-500" /> Issue Noise Control Notice
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <Label>Notice Type *</Label>
              <Select value={newNotice.notice_type} onValueChange={v => setNewNotice(p => ({ ...p, notice_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="abatement_notice">Abatement Notice (AN) — RMA s.326</SelectItem>
                  <SelectItem value="direction_notice">Direction Notice (DN) — immediate direction</SelectItem>
                  <SelectItem value="enforcement_notice">Enforcement Notice (END) — RMA s.319, financial penalty</SelectItem>
                </SelectContent>
              </Select>
              {newNotice.notice_type === 'enforcement_notice' && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  END carries financial penalties and may authorise equipment seizure (RMA s.328)
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Link to Job (optional)</Label>
              <Select value={newNotice.noise_job_id} onValueChange={v => setNewNotice(p => ({ ...p, noise_job_id: v }))}>
                <SelectTrigger><SelectValue placeholder="No job link" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No job link</SelectItem>
                  {jobs.filter(j => j.status !== 'cancelled').map(j => (
                    <SelectItem key={j.id} value={j.id}>{j.job_number} — {j.address}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Recipient Name *</Label>
              <Input placeholder="Full name of person/entity served" value={newNotice.recipient_name} onChange={e => setNewNotice(p => ({ ...p, recipient_name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Recipient Address *</Label>
              <Input placeholder="Address where notice is served" value={newNotice.recipient_address} onChange={e => setNewNotice(p => ({ ...p, recipient_address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Offence Description *</Label>
              <Textarea placeholder="Describe the offence, noise observed, section of district plan breached…" rows={3} value={newNotice.offence_description} onChange={e => setNewNotice(p => ({ ...p, offence_description: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>RMA Section</Label>
              <Input placeholder="e.g. RMA s.326(1)(a)" value={newNotice.rma_section} onChange={e => setNewNotice(p => ({ ...p, rma_section: e.target.value }))} />
            </div>
            {newNotice.notice_type === 'enforcement_notice' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Penalty Amount (NZD)</Label>
                  <Input type="number" placeholder="0.00" value={newNotice.penalty_amount_nzd} onChange={e => setNewNotice(p => ({ ...p, penalty_amount_nzd: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Daily Penalty (NZD)</Label>
                  <Input type="number" placeholder="0.00" value={newNotice.daily_penalty_nzd} onChange={e => setNewNotice(p => ({ ...p, daily_penalty_nzd: e.target.value }))} />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea placeholder="Additional notes…" rows={2} value={newNotice.notes} onChange={e => setNewNotice(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowNewNoticeDialog(false)}>Cancel</Button>
              <Button
                onClick={() => createNoticeMutation.mutate()}
                disabled={createNoticeMutation.isPending || !newNotice.recipient_name || !newNotice.recipient_address || !newNotice.offence_description}
              >
                {createNoticeMutation.isPending ? 'Issuing…' : 'Issue Notice'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Job Detail Dialog ────────────────────────────────────────────────── */}
      {showJobDetail && (
        <Dialog open onOpenChange={() => setShowJobDetail(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{showJobDetail.job_number} — {showJobDetail.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Status:</span> <Badge className={`text-xs border ${JOB_STATUS[showJobDetail.status]?.colour}`}>{JOB_STATUS[showJobDetail.status]?.label}</Badge></div>
                <div><span className="text-gray-500">Priority:</span> <Badge className={`text-xs ${PRIORITY_COLOUR[showJobDetail.priority]}`}>{showJobDetail.priority.toUpperCase()}</Badge></div>
                <div className="col-span-2"><span className="text-gray-500">Address:</span> {showJobDetail.address}{showJobDetail.suburb ? `, ${showJobDetail.suburb}` : ''}</div>
                <div><span className="text-gray-500">Noise type:</span> {showJobDetail.noise_type.replace(/_/g,' ')}</div>
                <div><span className="text-gray-500">Created:</span> {formatDateTime(showJobDetail.created_at)}</div>
              </div>
              {/* Officer context panel */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Officer Intelligence</p>
                <div className="flex flex-wrap gap-2">
                  {showJobDetail.has_permanent_end && <Badge className="bg-red-600 text-white">⚠ PERMANENT END IN FORCE</Badge>}
                  {showJobDetail.has_prior_end && !showJobDetail.has_permanent_end && <Badge className="bg-red-100 text-red-700 border-red-200">Prior END</Badge>}
                  {showJobDetail.has_hs_incident && <Badge className="bg-yellow-600 text-white">H&S FLAG</Badge>}
                  {showJobDetail.has_prior_abatement && <Badge className="bg-orange-100 text-orange-700 border-orange-200">Prior AN</Badge>}
                  {showJobDetail.prior_notice_count > 0 && <Badge className="bg-orange-50 text-orange-600 border-orange-200">{showJobDetail.prior_notice_count} prior notices</Badge>}
                  {!showJobDetail.has_prior_end && !showJobDetail.has_hs_incident && showJobDetail.prior_notice_count === 0 && (
                    <span className="text-xs text-gray-400">No prior enforcement history at this address</span>
                  )}
                </div>
                {showJobDetail.safety_notes && (
                  <div className="text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
                    <strong>Safety:</strong> {showJobDetail.safety_notes}
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end">
                <Select onValueChange={v => { updateJobStatusMutation.mutate({ id: showJobDetail.id, status: v }); setShowJobDetail(null) }}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Update status…" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(JOB_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => setShowJobDetail(null)}>Close</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Notice Detail Dialog ─────────────────────────────────────────────── */}
      {showNoticeDetail && (
        <Dialog open onOpenChange={() => setShowNoticeDetail(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{showNoticeDetail.notice_number} — {NOTICE_TYPE[showNoticeDetail.notice_type]?.label}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Type:</span> <Badge className={`text-xs border ${NOTICE_TYPE[showNoticeDetail.notice_type]?.colour}`}>{NOTICE_TYPE[showNoticeDetail.notice_type]?.abbr}</Badge></div>
                <div><span className="text-gray-500">Status:</span> <Badge className={`text-xs border ${NOTICE_STATUS[showNoticeDetail.status]?.colour}`}>{NOTICE_STATUS[showNoticeDetail.status]?.label}</Badge></div>
                <div className="col-span-2"><span className="text-gray-500">Recipient:</span> {showNoticeDetail.recipient_name}</div>
                <div className="col-span-2"><span className="text-gray-500">Address:</span> {showNoticeDetail.recipient_address}</div>
                <div className="col-span-2"><span className="text-gray-500">Offence:</span> {showNoticeDetail.offence_description}</div>
                {showNoticeDetail.penalty_amount_nzd && (
                  <div className="col-span-2 text-red-600"><span className="text-gray-500">Penalty:</span> ${showNoticeDetail.penalty_amount_nzd.toLocaleString()} NZD{showNoticeDetail.daily_penalty_nzd ? ` + $${showNoticeDetail.daily_penalty_nzd}/day ongoing` : ''}</div>
                )}
                <div><span className="text-gray-500">Issued:</span> {formatDateTime(showNoticeDetail.issued_at)}</div>
                {showNoticeDetail.comply_by && <div><span className="text-gray-500">Comply by:</span> {formatDateTime(showNoticeDetail.comply_by)}</div>}
                {showNoticeDetail.issuing_officer_name && <div className="col-span-2"><span className="text-gray-500">Officer:</span> {showNoticeDetail.issuing_officer_name}</div>}
              </div>
              {showNoticeDetail.is_permanent_end && (
                <div className="bg-red-50 border border-red-300 rounded p-2 text-red-700 text-xs">⚠ This is a permanent Enforcement Notice — all future jobs at this address must reference this order.</div>
              )}
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setShowNoticeDetail(null)}>Close</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AppLayout>
  )
}
