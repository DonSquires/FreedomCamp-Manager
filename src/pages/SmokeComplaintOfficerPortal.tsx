/**
 * SmokeComplaintOfficerPortal.tsx
 *
 * Field officer portal for Smoke Complaint Out-of-Hours (OOH) enforcement
 * under RMA s.17A (Duty to avoid, remedy or mitigate adverse effects).
 *
 * Workflow:
 *  1. Officer receives dispatched smoke_job
 *  2. On-scene: complete 6-step assessment (GPS, media, Bob AI, checklist, action, notice)
 *  3. Select action: No Action / Verbal Warning / Abatement Notice / Infringement / Prosecution
 *  4. For notices: generate via smoke-notice edge function
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { AppLayout } from '@/components/features/AppLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import { useShiftGate } from '@/hooks/useShiftGate'
import {
  Wind, Flame, AlertTriangle, MapPin, Camera, FileText,
  CheckCircle, Info, ChevronRight, RefreshCw, Printer,
  Plus, X, Loader2, Eye,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type SmokeJob = {
  id: string
  job_number: string
  title: string
  address: string
  suburb: string | null
  complaint_source: string
  priority: string
  status: string
  is_out_of_hours: boolean
  has_prior_notice: boolean
  has_repeat_offender: boolean
  safety_notes: string | null
  complaint_description: string | null
  complaint_time: string
  created_at: string
}

type AssessmentState = {
  job_id: string
  address: string
  gps_lat: number | null
  gps_lng: number | null
  image_base64: string | null
  video_note: string
  complaint_time: string
  // checklist
  is_out_of_hours: boolean
  smoke_opacity: string
  smoke_color: string
  is_continuous: boolean
  duration_minutes: string
  prohibited_materials: string[]
  odor_type: string
  odor_offensive: boolean
  wind_speed: string
  wind_direction: string
  smoke_drift_direction: string
  affecting_neighbors: boolean
  affecting_road: boolean
  neighbor_impact_description: string
  sample_taken: boolean
  sample_type: string
  officer_opinion: string
  // action
  action: string
  // notice
  recipient_name: string
  recipient_address: string
  comply_by: string
  offence_description: string
  rma_section: string
  penalty_amount_nzd: string
}

type AiResult = {
  smoke_opacity: string | null
  smoke_color: string | null
  prohibited_materials_suspected: string[]
  offensive_rating: number
  ai_caution: string | null
}

const PROHIBITED_ITEMS = [
  { id: 'treated_timber', label: 'Treated Timber' },
  { id: 'plastics', label: 'Plastics' },
  { id: 'rubber_tyres', label: 'Rubber Tyres' },
  { id: 'green_waste', label: 'Green Waste' },
  { id: 'household_rubbish', label: 'Household Rubbish' },
  { id: 'chemicals', label: 'Chemicals' },
]

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  assigned: 'bg-blue-100 text-blue-800',
  en_route: 'bg-indigo-100 text-indigo-800',
  on_scene: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-700',
  referred: 'bg-orange-100 text-orange-800',
}

const PRIORITY_BADGE: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-red-100 text-red-800',
}

function offensiveRatingColor(rating: number) {
  if (rating <= 2) return 'bg-green-500'
  if (rating === 3) return 'bg-amber-400'
  return 'bg-red-500'
}

function initAssessment(job: SmokeJob): AssessmentState {
  return {
    job_id: job.id,
    address: job.address,
    gps_lat: null,
    gps_lng: null,
    image_base64: null,
    video_note: '',
    complaint_time: job.complaint_time,
    is_out_of_hours: job.is_out_of_hours,
    smoke_opacity: '',
    smoke_color: '',
    is_continuous: true,
    duration_minutes: '',
    prohibited_materials: [],
    odor_type: '',
    odor_offensive: false,
    wind_speed: '',
    wind_direction: '',
    smoke_drift_direction: '',
    affecting_neighbors: false,
    affecting_road: false,
    neighbor_impact_description: '',
    sample_taken: false,
    sample_type: '',
    officer_opinion: '',
    action: '',
    recipient_name: '',
    recipient_address: job.address,
    comply_by: '',
    offence_description: '',
    rma_section: 'RMA s.17A',
    penalty_amount_nzd: '',
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SmokeComplaintOfficerPortal() {
  const { user } = useAuthStore()
  const { operationalOrganizationId } = useOperationalOrganization()
  const orgId = operationalOrganizationId
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { gateApplies, canAccessPortal, canUseFeature, isLoading: gateLoading } = useShiftGate()
  useEffect(() => {
    if (!gateLoading && gateApplies && (!canAccessPortal || !canUseFeature('smoke_complaint_ooh'))) {
      navigate('/officer-home', { replace: true })
    }
  }, [gateApplies, canAccessPortal, canUseFeature, gateLoading, navigate])

  const [tab, setTab] = useState('jobs')
  const [selectedJob, setSelectedJob] = useState<SmokeJob | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [state, setState] = useState<AssessmentState | null>(null)
  const [aiResult, setAiResult] = useState<AiResult | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [printingId, setPrintingId] = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: myJobs = [], isLoading: jobsLoading, refetch } = useQuery({
    queryKey: ['my_smoke_jobs', user?.id, orgId],
    queryFn: async () => {
      if (!orgId || !user?.id) return []
      const { data, error } = await supabase
        .from('smoke_jobs' as any)
        .select('*')
        .eq('organization_id', orgId)
        .eq('assigned_to', user.id)
        .not('status', 'in', '(completed,cancelled)')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(50)
      if (error) throw error
      return (data || []) as unknown as SmokeJob[]
    },
    enabled: !!orgId && !!user?.id,
    refetchInterval: 60_000,
  })

  const { data: completedJobs = [] } = useQuery({
    queryKey: ['completed_smoke_jobs', user?.id, orgId],
    queryFn: async () => {
      if (!orgId || !user?.id) return []
      const { data, error } = await supabase
        .from('smoke_jobs' as any)
        .select('*')
        .eq('organization_id', orgId)
        .eq('assigned_to', user.id)
        .in('status', ['completed', 'cancelled', 'referred'])
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data || []) as unknown as SmokeJob[]
    },
    enabled: !!orgId && !!user?.id,
  })

  // ── Mutations ──────────────────────────────────────────────────────────────

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id || !selectedJob || !state) throw new Error('Missing data')
      const actionStatus: Record<string, string> = {
        no_action: 'completed',
        verbal_warning: 'completed',
        abatement_notice: 'completed',
        infringement_notice: 'completed',
        prosecution_referral: 'referred',
      }
      // Save assessment
      const { error: aErr } = await supabase
        .from('smoke_assessments' as any)
        .insert({
          organization_id: orgId,
          smoke_job_id: selectedJob.id,
          officer_id: user.id,
          address: state.address,
          gps_lat: state.gps_lat,
          gps_lng: state.gps_lng,
          is_out_of_hours: state.is_out_of_hours,
          smoke_opacity: state.smoke_opacity || null,
          smoke_color: state.smoke_color || null,
          is_continuous: state.is_continuous,
          duration_minutes: state.duration_minutes ? parseInt(state.duration_minutes) : null,
          prohibited_materials: state.prohibited_materials,
          odor_type: state.odor_type || null,
          odor_offensive: state.odor_offensive,
          wind_speed: state.wind_speed ? parseFloat(state.wind_speed) : null,
          wind_direction: state.wind_direction || null,
          smoke_drift_direction: state.smoke_drift_direction || null,
          affecting_neighbors: state.affecting_neighbors,
          affecting_road: state.affecting_road,
          neighbor_impact_description: state.neighbor_impact_description || null,
          sample_taken: state.sample_taken,
          sample_type: state.sample_taken ? state.sample_type || null : null,
          officer_opinion: state.officer_opinion,
          action_taken: state.action,
          ai_offensive_rating: aiResult?.offensive_rating ?? null,
        })
      if (aErr) throw aErr
      // Update job status
      await supabase
        .from('smoke_jobs' as any)
        .update({ status: actionStatus[state.action] ?? 'completed', updated_at: new Date().toISOString() })
        .eq('id', selectedJob.id)
    },
    onSuccess: () => {
      toast.success('Assessment saved successfully')
      queryClient.invalidateQueries({ queryKey: ['my_smoke_jobs'] })
      queryClient.invalidateQueries({ queryKey: ['completed_smoke_jobs'] })
      setDialogOpen(false)
      setSelectedJob(null)
      setState(null)
      setAiResult(null)
      setStep(1)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const generateNoticeMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id || !selectedJob || !state) throw new Error('Missing data')
      const { data, error } = await supabase.functions.invoke('smoke-notice', {
        body: {
          organization_id: orgId,
          smoke_job_id: selectedJob.id,
          officer_id: user.id,
          notice_type: state.action,
          recipient_name: state.recipient_name,
          recipient_address: state.recipient_address || state.address,
          comply_by: state.comply_by || null,
          offence_description: state.offence_description,
          rma_section: state.rma_section,
          penalty_amount_nzd: state.penalty_amount_nzd ? parseFloat(state.penalty_amount_nzd) : null,
        },
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      toast.success('Notice generated')
      if (data?.notice_number) {
        toast.info(`Notice #${data.notice_number} created`)
      }
    },
    onError: (e: Error) => toast.error(`Notice generation failed: ${e.message}`),
  })

  // ── GPS helper ─────────────────────────────────────────────────────────────

  const grabGPS = () => {
    if (!navigator.geolocation) { toast.error('GPS not available'); return }
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState(prev => prev ? {
          ...prev,
          gps_lat: pos.coords.latitude,
          gps_lng: pos.coords.longitude,
        } : prev)
        setGpsLoading(false)
        toast.success('GPS location captured')
      },
      () => { setGpsLoading(false); toast.error('GPS unavailable') },
      { timeout: 10_000 },
    )
  }

  // ── Photo helper ───────────────────────────────────────────────────────────

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const b64 = (reader.result as string).split(',')[1]
      setState(prev => prev ? { ...prev, image_base64: b64 } : prev)
    }
    reader.readAsDataURL(file)
  }

  // ── Bob AI analysis ────────────────────────────────────────────────────────

  const runAiAnalysis = async () => {
    if (!state) return
    setAiLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('smoke-assess', {
        body: {
          job_id: state.job_id,
          image_base64: state.image_base64,
          gps_lat: state.gps_lat,
          gps_lng: state.gps_lng,
          address: state.address,
          complaint_time: state.complaint_time,
        },
      })
      if (error) throw error
      const result: AiResult = {
        smoke_opacity: data?.assessment?.smoke_opacity ?? null,
        smoke_color: data?.assessment?.smoke_color ?? null,
        prohibited_materials_suspected: data?.assessment?.prohibited_materials_suspected ?? [],
        offensive_rating: data?.assessment?.offensive_rating ?? 0,
        ai_caution: data?.assessment?.ai_caution ?? null,
      }
      setAiResult(result)
      // Pre-fill checklist from AI
      if (data?.checklist_prefill) {
        const pf = data.checklist_prefill
        setState(prev => prev ? {
          ...prev,
          smoke_opacity: pf.smoke_opacity || prev.smoke_opacity,
          smoke_color: pf.smoke_color || prev.smoke_color,
          prohibited_materials: pf.prohibited_materials || prev.prohibited_materials,
          odor_type: pf.odor_type || prev.odor_type,
          wind_speed: pf.wind_speed?.toString() || prev.wind_speed,
          wind_direction: pf.wind_direction || prev.wind_direction,
        } : prev)
      }
      // Pre-fill weather
      if (data?.weather) {
        const w = data.weather
        setState(prev => prev ? {
          ...prev,
          wind_speed: w.wind_speed_kmh?.toString() || prev.wind_speed,
          wind_direction: w.wind_direction || prev.wind_direction,
        } : prev)
      }
      toast.success('Bob AI analysis complete')
    } catch (e: any) {
      toast.error(`AI analysis failed: ${e.message}`)
    } finally {
      setAiLoading(false)
    }
  }

  // ── Open assessment dialog ─────────────────────────────────────────────────

  const openAssessment = (job: SmokeJob) => {
    setSelectedJob(job)
    setState(initAssessment(job))
    setAiResult(null)
    setStep(1)
    setDialogOpen(true)
  }

  const needsNoticeForm = state?.action === 'abatement_notice' || state?.action === 'infringement_notice'

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderJobCard = (job: SmokeJob) => (
    <Card key={job.id} className="border-amber-200 hover:border-amber-400 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-semibold text-sm text-amber-900">{job.job_number}</span>
              <Badge className={STATUS_BADGE[job.status] ?? 'bg-gray-100 text-gray-700'}>
                {job.status.replace('_', ' ')}
              </Badge>
              <Badge className={PRIORITY_BADGE[job.priority] ?? 'bg-gray-100 text-gray-700'}>
                {job.priority}
              </Badge>
              {job.is_out_of_hours && (
                <Badge className="bg-amber-500 text-white font-bold text-xs">OUT OF HOURS</Badge>
              )}
              {job.has_repeat_offender && (
                <Badge className="bg-red-100 text-red-800 text-xs">REPEAT</Badge>
              )}
            </div>
            <p className="text-sm font-medium truncate">{job.title}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" />
              {job.address}{job.suburb ? `, ${job.suburb}` : ''}
            </p>
            {job.safety_notes && (
              <p className="text-xs text-red-700 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {job.safety_notes}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Received: {formatDateTime(job.created_at)}
            </p>
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
            onClick={() => openAssessment(job)}
          >
            Assess <ChevronRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  // ── Step renderer ──────────────────────────────────────────────────────────

  const renderStep = () => {
    if (!state) return null

    if (step === 1) return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Confirm your location at the scene.</p>
        <div className="space-y-2">
          <Label>Address</Label>
          <Input value={state.address} onChange={e => setState(p => p ? { ...p, address: e.target.value } : p)} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={grabGPS} disabled={gpsLoading} className="flex items-center gap-1">
            {gpsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            {state.gps_lat ? 'GPS Captured ✓' : 'Capture GPS'}
          </Button>
          {state.gps_lat && (
            <span className="text-xs text-muted-foreground">{state.gps_lat.toFixed(5)}, {state.gps_lng?.toFixed(5)}</span>
          )}
        </div>
      </div>
    )

    if (step === 2) return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Capture scene evidence.</p>
        <div className="space-y-2">
          <Label className="flex items-center gap-1"><Camera className="w-4 h-4" /> Photo</Label>
          <Input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} />
          {state.image_base64 && <p className="text-xs text-green-600">✓ Photo captured</p>}
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1"><Eye className="w-4 h-4" /> Video / Voice Note</Label>
          <Textarea
            placeholder="Describe what you observe (voice note or typed)"
            rows={3}
            value={state.video_note}
            onChange={e => setState(p => p ? { ...p, video_note: e.target.value } : p)}
          />
        </div>
      </div>
    )

    if (step === 3) return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Bob AI will analyse the scene photo and complaint context.</p>
        <Button
          className="bg-amber-600 hover:bg-amber-700 text-white w-full"
          onClick={runAiAnalysis}
          disabled={aiLoading}
        >
          {aiLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analysing…</> : 'Run Bob AI Analysis'}
        </Button>
        {aiResult && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-amber-50 rounded p-2">
                <p className="text-xs text-muted-foreground">Smoke Opacity</p>
                <p className="font-medium capitalize">{aiResult.smoke_opacity ?? '—'}</p>
              </div>
              <div className="bg-amber-50 rounded p-2">
                <p className="text-xs text-muted-foreground">Smoke Color</p>
                <p className="font-medium capitalize">{aiResult.smoke_color ?? '—'}</p>
              </div>
            </div>
            {aiResult.prohibited_materials_suspected.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-2 text-sm">
                <p className="font-medium text-red-800 text-xs mb-1">Prohibited Materials Suspected</p>
                <p className="text-red-700">{aiResult.prohibited_materials_suspected.join(', ')}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Offensive Rating</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-200 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all ${offensiveRatingColor(aiResult.offensive_rating)}`}
                    style={{ width: `${(aiResult.offensive_rating / 5) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-bold">{aiResult.offensive_rating}/5</span>
              </div>
            </div>
            {aiResult.ai_caution && (
              <div className="bg-amber-50 border border-amber-300 rounded p-2 flex items-start gap-2 text-sm text-amber-800">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{aiResult.ai_caution}</p>
              </div>
            )}
          </div>
        )}
      </div>
    )

    if (step === 4) return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Complete the assessment checklist (pre-filled by Bob AI where available).</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Smoke Opacity</Label>
            <Select value={state.smoke_opacity} onValueChange={v => setState(p => p ? { ...p, smoke_opacity: v } : p)}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {['light', 'moderate', 'heavy', 'very_heavy', 'black'].map(o => (
                  <SelectItem key={o} value={o}>{o.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Smoke Color</Label>
            <Select value={state.smoke_color} onValueChange={v => setState(p => p ? { ...p, smoke_color: v } : p)}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {['white', 'light_grey', 'grey', 'dark_grey', 'black', 'brown', 'yellow'].map(o => (
                  <SelectItem key={o} value={o}>{o.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="continuous"
              checked={state.is_continuous}
              onCheckedChange={v => setState(p => p ? { ...p, is_continuous: !!v } : p)}
            />
            <Label htmlFor="continuous">Continuous</Label>
          </div>
          {!state.is_continuous && (
            <div className="flex items-center gap-2">
              <Label>Duration (min)</Label>
              <Input
                type="number"
                className="w-20"
                value={state.duration_minutes}
                onChange={e => setState(p => p ? { ...p, duration_minutes: e.target.value } : p)}
              />
            </div>
          )}
        </div>

        <div className="space-y-1">
          <Label>Prohibited Materials (check all observed/suspected)</Label>
          <div className="grid grid-cols-2 gap-1">
            {PROHIBITED_ITEMS.map(item => (
              <div key={item.id} className="flex items-center gap-2">
                <Checkbox
                  id={item.id}
                  checked={state.prohibited_materials.includes(item.id)}
                  onCheckedChange={checked => {
                    setState(p => {
                      if (!p) return p
                      const list = checked
                        ? [...p.prohibited_materials, item.id]
                        : p.prohibited_materials.filter(x => x !== item.id)
                      return { ...p, prohibited_materials: list }
                    })
                  }}
                />
                <Label htmlFor={item.id} className="text-sm">{item.label}</Label>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Odor Type</Label>
            <Select value={state.odor_type} onValueChange={v => setState(p => p ? { ...p, odor_type: v } : p)}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {['none', 'wood_smoke', 'acrid_chemical', 'plastic_like', 'noxious', 'other'].map(o => (
                  <SelectItem key={o} value={o}>{o.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Checkbox
              id="odor_offensive"
              checked={state.odor_offensive}
              onCheckedChange={v => setState(p => p ? { ...p, odor_offensive: !!v } : p)}
            />
            <Label htmlFor="odor_offensive">Odor Offensive</Label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="flex items-center gap-1"><Wind className="w-3 h-3" /> Wind Speed (km/h)</Label>
            <Input
              type="number"
              value={state.wind_speed}
              onChange={e => setState(p => p ? { ...p, wind_speed: e.target.value } : p)}
            />
          </div>
          <div className="space-y-1">
            <Label>Wind Direction</Label>
            <Select value={state.wind_direction} onValueChange={v => setState(p => p ? { ...p, wind_direction: v } : p)}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(d => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label>Smoke Drift Direction</Label>
          <Input
            value={state.smoke_drift_direction}
            placeholder="e.g. towards neighbour's property at 12 Smith St"
            onChange={e => setState(p => p ? { ...p, smoke_drift_direction: e.target.value } : p)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="affecting_neighbors"
              checked={state.affecting_neighbors}
              onCheckedChange={v => setState(p => p ? { ...p, affecting_neighbors: !!v } : p)}
            />
            <Label htmlFor="affecting_neighbors">Affecting Neighbours</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="affecting_road"
              checked={state.affecting_road}
              onCheckedChange={v => setState(p => p ? { ...p, affecting_road: !!v } : p)}
            />
            <Label htmlFor="affecting_road">Affecting Road</Label>
          </div>
        </div>

        {state.affecting_neighbors && (
          <div className="space-y-1">
            <Label>Neighbour Impact Description</Label>
            <Textarea
              rows={2}
              value={state.neighbor_impact_description}
              onChange={e => setState(p => p ? { ...p, neighbor_impact_description: e.target.value } : p)}
            />
          </div>
        )}

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="sample_taken"
              checked={state.sample_taken}
              onCheckedChange={v => setState(p => p ? { ...p, sample_taken: !!v } : p)}
            />
            <Label htmlFor="sample_taken">Sample Taken</Label>
          </div>
          {state.sample_taken && (
            <div className="flex items-center gap-2">
              <Label>Type</Label>
              <Select value={state.sample_type} onValueChange={v => setState(p => p ? { ...p, sample_type: v } : p)}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {['ash', 'unburnt_material', 'other'].map(o => (
                    <SelectItem key={o} value={o}>{o.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <Label>Officer Professional Opinion <span className="text-red-500">*</span></Label>
          <Textarea
            rows={3}
            placeholder="Describe your professional assessment of the burning activity and its potential effects…"
            value={state.officer_opinion}
            onChange={e => setState(p => p ? { ...p, officer_opinion: e.target.value } : p)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="is_ooh"
            checked={state.is_out_of_hours}
            onCheckedChange={v => setState(p => p ? { ...p, is_out_of_hours: !!v } : p)}
          />
          <Label htmlFor="is_ooh" className="text-amber-700 font-medium">Out of Hours (OOH)</Label>
        </div>
      </div>
    )

    if (step === 5) return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Select the enforcement action to take.</p>
        <div className="grid gap-2">
          {[
            { value: 'no_action', label: 'No Action', description: 'Smoke within acceptable limits or self-resolved' },
            { value: 'verbal_warning', label: 'Verbal Warning', description: 'Warn occupant — document only' },
            { value: 'abatement_notice', label: 'Abatement Notice', description: 'Formal notice to cease burning activity' },
            { value: 'infringement_notice', label: 'Infringement Notice ($300–$1,000)', description: 'Financial penalty under RMA s.17A' },
            { value: 'prosecution_referral', label: 'Prosecution Referral', description: 'Refer to council/council for prosecution' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                state.action === opt.value
                  ? 'border-amber-500 bg-amber-50'
                  : 'border-gray-200 hover:border-amber-300'
              }`}
              onClick={() => setState(p => p ? { ...p, action: opt.value } : p)}
            >
              <p className="font-medium text-sm">{opt.label}</p>
              <p className="text-xs text-muted-foreground">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>
    )

    if (step === 6) return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Complete notice details for the selected enforcement action.</p>
        <div className="space-y-2">
          <Label>Recipient Name</Label>
          <Input
            value={state.recipient_name}
            placeholder="Full name of responsible person"
            onChange={e => setState(p => p ? { ...p, recipient_name: e.target.value } : p)}
          />
        </div>
        <div className="space-y-2">
          <Label>Recipient Address</Label>
          <Input
            value={state.recipient_address}
            onChange={e => setState(p => p ? { ...p, recipient_address: e.target.value } : p)}
          />
        </div>
        <div className="space-y-2">
          <Label>Comply By (date/time)</Label>
          <Input
            type="datetime-local"
            value={state.comply_by}
            onChange={e => setState(p => p ? { ...p, comply_by: e.target.value } : p)}
          />
        </div>
        <div className="space-y-2">
          <Label>Offence Description</Label>
          <Textarea
            rows={3}
            value={state.offence_description}
            placeholder="Describe the offending activity and effects under RMA s.17A"
            onChange={e => setState(p => p ? { ...p, offence_description: e.target.value } : p)}
          />
        </div>
        <div className="space-y-2">
          <Label>RMA Section</Label>
          <Input value={state.rma_section} onChange={e => setState(p => p ? { ...p, rma_section: e.target.value } : p)} />
        </div>
        {state.action === 'infringement_notice' && (
          <div className="space-y-2">
            <Label>Penalty Amount (NZD)</Label>
            <Input
              type="number"
              min="300"
              max="1000"
              value={state.penalty_amount_nzd}
              placeholder="300–1000"
              onChange={e => setState(p => p ? { ...p, penalty_amount_nzd: e.target.value } : p)}
            />
          </div>
        )}
        <Button
          variant="outline"
          className="w-full flex items-center gap-2"
          onClick={() => generateNoticeMutation.mutate()}
          disabled={generateNoticeMutation.isPending}
        >
          {generateNoticeMutation.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Printer className="w-4 h-4" />}
          Generate Notice
        </Button>
      </div>
    )

    return null
  }

  const totalSteps = needsNoticeForm ? 6 : 5
  const canProceed = () => {
    if (!state) return false
    if (step === 4 && !state.officer_opinion.trim()) return false
    if (step === 5 && !state.action) return false
    return true
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Flame className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-amber-900">Smoke Complaint OOH</h1>
              <p className="text-xs text-muted-foreground">RMA s.17A enforcement · Out-of-Hours</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="flex items-center gap-1">
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="jobs" className="flex items-center gap-1">
              <Flame className="w-4 h-4" /> Active Jobs
              {myJobs.length > 0 && (
                <Badge className="ml-1 bg-amber-500 text-white text-xs px-1.5">{myJobs.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="new" className="flex items-center gap-1">
              <Plus className="w-4 h-4" /> New Job
            </TabsTrigger>
            <TabsTrigger value="completed" className="flex items-center gap-1">
              <CheckCircle className="w-4 h-4" /> Completed
            </TabsTrigger>
          </TabsList>

          {/* Active Jobs */}
          <TabsContent value="jobs" className="space-y-3 mt-4">
            {jobsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
              </div>
            ) : myJobs.length === 0 ? (
              <Card className="border-dashed border-amber-200">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Flame className="w-10 h-10 mx-auto mb-3 text-amber-300" />
                  <p className="font-medium">No active smoke jobs</p>
                  <p className="text-xs mt-1">Jobs assigned to you will appear here</p>
                </CardContent>
              </Card>
            ) : (
              myJobs.map(renderJobCard)
            )}
          </TabsContent>

          {/* New Job (brief guidance) */}
          <TabsContent value="new" className="mt-4">
            <Card className="border-amber-200">
              <CardHeader>
                <CardTitle className="text-amber-900 flex items-center gap-2">
                  <Info className="w-5 h-5" /> Creating New Smoke Complaints
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>New smoke complaint jobs are created by dispatch or by admin staff in the Admin Portal.</p>
                <p>If you have received a verbal complaint on-scene, contact your dispatcher to log a new job.</p>
                <p className="text-amber-700 font-medium">OOH jobs must be authorised by your supervisor before proceeding with enforcement action.</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Completed */}
          <TabsContent value="completed" className="space-y-3 mt-4">
            {completedJobs.length === 0 ? (
              <Card className="border-dashed border-gray-200">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <CheckCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">No completed jobs yet</p>
                </CardContent>
              </Card>
            ) : (
              completedJobs.map(job => (
                <Card key={job.id} className="border-gray-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">{job.job_number}</span>
                          <Badge className={STATUS_BADGE[job.status] ?? 'bg-gray-100 text-gray-700'}>
                            {job.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <p className="text-sm">{job.title}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3" /> {job.address}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDateTime(job.created_at)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!!printingId}
                        onClick={() => setPrintingId(job.id)}
                        className="flex items-center gap-1 text-xs"
                      >
                        <FileText className="w-3 h-3" /> Report
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>

        {/* Assessment Dialog */}
        <Dialog open={dialogOpen} onOpenChange={open => { if (!open) { setDialogOpen(false); setSelectedJob(null); setState(null); setAiResult(null); setStep(1) } }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-900">
                <Flame className="w-5 h-5 text-amber-600" />
                Smoke Assessment — Step {step} of {totalSteps}
              </DialogTitle>
            </DialogHeader>

            {/* Step progress */}
            <div className="flex gap-1 mb-2">
              {Array.from({ length: totalSteps }, (_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-amber-500' : 'bg-gray-200'}`}
                />
              ))}
            </div>

            {/* Step labels */}
            <p className="text-xs text-muted-foreground mb-4">
              {['Location', 'Media', 'Bob AI', 'Checklist', 'Action', 'Notice'][step - 1]}
            </p>

            {renderStep()}

            {/* Nav buttons */}
            <div className="flex justify-between mt-6 pt-4 border-t gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(s => s - 1)}
                disabled={step === 1}
                className="flex items-center gap-1"
              >
                <X className="w-4 h-4" /> Back
              </Button>
              {step < totalSteps ? (
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1"
                  onClick={() => {
                    if (step === 5 && !needsNoticeForm) {
                      // skip step 6 for no_action / verbal_warning / prosecution
                      if (!state?.action) { toast.error('Select an action'); return }
                      submitMutation.mutate()
                      return
                    }
                    setStep(s => s + 1)
                  }}
                  disabled={!canProceed() || submitMutation.isPending}
                >
                  {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {step === 5 && !needsNoticeForm ? 'Submit' : 'Next'}
                  {step < totalSteps && !submitMutation.isPending ? <ChevronRight className="w-4 h-4" /> : null}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-1"
                  onClick={() => submitMutation.mutate()}
                  disabled={submitMutation.isPending}
                >
                  {submitMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CheckCircle className="w-4 h-4" />}
                  Submit Assessment
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  )
}
