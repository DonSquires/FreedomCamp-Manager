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
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { edgeFunctions } from '@/lib/edgeFunctions'
import { FieldSafetyBar } from '@/components/features/FieldSafetyBar'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import { useShiftGate } from '@/hooks/useShiftGate'
import { GeofenceWarningBanner } from '@/components/features/GeofenceWarningBanner'
import {
  Volume2, ShieldAlert, AlertTriangle, FileText, Package,
  CheckCircle, Radio, MapPin, Clock, Camera, Gavel,
  ChevronRight, Info, ArrowRight, RefreshCw, Mic2, Eye,
  XCircle, List, Dog, Users, UserX, Printer, BrainCircuit,
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function NoiseOfficerPortal() {
  const { user } = useAuthStore()
  const { operationalOrganizationId } = useOperationalOrganization()
  const orgId = operationalOrganizationId
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // ── Shift gate: non-rostered officers redirect to /officer-home ───────
  const { gateApplies, canAccessPortal, canUseFeature, geofenceViolation, isLoading: gateLoading } = useShiftGate()
  useEffect(() => {
    if (!gateLoading && gateApplies && (!canAccessPortal || !canUseFeature('noise'))) {
      navigate('/officer-home', { replace: true })
    }
  }, [gateApplies, canAccessPortal, canUseFeature, gateLoading, navigate])

  const speechRecognitionRef = useRef<any>(null)
  const pttBaseNotesRef = useRef('')
  const noiseAudioFileInputRef = useRef<HTMLInputElement | null>(null)

  const [showHelp, setShowHelp] = useState(false)
  const [selectedJob, setSelectedJob] = useState<NoiseJob | null>(null)
  const [tab, setTab] = useState('jobs')
  const [attachedNoiseAudio, setAttachedNoiseAudio] = useState<{ base64: string; mime: string; name: string } | null>(null)

  // Assessment form state
  const [assessment, setAssessment] = useState({
    // Matrix scoring (from NZ council Noise Control Assessment Matrix)
    volume_score: -1 as number,   // -1 = not set; 0=No Noise, 1=Barely, 2=Clearly, 3=Loud, 4=Extremely Loud
    time_score: -1 as number,     // -1 = not set; 1=7am-9pm, 2=9pm-midnight, 3=midnight-2am, 4=2am-7am
    tone_score: -1 as number,     // -1 = not set; 0=No bass, 1=Slight bass, 2=Heavy bass
    // Optional supplementary dB measurement
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

  // Seizure form state — mirrors the "Receipt for Goods Seized" physical form
  const [seizureForm, setSeizureForm] = useState({
    equipment_description: '',
    equipment_type: '',               // e.g. amplifier, speaker, DJ deck
    equipment_make: '',               // brand name
    identification_marks: '',         // serial numbers, stickers
    equipment_count: '1',
    estimated_value_nzd: '',
    equipment_condition: 'good',      // excellent / good / fair / poor
    defects_noted: '',                // pre-existing damage
    owner_name: '',                   // owner if known
    storage_location: '',
    witness_name: '',
    police_present: false,
    police_officer_name: '',
    notes: '',
  })

  const [showNoticeDialog, setShowNoticeDialog] = useState(false)
  const [showSeizureDialog, setShowSeizureDialog] = useState(false)
  const [completedAssessmentId, setCompletedAssessmentId] = useState<string | null>(null)
  const [printHtml, setPrintHtml] = useState<string | null>(null)
  const [printLabel, setPrintLabel] = useState('')
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [isPttSupported, setIsPttSupported] = useState(false)
  const [isPttRecording, setIsPttRecording] = useState(false)

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setIsPttSupported(!!SpeechRecognition)

    return () => {
      try {
        speechRecognitionRef.current?.stop?.()
      } catch {
        // no-op
      }
    }
  }, [])

  const startPushToTalk = () => {
    if (isPttRecording || speechRecognitionRef.current) return
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('Push-to-talk is not supported in this browser')
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.lang = 'en-NZ'
      recognition.continuous = true
      recognition.interimResults = true

      pttBaseNotesRef.current = assessment.action_notes?.trim() || ''

      recognition.onstart = () => {
        setIsPttRecording(true)
      }

      recognition.onresult = (event: any) => {
        let transcript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript
        }
        const cleaned = transcript.trim()
        const combined = pttBaseNotesRef.current
          ? `${pttBaseNotesRef.current} ${cleaned}`.trim()
          : cleaned
        setAssessment(prev => ({ ...prev, action_notes: combined }))
      }

      recognition.onerror = (event: any) => {
        setIsPttRecording(false)
        speechRecognitionRef.current = null
        if (event?.error === 'not-allowed') {
          toast.error('Microphone permission denied')
        } else if (event?.error !== 'aborted') {
          toast.error('Push-to-talk failed to start')
        }
      }

      recognition.onend = () => {
        setIsPttRecording(false)
        speechRecognitionRef.current = null
      }

      speechRecognitionRef.current = recognition
      recognition.start()
    } catch {
      setIsPttRecording(false)
      toast.error('Unable to start push-to-talk')
    }
  }

  const stopPushToTalk = () => {
    if (!isPttRecording) return
    try {
      speechRecognitionRef.current?.stop?.()
      speechRecognitionRef.current = null
    } catch {
      speechRecognitionRef.current = null
      setIsPttRecording(false)
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: myJobs = [], isLoading: jobsLoading, refetch } = useQuery({
    queryKey: ['my_noise_jobs', user?.id, orgId],
    queryFn: async () => {
      if (!orgId || !user?.id) return []
      const { data, error } = await supabase
        .from('noise_jobs')
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
        .from('noise_assessments')
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

  const { data: myNotices = [] } = useQuery({
    queryKey: ['my_noise_notices', user?.id, orgId],
    queryFn: async () => {
      if (!orgId || !user?.id) return []
      const q: any = supabase.from('noise_notices' as any)
        .select('id, notice_number, notice_type, status, recipient_address, created_at')
        .eq('organization_id', orgId)
        .eq('issued_by', user?.id)
        .order('created_at', { ascending: false })
        .limit(20)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    enabled: !!orgId && !!user?.id,
  })

  const { data: mySeizures = [] } = useQuery({
    queryKey: ['my_noise_seizures', user?.id, orgId],
    queryFn: async () => {
      if (!orgId || !user?.id) return []
      const q: any = supabase.from('noise_seizures' as any)
        .select('id, seizure_number, status, equipment_type, equipment_make, seized_at')
        .eq('organization_id', orgId)
        .eq('seized_by', user?.id)
        .order('seized_at', { ascending: false })
        .limit(20)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    enabled: !!orgId && !!user?.id,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const submitAssessmentMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id || !selectedJob) throw new Error('No job selected')
      // Compute matrix total score
      const vol = assessment.volume_score >= 0 ? assessment.volume_score : null
      const tim = (vol !== null && vol > 0 && assessment.time_score >= 1) ? assessment.time_score : (vol === 0 ? 0 : null)
      const ton = assessment.tone_score >= 0 ? assessment.tone_score : null
      const matrixTotal = (vol !== null && tim !== null && ton !== null)
        ? vol + tim + ton
        : null
      // Auto-derive exceeds_district_plan from matrix score
      const exceedsDp = matrixTotal !== null ? matrixTotal >= 5 : assessment.exceeds_district_plan
      const { data, error } = await supabase
        .from('noise_assessments')
        .insert({
          organization_id: orgId,
          noise_job_id: selectedJob.id,
          officer_id: user?.id,
          address: selectedJob.address,
          volume_score: vol,
          time_score: tim,
          tone_score: ton,
          matrix_total_score: matrixTotal,
          noise_level_db: assessment.noise_level_db ? parseFloat(assessment.noise_level_db) : null,
          measurement_method: assessment.measurement_method,
          measurement_location: assessment.measurement_location || null,
          noise_source: assessment.noise_source || null,
          noise_source_address: assessment.noise_source_address || null,
          noise_type: assessment.noise_type || selectedJob.noise_type,
          time_category: assessment.time_category,
          district_plan_limit_db: assessment.district_plan_limit_db ? parseFloat(assessment.district_plan_limit_db) : null,
          exceeds_district_plan: exceedsDp,
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
        .from('noise_jobs')
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
      const vol = assessment.volume_score >= 0 ? assessment.volume_score : 0
      const tim = assessment.time_score >= 1 ? assessment.time_score : 1
      const ton = assessment.tone_score >= 0 ? assessment.tone_score : 0
      const matrixTotal = vol > 0 ? vol + tim + ton : 0
      const isExcessive = matrixTotal >= 5
      const recommendedNoticeType = isExcessive
        ? (assessment.recommended_action === 'verbal_warning' ? 'abatement_notice' : assessment.recommended_action)
        : assessment.recommended_action === 'verbal_warning' ? 'abatement_notice' : assessment.recommended_action
      const scoreDesc = matrixTotal > 0 ? ` Matrix score: ${matrixTotal} (V:${vol}+T:${tim}+B:${ton}).` : ''
      setNoticeForm(p => ({
        ...p,
        notice_type: recommendedNoticeType,
        recipient_name: assessment.responsible_person_name || '',
        rma_section: recommendedNoticeType === 'enforcement_notice' ? 'Section 327 Resource Management Act 1991' : 'RMA s.326(1)(a)',
        comply_by_hours: recommendedNoticeType === 'enforcement_notice' ? '72' : '24',
        offence_description: `Noise exceeding limits at ${selectedJob.address}.${scoreDesc}${assessment.noise_source ? ` Source: ${assessment.noise_source}.` : ''}${assessment.noise_level_db ? ` Estimated ${assessment.noise_level_db} dB(A).` : ''}`.trim(),
      }))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const issueNoticeMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id || !selectedJob) throw new Error('No job selected')
      const { data: noticeNumData, error: noticeNumError } = await supabase.rpc('next_noise_notice_number', { p_org_id: orgId })
      if (noticeNumError) throw noticeNumError
      const noticeNumber: string = noticeNumData
      const isEnd = noticeForm.notice_type === 'enforcement_notice'
      const complyBy = noticeForm.comply_by_hours
        ? new Date(Date.now() + parseInt(noticeForm.comply_by_hours) * 3600_000).toISOString()
        : null
      const { error } = await supabase
        .from('noise_notices')
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
          authority: orgId,
          status: 'issued',
          previous_notice_count: selectedJob.prior_notice_count,
          notes: noticeForm.notes || null,
        })
      if (error) throw error
      // Update job context flags if END issued
      if (isEnd) {
        await supabase
          .from('noise_jobs')
          .update({ has_prior_end: true, updated_at: new Date().toISOString() })
          .eq('id', selectedJob.id)
      }
    },
    onSuccess: () => {
      toast.success('Notice issued successfully')
      setShowNoticeDialog(false)
      queryClient.invalidateQueries({ queryKey: ['noise_notices'] })
      queryClient.invalidateQueries({ queryKey: ['my_noise_notices'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const recordSeizureMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id || !selectedJob) throw new Error('No job selected')
      const { data: seizureNumData, error: seizureNumError } = await supabase.rpc('next_noise_seizure_number', { p_org_id: orgId })
      if (seizureNumError) throw seizureNumError
      const seizureNumber: string = seizureNumData
      const { error } = await supabase
        .from('noise_seizures')
        .insert({
          organization_id: orgId,
          seizure_number: seizureNumber,
          noise_job_id: selectedJob.id,
          address: selectedJob.address,
          equipment_description: seizureForm.equipment_description,
          equipment_type: seizureForm.equipment_type || null,
          equipment_make: seizureForm.equipment_make || null,
          identification_marks: seizureForm.identification_marks || null,
          equipment_count: parseInt(seizureForm.equipment_count) || 1,
          estimated_value_nzd: seizureForm.estimated_value_nzd ? parseFloat(seizureForm.estimated_value_nzd) : null,
          equipment_condition: seizureForm.equipment_condition || null,
          defects_noted: seizureForm.defects_noted || null,
          owner_name: seizureForm.owner_name || null,
          storage_location: seizureForm.storage_location || null,
          seizing_officer_id: user?.id,
          seizing_officer_name: user?.full_name || null,
          witness_name: seizureForm.witness_name || null,
          police_present: seizureForm.police_present,
          police_officer_name: seizureForm.police_present ? (seizureForm.police_officer_name || null) : null,
          rma_authority: 'RMA s.328',
          status: 'held',
        })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Equipment seizure recorded under RMA s.328')
      setShowSeizureDialog(false)
      queryClient.invalidateQueries({ queryKey: ['noise_seizures'] })
      queryClient.invalidateQueries({ queryKey: ['my_noise_seizures'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const aiNoiseAudioAssessMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error('No job selected')
      const observedDb = assessment.noise_level_db ? Number(assessment.noise_level_db) : null
      const { data, error } = await edgeFunctions.noiseAudioAssess({
        transcript: assessment.action_notes || selectedJob.complaint_description || '',
        observed_db: Number.isFinite(observedDb as number) ? (observedDb as number) : null,
        time_category: assessment.time_category as 'day' | 'evening' | 'night',
        location_context: assessment.measurement_location || 'boundary of property',
        complaint_address: selectedJob.address,
        audio_base64: attachedNoiseAudio?.base64 || undefined,
        audio_mime_type: attachedNoiseAudio?.mime || undefined,
        matrix: {
          volume_score: assessment.volume_score,
          time_score: assessment.time_score,
          tone_score: assessment.tone_score,
        },
      })
      if (error) throw new Error(String(error))
      return data as any
    },
    onSuccess: (result) => {
      const prefill = result?.matrix_prefill || {}
      setAssessment((prev) => ({
        ...prev,
        volume_score: typeof prefill.volume_score === 'number' ? prefill.volume_score : prev.volume_score,
        time_score: typeof prefill.time_score === 'number' ? prefill.time_score : prev.time_score,
        tone_score: typeof prefill.tone_score === 'number' ? prefill.tone_score : prev.tone_score,
        recommended_action: result?.recommended_action || prev.recommended_action,
        exceeds_district_plan: typeof result?.exceeds_district_plan === 'boolean' ? result.exceeds_district_plan : prev.exceeds_district_plan,
        noise_type: result?.noise_type || prev.noise_type,
        noise_source: result?.noise_source || prev.noise_source,
        action_notes: [
          prev.action_notes,
          result?.rationale ? `AI audio assessment: ${result.rationale}` : '',
        ].filter(Boolean).join('\n').trim(),
      }))
      toast.success('Audio assessment applied to matrix and recommendation')
    },
    onError: (e: Error) => toast.error(e.message || 'Audio assessment failed'),
  })

  const handleAttachNoiseAudio = async (file: File | null) => {
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const base64 = btoa(binary)
      setAttachedNoiseAudio({
        base64,
        mime: file.type || 'audio/wav',
        name: file.name,
      })
      toast.success('Audio sample attached')
    } catch {
      toast.error('Could not read audio file')
    }
  }

  const completeJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('noise_jobs')
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

  const handlePrintNotice = async (noticeId: string, noticeNumber: string) => {
    if (!user) return
    setPrintingId(noticeId)
    const { data, error } = await edgeFunctions.generateNoiseNotice({
      noise_notice_id: noticeId,
      issued_by: user.id,
    })
    setPrintingId(null)
    if (error || !data?.html) {
      toast.error('Could not generate notice document')
      return
    }
    setPrintLabel(`Notice ${noticeNumber}`)
    setPrintHtml(data.html)
  }

  const handlePrintSeizureReceipt = async (seizureId: string, seizureNumber: string) => {
    if (!user) return
    setPrintingId(seizureId)
    const { data, error } = await edgeFunctions.generateSeizureReceipt({
      noise_seizure_id: seizureId,
      issued_by: user.id,
    })
    setPrintingId(null)
    if (error || !data?.html) {
      toast.error('Could not generate seizure receipt')
      return
    }
    setPrintLabel(`Seizure Receipt ${seizureNumber}`)
    setPrintHtml(data.html)
  }

  return (
    <AppLayout>
      <div className="p-4 space-y-5 max-w-2xl mx-auto">

        {geofenceViolation && <GeofenceWarningBanner />}

        {/* Safety bar — welfare, SOS, quick reports */}
        <FieldSafetyBar compact />

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 rounded-lg">
            <Volume2 className="h-6 w-6 text-orange-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Noise Control Officer</h1>
            <p className="text-sm text-gray-500">Assessment · Notices · Seizures</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowHelp(h => !h)} aria-expanded={showHelp}>
              <Info className="h-4 w-4 mr-1" /> Guide
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* When to use this — contextual help panel */}
        {showHelp && (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm space-y-3">
            <p className="font-semibold text-orange-800">When to use each noise notice</p>
            <ul className="space-y-2 text-orange-900">
              <li><span className="font-medium">Verbal Warning</span> — First contact, noise is currently happening, resident is cooperative. Record in the system. No printed document issued.</li>
              <li><span className="font-medium">Abatement Notice (AN) — RMA s.326</span> — First offence, or verbal warning was ignored. Gives the occupant <span className="font-semibold">24 hours</span> to reduce the noise. Fill in all fields, print, and hand to occupant.</li>
              <li><span className="font-medium">Direction Notice (DN)</span> — Prior AN exists and noise has recurred. Stronger direction requiring immediate compliance.</li>
              <li><span className="font-medium">Enforcement Notice (END) — RMA s.327</span> — Serious, persistent, or uncooperative occupant. Gives <span className="font-semibold">72 hours</span> to comply and grants authority to seize equipment if noise continues after the notice period. Record all equipment seizure details and take photos.</li>
            </ul>
            <p className="text-orange-700 text-xs">Full guide: <code>docs/OFFICER_FIELD_GUIDE_ENFORCEMENT.md</code> · Legal reference: <code>docs/LEGAL_BASIS_REFERENCE.md</code></p>
          </div>
        )}

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

                {/* ── Compliance & Safety Notes (from TDC/NCC Noise Control Officer Guidelines) ── */}
                <Card className="bg-amber-50 border-amber-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-amber-800 flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4" /> Officer Compliance Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5 text-xs text-amber-900">
                    <div className="flex items-start gap-2">
                      <Users className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-700" />
                      <span><strong>No equipment is to be seized, or properties entered, without police being present.</strong></span>
                    </div>
                    <div className="flex items-start gap-2">
                      <UserX className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-700" />
                      <span>Under no circumstances is the complainant to be identified to the offending address.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-700" />
                      <span>If you believe there is a risk to your personal safety, request the police to attend with you.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Dog className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-700" />
                      <span>We do not attend <strong>barking dog complaints</strong> — refer back to TAS as an Animal Control Department issue.</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Assessment form */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mic2 className="h-4 w-4 text-orange-500" /> On-Scene Noise Assessment
                    </CardTitle>
                    <CardDescription>Complete the formal assessment before issuing any notice (NZ council process)</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">

                    {/* ── Noise Control Assessment Matrix ───────────────── */}
                    {(() => {
                      const vol = assessment.volume_score
                      const tim = assessment.time_score
                      const ton = assessment.tone_score
                      const total = (vol > 0 && vol >= 0 && tim >= 1 && ton >= 0)
                        ? vol + tim + ton
                        : (vol === 0 ? 0 : null)
                      const band = total === null ? null
                        : total === 0 ? 'none'
                        : total <= 4 ? 'acceptable'
                        : 'excessive'
                      const bandColour = band === 'excessive' ? 'bg-red-50 border-red-300 text-red-800'
                        : band === 'acceptable' ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
                        : band === 'none' ? 'bg-green-50 border-green-200 text-green-800'
                        : 'bg-gray-50 border-gray-200 text-gray-600'
                      return (
                        <div className="rounded-lg border p-3 space-y-3 bg-orange-50 border-orange-200">
                          <p className="text-xs font-bold text-orange-800 uppercase tracking-wide">Noise Control Assessment Matrix</p>

                          {/* Volume */}
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold text-gray-700">Volume</p>
                            <div className="grid grid-cols-5 gap-1">
                              {[
                                { val: 0, label: 'No Noise' },
                                { val: 1, label: 'Barely Audible' },
                                { val: 2, label: 'Clearly Audible' },
                                { val: 3, label: 'Loud' },
                                { val: 4, label: 'Extremely Loud' },
                              ].map(opt => (
                                <button
                                  key={opt.val}
                                  type="button"
                                  onClick={() => {
                                    setAssessment(p => ({
                                      ...p,
                                      volume_score: opt.val,
                                      // If no noise, time/tone are irrelevant — reset to 0
                                      time_score: opt.val === 0 ? 0 : p.time_score,
                                      tone_score: opt.val === 0 ? 0 : p.tone_score,
                                    }))
                                  }}
                                  className={`rounded p-1.5 text-center text-xs border transition-colors ${assessment.volume_score === opt.val ? 'bg-orange-500 border-orange-600 text-white font-bold' : 'bg-white border-gray-300 text-gray-600 hover:bg-orange-100'}`}
                                >
                                  <div className="font-bold">{opt.val}</div>
                                  <div className="leading-tight" style={{ fontSize: '9px' }}>{opt.label}</div>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Time (only shown if volume > 0) */}
                          {assessment.volume_score > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-gray-700">Time of Day</p>
                              <div className="grid grid-cols-4 gap-1">
                                {[
                                  { val: 1, label: '7am–9pm' },
                                  { val: 2, label: '9pm–midnight' },
                                  { val: 3, label: 'Midnight–2am' },
                                  { val: 4, label: '2am–7am' },
                                ].map(opt => (
                                  <button
                                    key={opt.val}
                                    type="button"
                                    onClick={() => setAssessment(p => ({ ...p, time_score: opt.val }))}
                                    className={`rounded p-1.5 text-center text-xs border transition-colors ${assessment.time_score === opt.val ? 'bg-orange-500 border-orange-600 text-white font-bold' : 'bg-white border-gray-300 text-gray-600 hover:bg-orange-100'}`}
                                  >
                                    <div className="font-bold">{opt.val}</div>
                                    <div className="leading-tight" style={{ fontSize: '9px' }}>{opt.label}</div>
                                  </button>
                                ))}
                              </div>
                              <p className="text-xs text-gray-400 italic">Ignore time rating if No Noise</p>
                            </div>
                          )}

                          {/* Tone/Bass (only shown if volume > 0) */}
                          {assessment.volume_score > 0 && (
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-gray-700">Tone / Bass</p>
                              <div className="grid grid-cols-3 gap-1">
                                {[
                                  { val: 0, label: 'No bass' },
                                  { val: 1, label: 'Slight bass' },
                                  { val: 2, label: 'Heavy bass' },
                                ].map(opt => (
                                  <button
                                    key={opt.val}
                                    type="button"
                                    onClick={() => setAssessment(p => ({ ...p, tone_score: opt.val }))}
                                    className={`rounded p-1.5 text-center text-xs border transition-colors ${assessment.tone_score === opt.val ? 'bg-orange-500 border-orange-600 text-white font-bold' : 'bg-white border-gray-300 text-gray-600 hover:bg-orange-100'}`}
                                  >
                                    <div className="font-bold">{opt.val}</div>
                                    <div className="leading-tight" style={{ fontSize: '9px' }}>{opt.label}</div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Score result */}
                          {total !== null && (
                            <div className={`rounded p-2 border text-sm font-semibold ${bandColour}`}>
                              Score: {total}
                              {' — '}
                              {band === 'none' && 'No Noise · No further action required'}
                              {band === 'acceptable' && 'Noise Acceptable · No further action required'}
                              {band === 'excessive' && 'EXCESSIVE NOISE · Enforcement action required'}
                            </div>
                          )}

                          {/* Guidance for score 5+ */}
                          {band === 'excessive' && (
                            <div className="text-xs text-red-700 space-y-0.5 border border-red-200 rounded p-2 bg-white">
                              <p><strong>Verbal Warning</strong> — if first visit of the night</p>
                              <p><strong>Issue END (s.327)</strong> — if second visit, occupants uncooperative, or problem address</p>
                              <p><strong>Seize equipment</strong> — if END issued within last 72hrs, or permanent Abatement Notice in place</p>
                            </div>
                          )}

                          <div className="pt-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                ref={noiseAudioFileInputRef}
                                type="file"
                                accept="audio/*"
                                className="hidden"
                                onChange={(e) => void handleAttachNoiseAudio(e.target.files?.[0] || null)}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => noiseAudioFileInputRef.current?.click()}
                              >
                                <Mic2 className="h-4 w-4 mr-1.5" />
                                Attach Audio Sample
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => aiNoiseAudioAssessMutation.mutate()}
                                disabled={aiNoiseAudioAssessMutation.isPending}
                              >
                                <BrainCircuit className="h-4 w-4 mr-1.5" />
                                {aiNoiseAudioAssessMutation.isPending ? 'Assessing street audio…' : 'Auto-fill from street audio'}
                              </Button>
                            </div>
                            {attachedNoiseAudio && (
                              <p className="text-[11px] text-gray-500 mt-1">Attached: {attachedNoiseAudio.name}</p>
                            )}
                            <p className="text-[11px] text-gray-500 mt-1">
                              Uses officer transcript/notes + optional dB estimate to prefill the matrix and recommended action.
                            </p>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Measurement */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Estimated dB(A) <span className="text-gray-400 text-xs">(optional)</span></Label>
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
                          <SelectItem value="enforcement_notice">Excessive Noise Direction (END) — s.327 RMA 1991</SelectItem>
                          <SelectItem value="police_referral">Police Referral</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label>Action Notes</Label>
                      <Textarea placeholder="Additional observations, actions taken…" rows={3} value={assessment.action_notes} onChange={e => setAssessment(p => ({ ...p, action_notes: e.target.value }))} />
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          type="button"
                          variant={isPttRecording ? 'destructive' : 'outline'}
                          size="sm"
                          disabled={!isPttSupported}
                          className="select-none"
                          onMouseDown={startPushToTalk}
                          onMouseUp={stopPushToTalk}
                          onMouseLeave={stopPushToTalk}
                          onTouchStart={(e) => {
                            e.preventDefault()
                            startPushToTalk()
                          }}
                          onTouchEnd={(e) => {
                            e.preventDefault()
                            stopPushToTalk()
                          }}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') startPushToTalk()
                          }}
                          onKeyUp={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') stopPushToTalk()
                          }}
                        >
                          <Mic2 className="h-4 w-4 mr-1" />
                          {isPttRecording ? 'Release to stop' : 'Hold to talk'}
                        </Button>
                        <span className="text-xs text-gray-500">
                          {isPttSupported ? 'Press and hold the mic while speaking' : 'Use Chrome/Edge for push-to-talk'}
                        </span>
                      </div>
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
                      {/* Incident Report checklist (from TDC matrix form) */}
                      <div className="rounded-lg border border-green-300 bg-white p-3 space-y-1.5 text-xs">
                        <p className="font-semibold text-green-800 flex items-center gap-1.5 mb-2">
                          <List className="h-3.5 w-3.5" /> Incident Report must include:
                        </p>
                        <div className="flex items-center gap-2 text-gray-700">
                          <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                          <span>Time on site</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-700">
                          <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                          <span>Overall rating score — <strong>
                            {(() => { const tot = (assessment.volume_score >= 0 ? assessment.volume_score : 0) + (assessment.time_score >= 1 ? assessment.time_score : 0) + (assessment.tone_score >= 0 ? assessment.tone_score : 0); return tot === 0 ? '0 — No Noise' : tot <= 4 ? `${tot} — Noise Acceptable` : `${tot} — Excessive Noise` })()}
                          </strong></span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-700">
                          <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                          <span>Action taken — <strong>{assessment.recommended_action?.replace(/_/g,' ') || 'no action'}</strong></span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-700">
                          <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                          <span>Name of officer who attended (auto-recorded)</span>
                        </div>
                        {assessment.recommended_action === 'enforcement_notice' && (
                          <div className="flex items-center gap-2 text-orange-700 font-medium">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span>END issued — include END number and name of occupant in IR</span>
                          </div>
                        )}
                        {(assessment.recommended_action === 'enforcement_notice' || selectedJob.has_permanent_end) && (
                          <div className="flex items-center gap-2 text-red-700 font-medium">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span>If equipment seized — attach photo to IR and complete seizure form</span>
                          </div>
                        )}
                      </div>
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
          <TabsContent value="history" className="mt-4 space-y-4">
            {/* ── My Notices ─────────────────────────────────────── */}
            {myNotices.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Notices Issued</p>
                {myNotices.map((n: any) => {
                  const ABBR: Record<string, string> = { abatement_notice: 'AN', direction_notice: 'DN', enforcement_notice: 'END' }
                  const abbr = ABBR[n.notice_type] ?? 'NO'
                  return (
                    <Card key={n.id}>
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                          <span className="text-xs font-bold text-orange-700">{abbr}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-sm font-semibold text-gray-800">{n.notice_number}</p>
                          <p className="text-xs text-gray-500 truncate">{n.recipient_address}</p>
                          <p className="text-xs text-gray-400">{formatDateTime(n.created_at)}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-shrink-0 text-xs gap-1"
                          disabled={printingId === n.id}
                          onClick={() => handlePrintNotice(n.id, n.notice_number)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                          {printingId === n.id ? 'Loading…' : 'Print'}
                        </Button>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* ── My Seizures ────────────────────────────────────── */}
            {mySeizures.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Seizure Receipts</p>
                {mySeizures.map((s: any) => (
                  <Card key={s.id}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                        <Package className="h-4 w-4 text-red-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-semibold text-gray-800">{s.seizure_number}</p>
                        <p className="text-xs text-gray-600 truncate">{s.equipment_type}{s.equipment_make ? ` · ${s.equipment_make}` : ''}</p>
                        <p className="text-xs text-gray-400">{formatDateTime(s.seized_at)}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-shrink-0 text-xs gap-1 border-red-200 text-red-700 hover:bg-red-50"
                        disabled={printingId === s.id}
                        onClick={() => handlePrintSeizureReceipt(s.id, s.seizure_number)}
                      >
                        <Printer className="h-3.5 w-3.5" />
                        {printingId === s.id ? 'Loading…' : 'Receipt'}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* ── Assessments ─────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Assessments</p>
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
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Print Preview Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!printHtml} onOpenChange={() => setPrintHtml(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-gray-600" /> {printLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-2 mb-3">
            <Button
              size="sm"
              onClick={() => {
                const w = window.open('', '_blank')
                if (w) { w.document.write(printHtml ?? ''); w.document.close(); w.focus(); w.print() }
              }}
            >
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const blob = new Blob([printHtml ?? ''], { type: 'text/html' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${printLabel.replace(/\s+/g, '-')}.html`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              Download HTML
            </Button>
          </div>
          <div className="flex-1 overflow-auto rounded border border-gray-200 bg-white">
            <iframe
              srcDoc={printHtml ?? ''}
              className="w-full"
              style={{ height: '60vh', border: 'none' }}
              title="Notice Preview"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Issue Notice Dialog ──────────────────────────────────────────────── */}
      <Dialog open={showNoticeDialog} onOpenChange={setShowNoticeDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-orange-500" /> Issue Noise Control Notice
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <Label>Notice Type *</Label>
              <Select value={noticeForm.notice_type} onValueChange={v => setNoticeForm(p => ({
                ...p,
                notice_type: v,
                rma_section: v === 'enforcement_notice' ? 'Section 327 Resource Management Act 1991' : 'RMA s.326(1)(a)',
                comply_by_hours: v === 'enforcement_notice' ? '72' : '24',
              }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="abatement_notice">Abatement Notice (AN) — RMA s.326</SelectItem>
                  <SelectItem value="direction_notice">Direction Notice (DN) — immediate direction</SelectItem>
                  <SelectItem value="enforcement_notice">Excessive Noise Direction (END) — s.327 RMA 1991</SelectItem>
                </SelectContent>
              </Select>
              {noticeForm.notice_type === 'enforcement_notice' && (
                <div className="bg-red-50 border border-red-200 rounded p-2 mt-1 space-y-1">
                  <p className="text-xs text-red-700 font-semibold">Excessive Noise Direction (END) — Section 327 RMA 1991</p>
                  <p className="text-xs text-red-600">Directs the occupier to immediately reduce excessive noise. Effective for <strong>72 hours</strong>.</p>
                  <p className="text-xs text-red-600">Failure may result in seizure of noise-causing equipment. Minimum fee to reclaim: <strong>$150</strong>. Maximum fine: <strong>$10,000</strong> plus <strong>$1,000/day</strong> continuing.</p>
                  <p className="text-xs text-red-600">Alternatively, an Infringement Notice ($500) may be issued for non-compliance.</p>
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Package className="h-5 w-5" /> Receipt for Goods Seized — RMA s.328
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">
              <p className="font-semibold">I hereby acknowledge receipt of the following goods seized pursuant to the provisions of the Resource Management Act 1991.</p>
              <p className="mt-1">An authorised officer may seize any item causing excessive noise where an Excessive Noise Direction (s.327) has been issued. Photograph ALL seized equipment. Provide this receipt to the occupant.</p>
              <p className="mt-1 font-semibold">⚠ Goods will not be returned until at least <strong>72 hours</strong> following seizure. A fee of <strong>$150.00</strong> is payable before return of goods.</p>
            </div>

            {/* Address of Property */}
            <div className="space-y-1">
              <Label>Address of Property *</Label>
              <Input placeholder="Address where goods were seized" value={selectedJob?.address || ''} disabled className="bg-gray-50" />
            </div>

            {/* Type and Make */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Type (e.g. amplifier etc.) *</Label>
                <Input placeholder="e.g. amplifier, speakers, DJ deck" value={seizureForm.equipment_type} onChange={e => setSeizureForm(p => ({ ...p, equipment_type: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Make</Label>
                <Input placeholder="e.g. Pioneer, QSC, Sony" value={seizureForm.equipment_make} onChange={e => setSeizureForm(p => ({ ...p, equipment_make: e.target.value }))} />
              </div>
            </div>

            {/* Identification Marks */}
            <div className="space-y-1">
              <Label>Identification Marks (if any)</Label>
              <Input placeholder="Serial numbers, stickers, labels, custom markings" value={seizureForm.identification_marks} onChange={e => setSeizureForm(p => ({ ...p, identification_marks: e.target.value }))} />
            </div>

            {/* Condition */}
            <div className="space-y-1">
              <Label>Condition</Label>
              <Select value={seizureForm.equipment_condition} onValueChange={v => setSeizureForm(p => ({ ...p, equipment_condition: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excellent">Excellent</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Defects */}
            <div className="space-y-1">
              <Label>Note any defects</Label>
              <Input placeholder="Pre-existing damage or defects noted at time of seizure" value={seizureForm.defects_noted} onChange={e => setSeizureForm(p => ({ ...p, defects_noted: e.target.value }))} />
            </div>

            {/* Full description */}
            <div className="space-y-1">
              <Label>Full Equipment Description</Label>
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

            {/* Owner and Storage */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Owner's Name (if known)</Label>
                <Input placeholder="Name of equipment owner" value={seizureForm.owner_name} onChange={e => setSeizureForm(p => ({ ...p, owner_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Storage Location</Label>
                <Input placeholder="e.g. Council depot, Bay 3" value={seizureForm.storage_location} onChange={e => setSeizureForm(p => ({ ...p, storage_location: e.target.value }))} />
              </div>
            </div>

            {/* Witness */}
            <div className="space-y-1">
              <Label>Witness Name</Label>
              <Input placeholder="Name of witness present during seizure" value={seizureForm.witness_name} onChange={e => setSeizureForm(p => ({ ...p, witness_name: e.target.value }))} />
            </div>

            {/* Police present */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={seizureForm.police_present}
                  onChange={e => setSeizureForm(p => ({ ...p, police_present: e.target.checked }))}
                  className="h-4 w-4 rounded"
                />
                Police officer present during seizure
              </label>
              {seizureForm.police_present && (
                <Input placeholder="Police officer name / badge number" value={seizureForm.police_officer_name} onChange={e => setSeizureForm(p => ({ ...p, police_officer_name: e.target.value }))} />
              )}
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
                disabled={recordSeizureMutation.isPending || !seizureForm.equipment_type}
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
