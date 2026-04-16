import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useBobAssistantStore } from '@/stores/bobAssistantStore'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/lib/supabase'
import { BrainCircuit, ClipboardList, Loader2, MapPinned, Mic, MicOff, Paintbrush2, Route, Send, Volume2, VolumeX, Wrench, Github, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { consumeLatestBobCollaborationPacket, publishBobResponse, type BobCollaborationPacket } from '@/lib/bobCollaboration'
import { BOB_PROJECT_KNOWLEDGE } from '@/lib/bobKnowledgeBase'
import {
  buildBobLearningContext,
  buildBobLearningContextRemote,
  buildConversationContinuationContextRemote,
  clearAllBobMemoryRemote,
  forgetLastConversationRemote,
  getBobMemorySnapshotRemote,
  type BobMemorySnapshot,
  persistBobLearningRemote,
  persistConversationTurnRemote,
} from '@/lib/bobLearningMemory'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
}

type PlanType =
  | 'sop'
  | 'assignment_instructions'
  | 'risk_assessment'
  | 'hs_plan'
  | 'evacuation_plan'
  | 'active_offender_procedure'
  | 'crowded_places_action_plan'

interface PlanForm {
  planType: PlanType
  planTitle: string
  organizationName: string
  siteName: string
  siteAddress: string
  deploymentType: string
  peopleCount: string
  shiftStart: string
  shiftEnd: string
  weatherSummary: string
  extremeWeatherPlan: string
  previousHistory: string
  knownThreats: string
  environmentalHazards: string
  biologicalHazards: string
  hazardControls: string
  entryPoints: string
  evacuationPoints: string
  commsPlan: string
  mapReference: string
  commandStructure: string
  ppeRequirements: string
  medicalSupport: string
  assignmentScope: 'organization' | 'zone' | 'client_site' | 'service_provider_office'
  assignedZoneId: string
  assignedClientSiteId: string
  assignedServiceProviderOrgId: string
  assignedOfficeLocationId: string
  fieldStaffCanView: boolean
}

type AssignmentOption = {
  id: string
  name: string
}

interface CodeChangeRequest {
  summary: string
  details: string
  stackTrace: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  complexity: 'simple' | 'moderate' | 'complex'
  targetPaths: string
  confirmed: boolean
}

function isHazardReviewRequiredPlan(planType: PlanType): boolean {
  return planType === 'risk_assessment' || planType === 'hs_plan'
}

const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  sop: 'Standard Operating Procedure (SOP)',
  assignment_instructions: 'Assignment Instructions',
  risk_assessment: 'Risk Assessment',
  hs_plan: 'Health and Safety Plan',
  evacuation_plan: 'Evacuation Plan',
  active_offender_procedure: 'Active Offender Procedure',
  crowded_places_action_plan: 'Crowded Places Action Plan',
}

function buildPlanRecommendations(form: PlanForm): string[] {
  const recommendations: string[] = []
  const people = Number(form.peopleCount || 0)

  if (!form.previousHistory.trim()) {
    recommendations.push('Capture previous incidents and lessons learned before final approval.')
  } else {
    recommendations.push('Use previous incident history to set trigger thresholds and patrol frequency.')
  }

  if (people >= 200) {
    recommendations.push('Large deployment detected: assign a dedicated incident commander and a separate communications lead.')
  } else if (people >= 50) {
    recommendations.push('Medium deployment detected: assign one lead and one deputy for coverage continuity.')
  } else {
    recommendations.push('Small deployment detected: ensure role cross-coverage for breaks and emergency escalation.')
  }

  if (!form.mapReference.trim()) {
    recommendations.push('Add a map reference and mark entry/exit routes, muster points, and exclusion zones.')
  } else {
    recommendations.push('Validate map reference with actual site access constraints and update briefing packs.')
  }

  if (!form.commsPlan.trim()) {
    recommendations.push('Define radio channels, fallback communications, and escalation call tree.')
  }

  if (!form.weatherSummary.trim()) {
    recommendations.push('Capture weather forecast, including expected temperature range, wind, rain, and visibility for the shift window.')
  } else {
    recommendations.push('Re-check weather at handover and trigger plan updates if forecast changes materially.')
  }

  const weatherText = normalize(`${form.weatherSummary} ${form.extremeWeatherPlan}`)
  if (!form.extremeWeatherPlan.trim()) {
    recommendations.push('Document extreme weather controls for heat, cold, storms, and rapid deterioration scenarios.')
  }
  if (weatherText.includes('heat')) {
    recommendations.push('Heat controls: hydration cycle, shaded rest points, buddy checks, and adjusted patrol intervals.')
  }
  if (weatherText.includes('cold')) {
    recommendations.push('Cold controls: layered PPE, warm-up rotations, and hypothermia early-warning checks.')
  }

  if (!form.environmentalHazards.trim()) {
    recommendations.push('Assess environmental hazards such as weather, terrain, flood risk, heat/cold stress, and visibility impacts.')
  } else {
    recommendations.push('Validate environmental controls against forecast conditions and site-specific terrain constraints.')
  }

  if (!form.biologicalHazards.trim()) {
    recommendations.push('Assess biological hazards including infectious exposure, pests, biohazard waste, and contaminated surfaces/water.')
  } else {
    recommendations.push('Confirm biological hazard controls include hygiene, contamination isolation, and exposure reporting workflow.')
  }

  if (!form.hazardControls.trim()) {
    recommendations.push('Document controls for identified hazards: elimination, isolation, engineering controls, PPE, and monitoring cadence.')
  }

  if (isHazardReviewRequiredPlan(form.planType)) {
    recommendations.push('This plan type requires full environmental, biological, weather, and control documentation before approval.')
  }

  if (form.planType === 'active_offender_procedure') {
    recommendations.push('Include immediate lockdown trigger words, police notification sequence, and shelter zones by area.')
  }

  if (form.planType === 'crowded_places_action_plan') {
    recommendations.push('Add crowd density checkpoints and dynamic ingress controls for peak periods.')
  }

  if (form.planType === 'evacuation_plan') {
    recommendations.push('Add mobility support arrangements for persons requiring assisted evacuation.')
  }

  return recommendations
}

function buildPlanDocument(form: PlanForm, recommendations: string[]): string {
  const title = form.planTitle.trim() || PLAN_TYPE_LABELS[form.planType]
  const now = new Date().toLocaleString()

  return [
    `${title}`,
    `Generated by Bob on ${now}`,
    '',
    '1. Operational Context',
    `Organization: ${form.organizationName || 'Not specified'}`,
    `Site: ${form.siteName || 'Not specified'}`,
    `Address: ${form.siteAddress || 'Not specified'}`,
    `Deployment Type: ${form.deploymentType || 'Not specified'}`,
    `Planned Headcount: ${form.peopleCount || 'Not specified'}`,
    `Shift Window: ${form.shiftStart || 'Not set'} to ${form.shiftEnd || 'Not set'}`,
    `Assignment Scope: ${form.assignmentScope}`,
    `Field Staff Access: ${form.fieldStaffCanView ? 'Enabled' : 'Disabled (Admin only)'}`,
    '',
    '2. Site & History Intelligence',
    `Map Reference: ${form.mapReference || 'Not specified'}`,
    `Weather Conditions: ${form.weatherSummary || 'Not specified'}`,
    `Extreme Weather Protocol: ${form.extremeWeatherPlan || 'Not specified'}`,
    `Previous History: ${form.previousHistory || 'No history supplied'}`,
    `Known Threats: ${form.knownThreats || 'No threats supplied'}`,
    `Environmental Hazards: ${form.environmentalHazards || 'Not specified'}`,
    `Biological Hazards: ${form.biologicalHazards || 'Not specified'}`,
    `Entry Points: ${form.entryPoints || 'Not specified'}`,
    `Evacuation/Muster Points: ${form.evacuationPoints || 'Not specified'}`,
    '',
    '3. Command, Communications, and Safety Controls',
    `Command Structure: ${form.commandStructure || 'Not specified'}`,
    `Communications Plan: ${form.commsPlan || 'Not specified'}`,
    `Hazard Controls: ${form.hazardControls || 'Not specified'}`,
    `PPE Requirements: ${form.ppeRequirements || 'Not specified'}`,
    `Medical Support: ${form.medicalSupport || 'Not specified'}`,
    '',
    '4. Bob Recommendations',
    ...recommendations.map((item, index) => `${index + 1}. ${item}`),
    '',
    '5. Action Checklist',
    '- Confirm role allocations and roster coverage',
    '- Confirm map overlays and direction routes',
    '- Brief all assigned personnel and record acknowledgment',
    '- Run pre-start risk review and document controls',
  ].join('\n')
}

function getSpeechRecognitionCtor(): any {
  if (typeof window === 'undefined') return null
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

function normalize(input: string): string {
  return input.trim().toLowerCase()
}

function buildMapDirectionsUrl(from: string, to: string, mode: string) {
  const travelMode = mode || 'driving'
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&travelmode=${encodeURIComponent(travelMode)}`
}

const BOB_WAKE_PHRASES = [
  'hay bob',
  'hey bob',
  'ok bob',
  'okay bob',
  'hello bob',
  'bob are you there',
]
const BOB_END_PHRASES = [
  'thank you',
  'thanks',
  'thanks bob',
  'thank you bob',
  'goodbye',
  'bye',
  'that is all',
  "that's all",
  'end conversation',
  'stop listening',
  'we are done',
]
const VOICE_INACTIVITY_TIMEOUT_MS = 29_000

function BobSketchPad() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [drawing, setDrawing] = useState(false)

  const getContext = () => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#0f172a'
    return ctx
  }

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  const startDraw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerPosition(event)
    const ctx = getContext()
    if (!point || !ctx) return
    setDrawing(true)
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
  }

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return
    const point = pointerPosition(event)
    const ctx = getContext()
    if (!point || !ctx) return
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  }

  const stopDraw = () => {
    setDrawing(false)
  }

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  const download = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `bob-sketch-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Paintbrush2 className="h-4 w-4" /> Drawing Board</CardTitle>
        <CardDescription>Sketch ideas, routes, or incident diagrams and export as PNG.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <canvas
          ref={canvasRef}
          width={680}
          height={260}
          className="w-full rounded border bg-white touch-none"
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={stopDraw}
          onPointerLeave={stopDraw}
        />
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={clear}>Clear</Button>
          <Button type="button" variant="outline" onClick={download}>Download PNG</Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function BobAssistantStudio() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const isGrandMaster = user?.role === 'grand_master'

  const {
    displayName,
    tone,
    voiceGender,
    accent,
    speechEnabled,
    autoSpeakReplies,
    voiceActivatedConversation,
    expressUserDataPermission,
    permittedUserIdentity,
    voicePatternLearningConsent,
    faceClarificationConsent,
    setDisplayName,
    setTone,
    setVoiceGender,
    setAccent,
    setSpeechEnabled,
    setAutoSpeakReplies,
    setVoiceActivatedConversation,
    setExpressUserDataPermission,
    setPermittedUserIdentity,
    setVoicePatternLearningConsent,
    setFaceClarificationConsent,
  } = useBobAssistantStore()

  const [chatInput, setChatInput] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [listening, setListening] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [travelMode, setTravelMode] = useState<'driving' | 'walking' | 'transit'>('driving')
  const [zoneOptions, setZoneOptions] = useState<AssignmentOption[]>([])
  const [clientSiteOptions, setClientSiteOptions] = useState<AssignmentOption[]>([])
  const [serviceProviderOrgOptions, setServiceProviderOrgOptions] = useState<AssignmentOption[]>([])
  const [officeLocationOptions, setOfficeLocationOptions] = useState<AssignmentOption[]>([])
  const [savingPlan, setSavingPlan] = useState(false)
  const [planForm, setPlanForm] = useState<PlanForm>({
    planType: 'sop',
    planTitle: '',
    organizationName: '',
    siteName: '',
    siteAddress: '',
    deploymentType: '',
    peopleCount: '',
    shiftStart: '',
    shiftEnd: '',
    weatherSummary: '',
    extremeWeatherPlan: '',
    previousHistory: '',
    knownThreats: '',
    environmentalHazards: '',
    biologicalHazards: '',
    hazardControls: '',
    entryPoints: '',
    evacuationPoints: '',
    commsPlan: '',
    mapReference: '',
    commandStructure: '',
    ppeRequirements: '',
    medicalSupport: '',
    assignmentScope: 'organization',
    assignedZoneId: '',
    assignedClientSiteId: '',
    assignedServiceProviderOrgId: '',
    assignedOfficeLocationId: '',
    fieldStaffCanView: true,
  })
  const [generatedPlan, setGeneratedPlan] = useState('')
  const [collaborationPacket, setCollaborationPacket] = useState<BobCollaborationPacket | null>(null)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [codeTaskLoading, setCodeTaskLoading] = useState(false)
  const [codeTaskResult, setCodeTaskResult] = useState('')
  const [remoteLearningContext, setRemoteLearningContext] = useState('')
  const [conversationContinuationContext, setConversationContinuationContext] = useState('')
  const [memorySnapshot, setMemorySnapshot] = useState<BobMemorySnapshot | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false)
  const [codeChangeRequest, setCodeChangeRequest] = useState<CodeChangeRequest>({
    summary: '',
    details: '',
    stackTrace: '',
    severity: 'medium',
    complexity: 'moderate',
    targetPaths: '',
    confirmed: false,
  })

  const recognitionRef = useRef<any>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const voiceConversationActiveRef = useRef(false)
  const speakingRef = useRef(false)
  const wakeUnlockedRef = useRef(false)
  const inactivityTimerRef = useRef<number | null>(null)

  const planRecommendations = useMemo(() => buildPlanRecommendations(planForm), [planForm])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, thinking])

  useEffect(() => {
    let cancelled = false

    const loadRemoteLearning = async () => {
      if (!user?.id) {
        setRemoteLearningContext('')
        setConversationContinuationContext('')
        return
      }

      const [learningContext, continuationContext] = await Promise.all([
        buildBobLearningContextRemote(user.id, 20),
        buildConversationContinuationContextRemote(user.id, 16),
      ])

      if (!cancelled) {
        setRemoteLearningContext(learningContext)
        setConversationContinuationContext(continuationContext)
      }
    }

    loadRemoteLearning()

    return () => {
      cancelled = true
    }
  }, [user?.id])

  // Track whether we've already published a response for the current packet
  const hasPublishedResponseRef = useRef(false)

  const applyClassicCommandVoicePreset = () => {
    setVoiceGender('male')
    setAccent('en-GB')
    setTone('friendly')
    setSpeechEnabled(true)
    setAutoSpeakReplies(true)
    toast.success('Classic command voice preset applied')
  }

  const applySoftConversationalPreset = () => {
    setVoiceGender('male')
    setAccent('en-NZ')
    setTone('professional')
    setSpeechEnabled(true)
    setAutoSpeakReplies(true)
    toast.success('Soft conversational preset applied')
  }

  useEffect(() => {
    const packet = consumeLatestBobCollaborationPacket()
    if (!packet) return
    setCollaborationPacket(packet)
    hasPublishedResponseRef.current = false
    setChatInput((prev) => prev || packet.prompt)
    toast.message(`${packet.title} loaded into Bob Assistant`)

    // autoSubmit: act as a sub-agent — send the prompt automatically
    if (packet.autoSubmit) {
      // Small delay so the component has fully mounted
      setTimeout(() => {
        sendMessage(packet.prompt)
      }, 400)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hydrateVoices = () => {
      setAvailableVoices(window.speechSynthesis.getVoices())
    }
    hydrateVoices()
    window.speechSynthesis.onvoiceschanged = hydrateVoices
    return () => {
      window.speechSynthesis.onvoiceschanged = null
    }
  }, [])

  useEffect(() => {
    setVoiceSupported(!!getSpeechRecognitionCtor())
  }, [])

  useEffect(() => {
    const orgId = user?.organization_id
    if (!orgId) return

    const loadAssignmentOptions = async () => {
      const [zonesResult, sitesResult, providersResult] = await Promise.all([
        (supabase.from('zones') as any)
          .select('id, name')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .order('name', { ascending: true }),
        (supabase.from('client_sites') as any)
          .select('id, name')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .order('name', { ascending: true }),
        (supabase.from('organizations') as any)
          .select('id, name')
          .eq('organization_type', 'service_provider')
          .eq('is_active', true)
          .order('name', { ascending: true }),
      ])

      if (zonesResult.error) {
        toast.error(`Could not load zones: ${zonesResult.error.message}`)
      } else {
        setZoneOptions(((zonesResult.data ?? []) as any[]).map((row) => ({ id: row.id, name: row.name })))
      }

      if (sitesResult.error) {
        toast.error(`Could not load client sites: ${sitesResult.error.message}`)
      } else {
        setClientSiteOptions(((sitesResult.data ?? []) as any[]).map((row) => ({ id: row.id, name: row.name })))
      }

      if (providersResult.error) {
        toast.error(`Could not load service providers: ${providersResult.error.message}`)
      } else {
        setServiceProviderOrgOptions(((providersResult.data ?? []) as any[]).map((row) => ({ id: row.id, name: row.name })))
      }
    }

    loadAssignmentOptions()
  }, [user?.organization_id])

  useEffect(() => {
    const providerOrgId = planForm.assignedServiceProviderOrgId
    if (!providerOrgId) {
      setOfficeLocationOptions([])
      return
    }

    const loadOfficeLocations = async () => {
      const { data, error } = await ((supabase as any).from('office_locations') as any)
        .select('id, name')
        .eq('organization_id', providerOrgId)
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (error) {
        toast.error(`Could not load office locations: ${error.message}`)
        return
      }

      setOfficeLocationOptions(((data ?? []) as any[]).map((row) => ({ id: row.id, name: row.name })))
    }

    loadOfficeLocations()
  }, [planForm.assignedServiceProviderOrgId])

  const selectedVoice = useMemo(() => {
    if (!availableVoices.length) return null
    const accentMatches = availableVoices.filter((voice) => voice.lang.toLowerCase().startsWith(accent.toLowerCase()))
    const englishPool = accentMatches.length ? accentMatches : availableVoices.filter((voice) => voice.lang.toLowerCase().startsWith('en'))

    const maleHints = ['david', 'matthew', 'male', 'guy', 'james', 'tom', 'daniel', 'uk', 'british']
    const maleScottishHints = ['scotland', 'scottish', 'glasgow', 'edinburgh', 'angus', 'malcolm']
    const femaleHints = ['samantha', 'karen', 'female', 'zira', 'aria', 'susan']

    if (voiceGender === 'male') {
      if (accent === 'en-GB') {
        return (
          englishPool.find((voice) => maleScottishHints.some((hint) => voice.name.toLowerCase().includes(hint))) ||
          englishPool.find((voice) => maleHints.some((hint) => voice.name.toLowerCase().includes(hint))) ||
          englishPool[0]
        )
      }
      return englishPool.find((voice) => maleHints.some((hint) => voice.name.toLowerCase().includes(hint))) || englishPool[0]
    }
    if (voiceGender === 'female') {
      return englishPool.find((voice) => femaleHints.some((hint) => voice.name.toLowerCase().includes(hint))) || englishPool[0]
    }
    return englishPool[0]
  }, [availableVoices, accent, voiceGender])

  const speak = (text: string) => {
    if (!speechEnabled || typeof window === 'undefined') return
    if (voiceConversationActiveRef.current && recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }

    speakingRef.current = true
    const utterance = new SpeechSynthesisUtterance(text)
    if (selectedVoice) utterance.voice = selectedVoice
    utterance.lang = accent
    utterance.rate = tone === 'professional' ? 0.95 : tone === 'coach' ? 1.03 : 1
    utterance.pitch = voiceGender === 'male' ? 0.9 : voiceGender === 'female' ? 1.08 : 1
    utterance.onend = () => {
      speakingRef.current = false
      if (voiceConversationActiveRef.current) {
        startVoiceConversation()
      }
    }
    utterance.onerror = () => {
      speakingRef.current = false
      if (voiceConversationActiveRef.current) {
        startVoiceConversation()
      }
    }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }

  const clearVoiceInactivityTimer = () => {
    if (inactivityTimerRef.current !== null) {
      window.clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
    }
  }

  const resetVoiceInactivityTimer = () => {
    if (typeof window === 'undefined') return
    clearVoiceInactivityTimer()
    inactivityTimerRef.current = window.setTimeout(() => {
      if (!voiceConversationActiveRef.current) return
      stopVoiceConversation()
      setVoiceActivatedConversation(false)
      toast.message('Voice conversation ended after 29 seconds of inactivity')
    }, VOICE_INACTIVITY_TIMEOUT_MS)
  }

  const containsEndPhrase = (text: string) => {
    const normalized = normalize(text)
    return BOB_END_PHRASES.some((phrase) => normalized.includes(phrase))
  }

  const stripWakePhrase = (text: string) => {
    const normalized = normalize(text)
    for (const phrase of BOB_WAKE_PHRASES) {
      const idx = normalized.indexOf(phrase)
      if (idx >= 0) {
        const stripped = text.slice(idx + phrase.length).replace(/^[\s,:-]+/, '').trim()
        return { matched: true, stripped }
      }
    }
    return { matched: false, stripped: text.trim() }
  }

  const stopVoiceConversation = () => {
    voiceConversationActiveRef.current = false
    wakeUnlockedRef.current = false
    clearVoiceInactivityTimer()
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setListening(false)
  }

  const startVoiceConversation = () => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      setVoiceActivatedConversation(false)
      setListening(false)
      toast.error('Speech recognition is not supported in this browser')
      return
    }
    if (!voiceConversationActiveRef.current) return
    if (recognitionRef.current || speakingRef.current || thinking) return

    try {
      const recognition = new Ctor()
      recognition.lang = accent
      recognition.interimResults = false
      recognition.continuous = true
      recognition.maxAlternatives = 1

      recognition.onresult = (event: any) => {
        const results = Array.from(event?.results ?? []) as any[]
        const finalTranscript = results
          .filter((r) => r?.isFinal)
          .map((r) => r?.[0]?.transcript ?? '')
          .join(' ')
          .trim()

        if (!finalTranscript) return
        resetVoiceInactivityTimer()

        if (containsEndPhrase(finalTranscript)) {
          stopVoiceConversation()
          setVoiceActivatedConversation(false)
          toast.success('Voice conversation ended')
          return
        }

        if (!wakeUnlockedRef.current) {
          const wake = stripWakePhrase(finalTranscript)
          if (!wake.matched) {
            return
          }

          wakeUnlockedRef.current = true

          if (!wake.stripped) {
            speak('Yes, I am listening.')
            return
          }

          sendMessage(wake.stripped)
          return
        }

        sendMessage(finalTranscript)
      }

      recognition.onerror = (event: any) => {
        setListening(false)
        recognitionRef.current = null
        const code = event?.error ?? 'unknown'
        if (voiceConversationActiveRef.current && code !== 'aborted' && code !== 'no-speech') {
          toast.error(`Voice capture error: ${code}`)
        }
      }

      recognition.onend = () => {
        setListening(false)
        recognitionRef.current = null
        if (voiceConversationActiveRef.current && !speakingRef.current && !thinking) {
          setTimeout(() => startVoiceConversation(), 250)
        }
      }

      recognitionRef.current = recognition
      recognition.start()
      setListening(true)
      resetVoiceInactivityTimer()
    } catch {
      setListening(false)
      recognitionRef.current = null
      if (voiceConversationActiveRef.current) {
        toast.error('Could not start voice conversation')
      }
    }
  }

  const sendMessage = async (override?: string) => {
    const message = (override ?? chatInput).trim()
    if (!message || thinking) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: message,
      createdAt: new Date().toISOString(),
    }

    setChat((prev) => [...prev, userMsg])
    setChatInput('')
    setThinking(true)
    const learningUserId = user?.id ?? 'anonymous'

    const buildRequestBody = () => {
      const historyMessages = chat
        .slice(-16)
        .map((m): { role: 'user' | 'assistant'; content: string } => ({ role: m.role, content: m.text }))
      const longTermMemory = buildBobLearningContext(learningUserId, 20)
      const compactKnowledge = BOB_PROJECT_KNOWLEDGE.slice(0, 9_000)
      const compactLongTermMemory = longTermMemory.slice(0, 5_000)
      const compactRemoteMemory = remoteLearningContext.slice(0, 5_000)
      const compactContinuationMemory = conversationContinuationContext.slice(0, 6_000)

      const rawMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
      rawMessages.push({ role: 'assistant', content: compactKnowledge })
      if (compactLongTermMemory) rawMessages.push({ role: 'assistant', content: compactLongTermMemory })
      if (compactRemoteMemory) rawMessages.push({ role: 'assistant', content: compactRemoteMemory })
      if (compactContinuationMemory) rawMessages.push({ role: 'assistant', content: compactContinuationMemory })
      rawMessages.push(...historyMessages, { role: 'user', content: message })

      return {
        messages: rawMessages,
        provider: 'ollama' as const,
        context: {
          tone,
          source: 'bob-studio',
          privacy: {
            expressPermission: expressUserDataPermission,
            permittedUserIdentity: permittedUserIdentity || null,
          },
          biometric_scaffold: {
            voicePatternLearningConsent,
            faceClarificationConsent,
            note: 'Consent scaffold only - no biometric persistence enabled in this build.',
          },
        },
      }
    }

    try {
      const { data, error } = await edgeFunctions.aiChat(buildRequestBody())
      if (error || !data?.response) {
        throw new Error(error || 'Bob returned an empty response')
      }

      const replyText: string = data?.response || 'I could not generate a response. Please try again.'

      const bobMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: replyText,
        createdAt: new Date().toISOString(),
      }

      setChat((prev) => [...prev, bobMsg])

      // Continuous learning: persist each exchange so future prompts can reuse
      // Bob's prior outcomes instead of starting from scratch.
      await persistBobLearningRemote({
        userId: learningUserId,
        organizationId: user?.organization_id ?? null,
        route: '/bob-assistant',
        source: collaborationPacket?.source ?? 'bob-studio',
        userMessage: message,
        assistantReply: replyText,
      })

      await persistConversationTurnRemote({
        userId: learningUserId,
        organizationId: user?.organization_id ?? null,
        route: '/bob-assistant',
        source: collaborationPacket?.source ?? 'bob-studio',
        userMessage: message,
        assistantReply: replyText,
        currentRoute: window.location.pathname,
        destinationHint: destination || null,
      })

      // Refresh remote context opportunistically after successful persistence.
      if (learningUserId !== 'anonymous') {
        const [refreshedRemote, refreshedContinuation] = await Promise.all([
          buildBobLearningContextRemote(learningUserId, 20),
          buildConversationContinuationContextRemote(learningUserId, 16),
        ])
        setRemoteLearningContext(refreshedRemote)
        setConversationContinuationContext(refreshedContinuation)
      }

      // Publish response back to the originating component (sub-agent pattern)
      if (collaborationPacket && !hasPublishedResponseRef.current) {
        hasPublishedResponseRef.current = true
        publishBobResponse(collaborationPacket.id, replyText)

        // Auto-return to the originating page when the packet was submitted automatically
        // (i.e. the caller navigated here on behalf of the user, so return them when done).
        if (collaborationPacket.autoSubmit && collaborationPacket.returnRoute) {
          setTimeout(() => navigate(collaborationPacket.returnRoute!), 1800)
        }
      }

      if (autoSpeakReplies) {
        speak(replyText)
      }
    } catch (err: any) {
      console.error('Bob assistant invoke failed:', err)
      const replyText = 'Bob/Ollama is temporarily unavailable right now. Please retry in a moment.'
      const bobMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: replyText,
        createdAt: new Date().toISOString(),
      }
      setChat((prev) => [...prev, bobMsg])

      // Even in degraded mode, capture what was asked and what was answered.
      await persistBobLearningRemote({
        userId: learningUserId,
        organizationId: user?.organization_id ?? null,
        route: '/bob-assistant',
        source: collaborationPacket?.source ?? 'bob-ollama-unavailable',
        userMessage: message,
        assistantReply: replyText,
      })

      await persistConversationTurnRemote({
        userId: learningUserId,
        organizationId: user?.organization_id ?? null,
        route: '/bob-assistant',
        source: collaborationPacket?.source ?? 'bob-ollama-unavailable',
        userMessage: message,
        assistantReply: replyText,
        currentRoute: window.location.pathname,
        destinationHint: destination || null,
      })

      if (learningUserId !== 'anonymous') {
        const refreshedContinuation = await buildConversationContinuationContextRemote(learningUserId, 16)
        setConversationContinuationContext(refreshedContinuation)
      }

      if (collaborationPacket && !hasPublishedResponseRef.current) {
        hasPublishedResponseRef.current = true
        publishBobResponse(collaborationPacket.id, replyText)
        if (collaborationPacket.autoSubmit && collaborationPacket.returnRoute) {
          setTimeout(() => navigate(collaborationPacket.returnRoute!), 1800)
        }
      }

      if (autoSpeakReplies) speak(replyText)
      const shortError = String(err?.message || 'unknown_error').slice(0, 120)
      toast.error(`Bob/Ollama service unavailable (${shortError})`)
    } finally {
      setThinking(false)
    }
  }

  const handleViewMyMemory = async () => {
    if (!user?.id) {
      toast.error('Please sign in to view memory')
      return
    }
    setMemoryLoading(true)
    try {
      const snapshot = await getBobMemorySnapshotRemote(user.id, 8)
      setMemorySnapshot(snapshot)
      setMemoryPanelOpen(true)
    } finally {
      setMemoryLoading(false)
    }
  }

  const handleForgetLastConversation = async () => {
    if (!user?.id) {
      toast.error('Please sign in to manage memory')
      return
    }
    setMemoryLoading(true)
    try {
      await forgetLastConversationRemote(user.id)
      const [learningContext, continuationContext, snapshot] = await Promise.all([
        buildBobLearningContextRemote(user.id, 20),
        buildConversationContinuationContextRemote(user.id, 16),
        getBobMemorySnapshotRemote(user.id, 8),
      ])
      setRemoteLearningContext(learningContext)
      setConversationContinuationContext(continuationContext)
      setMemorySnapshot(snapshot)
      setMemoryPanelOpen(true)
      toast.success('Last conversation memory removed')
    } finally {
      setMemoryLoading(false)
    }
  }

  const handleClearAllMemory = async () => {
    if (!user?.id) {
      toast.error('Please sign in to manage memory')
      return
    }
    setMemoryLoading(true)
    try {
      await clearAllBobMemoryRemote(user.id)
      setRemoteLearningContext('')
      setConversationContinuationContext('')
      setMemorySnapshot({
        conversationTurns: 0,
        learningEntries: 0,
        recentTurns: [],
        recentLearning: [],
      })
      setMemoryPanelOpen(true)
      toast.success('All Bob memory cleared for your account')
    } finally {
      setMemoryLoading(false)
    }
  }

  const toggleListening = () => {
    if (voiceActivatedConversation) {
      toast.message('Voice Activated Conversation is enabled. Disable it to use one-shot voice input.')
      return
    }
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      toast.error('Speech recognition is not supported in this browser')
      return
    }

    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const recognition = new Ctor()
    recognition.lang = accent
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript || ''
      if (transcript) {
        sendMessage(transcript)
      }
    }
    recognition.onerror = () => {
      setListening(false)
      toast.error('Voice capture failed. Try again.')
    }
    recognition.onend = () => {
      setListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  useEffect(() => {
    if (!speechEnabled && voiceActivatedConversation) {
      setVoiceActivatedConversation(false)
      stopVoiceConversation()
      return
    }

    if (!voiceActivatedConversation) {
      stopVoiceConversation()
      return
    }

    voiceConversationActiveRef.current = true
    wakeUnlockedRef.current = false
    resetVoiceInactivityTimer()
    startVoiceConversation()

    return () => {
      stopVoiceConversation()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActivatedConversation, speechEnabled])

  useEffect(() => {
    return () => {
      stopVoiceConversation()
      if (typeof window !== 'undefined') {
        window.speechSynthesis.cancel()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openDirections = () => {
    if (!origin.trim() || !destination.trim()) {
      toast.error('Enter origin and destination first')
      return
    }
    const url = buildMapDirectionsUrl(origin, destination, travelMode)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const updatePlanForm = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => {
    setPlanForm((prev) => ({ ...prev, [key]: value }))
  }

  const generatePlan = () => {
    if (isHazardReviewRequiredPlan(planForm.planType)) {
      if (!planForm.environmentalHazards.trim() || !planForm.biologicalHazards.trim() || !planForm.hazardControls.trim()) {
        toast.error('Risk and H&S plans require environmental hazards, biological hazards, and hazard controls.')
        return
      }
      if (!planForm.weatherSummary.trim() || !planForm.extremeWeatherPlan.trim()) {
        toast.error('Risk and H&S plans require weather conditions and extreme-condition controls (heat/cold/storm).')
        return
      }
    }

    const documentText = buildPlanDocument(planForm, planRecommendations)
    setGeneratedPlan(documentText)
    toast.success('Draft plan generated')
  }

  const saveLivePlan = async () => {
    const orgId = user?.organization_id
    if (!orgId) {
      toast.error('Your user profile is missing organization context')
      return
    }
    if (!generatedPlan.trim()) {
      toast.error('Generate a draft before saving a live plan')
      return
    }
    if (planForm.assignmentScope === 'zone' && !planForm.assignedZoneId) {
      toast.error('Select a zone for zone-scoped plans')
      return
    }
    if (planForm.assignmentScope === 'client_site' && !planForm.assignedClientSiteId) {
      toast.error('Select a client site for site-scoped plans')
      return
    }
    if (planForm.assignmentScope === 'service_provider_office') {
      if (!planForm.assignedServiceProviderOrgId || !planForm.assignedOfficeLocationId) {
        toast.error('Select a service provider and office location for office-scoped plans')
        return
      }
    }

    setSavingPlan(true)
    try {
      const title = planForm.planTitle.trim() || PLAN_TYPE_LABELS[planForm.planType]

      const { data: crmDocument, error: crmDocumentError } = await (((supabase as any).from('crm_documents')) as any)
        .insert({
          organization_id: orgId,
          name: title,
          description: `Live operational plan (${planForm.planType}) generated by Bob`,
          file_path: `generated/live-plans/${Date.now()}-${title.replace(/\s+/g, '-').toLowerCase()}.md`,
          file_name: `${title}.md`,
          file_type: 'text/markdown',
          file_size_bytes: generatedPlan.length,
          document_type: 'compliance',
          uploaded_by: user?.id ?? null,
        })
        .select('id')
        .single()

      if (crmDocumentError) {
        throw crmDocumentError
      }

      const { error: livePlanError } = await (((supabase as any).from('ops_live_plans')) as any)
        .insert({
          organization_id: orgId,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
          crm_document_id: crmDocument?.id ?? null,
          plan_type: planForm.planType,
          title,
          status: 'active',
          assignment_scope: planForm.assignmentScope,
          zone_id: planForm.assignedZoneId || null,
          client_site_id: planForm.assignedClientSiteId || null,
          service_provider_org_id: planForm.assignedServiceProviderOrgId || null,
          service_provider_office_id: planForm.assignedOfficeLocationId || null,
          field_staff_can_view: planForm.fieldStaffCanView,
          review_on_incident: true,
          review_on_hs_report: true,
          review_on_poi_report: true,
          review_on_voi_report: true,
          weather_conditions: planForm.weatherSummary || null,
          extreme_weather_protocol: planForm.extremeWeatherPlan || null,
          environmental_hazards: planForm.environmentalHazards || null,
          biological_hazards: planForm.biologicalHazards || null,
          hazard_controls: planForm.hazardControls || null,
          plan_body: generatedPlan,
          recommendations: planRecommendations,
          generated_context: planForm,
          next_review_due_at: new Date().toISOString(),
        })

      if (livePlanError) {
        throw livePlanError
      }

      toast.success('Live plan saved and assigned in CRM')
    } catch (error: any) {
      toast.error(`Failed to save live plan: ${error?.message ?? 'Unknown error'}`)
    } finally {
      setSavingPlan(false)
    }
  }

  const copyPlan = async () => {
    if (!generatedPlan.trim()) {
      toast.error('Generate a plan first')
      return
    }
    await navigator.clipboard.writeText(generatedPlan)
    toast.success('Plan copied to clipboard')
  }

  const submitCodeChangeRequest = async () => {
    if (!codeChangeRequest.summary.trim()) {
      toast.error('Code change summary is required')
      return
    }
    if (!codeChangeRequest.confirmed) {
      toast.error('Please confirm before generating a code patch task')
      return
    }

    setCodeTaskLoading(true)
    try {
      if (!isGrandMaster) {
        const requesterName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || 'Unknown user'
        const summary = codeChangeRequest.summary.trim()
        const details = codeChangeRequest.details.trim()

        const { data: approvers, error: approverError } = await (supabase.from('user_profiles') as any)
          .select('id, first_name, last_name, email, role, is_active')
          .eq('role', 'grand_master')
          .eq('is_active', true)
          .limit(20)

        if (approverError) throw approverError

        const rows = (approvers ?? []).map((approver: any) => {
          const approverName = [approver.first_name, approver.last_name].filter(Boolean).join(' ').toLowerCase()
          const isDon = approverName.includes('don') || String(approver.email || '').toLowerCase().includes('don')
          return {
            user_id: approver.id,
            type: 'system_alert',
            title: isDon ? 'Bob: Don approval requested for code fix' : 'Bob: Grand Master approval requested for code fix',
            body: `${requesterName} reported a bug that requires code-fix approval. Summary: ${summary}`,
            data: {
              source: 'bob-assistant-studio',
              requires_code_fix_approval: true,
              requester_name: requesterName,
              requester_id: user?.id ?? null,
              summary,
              details,
              severity: codeChangeRequest.severity,
              complexity: codeChangeRequest.complexity,
              target_paths: codeChangeRequest.targetPaths,
            },
            priority: codeChangeRequest.severity === 'critical' || codeChangeRequest.severity === 'high' ? 'high' : 'normal',
            read: false,
            delivered: false,
          }
        })

        if (!rows.length) {
          toast.error('No active Grand Master approver found')
          return
        }

        const { error: notifyError } = await (supabase.from('notifications') as any).insert(rows)
        if (notifyError) throw notifyError

        setCodeTaskResult(JSON.stringify({
          status: 'approval_requested',
          approvers_notified: rows.length,
          note: 'Only Grand Master can approve code changes. Bob has notified Don/Grand Master approvers.',
        }, null, 2))

        toast.success('Approval request sent to Don/Grand Master approvers')
        return
      }

      const targetPaths = codeChangeRequest.targetPaths
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)

      const { data, error } = await edgeFunctions.bobCodeChangeTask({
        summary: codeChangeRequest.summary.trim(),
        details: codeChangeRequest.details.trim() || undefined,
        stack_trace: codeChangeRequest.stackTrace.trim() || undefined,
        severity: codeChangeRequest.severity,
        complexity: codeChangeRequest.complexity,
        target_paths: targetPaths.length ? targetPaths : undefined,
      })

      if (error) throw new Error(String(error) || 'Could not generate code patch task')

      const payload = {
        execution_mode: data?.execution_mode,
        github_assist_required: data?.github_assist_required,
        note: data?.note,
        patch_task: data?.patch_task,
      }

      setCodeTaskResult(JSON.stringify(payload, null, 2))

      if (data?.github_assist_required) {
        toast.success('Complex issue routed to GitHub-assist mode')
      } else {
        toast.success('Self-healing patch task generated')
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate code patch task')
    } finally {
      setCodeTaskLoading(false)
    }
  }

  return (
    <AppLayout title="Bob Assistant Studio" description="Personality, voice, mapping, and drawing controls for Bob.">
      <GlobalFilterRibbon />

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BrainCircuit className="h-4 w-4" /> Bob Personality</CardTitle>
              <CardDescription>Tune how Bob looks, sounds, and responds.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Bob" />
              </div>

              <div className="rounded-md border p-2 space-y-2">
                <div className="text-xs text-muted-foreground">Quick voice presets</div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={applyClassicCommandVoicePreset}>
                    Classic Command
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={applySoftConversationalPreset}>
                    Soft Conversational
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Tone</Label>
                <Select value={tone} onValueChange={(value) => setTone(value as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="coach">Coach</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Voice Gender</Label>
                <Select value={voiceGender} onValueChange={(value) => setVoiceGender(value as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Accent</Label>
                <Select value={accent} onValueChange={(value) => setAccent(value as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en-NZ">New Zealand English</SelectItem>
                    <SelectItem value="en-AU">Australian English</SelectItem>
                    <SelectItem value="en-GB">British English</SelectItem>
                    <SelectItem value="en-US">United States English</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">For a classic warm male assistant vibe, use Male + British English.</p>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="speech-enabled">Speech enabled</Label>
                <Switch id="speech-enabled" checked={speechEnabled} onCheckedChange={setSpeechEnabled} />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="autospeak-enabled">Auto-speak replies</Label>
                <Switch id="autospeak-enabled" checked={autoSpeakReplies} onCheckedChange={setAutoSpeakReplies} />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="voice-activated-conversation">Voice activated conversation</Label>
                <Switch
                  id="voice-activated-conversation"
                  checked={voiceActivatedConversation}
                  onCheckedChange={setVoiceActivatedConversation}
                  disabled={!speechEnabled || !voiceSupported}
                />
              </div>

              <div className="text-xs text-muted-foreground">
                Active voice: {selectedVoice ? `${selectedVoice.name} (${selectedVoice.lang})` : 'No compatible voice found'}
                {voiceSupported ? '' : ' · Voice input not supported in this browser'}
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Privacy & Permission Controls</div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="express-user-permission">Express user permission for personal data requests</Label>
                  <Switch
                    id="express-user-permission"
                    checked={expressUserDataPermission}
                    onCheckedChange={setExpressUserDataPermission}
                  />
                </div>
                <Input
                  value={permittedUserIdentity}
                  onChange={(e) => setPermittedUserIdentity(e.target.value)}
                  placeholder="Permitted user identity (name/email)"
                  disabled={!expressUserDataPermission}
                />
                <p className="text-xs text-muted-foreground">
                  Any personal-data request is audited. If permission is off, Bob blocks disclosure unless Grand Master override applies.
                </p>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Biometric Consent Scaffold (No Storage)</div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="voice-pattern-consent">Voice pattern clarification consent</Label>
                  <Switch
                    id="voice-pattern-consent"
                    checked={voicePatternLearningConsent}
                    onCheckedChange={setVoicePatternLearningConsent}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="face-clarification-consent">Face clarification consent</Label>
                  <Switch
                    id="face-clarification-consent"
                    checked={faceClarificationConsent}
                    onCheckedChange={setFaceClarificationConsent}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Scaffold only: this build does not store or train on biometric templates.
                </p>
              </div>
              {voiceActivatedConversation && (
                <div className="text-xs text-muted-foreground">
                  Say "Hey Bob" (or "OK Bob") to start, then continue naturally. Say "thank you" (or similar) to end. Bob auto-stops after 29 seconds of inactivity.
                </div>
              )}

              <div className="rounded-md border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-medium text-muted-foreground">Bob Memory Controls</div>
                  <Badge variant="outline">Per-user</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={handleViewMyMemory} disabled={memoryLoading || !user?.id}>
                    {memoryLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                    View My Memory
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleForgetLastConversation} disabled={memoryLoading || !user?.id}>
                    {memoryLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                    Forget Last Conversation
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleClearAllMemory} disabled={memoryLoading || !user?.id}>
                    {memoryLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                    Clear All My Memory
                  </Button>
                </div>
                {memoryPanelOpen && (
                  <div className="rounded border bg-muted/30 p-2 space-y-2 text-xs">
                    <div className="flex flex-wrap gap-3 text-muted-foreground">
                      <span>Conversation turns: {memorySnapshot?.conversationTurns ?? 0}</span>
                      <span>Learning entries: {memorySnapshot?.learningEntries ?? 0}</span>
                    </div>
                    {(memorySnapshot?.recentTurns?.length ?? 0) > 0 && (
                      <div className="space-y-1">
                        <div className="font-medium">Recent conversation memory</div>
                        {memorySnapshot?.recentTurns.slice(0, 4).map((turn, idx) => (
                          <div key={`${turn.createdAt}-${idx}`} className="text-muted-foreground truncate">
                            {turn.role === 'assistant' ? 'Bob' : 'You'}: {turn.message}
                          </div>
                        ))}
                      </div>
                    )}
                    {(memorySnapshot?.recentLearning?.length ?? 0) > 0 && (
                      <div className="space-y-1">
                        <div className="font-medium">Recent long-term learning</div>
                        {memorySnapshot?.recentLearning.slice(0, 4).map((entry, idx) => (
                          <div key={`${entry.lastUsedAt}-${idx}`} className="text-muted-foreground truncate">
                            {entry.topic} (uses: {entry.useCount})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MapPinned className="h-4 w-4" /> Map Directions</CardTitle>
              <CardDescription>Get turn-by-turn directions from Bob.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Origin" value={origin} onChange={(e) => setOrigin(e.target.value)} />
              <Input placeholder="Destination" value={destination} onChange={(e) => setDestination(e.target.value)} />
              <Select value={travelMode} onValueChange={(value) => setTravelMode(value as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="driving">Driving</SelectItem>
                  <SelectItem value="walking">Walking</SelectItem>
                  <SelectItem value="transit">Transit</SelectItem>
                </SelectContent>
              </Select>
              <Button className="w-full" onClick={openDirections}><Route className="h-4 w-4 mr-1" /> Open Directions</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" /> Code Change Request</CardTitle>
              <CardDescription>
                Use Bob to generate executable patch tasks. Simple/moderate issues run through self-healing mode; complex issues are escalated to GitHub assist.
              </CardDescription>
              {isGrandMaster && (
                <div>
                  <Button variant="outline" size="sm" onClick={() => navigate('/compliance-escalations')}>
                    <ShieldAlert className="h-4 w-4 mr-1" /> Open Compliance Escalations
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={codeChangeRequest.summary}
                onChange={(e) => setCodeChangeRequest((prev) => ({ ...prev, summary: e.target.value }))}
                placeholder="Short summary of the code issue"
              />
              <Textarea
                value={codeChangeRequest.details}
                onChange={(e) => setCodeChangeRequest((prev) => ({ ...prev, details: e.target.value }))}
                placeholder="Details / expected behavior / acceptance criteria"
              />
              <Textarea
                value={codeChangeRequest.stackTrace}
                onChange={(e) => setCodeChangeRequest((prev) => ({ ...prev, stackTrace: e.target.value }))}
                placeholder="Stack trace (optional)"
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Severity</Label>
                  <Select
                    value={codeChangeRequest.severity}
                    onValueChange={(value) =>
                      setCodeChangeRequest((prev) => ({ ...prev, severity: value as CodeChangeRequest['severity'] }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Complexity</Label>
                  <Select
                    value={codeChangeRequest.complexity}
                    onValueChange={(value) =>
                      setCodeChangeRequest((prev) => ({ ...prev, complexity: value as CodeChangeRequest['complexity'] }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">Simple</SelectItem>
                      <SelectItem value="moderate">Moderate</SelectItem>
                      <SelectItem value="complex">Complex (GitHub assist)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Input
                value={codeChangeRequest.targetPaths}
                onChange={(e) => setCodeChangeRequest((prev) => ({ ...prev, targetPaths: e.target.value }))}
                placeholder="Target paths (comma separated, optional)"
              />

              <div className="flex items-center justify-between">
                <Label htmlFor="bob-code-confirm">I confirm Bob should generate a code patch task</Label>
                <Switch
                  id="bob-code-confirm"
                  checked={codeChangeRequest.confirmed}
                  onCheckedChange={(checked) =>
                    setCodeChangeRequest((prev) => ({ ...prev, confirmed: checked }))
                  }
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={submitCodeChangeRequest} disabled={codeTaskLoading}>
                  {codeTaskLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wrench className="h-4 w-4 mr-1" />}
                  {isGrandMaster ? 'Generate Patch Task' : 'Request Grand Master Approval'}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!codeTaskResult.trim()) return
                    await navigator.clipboard.writeText(codeTaskResult)
                    toast.success('Patch task copied')
                  }}
                  disabled={!codeTaskResult.trim()}
                >
                  <Github className="h-4 w-4 mr-1" /> Copy for GitHub/Copilot
                </Button>
              </div>

              <Textarea
                value={codeTaskResult}
                readOnly
                placeholder="Generated patch-task payload will appear here"
                className="min-h-[180px] font-mono text-xs"
              />

              {!isGrandMaster && (
                <p className="text-xs text-muted-foreground">
                  Only Grand Master can approve and execute code changes. Bob will notify Don/Grand Master approvers when you submit a bug fix request.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><BrainCircuit className="h-4 w-4" /> Conversation</span>
                <Badge variant="outline">{displayName}</Badge>
              </CardTitle>
              <CardDescription>Talk to Bob by typing or voice. Bob is your inference agent and assistant, and can coordinate build context across DB, UI, Expo, Railway, and Vercel workflows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {collaborationPacket && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
                  <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                    <ShieldAlert className="h-4 w-4" /> Collaboration Context Loaded
                  </div>
                  <p className="mt-1 text-amber-800 dark:text-amber-300">{collaborationPacket.title}</p>
                  {collaborationPacket.summary && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{collaborationPacket.summary}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <div className="flex flex-wrap gap-2">
                      <span>Source: {collaborationPacket.source}</span>
                      <span>·</span>
                      <span>{new Date(collaborationPacket.createdAt).toLocaleString('en-NZ')}</span>
                      {collaborationPacket.autoSubmit && <span className="font-semibold text-amber-800 dark:text-amber-300">· Auto-submitted</span>}
                    </div>
                    {collaborationPacket.returnRoute && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 border-amber-400 px-2 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/30"
                        onClick={() => navigate(collaborationPacket.returnRoute!)}
                      >
                        ← Return
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="max-h-[300px] overflow-auto rounded border p-3 space-y-2 bg-muted/20">
                {chat.length === 0 && !thinking ? (
                  <div className="text-sm text-muted-foreground">No messages yet. Ask Bob for import help, directions, or operational guidance.</div>
                ) : (
                  chat.map((message) => (
                    <div key={message.id} className={`rounded px-3 py-2 text-sm ${message.role === 'assistant' ? 'bg-primary text-primary-foreground' : 'bg-background border'}`}>
                      <div className="text-[11px] opacity-80 mb-1">{message.role === 'assistant' ? displayName : 'You'}</div>
                      <div>{message.text}</div>
                    </div>
                  ))
                )}
                {thinking && (
                  <div className="rounded px-3 py-2 text-sm bg-primary/70 text-primary-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    <span>{displayName} is thinking…</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="flex gap-2">
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask Bob anything operational..."
                  className="min-h-[80px]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => sendMessage()} disabled={!chatInput.trim() || thinking}><Send className="h-4 w-4 mr-1" /> Send</Button>
                <Button variant="outline" onClick={toggleListening}>
                  {listening ? <MicOff className="h-4 w-4 mr-1" /> : <Mic className="h-4 w-4 mr-1" />}
                  {listening ? 'Stop Listening' : 'Voice Input'}
                </Button>
                <Button variant="outline" onClick={() => speak('Hello, I am Bob. Ready when you are.')} disabled={!speechEnabled}>
                  {speechEnabled ? <Volume2 className="h-4 w-4 mr-1" /> : <VolumeX className="h-4 w-4 mr-1" />} Test Voice
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Operations Planning Workspace</CardTitle>
              <CardDescription>
                Draft SOPs, assignment instructions, risk assessments, H&S plans, evacuation plans, active offender procedures, and crowded places action plans.
                Bob asks for user input, then generates recommendations and a structured draft.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Plan Type</Label>
                  <Select value={planForm.planType} onValueChange={(value) => updatePlanForm('planType', value as PlanType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PLAN_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Plan Title</Label>
                  <Input value={planForm.planTitle} onChange={(e) => updatePlanForm('planTitle', e.target.value)} placeholder="Example: Site Guard SOP - Downtown Depot" />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input value={planForm.organizationName} onChange={(e) => updatePlanForm('organizationName', e.target.value)} placeholder="Organization" />
                <Input value={planForm.deploymentType} onChange={(e) => updatePlanForm('deploymentType', e.target.value)} placeholder="Deployment Type" />
                <Input value={planForm.siteName} onChange={(e) => updatePlanForm('siteName', e.target.value)} placeholder="Site Name" />
                <Input value={planForm.siteAddress} onChange={(e) => updatePlanForm('siteAddress', e.target.value)} placeholder="Site Address" />
                <Input value={planForm.peopleCount} onChange={(e) => updatePlanForm('peopleCount', e.target.value)} placeholder="Number of People" />
                <Input value={planForm.mapReference} onChange={(e) => updatePlanForm('mapReference', e.target.value)} placeholder="Map Reference or URL" />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input type="time" value={planForm.shiftStart} onChange={(e) => updatePlanForm('shiftStart', e.target.value)} placeholder="Shift Start" />
                <Input type="time" value={planForm.shiftEnd} onChange={(e) => updatePlanForm('shiftEnd', e.target.value)} placeholder="Shift End" />
              </div>

              <Textarea value={planForm.weatherSummary} onChange={(e) => updatePlanForm('weatherSummary', e.target.value)} placeholder="Weather conditions forecast (including temperature bands, wind, rain, visibility)" />
              <Textarea value={planForm.extremeWeatherPlan} onChange={(e) => updatePlanForm('extremeWeatherPlan', e.target.value)} placeholder="Extreme conditions protocol (extreme cold, heat, storm, flooding, rapid deterioration)" />

              <Textarea value={planForm.previousHistory} onChange={(e) => updatePlanForm('previousHistory', e.target.value)} placeholder="Previous history, incidents, or lessons learned" />
              <Textarea value={planForm.knownThreats} onChange={(e) => updatePlanForm('knownThreats', e.target.value)} placeholder="Known threats and vulnerabilities" />
              <Textarea value={planForm.environmentalHazards} onChange={(e) => updatePlanForm('environmentalHazards', e.target.value)} placeholder="Environmental hazards (weather, terrain, flood, heat/cold, visibility, slips/trips)" />
              <Textarea value={planForm.biologicalHazards} onChange={(e) => updatePlanForm('biologicalHazards', e.target.value)} placeholder="Biological hazards (infectious exposure, pests, contamination, waste, water quality)" />
              <Textarea value={planForm.entryPoints} onChange={(e) => updatePlanForm('entryPoints', e.target.value)} placeholder="Entry and access points" />
              <Textarea value={planForm.evacuationPoints} onChange={(e) => updatePlanForm('evacuationPoints', e.target.value)} placeholder="Evacuation routes and muster points" />
              <Textarea value={planForm.commandStructure} onChange={(e) => updatePlanForm('commandStructure', e.target.value)} placeholder="Command structure and role assignments" />
              <Textarea value={planForm.commsPlan} onChange={(e) => updatePlanForm('commsPlan', e.target.value)} placeholder="Comms plan (channels, escalation, fallback)" />
              <Textarea value={planForm.hazardControls} onChange={(e) => updatePlanForm('hazardControls', e.target.value)} placeholder="Controls for environmental/biological hazards (eliminate, isolate, engineer, PPE, monitor)" />
              <Textarea value={planForm.ppeRequirements} onChange={(e) => updatePlanForm('ppeRequirements', e.target.value)} placeholder="PPE requirements" />
              <Textarea value={planForm.medicalSupport} onChange={(e) => updatePlanForm('medicalSupport', e.target.value)} placeholder="Medical support and emergency services linkage" />

              <div className="rounded-lg border p-3 space-y-3">
                <div className="text-xs font-medium text-muted-foreground">CRM Assignment and Field Access</div>
                <div className="space-y-1.5">
                  <Label>Assignment Scope</Label>
                  <Select value={planForm.assignmentScope} onValueChange={(value) => updatePlanForm('assignmentScope', value as PlanForm['assignmentScope'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="organization">Organization-wide</SelectItem>
                      <SelectItem value="zone">Zone</SelectItem>
                      <SelectItem value="client_site">Client site</SelectItem>
                      <SelectItem value="service_provider_office">Service provider office</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {planForm.assignmentScope === 'zone' && (
                  <div className="space-y-1.5">
                    <Label>Zone</Label>
                    <Select value={planForm.assignedZoneId} onValueChange={(value) => updatePlanForm('assignedZoneId', value)}>
                      <SelectTrigger><SelectValue placeholder="Select zone" /></SelectTrigger>
                      <SelectContent>
                        {zoneOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {planForm.assignmentScope === 'client_site' && (
                  <div className="space-y-1.5">
                    <Label>Client Site</Label>
                    <Select value={planForm.assignedClientSiteId} onValueChange={(value) => updatePlanForm('assignedClientSiteId', value)}>
                      <SelectTrigger><SelectValue placeholder="Select client site" /></SelectTrigger>
                      <SelectContent>
                        {clientSiteOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {planForm.assignmentScope === 'service_provider_office' && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Service Provider</Label>
                      <Select value={planForm.assignedServiceProviderOrgId} onValueChange={(value) => updatePlanForm('assignedServiceProviderOrgId', value)}>
                        <SelectTrigger><SelectValue placeholder="Select service provider" /></SelectTrigger>
                        <SelectContent>
                          {serviceProviderOrgOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Office</Label>
                      <Select value={planForm.assignedOfficeLocationId} onValueChange={(value) => updatePlanForm('assignedOfficeLocationId', value)}>
                        <SelectTrigger><SelectValue placeholder="Select office location" /></SelectTrigger>
                        <SelectContent>
                          {officeLocationOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between">
                  <Label htmlFor="field-staff-access">Field staff can access this live plan</Label>
                  <Switch id="field-staff-access" checked={planForm.fieldStaffCanView} onCheckedChange={(value) => updatePlanForm('fieldStaffCanView', value)} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Live-plan review events are automatically raised when incident, H&S, POI, or VOI activity is recorded for the relevant zone/location.
                </div>
              </div>

              <div className="rounded-lg border p-3 bg-muted/20">
                <div className="text-xs font-medium text-muted-foreground mb-2">Bob Recommendations</div>
                <ul className="space-y-1 text-sm">
                  {planRecommendations.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-2">
                <Button onClick={generatePlan}>Generate Draft</Button>
                <Button variant="outline" onClick={copyPlan}>Copy Draft</Button>
                <Button variant="secondary" onClick={saveLivePlan} disabled={savingPlan}>{savingPlan ? 'Saving…' : 'Save Live Plan'}</Button>
              </div>

              <Textarea
                value={generatedPlan}
                onChange={(e) => setGeneratedPlan(e.target.value)}
                placeholder="Generated plan will appear here"
                className="min-h-[260px] font-mono text-xs"
              />
            </CardContent>
          </Card>

          <BobSketchPad />
        </div>
      </div>
    </AppLayout>
  )
}
