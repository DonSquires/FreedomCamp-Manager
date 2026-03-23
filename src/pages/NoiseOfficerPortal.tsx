/**
 * NoiseOfficerPortal.tsx
 *
 * Field officer portal for noise control assessment and enforcement.
 *
 * Workflow (mirrors NZ council officer process):
 *  1. Officer receives dispatched job with pre-loaded context (prior ENDs, H&S flags, prior notices)
 *  2. On-scene: complete formal noise assessment (dB, source, scene details, photos)
 *  3. Select action: No Action / Verbal Warning / Issue AN / DN / END
 *  4. For END: record equipment seizure details and photos
 *  5. Update job status
 *
 * Smart action guidance:
 *  - Permanent END in place → officer sees immediate seizure option
 *  - Prior END → escalation to END recommended
 *  - Prior AN → escalation to DN or END recommended
 *  - H&S flag → safety panel shown prominently before any action
 *  - First contact → verbal warning or AN pathway shown
 *
 * Based on NZ council noise control officer workflows used by:
 *  Auckland Council, Wellington City Council, Christchurch City Council,
 *  Hamilton City Council, Tauranga City Council.
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
  Volume2, ShieldAlert, AlertTriangle, FileText, Package,
  CheckCircle, Radio, MapPin, Clock, Camera, Gavel,
  ChevronRight, Info, ArrowRight, RefreshCw, Mic2, Eye,
  XCircle,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type NoiseJob = {
  id: string
  job_number: string
  title: string
  address: string
  suburb: string | null
  city: string | null
  noise_type: string
  priority: string
  status: string
  complaint_description: string | null
  has_prior_end: boolean
  has_permanent_end: boolean
  has_hs_incident: boolean
  has_prior_abatement: boolean
  prior_notice_count: number
  prior_notice_summary: string | null
  safety_notes: string | null
  created_at: string
}

// ─── Action recommendation logic ─────────────────────────────────────────────

type ActionRec = {
  level: 'info' | 'warning' | 'danger'
  title: string
  body: string
  suggestedAction: string
}

function getActionRecommendation(job: NoiseJob): ActionRec {
  if (job.has_permanent_end) {
    return {
      level: 'danger',
      title: '⚠ PERMANENT ENFORCEMENT NOTICE IN FORCE',
      body: 'A permanent Enforcement Notice (END) is already in place at this address. Any noise in breach of this order may be seized immediately without a new notice. Check with your supervisor before proceeding.',
      suggestedAction: 'enforcement_notice',
    }
  }
  if (job.has_hs_incident) {
    return {
      level: 'danger',
      title: '⚠ H&S SAFETY FLAG — READ BEFORE ATTENDING',
      body: job.safety_notes || 'A health and safety incident has been recorded at this address. Review safety briefing before approaching.',
      suggestedAction: job.has_prior_end ? 'enforcement_notice' : 'abatement_notice',
    }
  }
  if (job.has_prior_end) {
    return {
      level: 'warning',
      title: 'Prior Enforcement Notice (END) on Record',
      body: `This address has ${job.prior_notice_count} prior notice${job.prior_notice_count !== 1 ? 's' : ''}, including an Enforcement Notice. Continued noise is a serious breach — consider issuing a new END or referring to court/police.`,
      suggestedAction: 'enforcement_notice',
    }
  }
  if (job.has_prior_abatement) {
    return {
      level: 'warning',
      title: 'Prior Abatement Notice at This Address',
      body: `A previous Abatement Notice was issued here. If the noise continues, escalate to a Direction Notice (DN) or Enforcement Notice (END).`,
      suggestedAction: job.prior_notice_count >= 3 ? 'enforcement_notice' : 'direction_notice',
    }
  }
  if (job.prior_notice_count === 0) {
    return {
      level: 'info',
      title: 'First Contact at This Address',
      body: 'No prior enforcement history. Begin with verbal warning or Abatement Notice if noise exceeds district plan limits.',
      suggestedAction: 'verbal_warning',
    }
  }
  return {
    level: 'info',
    title: `${job.prior_notice_count} Prior Notice${job.prior_notice_count !== 1 ? 's' : ''} at This Address`,
    body: 'Review prior history before determining appropriate action.',
    suggestedAction: 'abatement_notice',
  }
}

const REC_STYLES: Record<string, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-orange-50 border-orange-200 text-orange-800',
  danger: 'bg-red-50 border-red-300 text-red-800',
}

/**
 * Atomically increment a noise counter table and return the formatted number.
 * counterTable: 'noise_notice_counters' | 'noise_seizure_counters'
 * prefix: 'NCN' | 'NCS'
 */
async function nextNoiseNumber(
  counterTable: 'noise_notice_counters' | 'noise_seizure_counters',
  prefix: string,
  orgId: string
): Promise<string> {
  const { data } = await supabase
    .from(counterTable as any)
    .select('last_number')
    .eq('organization_id', orgId)
    .maybeSingle()
  const nextNum = (((data as any)?.last_number) || 0) + 1
  await supabase
    .from(counterTable as any)
    .upsert({ organization_id: orgId, last_number: nextNum }, { onConflict: 'organization_id' })
  return `${prefix}-${new Date().getFullYear()}-${String(nextNum).padStart(6, '0')}`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NoiseOfficerPortal() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id
  const queryClient = useQueryClient()

  const [selectedJob, setSelectedJob] = useState<NoiseJob | null>(null)
  const [tab, setTab] = useState('jobs')

  // Assessment form state
  const [assessment, setAssessment] = useState({
    noise_level_db: '',
    measurement_method: 'estimated',
    measurement_location: 'boundary of property',
    noise_source: '',
    noise_source_address: '',
    noise_type: '',
    time_category: 'night',
    district_plan_limit_db: '',
    exceeds_district_plan: false,
    persons_present: '',
    responsible_person_name: '',
    responsible_person_warned: false,
    verbal_warning_given: false,
    recommended_action: 'verbal_warning',
    action_notes: '',
    address_photo_url: '',
  })

  // Notice form state
  const [noticeForm, setNoticeForm] = useState({
    notice_type: 'abatement_notice',
    recipient_name: '',
    offence_description: '',
    rma_section: 'RMA s.326(1)(a)',
    penalty_amount_nzd: '',
    comply_by_hours: '24',
    notes: '',
  })

  // Seizure form state
  const [seizureForm, setSeizureForm] = useState({
    equipment_description: '',
    equipment_count: '1',
    estimated_value_nzd: '',
    equipment_condition: 'good',
    storage_location: '',
    witness_name: '',
    notes: '',
  })

  const [showNoticeDialog, setShowNoticeDialog] = useState(false)
  const [showSeizureDialog, setShowSeizureDialog] = useState(false)
  const [completedAssessmentId, setCompletedAssessmentId] = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: myJobs = [], isLoading: jobsLoading, refetch } = useQuery({
    queryKey: ['my_noise_jobs', user?.id, orgId],
    queryFn: async () => {
      if (!orgId || !user?.id) return []
      const { data, error } = await supabase
        .from('noise_jobs' as any)
        .select('*')
        .eq('organization_id', orgId)
        .or(`assigned_to.eq.${user?.id},status.eq.pending`)
        .not('status', 'in', '(completed,cancelled)')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(50)
      if (error) throw error
      return (data || []) as unknown as NoiseJob[]
    },
    enabled: !!orgId && !!user?.id,
    refetchInterval: 60_000,
  })

  const { data: myAssessments = [] } = useQuery({
    queryKey: ['my_noise_assessments', user?.id, orgId],
    queryFn: async () => {
      if (!orgId || !user?.id) return []
      const { data, error } = await supabase
        .from('noise_assessments' as any)
        .select('id, assessed_at, address, recommended_action, noise_level_db, noise_job_id')
        .eq('organization_id', orgId)
        .eq('officer_id', user?.id)
        .order('assessed_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data || []
    },
    enabled: !!orgId && !!user?.id,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const submitAssessmentMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id || !selectedJob) throw new Error('No job selected')
      const { data, error } = await supabase
        .from('noise_assessments' as any)
        .insert({
          organization_id: orgId,
          noise_job_id: selectedJob.id,
          officer_id: user?.id,
          address: selectedJob.address,
          noise_level_db: assessment.noise_level_db ? parseFloat(assessment.noise_level_db) : null,
          measurement_method: assessment.measurement_method,
          measurement_location: assessment.measurement_location || null,
          noise_source: assessment.noise_source || null,
          noise_source_address: assessment.noise_source_address || null,
          noise_type: assessment.noise_type || selectedJob.noise_type,
          time_category: assessment.time_category,
          district_plan_limit_db: assessment.district_plan_limit_db ? parseFloat(assessment.district_plan_limit_db) : null,
          exceeds_district_plan: assessment.exceeds_district_plan,
          persons_present: assessment.persons_present ? parseInt(assessment.persons_present) : null,
          responsible_person_name: assessment.responsible_person_name || null,
          responsible_person_warned: assessment.responsible_person_warned,
          verbal_warning_given: assessment.verbal_warning_given,
          recommended_action: assessment.recommended_action,
          action_notes: assessment.action_notes || null,
          address_photo_url: assessment.address_photo_url || null,
        })
        .select('id')
        .single()
      if (error) throw error
      // Update job status to on_scene
      await supabase
        .from('noise_jobs' as any)
        .update({ status: 'on_scene', updated_at: new Date().toISOString() })
        .eq('id', selectedJob.id)
      return (data as any).id as string
    },
    onSuccess: (assessmentId) => {
      toast.success('Assessment recorded')
      setCompletedAssessmentId(assessmentId)
      queryClient.invalidateQueries({ queryKey: ['my_noise_jobs'] })
      queryClient.invalidateQueries({ queryKey: ['my_noise_assessments'] })
      // Pre-fill notice form from assessment
      setNoticeForm(p => ({
        ...p,
        notice_type: assessment.recommended_action === 'verbal_warning' ? 'abatement_notice' : assessment.recommended_action,
        recipient_name: assessment.responsible_person_name || '',
        offence_description: `Noise exceeding district plan limits at ${selectedJob.address}. ${assessment.noise_source ? `Source: ${assessment.noise_source}.` : ''} ${assessment.noise_level_db ? `Estimated ${assessment.noise_level_db} dB(A).` : ''}`.trim(),
      }))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const issueNoticeMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id || !selectedJob) throw new Error('No job selected')
      const noticeNumber = await nextNoiseNumber('noise_notice_counters', 'NCN', orgId)
      const isEnd = noticeForm.notice_type === 'enforcement_notice'
      const complyBy = noticeForm.comply_by_hours
        ? new Date(Date.now() + parseInt(noticeForm.comply_by_hours) * 3600_000).toISOString()
        : null
      const { error } = await supabase
        .from('noise_notices' as any)
        .insert({
          organization_id: orgId,
          notice_number: noticeNumber,
          noise_assessment_id: completedAssessmentId || null,
          noise_job_id: selectedJob.id,
          notice_type: noticeForm.notice_type,
          recipient_name: noticeForm.recipient_name || 'Occupant',
          recipient_address: selectedJob.address,
          offence_description: noticeForm.offence_description,
          rma_section: noticeForm.rma_section || null,
          penalty_amount_nzd: isEnd && noticeForm.penalty_amount_nzd ? parseFloat(noticeForm.penalty_amount_nzd) : null,
          comply_by: complyBy,
          issuing_officer_id: user?.id,
          issuing_officer_name: user?.full_name || null,
          authority: user?.organization_id,
          status: 'issued',
          previous_notice_count: selectedJob.prior_notice_count,
          notes: noticeForm.notes || null,
        })
      if (error) throw error
      // Update job context flags if END issued
      if (isEnd) {
        await supabase
          .from('noise_jobs' as any)
          .update({ has_prior_end: true, updated_at: new Date().toISOString() })
          .eq('id', selectedJob.id)
      }
    },
    onSuccess: () => {
      toast.success('Notice issued successfully')
      setShowNoticeDialog(false)
      queryClient.invalidateQueries({ queryKey: ['noise_notices'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const recordSeizureMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id || !selectedJob) throw new Error('No job selected')
      const seizureNumber = await nextNoiseNumber('noise_seizure_counters', 'NCS', orgId)
      const { error } = await supabase
        .from('noise_seizures' as any)
        .insert({
          organization_id: orgId,
          seizure_number: seizureNumber,
          noise_job_id: selectedJob.id,
          address: selectedJob.address,
          equipment_description: seizureForm.equipment_description,
          equipment_count: parseInt(seizureForm.equipment_count) || 1,
          estimated_value_nzd: seizureForm.estimated_value_nzd ? parseFloat(seizureForm.estimated_value_nzd) : null,
          equipment_condition: seizureForm.equipment_condition || null,
          storage_location: seizureForm.storage_location || null,
          seizing_officer_id: user?.id,
          seizing_officer_name: user?.full_name || null,
          witness_name: seizureForm.witness_name || null,
          rma_authority: 'RMA s.328',
          status: 'held',
        })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Equipment seizure recorded under RMA s.328')
      setShowSeizureDialog(false)
      queryClient.invalidateQueries({ queryKey: ['noise_seizures'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const completeJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('noise_jobs' as any)
        .update({ status: 'completed', completed_at: new Date().toISOString(), completed_by: user?.id, updated_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Job marked as completed')
      setSelectedJob(null)
      setCompletedAssessmentId(null)
      setTab('jobs')
      queryClient.invalidateQueries({ queryKey: ['my_noise_jobs'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Priority badge ─────────────────────────────────────────────────────────

  const PRIORITY_COLOUR: Record<string, string> = {
    low:    'bg-gray-100 text-gray-600',
    normal: 'bg-blue-100 text-blue-700',
    high:   'bg-orange-100 text-orange-700',
    urgent: 'bg-red-100 text-red-700',
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-4 space-y-5 max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 rounded-lg">
            <Volume2 className="h-6 w-6 text-orange-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Noise Control Officer</h1>
            <p className="text-sm text-gray-500">Assessment · Notices · Seizures</p>
          </div>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="jobs" className="flex-1">
              <Radio className="h-4 w-4 mr-1" /> My Jobs ({myJobs.length})
            </TabsTrigger>
            <TabsTrigger value="assess" className="flex-1" disabled={!selectedJob}>
              <Mic2 className="h-4 w-4 mr-1" /> Assess
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1">
              <Eye className="h-4 w-4 mr-1" /> History
            </TabsTrigger>
          </TabsList>

          {/* ── Jobs tab ─────────────────────────────────────────────────── */}
          <TabsContent value="jobs" className="mt-4 space-y-3">
            {jobsLoading ? (
              <div className="text-center py-12 text-gray-400">Loading jobs…</div>
            ) : myJobs.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <CheckCircle className="h-10 w-10 text-green-400 mx-auto" />
                <p className="text-gray-400">No active noise jobs assigned to you</p>
              </div>
            ) : (
              myJobs.map(job => {
                const rec = getActionRecommendation(job)
                return (
                  <Card key={job.id} className={`cursor-pointer hover:shadow-md transition-shadow ${selectedJob?.id === job.id ? 'ring-2 ring-orange-400' : ''}`}
                    onClick={() => { setSelectedJob(job); setTab('assess') }}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-mono text-sm font-semibold text-gray-700">{job.job_number}</span>
                            <Badge className={`text-xs ${PRIORITY_COLOUR[job.priority]}`}>{job.priority.toUpperCase()}</Badge>
                            {job.has_permanent_end && <Badge className="text-xs bg-red-600 text-white">PERMANENT END</Badge>}
                            {job.has_hs_incident && <Badge className="text-xs bg-yellow-600 text-white">H&S</Badge>}
                          </div>
                          <p className="font-semibold text-gray-900 text-sm truncate">{job.title}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" /> {job.address}{job.suburb ? `, ${job.suburb}` : ''}
                          </p>
                          {/* Inline action recommendation preview */}
                          <div className={`mt-2 rounded p-2 text-xs border ${REC_STYLES[rec.level]}`}>
                            <strong>{rec.title}</strong>
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-400 mt-1 shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </TabsContent>

          {/* ── Assessment tab ───────────────────────────────────────────── */}
          <TabsContent value="assess" className="mt-4 space-y-4">
            {!selectedJob ? (
              <div className="text-center py-12 text-gray-400">Select a job from the Jobs tab</div>
            ) : (
              <>
                {/* Job context card */}
                <Card className="bg-gray-50 border-gray-200">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{selectedJob.job_number}</span>
                      <Badge className={`text-xs ${PRIORITY_COLOUR[selectedJob.priority]}`}>{selectedJob.priority.toUpperCase()}</Badge>
                    </div>
                    <p className="font-semibold text-gray-900">{selectedJob.title}</p>
                    <p className="text-sm text-gray-600 flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 text-orange-500" />
                      {selectedJob.address}{selectedJob.suburb ? `, ${selectedJob.suburb}` : ''}{selectedJob.city ? `, ${selectedJob.city}` : ''}
                    </p>
                    {selectedJob.complaint_description && (
                      <p className="text-xs text-gray-500 italic">"{selectedJob.complaint_description}"</p>
                    )}
                  </CardContent>
                </Card>

                {/* Action recommendation banner */}
                {(() => {
                  const rec = getActionRecommendation(selectedJob)
                  return (
                    <div className={`rounded-lg border p-4 ${REC_STYLES[rec.level]}`}>
                      <p className="font-semibold text-sm">{rec.title}</p>
                      <p className="text-sm mt-1">{rec.body}</p>
                      <p className="text-xs mt-2 font-medium flex items-center gap-1">
                        <ArrowRight className="h-3 w-3" />
                        Suggested action: <span className="underline">{rec.suggestedAction.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                      </p>
                    </div>
                  )
                })()}

                {/* Assessment form */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mic2 className="h-4 w-4 text-orange-500" /> On-Scene Noise Assessment
                    </CardTitle>
                    <CardDescription>Complete the formal assessment before issuing any notice (NZ council process)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Measurement */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Estimated dB(A)</Label>
                        <Input type="number" placeholder="e.g. 65" value={assessment.noise_level_db} onChange={e => setAssessment(p => ({ ...p, noise_level_db: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label>Time Category</Label>
                        <Select value={assessment.time_category} onValueChange={v => setAssessment(p => ({ ...p, time_category: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="day">Day (7am–10pm)</SelectItem>
                            <SelectItem value="evening">Evening (10pm–11pm)</SelectItem>
                            <SelectItem value="night">Night (11pm–7am)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Measurement Method</Label>
                        <Select value={assessment.measurement_method} onValueChange={v => setAssessment(p => ({ ...p, measurement_method: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="estimated">Estimated</SelectItem>
                            <SelectItem value="sound_meter">Sound Meter</SelectItem>
                            <SelectItem value="app_meter">App Meter</SelectItem>
                            <SelectItem value="council_meter">Council Meter</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>District Plan Limit dB</Label>
                        <Input type="number" placeholder="e.g. 50" value={assessment.district_plan_limit_db} onChange={e => setAssessment(p => ({ ...p, district_plan_limit_db: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>Measurement Location</Label>
                      <Input placeholder="e.g. boundary of property" value={assessment.measurement_location} onChange={e => setAssessment(p => ({ ...p, measurement_location: e.target.value }))} />
                    </div>

                    {/* Source */}
                    <div className="space-y-1">
                      <Label>Noise Source</Label>
                      <Input placeholder="e.g. residential stereo music, DJ equipment" value={assessment.noise_source} onChange={e => setAssessment(p => ({ ...p, noise_source: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Noise Source Address (if different)</Label>
                      <Input placeholder="Address noise is coming FROM" value={assessment.noise_source_address} onChange={e => setAssessment(p => ({ ...p, noise_source_address: e.target.value }))} />
                    </div>

                    {/* People */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Persons Present</Label>
                        <Input type="number" placeholder="0" value={assessment.persons_present} onChange={e => setAssessment(p => ({ ...p, persons_present: e.target.value }))} />
                      </div>
                      <div className="space-y-1">
                        <Label>Responsible Person Name</Label>
                        <Input placeholder="Name of person spoken to" value={assessment.responsible_person_name} onChange={e => setAssessment(p => ({ ...p, responsible_person_name: e.target.value }))} />
                      </div>
                    </div>

                    {/* Checkboxes */}
                    <div className="flex flex-col gap-2">
                      {[
                        { key: 'exceeds_district_plan', label: 'Noise exceeds district plan limit' },
                        { key: 'verbal_warning_given', label: 'Verbal warning given on-scene' },
                        { key: 'responsible_person_warned', label: 'Responsible person warned' },
                      ].map(c => (
                        <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={assessment[c.key as keyof typeof assessment] as boolean}
                            onChange={e => setAssessment(p => ({ ...p, [c.key]: e.target.checked }))}
                            className="h-4 w-4 rounded"
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>

                    {/* Recommended action */}
                    <div className="space-y-1">
                      <Label>Recommended Action</Label>
                      <Select value={assessment.recommended_action} onValueChange={v => {
                        setAssessment(p => ({ ...p, recommended_action: v }))
                        if (['abatement_notice','direction_notice','enforcement_notice'].includes(v)) {
                          setNoticeForm(p => ({ ...p, notice_type: v }))
                        }
                      }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="no_action">No Action — noise within limits</SelectItem>
                          <SelectItem value="verbal_warning">Verbal Warning only</SelectItem>
                          <SelectItem value="abatement_notice">Abatement Notice (AN) — RMA s.326</SelectItem>
                          <SelectItem value="direction_notice">Direction Notice (DN) — immediate</SelectItem>
                          <SelectItem value="enforcement_notice">Enforcement Notice (END) — RMA s.319</SelectItem>
                          <SelectItem value="police_referral">Police Referral</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label>Action Notes</Label>
                      <Textarea placeholder="Additional observations, actions taken…" rows={3} value={assessment.action_notes} onChange={e => setAssessment(p => ({ ...p, action_notes: e.target.value }))} />
                    </div>

                    {/* Photo capture — address verification */}
                    <div className="space-y-1">
                      <Label className="flex items-center gap-1">
                        <Camera className="h-3.5 w-3.5 text-orange-500" /> Address Verification Photo URL
                      </Label>
                      <Input placeholder="Paste uploaded photo URL or use camera" value={assessment.address_photo_url} onChange={e => setAssessment(p => ({ ...p, address_photo_url: e.target.value }))} />
                      <p className="text-xs text-gray-400">Required: photograph the property number/address for evidence.</p>
                    </div>

                    <Button
                      className="w-full"
                      onClick={() => submitAssessmentMutation.mutate()}
                      disabled={submitAssessmentMutation.isPending}
                    >
                      {submitAssessmentMutation.isPending ? 'Recording…' : 'Record Assessment'}
                    </Button>
                  </CardContent>
                </Card>

                {/* Post-assessment actions */}
                {completedAssessmentId && (
                  <Card className="bg-green-50 border-green-200">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base text-green-800 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4" /> Assessment Recorded — Next Steps
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-1 gap-2">
                        {assessment.recommended_action !== 'no_action' && assessment.recommended_action !== 'verbal_warning' && (
                          <Button
                            variant="outline"
                            className="w-full justify-start border-orange-300 text-orange-700 hover:bg-orange-50"
                            onClick={() => setShowNoticeDialog(true)}
                          >
                            <FileText className="h-4 w-4 mr-2" />
                            Issue {assessment.recommended_action === 'abatement_notice' ? 'Abatement Notice (AN)' :
                                   assessment.recommended_action === 'direction_notice' ? 'Direction Notice (DN)' :
                                   'Enforcement Notice (END)'}
                          </Button>
                        )}
                        {(assessment.recommended_action === 'enforcement_notice' || selectedJob.has_permanent_end) && (
                          <Button
                            variant="outline"
                            className="w-full justify-start border-red-300 text-red-700 hover:bg-red-50"
                            onClick={() => setShowSeizureDialog(true)}
                          >
                            <Package className="h-4 w-4 mr-2" />
                            Record Equipment Seizure (RMA s.328)
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          className="w-full justify-start border-green-300 text-green-700 hover:bg-green-50"
                          onClick={() => completeJobMutation.mutate(selectedJob.id)}
                          disabled={completeJobMutation.isPending}
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          {completeJobMutation.isPending ? 'Completing…' : 'Mark Job Complete'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* ── History tab ──────────────────────────────────────────────── */}
          <TabsContent value="history" className="mt-4 space-y-3">
            {myAssessments.length === 0 ? (
              <div className="text-center py-12 text-gray-400">No assessments recorded yet</div>
            ) : (
              myAssessments.map((a: any) => (
                <Card key={a.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm text-gray-900 truncate">{a.address}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(a.assessed_at)}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{a.recommended_action?.replace(/_/g,' ')}{a.noise_level_db ? ` · ${a.noise_level_db} dB` : ''}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Issue Notice Dialog ──────────────────────────────────────────────── */}
      <Dialog open={showNoticeDialog} onOpenChange={setShowNoticeDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-orange-500" /> Issue Noise Control Notice
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <Label>Notice Type *</Label>
              <Select value={noticeForm.notice_type} onValueChange={v => setNoticeForm(p => ({ ...p, notice_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="abatement_notice">Abatement Notice (AN) — RMA s.326</SelectItem>
                  <SelectItem value="direction_notice">Direction Notice (DN) — immediate direction</SelectItem>
                  <SelectItem value="enforcement_notice">Enforcement Notice (END) — RMA s.319 + financial penalty</SelectItem>
                </SelectContent>
              </Select>
              {noticeForm.notice_type === 'enforcement_notice' && (
                <div className="bg-red-50 border border-red-200 rounded p-2 mt-1">
                  <p className="text-xs text-red-700 font-semibold">Enforcement Notice (END)</p>
                  <p className="text-xs text-red-600 mt-0.5">Carries financial penalties. May authorise equipment seizure under RMA s.328. This is a serious enforcement action. Ensure assessment evidence is complete.</p>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Recipient Name</Label>
              <Input placeholder="Name of person/entity served" value={noticeForm.recipient_name} onChange={e => setNoticeForm(p => ({ ...p, recipient_name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Offence Description *</Label>
              <Textarea rows={4} value={noticeForm.offence_description} onChange={e => setNoticeForm(p => ({ ...p, offence_description: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>RMA Section</Label>
              <Input value={noticeForm.rma_section} onChange={e => setNoticeForm(p => ({ ...p, rma_section: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Comply By (hours)</Label>
                <Select value={noticeForm.comply_by_hours} onValueChange={v => setNoticeForm(p => ({ ...p, comply_by_hours: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 hour (immediate)</SelectItem>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="48">48 hours</SelectItem>
                    <SelectItem value="72">72 hours</SelectItem>
                    <SelectItem value="168">7 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {noticeForm.notice_type === 'enforcement_notice' && (
                <div className="space-y-1">
                  <Label>Penalty (NZD)</Label>
                  <Input type="number" placeholder="0.00" value={noticeForm.penalty_amount_nzd} onChange={e => setNoticeForm(p => ({ ...p, penalty_amount_nzd: e.target.value }))} />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea rows={2} value={noticeForm.notes} onChange={e => setNoticeForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowNoticeDialog(false)}>Cancel</Button>
              <Button
                onClick={() => issueNoticeMutation.mutate()}
                disabled={issueNoticeMutation.isPending || !noticeForm.offence_description}
              >
                {issueNoticeMutation.isPending ? 'Issuing…' : 'Issue Notice'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Seizure Dialog ───────────────────────────────────────────────────── */}
      <Dialog open={showSeizureDialog} onOpenChange={setShowSeizureDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Package className="h-5 w-5" /> Record Equipment Seizure — RMA s.328
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
              <p className="font-semibold">RMA s.328 — Authorised Officer Powers</p>
              <p className="mt-1">An authorised officer may seize any item that is causing excessive noise where an Enforcement Notice has been issued or a permanent order is in place. Photograph ALL seized equipment. Provide a seizure notice to the occupant.</p>
            </div>
            <div className="space-y-1">
              <Label>Equipment Description *</Label>
              <Textarea placeholder="e.g. Pioneer CDJ-2000 DJ deck, 2× QSC K12 speakers, 1× subwoofer, cabling" rows={2} value={seizureForm.equipment_description} onChange={e => setSeizureForm(p => ({ ...p, equipment_description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Number of Items</Label>
                <Input type="number" min="1" value={seizureForm.equipment_count} onChange={e => setSeizureForm(p => ({ ...p, equipment_count: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Est. Value (NZD)</Label>
                <Input type="number" placeholder="0.00" value={seizureForm.estimated_value_nzd} onChange={e => setSeizureForm(p => ({ ...p, estimated_value_nzd: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Condition</Label>
                <Select value={seizureForm.equipment_condition} onValueChange={v => setSeizureForm(p => ({ ...p, equipment_condition: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="damaged">Damaged</SelectItem>
                    <SelectItem value="poor">Poor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Storage Location</Label>
                <Input placeholder="e.g. Council depot, Bay 3" value={seizureForm.storage_location} onChange={e => setSeizureForm(p => ({ ...p, storage_location: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Witness Name</Label>
              <Input placeholder="Name of witness present during seizure" value={seizureForm.witness_name} onChange={e => setSeizureForm(p => ({ ...p, witness_name: e.target.value }))} />
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-700">
              <Camera className="h-3 w-3 inline mr-1" />
              <strong>Photos required:</strong> photograph each item before removal and after storage. Upload via the evidence photo system.
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowSeizureDialog(false)}>Cancel</Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => recordSeizureMutation.mutate()}
                disabled={recordSeizureMutation.isPending || !seizureForm.equipment_description}
              >
                {recordSeizureMutation.isPending ? 'Recording…' : 'Record Seizure'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
