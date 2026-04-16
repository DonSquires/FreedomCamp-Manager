/**
 * BiosecurityOfficerPortal.tsx
 *
 * Field officer portal for biosecurity inspection and enforcement.
 * Focuses on Chilean Needlegrass (Nassella neesiana) identification and
 * management under the Biosecurity Act 1993.
 *
 * Workflow:
 *  1. Officer receives dispatched biosecurity_job
 *  2. On-scene: photograph specimen, run Bob AI identification
 *  3. Confirm AI checklist (species, density, seed heads, etc.)
 *  4. Select action: No Action / Advisory / NOD / Infringement / Referral to MPI
 *  5. Generate and print statutory notice if required
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
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
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { FieldSafetyBar } from '@/components/features/FieldSafetyBar'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import { useShiftGate } from '@/hooks/useShiftGate'
import { GeofenceWarningBanner } from '@/components/features/GeofenceWarningBanner'
import {
  Leaf, MapPin, Camera, CheckCircle, AlertTriangle, Info,
  FileText, ChevronRight, RefreshCw, Printer, Plus, Eye,
  Loader2, TreePine, Bug,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type BiosecurityJob = {
  id: string
  job_number: string
  title: string
  address: string
  inspection_type: string
  priority: string
  status: string
  has_prior_notice: boolean
  has_management_plan: boolean
  prior_notice_count: number
  safety_notes: string | null
  created_at: string
  assigned_at: string | null
}

// ─── Assessment state ─────────────────────────────────────────────────────────

const EMPTY_ASSESSMENT = {
  step: 1,
  job_id: null as string | null,
  address: '',
  gps_lat: null as number | null,
  gps_lng: null as number | null,
  image_base64: null as string | null,
  photo_preview: null as string | null,
  ai_running: false,
  ai_result: null as any,
  ai_error: null as string | null,
  // checklist
  plant_species: '',
  density_estimate: '',
  density_category: '',
  seed_heads_present: false,
  basal_seeds_present: false,
  cleistogenes_present: false,
  leaf_texture_harsh: false,
  awn_visible: false,
  infestation_stage: '',
  location_type: '',
  patch_area_m2: '',
  patch_count: '',
  buffer_zone_breached: false,
  management_plan_current: false,
  pathway_evidence: '',
  sample_taken: false,
  weather_summary: '',
  officer_notes: '',
  // action
  recommended_action: '',
  // notice
  recipient_name: '',
  recipient_address: '',
  comply_by: '',
  required_actions: '',
  act_section: 'Biosecurity Act 1993 s.128',
  penalty_amount: '',
  // notice result
  notice_html: null as string | null,
  notice_number: null as string | null,
}

type AssessmentState = typeof EMPTY_ASSESSMENT

// ─── Badge helpers ─────────────────────────────────────────────────────────────

const STATUS_COLOUR: Record<string, string> = {
  pending:   'bg-yellow-100 text-yellow-700',
  assigned:  'bg-blue-100 text-blue-700',
  en_route:  'bg-indigo-100 text-indigo-700',
  on_scene:  'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
  referred:  'bg-orange-100 text-orange-700',
}

const PRIORITY_COLOUR: Record<string, string> = {
  low:    'bg-gray-100 text-gray-600',
  normal: 'bg-blue-100 text-blue-700',
  high:   'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BiosecurityOfficerPortal() {
  const { user } = useAuthStore()
  const { operationalOrganizationId } = useOperationalOrganization()
  const orgId = operationalOrganizationId
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const photoInputRef = useRef<HTMLInputElement>(null)

  // ── Shift gate ────────────────────────────────────────────────────────────
  const { gateApplies, canAccessPortal, canUseFeature, geofenceViolation, isLoading: gateLoading } = useShiftGate()
  useEffect(() => {
    if (!gateLoading && gateApplies && (!canAccessPortal || !canUseFeature('biosecurity_inspection'))) {
      navigate('/officer-home', { replace: true })
    }
  }, [gateApplies, canAccessPortal, canUseFeature, gateLoading, navigate])

  const [tab, setTab] = useState('jobs')
  const [showDialog, setShowDialog] = useState(false)
  const [selectedJob, setSelectedJob] = useState<BiosecurityJob | null>(null)
  const [state, setState] = useState<AssessmentState>({ ...EMPTY_ASSESSMENT })
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [printHtml, setPrintHtml] = useState<string | null>(null)

  const set = (patch: Partial<AssessmentState>) => setState(prev => ({ ...prev, ...patch }))

  // ── GPS on dialog open ────────────────────────────────────────────────────
  useEffect(() => {
    if (!showDialog) return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => set({ gps_lat: pos.coords.latitude, gps_lng: pos.coords.longitude }),
      () => { /* silently ignore — officer can type address */ },
      { timeout: 8000 },
    )
  }, [showDialog])

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: activeJobs = [], isLoading: jobsLoading, refetch } = useQuery({
    queryKey: ['biosecurity_jobs_active', user?.id, orgId],
    queryFn: async () => {
      if (!orgId || !user?.id) return []
      const { data, error } = await supabase
        .from('biosecurity_jobs' as any)
        .select('*')
        .eq('organization_id', orgId)
        .eq('assigned_to', user.id)
        .in('status', ['assigned', 'en_route', 'on_scene'])
        .order('created_at', { ascending: true })
        .limit(50)
      if (error) throw error
      return (data || []) as unknown as BiosecurityJob[]
    },
    enabled: !!orgId && !!user?.id,
    refetchInterval: 60_000,
  })

  const { data: completedJobs = [], isLoading: completedLoading } = useQuery({
    queryKey: ['biosecurity_jobs_completed', user?.id, orgId],
    queryFn: async () => {
      if (!orgId || !user?.id) return []
      const { data, error } = await supabase
        .from('biosecurity_jobs' as any)
        .select('*')
        .eq('organization_id', orgId)
        .eq('assigned_to', user.id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data || []) as unknown as BiosecurityJob[]
    },
    enabled: !!orgId && !!user?.id,
  })

  // ── Job status mutation ───────────────────────────────────────────────────

  const updateJobStatusMutation = useMutation({
    mutationFn: async ({ jobId, status }: { jobId: string; status: string }) => {
      const patch: any = { status, updated_at: new Date().toISOString() }
      if (status === 'on_scene') patch.arrived_at = new Date().toISOString()
      if (status === 'completed') patch.completed_at = new Date().toISOString()
      const { error } = await supabase
        .from('biosecurity_jobs' as any)
        .update(patch)
        .eq('id', jobId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['biosecurity_jobs_active'] })
      queryClient.invalidateQueries({ queryKey: ['biosecurity_jobs_completed'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Save assessment mutation ──────────────────────────────────────────────

  const saveAssessmentMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || !user?.id) throw new Error('Not authenticated')
      const { error } = await supabase
        .from('biosecurity_assessments' as any)
        .insert({
          organization_id: orgId,
          officer_id: user.id,
          biosecurity_job_id: state.job_id,
          address: state.address,
          gps_lat: state.gps_lat,
          gps_lng: state.gps_lng,
          plant_species: state.plant_species || null,
          density_estimate: state.density_estimate ? parseFloat(state.density_estimate) : null,
          density_category: state.density_category || null,
          seed_heads_present: state.seed_heads_present,
          basal_seeds_present: state.basal_seeds_present,
          cleistogenes_present: state.cleistogenes_present,
          leaf_texture_harsh: state.leaf_texture_harsh,
          awn_visible: state.awn_visible,
          infestation_stage: state.infestation_stage || null,
          location_type: state.location_type || null,
          patch_area_m2: state.patch_area_m2 ? parseFloat(state.patch_area_m2) : null,
          patch_count: state.patch_count ? parseInt(state.patch_count) : null,
          buffer_zone_breached: state.buffer_zone_breached,
          management_plan_current: state.management_plan_current,
          pathway_evidence: state.pathway_evidence || null,
          sample_taken: state.sample_taken,
          weather_conditions: state.weather_summary ? { summary: state.weather_summary } : null,
          officer_notes: state.officer_notes || null,
          recommended_action: state.recommended_action,
          ai_species_identification: state.ai_result,
        })
      if (error) throw error
      if (state.job_id) {
        await updateJobStatusMutation.mutateAsync({ jobId: state.job_id, status: 'completed' })
      }
    },
    onSuccess: () => {
      toast.success('Biosecurity assessment saved')
      setShowDialog(false)
      setState({ ...EMPTY_ASSESSMENT })
      setSelectedJob(null)
      queryClient.invalidateQueries({ queryKey: ['biosecurity_jobs_active'] })
      queryClient.invalidateQueries({ queryKey: ['biosecurity_jobs_completed'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Photo handler ─────────────────────────────────────────────────────────

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result as string
      // strip data URL prefix for base64 only
      const base64 = result.split(',')[1] ?? result
      set({ image_base64: base64, photo_preview: result })
    }
    reader.readAsDataURL(file)
  }

  // ── Bob AI analysis ───────────────────────────────────────────────────────

  const runAiAnalysis = async () => {
    if (!state.image_base64) {
      toast.error('Please take or upload a photo first')
      return
    }
    set({ ai_running: true, ai_error: null, ai_result: null })
    try {
      const { data, error } = await edgeFunctions.biosecurityAssess({
        job_id: state.job_id,
        image_base64: state.image_base64,
        gps_lat: state.gps_lat,
        gps_lng: state.gps_lng,
        address: state.address,
      })
      if (error) throw new Error((error as any).message ?? String(error))
      const prefill = data?.checklist_prefill ?? {}
      const identification = data?.identification ?? {}
      set({
        ai_running: false,
        ai_result: data,
        plant_species: identification.dominant_species ?? identification.species ?? prefill.plant_species ?? '',
        density_estimate: prefill.density_estimate != null ? String(prefill.density_estimate) : '',
        density_category: prefill.density_category ?? '',
        seed_heads_present: prefill.seed_heads_present ?? false,
        basal_seeds_present: prefill.basal_seeds_present ?? false,
        cleistogenes_present: prefill.cleistogenes_present ?? false,
        leaf_texture_harsh: prefill.leaf_texture_harsh ?? false,
        awn_visible: prefill.awn_visible ?? false,
        infestation_stage: prefill.infestation_stage ?? '',
        weather_summary: data?.weather_summary ?? '',
      })
      set({ step: 4 })
    } catch (err: any) {
      set({ ai_running: false, ai_error: err.message ?? 'AI analysis failed' })
    }
  }

  // ── Generate notice ────────────────────────────────────────────────────────

  const generateNotice = async () => {
    if (!orgId || !user?.id) return
    setPrintingId('notice')
    try {
      // 1. Allocate a notice number and INSERT the record so the edge function
      //    can look it up by ID (the function only accepts a notice UUID).
      const { data: noticeNumber, error: numErr } = await (supabase.rpc as any)(
        'next_biosecurity_notice_number',
        { p_org_id: orgId },
      )
      if (numErr) throw new Error(numErr.message)

      const { data: inserted, error: insertErr } = await (supabase as any)
        .from('biosecurity_notices')
        .insert({
          organization_id: orgId,
          notice_number: noticeNumber,
          biosecurity_job_id: state.job_id ?? null,
          notice_type: state.recommended_action === 'infringement_notice'
            ? 'infringement_notice'
            : state.recommended_action === 'notice_of_direction'
              ? 'notice_of_direction'
              : 'formal_warning',
          recipient_name: state.recipient_name,
          recipient_address: state.recipient_address,
          offence_description: `${state.plant_species || 'Invasive species'} infestation detected. ${state.officer_notes || ''}`.trim(),
          biosecurity_act_section: state.act_section,
          species_identified: state.plant_species || null,
          infestation_location: state.address || null,
          comply_by: state.comply_by || null,
          required_actions: state.required_actions || null,
          penalty_amount_nzd: state.penalty_amount ? parseFloat(state.penalty_amount) : null,
          issuing_officer_id: user.id,
          status: 'issued',
        })
        .select('id')
        .single()
      if (insertErr) throw new Error(insertErr.message)

      // 2. Render the notice HTML via the edge function.
      const { data, error } = await edgeFunctions.biosecurityNotice({
        biosecurity_notice_id: inserted.id,
        issued_by: user.id,
      })
      if (error) throw new Error((error as any).message ?? String(error))
      set({ notice_html: data?.html ?? null, notice_number: noticeNumber })
      if (data?.html) setPrintHtml(data.html)
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to generate notice')
    } finally {
      setPrintingId(null)
    }
  }

  const handlePrint = () => {
    if (!printHtml) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(printHtml)
    w.document.close()
    w.print()
    setPrintHtml(null)
  }

  // ── Open assessment dialog ─────────────────────────────────────────────────

  const openNewAssessment = (job?: BiosecurityJob) => {
    setState({
      ...EMPTY_ASSESSMENT,
      job_id: job?.id ?? null,
      address: job?.address ?? '',
    })
    setSelectedJob(job ?? null)
    setShowDialog(true)
  }

  // ── Step navigation ────────────────────────────────────────────────────────

  const canAdvance = () => {
    switch (state.step) {
      case 1: return !!state.address.trim()
      case 2: return !!state.image_base64
      case 3: return !state.ai_running
      case 4: return !!state.plant_species && !!state.infestation_stage
      case 5: return !!state.recommended_action
      case 6: return true
      default: return true
    }
  }

  const STEPS = ['Location', 'Photo', 'AI Analysis', 'Checklist', 'Action', 'Notice']
  const needsNotice = state.recommended_action === 'nod' || state.recommended_action === 'infringement'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div className="p-4 space-y-5 max-w-2xl mx-auto">

        {geofenceViolation && <GeofenceWarningBanner />}
        <FieldSafetyBar compact />

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Leaf className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Biosecurity Officer</h1>
            <p className="text-sm text-gray-500">Chilean Needlegrass Inspection · Nassella neesiana</p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => openNewAssessment()}>
              <Plus className="h-4 w-4 mr-1" /> New Assessment
            </Button>
          </div>
        </div>

        {/* AI caution */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <span>
            <strong>AI identification is a screening aid only.</strong> You must confirm the species
            identification before issuing any notice.
          </span>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="jobs" className="flex-1">
              <TreePine className="h-4 w-4 mr-1" /> Active Jobs ({activeJobs.length})
            </TabsTrigger>
            <TabsTrigger value="new" className="flex-1">
              <Bug className="h-4 w-4 mr-1" /> New Assessment
            </TabsTrigger>
            <TabsTrigger value="completed" className="flex-1">
              <Eye className="h-4 w-4 mr-1" /> Completed
            </TabsTrigger>
          </TabsList>

          {/* ── Active jobs tab ─────────────────────────────────────────── */}
          <TabsContent value="jobs" className="mt-4 space-y-3">
            {jobsLoading ? (
              <div className="text-center py-12 text-gray-400">Loading jobs…</div>
            ) : activeJobs.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <CheckCircle className="h-10 w-10 text-emerald-400 mx-auto" />
                <p className="text-gray-400">No active biosecurity jobs assigned to you</p>
              </div>
            ) : (
              activeJobs.map(job => (
                <Card key={job.id} className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => openNewAssessment(job)}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-sm font-semibold text-gray-700">{job.job_number}</span>
                          <Badge className={`text-xs ${PRIORITY_COLOUR[job.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                            {job.priority.toUpperCase()}
                          </Badge>
                          <Badge className={`text-xs ${STATUS_COLOUR[job.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {job.status.replace(/_/g, ' ')}
                          </Badge>
                          {job.has_prior_notice && (
                            <Badge className="text-xs bg-orange-100 text-orange-700">Prior Notice</Badge>
                          )}
                        </div>
                        <p className="font-semibold text-gray-900 text-sm truncate">{job.title}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" /> {job.address}
                        </p>
                        {job.safety_notes && (
                          <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> {job.safety_notes}
                          </p>
                        )}
                        {/* Status advance buttons */}
                        <div className="flex gap-2 mt-2" onClick={e => e.stopPropagation()}>
                          {job.status === 'assigned' && (
                            <Button size="sm" variant="outline" className="text-xs h-7"
                              onClick={() => updateJobStatusMutation.mutate({ jobId: job.id, status: 'en_route' })}>
                              En Route
                            </Button>
                          )}
                          {job.status === 'en_route' && (
                            <Button size="sm" variant="outline" className="text-xs h-7"
                              onClick={() => updateJobStatusMutation.mutate({ jobId: job.id, status: 'on_scene' })}>
                              On Scene
                            </Button>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-gray-400 mt-1 shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* ── New assessment tab ──────────────────────────────────────── */}
          <TabsContent value="new" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Leaf className="h-4 w-4 text-emerald-600" /> Ad-hoc Biosecurity Inspection
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 mb-4">
                  Start a new biosecurity assessment without a dispatched job — e.g. observed infestation
                  while on patrol.
                </p>
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white w-full"
                  onClick={() => { openNewAssessment(); setTab('jobs') }}>
                  <Plus className="h-4 w-4 mr-2" /> Start New Assessment
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Completed jobs tab ──────────────────────────────────────── */}
          <TabsContent value="completed" className="mt-4 space-y-3">
            {completedLoading ? (
              <div className="text-center py-12 text-gray-400">Loading…</div>
            ) : completedJobs.length === 0 ? (
              <div className="text-center py-12 text-gray-400">No completed jobs yet</div>
            ) : (
              completedJobs.map(job => (
                <Card key={job.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-semibold text-gray-700">{job.job_number}</span>
                      <Badge className="text-xs bg-green-100 text-green-700">Completed</Badge>
                    </div>
                    <p className="font-semibold text-gray-900 text-sm">{job.title}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3" /> {job.address}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">{formatDateTime(job.created_at)}</p>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>

        {/* Print preview if notice generated */}
        {printHtml && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <FileText className="h-4 w-4" />
              <span>Notice ready — {state.notice_number ?? 'generated'}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-1" /> Print
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPrintHtml(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}

      </div>

      {/* ── Assessment dialog ─────────────────────────────────────────────── */}
      <Dialog open={showDialog} onOpenChange={open => { if (!open) { setShowDialog(false); setState({ ...EMPTY_ASSESSMENT }) } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Leaf className="h-5 w-5 text-emerald-600" />
              Biosecurity Inspection — Step {state.step} of {needsNotice ? 6 : 5}
            </DialogTitle>
          </DialogHeader>

          {/* Step progress */}
          <div className="flex gap-1 mb-2">
            {STEPS.slice(0, needsNotice ? 6 : 5).map((label, i) => (
              <div key={label} className={`flex-1 h-1.5 rounded-full ${i < state.step ? 'bg-emerald-500' : 'bg-gray-200'}`} />
            ))}
          </div>

          {/* ── Step 1: Location ─────────────────────────────────────────── */}
          {state.step === 1 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="bio-address">Site Address *</Label>
                <Input id="bio-address" placeholder="123 Rural Road, Levin 5510"
                  value={state.address} onChange={e => set({ address: e.target.value })} />
              </div>
              {state.gps_lat && (
                <p className="text-xs text-emerald-700 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  GPS: {state.gps_lat.toFixed(5)}, {state.gps_lng?.toFixed(5)}
                </p>
              )}
              {!state.gps_lat && (
                <p className="text-xs text-gray-400">Acquiring GPS location…</p>
              )}
            </div>
          )}

          {/* ── Step 2: Photo ────────────────────────────────────────────── */}
          {state.step === 2 && (
            <div className="space-y-4">
              <div>
                <Label>Take Photo / Upload *</Label>
                <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
                  className="hidden" onChange={handlePhoto} />
                <Button variant="outline" className="w-full mt-2 border-dashed h-24 text-gray-500"
                  onClick={() => photoInputRef.current?.click()}>
                  <Camera className="h-5 w-5 mr-2" />
                  {state.photo_preview ? 'Retake / Replace Photo' : 'Take Photo or Upload from Gallery'}
                </Button>
              </div>
              {state.photo_preview && (
                <img src={state.photo_preview} alt="Specimen" className="rounded-lg border w-full object-contain max-h-56" />
              )}
              <div>
                <Label htmlFor="video-note">Video frame notes (optional)</Label>
                <Textarea id="video-note" placeholder="Describe any video footage taken on your device…"
                  className="text-sm" rows={2}
                  value={state.officer_notes}
                  onChange={e => set({ officer_notes: e.target.value })} />
              </div>
            </div>
          )}

          {/* ── Step 3: AI Analysis ──────────────────────────────────────── */}
          {state.step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Bob AI will analyse your photo and attempt to identify if Chilean Needlegrass
                  (<em>Nassella neesiana</em>) is present, and prefill the inspection checklist.</span>
              </div>
              {state.photo_preview && (
                <img src={state.photo_preview} alt="Specimen" className="rounded-lg border w-full object-contain max-h-40" />
              )}
              {state.ai_error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertTriangle className="h-4 w-4 inline mr-1" /> {state.ai_error}
                </div>
              )}
              {state.ai_result && !state.ai_running && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-1 text-sm">
                  <p className="font-semibold text-emerald-800">AI Result</p>
                  <p><strong>Species:</strong> {state.ai_result.identification?.species ?? '—'}</p>
                  <p><strong>Confidence:</strong> {state.ai_result.identification?.confidence != null
                    ? `${Math.round(state.ai_result.identification.confidence * 100)}%` : '—'}</p>
                  <p><strong>Density estimate:</strong> {state.ai_result.checklist_prefill?.density_estimate ?? '—'} plants/m²</p>
                </div>
              )}
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={state.ai_running || !state.image_base64}
                onClick={runAiAnalysis}>
                {state.ai_running
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analysing…</>
                  : <><Bug className="h-4 w-4 mr-2" /> Analyse with Bob AI</>}
              </Button>
              {state.ai_result && (
                <p className="text-xs text-gray-400 text-center">AI complete — advance to confirm checklist</p>
              )}
            </div>
          )}

          {/* ── Step 4: Checklist ────────────────────────────────────────── */}
          {state.step === 4 && (
            <div className="space-y-3 text-sm">
              <div>
                <Label htmlFor="bio-species">Species Identified *</Label>
                <Input id="bio-species" placeholder="Nassella neesiana"
                  value={state.plant_species} onChange={e => set({ plant_species: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="bio-density">Density (plants/m²)</Label>
                  <Input id="bio-density" type="number" min="0"
                    value={state.density_estimate} onChange={e => set({ density_estimate: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="bio-patch">Patch Area (m²)</Label>
                  <Input id="bio-patch" type="number" min="0"
                    value={state.patch_area_m2} onChange={e => set({ patch_area_m2: e.target.value })} />
                </div>
              </div>
              {/* Boolean toggles */}
              {([
                ['seed_heads_present', 'Seed heads present'],
                ['basal_seeds_present', 'Basal seeds present'],
                ['cleistogenes_present', 'Cleistogenes (hidden seeds) present'],
                ['awn_visible', 'Awn visible'],
                ['leaf_texture_harsh', 'Leaf texture harsh'],
                ['buffer_zone_breached', 'Within 5 m of boundary (buffer zone breach)'],
                ['management_plan_current', 'Management plan on file'],
                ['sample_taken', 'Sample taken'],
              ] as [keyof AssessmentState, string][]).map(([field, label]) => (
                <label key={field} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="rounded"
                    checked={!!state[field]}
                    onChange={e => set({ [field]: e.target.checked } as any)} />
                  <span>{label}</span>
                </label>
              ))}
              <div>
                <Label htmlFor="bio-stage">Life Stage *</Label>
                <Select value={state.infestation_stage} onValueChange={v => set({ infestation_stage: v })}>
                  <SelectTrigger id="bio-stage"><SelectValue placeholder="Select stage…" /></SelectTrigger>
                  <SelectContent>
                    {['seedling', 'vegetative', 'flowering', 'seeding', 'dormant'].map(s => (
                      <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bio-loctype">Location Type</Label>
                <Select value={state.location_type} onValueChange={v => set({ location_type: v })}>
                  <SelectTrigger id="bio-loctype"><SelectValue placeholder="Select location…" /></SelectTrigger>
                  <SelectContent>
                    {[
                      ['stockyard', 'Stockyard'],
                      ['fenceline', 'Fenceline'],
                      ['vehicle_area', 'Vehicle area'],
                      ['earthworks', 'Earthworks'],
                      ['roadside', 'Roadside'],
                      ['paddock', 'Paddock'],
                      ['other', 'Other'],
                    ].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bio-pathway">Pathway Evidence</Label>
                <Textarea id="bio-pathway" rows={2} placeholder="How may the weed have arrived / spread?"
                  value={state.pathway_evidence} onChange={e => set({ pathway_evidence: e.target.value })} />
              </div>
              {state.weather_summary && (
                <div className="rounded border bg-gray-50 p-2 text-xs text-gray-600">
                  <strong>Weather (AI):</strong> {state.weather_summary}
                </div>
              )}
              <div>
                <Label htmlFor="bio-notes">Officer Notes</Label>
                <Textarea id="bio-notes" rows={2} placeholder="Additional observations…"
                  value={state.officer_notes} onChange={e => set({ officer_notes: e.target.value })} />
              </div>
            </div>
          )}

          {/* ── Step 5: Action ───────────────────────────────────────────── */}
          {state.step === 5 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">Select the appropriate enforcement action.</p>
              {([
                ['no_action', 'No Action', 'bg-gray-100 text-gray-700'],
                ['advisory', 'Advisory (verbal)', 'bg-blue-100 text-blue-700'],
                ['nod', 'Notice of Direction (NOD)', 'bg-orange-100 text-orange-700'],
                ['infringement', 'Infringement Notice', 'bg-red-100 text-red-700'],
                ['referral_mpi', 'Referral to MPI', 'bg-purple-100 text-purple-700'],
              ] as [string, string, string][]).map(([value, label, cls]) => (
                <button key={value}
                  className={`w-full text-left rounded-lg border-2 p-3 transition-all text-sm font-medium ${state.recommended_action === value ? 'border-emerald-500 ' + cls : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}
                  onClick={() => set({ recommended_action: value })}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* ── Step 6: Notice form ──────────────────────────────────────── */}
          {state.step === 6 && needsNotice && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 text-xs">
                <Info className="h-3.5 w-3.5 inline mr-1" />
                Issuing a <strong>{state.recommended_action === 'nod' ? 'Notice of Direction' : 'Infringement Notice'}</strong> under {state.act_section}.
              </div>
              <div>
                <Label htmlFor="bio-recipient">Recipient Name</Label>
                <Input id="bio-recipient" placeholder="Landowner / Occupier name"
                  value={state.recipient_name} onChange={e => set({ recipient_name: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="bio-recaddr">Recipient Address</Label>
                <Input id="bio-recaddr" placeholder="Postal address"
                  value={state.recipient_address} onChange={e => set({ recipient_address: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="bio-comply">Comply By Date</Label>
                <Input id="bio-comply" type="date"
                  value={state.comply_by} onChange={e => set({ comply_by: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="bio-section">Act Section</Label>
                <Input id="bio-section" value={state.act_section}
                  onChange={e => set({ act_section: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="bio-reqactions">Required Actions</Label>
                <Textarea id="bio-reqactions" rows={3}
                  placeholder="List actions required to achieve compliance…"
                  value={state.required_actions} onChange={e => set({ required_actions: e.target.value })} />
              </div>
              {state.recommended_action === 'infringement' && (
                <div>
                  <Label htmlFor="bio-penalty">Penalty Amount (NZD)</Label>
                  <Input id="bio-penalty" type="number" min="0" placeholder="e.g. 400"
                    value={state.penalty_amount} onChange={e => set({ penalty_amount: e.target.value })} />
                </div>
              )}
              <Button variant="outline" className="w-full"
                disabled={printingId === 'notice'}
                onClick={generateNotice}>
                {printingId === 'notice'
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
                  : <><FileText className="h-4 w-4 mr-2" /> Generate Notice</>}
              </Button>
              {state.notice_html && (
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" /> Print Notice {state.notice_number ?? ''}
                </Button>
              )}
            </div>
          )}

          {/* ── Navigation buttons ───────────────────────────────────────── */}
          <div className="flex gap-2 pt-2 border-t mt-4">
            {state.step > 1 && (
              <Button variant="outline" onClick={() => set({ step: state.step - 1 })}>Back</Button>
            )}
            <div className="flex-1" />
            {state.step < (needsNotice ? 6 : 5) ? (
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={!canAdvance()}
                onClick={() => {
                  if (state.step === 3 && !state.ai_result) {
                    toast.error('Please run the AI analysis first (or skip to manually fill checklist)')
                    set({ step: state.step + 1 })
                    return
                  }
                  set({ step: state.step + 1 })
                }}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={saveAssessmentMutation.isPending}
                onClick={() => saveAssessmentMutation.mutate()}>
                {saveAssessmentMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
                  : <><CheckCircle className="h-4 w-4 mr-2" /> Save Assessment</>}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
