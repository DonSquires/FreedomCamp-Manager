import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { BobActionApprovalDialog, type BobRecommendation } from '@/components/features/BobActionApprovalDialog'
import { useBobAssistantStore } from '@/stores/bobAssistantStore'
import { getEffectiveBobExecutionPolicy, useBobExecutionPolicyStore } from '@/stores/bobExecutionPolicyStore'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { useBobActionApproval } from '@/hooks/useBobActionApproval'
import { listPendingBobActionProposals, type BobActionProposalRow } from '@/hooks/useBobApprovalD1'
import { usePTTStore } from '@/stores/pttStore'
import { supabase } from '@/lib/supabase'
import { BrainCircuit, CheckCircle2, ClipboardList, FlaskConical, Loader2, MapPinned, Mic, MicOff, Paintbrush2, Play, Radio, Route, Send, Volume2, VolumeX, Wrench, Github, ShieldAlert, PhoneOff, SignalHigh, Stethoscope, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { assertBobMutationAccess } from '@/lib/bobMutationCatalog'
import { smokeTests, dataVerification, performanceTests, runBugFixDeepDive } from '@/lib/testUtils'
import { consumeLatestBobCollaborationPacket, publishBobResponse, type BobCollaborationPacket } from '@/lib/bobCollaboration'
import { BOB_PROJECT_KNOWLEDGE } from '@/lib/bobKnowledgeBase'
import { BobOrb, type BobOrbState } from '@/components/features/BobOrb'
import {
  clearPTTCustomAudioSourceFactory,
  connectToPTT,
  disconnectFromPTT,
  getPTTDiagnostics,
  setPTTCustomAudioSourceFactory,
  startSpeaking,
  stopSpeaking,
} from '@/lib/ptt'
import {
  createBobRadioAudioSource,
  createBobSpeechAudioSourceFromBase64,
  estimateBobRadioSignalDurationMs,
  type BobRadioSignalProfile,
} from '@/lib/bobRtcAgent'
import { useBobIdentitySettings, type EmergencyCancelVerificationMode } from '@/hooks/useBobIdentitySettings'
import {
  consumeLatestEmergencyAssistRequest,
  EMERGENCY_ASSIST_REQUEST_EVENT,
} from '@/lib/emergencyAssistBridge'
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
import { classifyBobCommand, evaluateBobCommandPolicy, type BobCommand } from '@/lib/bobCommandBus'
import { radioTranslationService } from '@/lib/radio/radioTranslationService'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  actionChecklist?: string[]
  executionReview?: {
    currentRoute?: string | null
    matchedRoutes?: string[]
    matchedEntities?: string[]
    candidateMutationContracts?: string[]
    requestedMutationContract?: string | null
    mutationAccess?: { allowed: boolean; reason: string } | null
    policyMode?: string
  }
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

function formatApprovalDueState(approvalDueAt: string): string {
  const deltaMs = new Date(approvalDueAt).getTime() - Date.now()
  if (deltaMs <= 0) return 'overdue'
  const seconds = Math.ceil(deltaMs / 1000)
  if (seconds < 60) return `due in ${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  return `due in ${minutes}m`
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

type DoctorPlaybookId = 'ollama_recovery' | 'ptt_token_path_repair' | 'edge_auth_alignment'

interface BobRadioChannel {
  id: string
  channel_number: number
  name: string
  channel_type: string
  is_active: boolean
}

const DEFAULT_BOB_RADIO_CHANNELS: BobRadioChannel[] = [
  { id: 'bob-default-1', channel_number: 1, name: 'All Units', channel_type: 'primary', is_active: true },
  { id: 'bob-default-2', channel_number: 2, name: 'Dispatch', channel_type: 'dispatch', is_active: true },
  { id: 'bob-default-3', channel_number: 3, name: 'Operations', channel_type: 'team', is_active: true },
  { id: 'bob-default-9', channel_number: 9, name: 'EMERGENCY', channel_type: 'emergency', is_active: true },
]

function hashScopeSeed(seed: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= c
    h2 = Math.imul(h2, 0x27d4eb2d)
  }
  const p1 = (h1 >>> 0).toString(16).padStart(8, '0')
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0')
  const merged = `${p1}${p2}${p1}${p2}`
  return `${merged.slice(0, 8)}-${merged.slice(8, 12)}-${merged.slice(12, 16)}-${merged.slice(16, 20)}-${merged.slice(20, 32)}`
}

function getBobRadioChannelScope(channel: BobRadioChannel, effectiveOrgId: string): string {
  if (channel.channel_type === 'primary' || channel.channel_type === 'emergency' || channel.channel_number === 1) {
    return `org:${effectiveOrgId}`
  }

  const stableId = hashScopeSeed(`${effectiveOrgId}:${channel.channel_number}:${channel.channel_type}`)
  return `team:${stableId}`
}

function resolveEmergencyChannel(channels: BobRadioChannel[], fallback: BobRadioChannel | null): BobRadioChannel | null {
  return channels.find((channel) => channel.channel_type === 'emergency')
    || channels.find((channel) => channel.channel_number === 9)
    || fallback
}

function buildEmergencyAssistPhrase(params: {
  firstName: string
  locationLabel: string
  reasonText: string
  channelName: string
}): string {
  const safeReason = params.reasonText
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)

  const safeLocation = params.locationLabel === 'Location unavailable'
    ? 'location unavailable'
    : params.locationLabel

  return [
    `Emergency assist request for ${params.firstName}.`,
    `Location: ${safeLocation}.`,
    `Situation: ${safeReason || 'critical escalation detected'}.`,
    `Respond on ${params.channelName}.`,
  ].join(' ')
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
const BOB_CHAT_RESPONSE_TIMEOUT_MS = 45_000
const BOB_SERVICE_OUTAGE_KEY = 'bob-service-outage-until'
const BOB_SERVICE_OUTAGE_COOLDOWN_MS = 2 * 60_000

async function withPromiseTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: number | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutHandle !== undefined) {
      window.clearTimeout(timeoutHandle)
    }
  }
}

function getBobServiceOutageUntil(): number {
  if (typeof window === 'undefined') return 0
  const raw = window.localStorage.getItem(BOB_SERVICE_OUTAGE_KEY)
  const parsed = Number(raw || '0')
  return Number.isFinite(parsed) ? parsed : 0
}

function isBobServiceInCooldown(): { active: boolean; remainingMs: number } {
  const outageUntil = getBobServiceOutageUntil()
  const remainingMs = Math.max(0, outageUntil - Date.now())
  return { active: remainingMs > 0, remainingMs }
}

function markBobServiceOutage() {
  if (typeof window === 'undefined') return
  const outageUntil = Date.now() + BOB_SERVICE_OUTAGE_COOLDOWN_MS
  window.localStorage.setItem(BOB_SERVICE_OUTAGE_KEY, String(outageUntil))
}

function clearBobServiceOutage() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(BOB_SERVICE_OUTAGE_KEY)
}

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
  const { organizationId } = useGlobalFiltersStore()
  const isGrandMaster = user?.role === 'grand_master'
  const bobActionApproval = useBobActionApproval()
  const pttConnectionStatus = usePTTStore((state) => state.connectionStatus)
  const pttChannelId = usePTTStore((state) => state.channelId)
  const pttIsSpeaking = usePTTStore((state) => state.isSpeaking)

  const {
    displayName,
    tone,
    voiceGender,
    accent,
    speechStyle,
    speechRate,
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
    setSpeechStyle,
    setSpeechRate,
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
  const [completedChecklist, setCompletedChecklist] = useState<Record<string, boolean>>({})
    const isPolicyManager = user?.role === 'master' || user?.role === 'grand_master'
    const policyMode = useBobExecutionPolicyStore((state) => state.mode)
    const setPolicyMode = useBobExecutionPolicyStore((state) => state.setMode)
    const enforceSchemaCheck = useBobExecutionPolicyStore((state) => state.enforceSchemaCheck)
    const setEnforceSchemaCheck = useBobExecutionPolicyStore((state) => state.setEnforceSchemaCheck)
    const enforceHardSections = useBobExecutionPolicyStore((state) => state.enforceHardSections)
    const setEnforceHardSections = useBobExecutionPolicyStore((state) => state.setEnforceHardSections)
    const showActionChecklist = useBobExecutionPolicyStore((state) => state.showActionChecklist)
    const setShowActionChecklist = useBobExecutionPolicyStore((state) => state.setShowActionChecklist)
    const effectivePolicy = getEffectiveBobExecutionPolicy()
  const [pendingCommandConfirmation, setPendingCommandConfirmation] = useState<{
    command: BobCommand
    requestedAt: string
  } | null>(null)
  const [listening, setListening] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [isBobSpeaking, setIsBobSpeaking] = useState(false)
  const [bobDegraded, setBobDegraded] = useState(false)
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
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0)
  const [pendingApprovalItems, setPendingApprovalItems] = useState<BobActionProposalRow[]>([])
  const [statusRefreshing, setStatusRefreshing] = useState(false)
  const [statusLastCheckedAt, setStatusLastCheckedAt] = useState<string | null>(null)
  const [doctorHealth, setDoctorHealth] = useState<any>(null)
  const [endpointHealth, setEndpointHealth] = useState<{ healthyCount: number; totalEndpoints: number; recommended: string | null; endpoints: any[] } | null>(null)
  const [doctorLoading, setDoctorLoading] = useState(false)
  const [doctorPlaybookRunning, setDoctorPlaybookRunning] = useState<DoctorPlaybookId | null>(null)
  const [remoteLearningContext, setRemoteLearningContext] = useState('')
  const [conversationContinuationContext, setConversationContinuationContext] = useState('')
  const [memorySnapshot, setMemorySnapshot] = useState<BobMemorySnapshot | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false)
  const [radioChannels, setRadioChannels] = useState<BobRadioChannel[]>(DEFAULT_BOB_RADIO_CHANNELS)
  const [radioChannelsLoading, setRadioChannelsLoading] = useState(false)
  const [selectedRadioChannelId, setSelectedRadioChannelId] = useState(DEFAULT_BOB_RADIO_CHANNELS[0].id)
  const [radioSignalProfile, setRadioSignalProfile] = useState<BobRadioSignalProfile>('link-test')
  const [radioSignalText, setRadioSignalText] = useState('BOB LINK TEST')
  const [radioConnecting, setRadioConnecting] = useState(false)
  const [radioTransmitting, setRadioTransmitting] = useState(false)
  const [dangerAutoAssistArmed, setDangerAutoAssistArmed] = useState(false)
  const [dangerKeywords, setDangerKeywords] = useState('help, danger, emergency, attack, assaulted, unsafe, call assistance')
  const [dangerCooldownUntil, setDangerCooldownUntil] = useState<number>(0)
  const [requireDualSignal, setRequireDualSignal] = useState(true)
  const [dualSignalWindowSeconds, setDualSignalWindowSeconds] = useState(12)
  const [ambientRiskMonitoring, setAmbientRiskMonitoring] = useState(false)
  const [ambientSensitivity, setAmbientSensitivity] = useState(65)
  const [emergencyLocationLabel, setEmergencyLocationLabel] = useState('Location unavailable')
  const [pendingEmergencyReason, setPendingEmergencyReason] = useState<string | null>(null)
  const [emergencyCountdownSeconds, setEmergencyCountdownSeconds] = useState<number | null>(null)
  const [lastEmergencyPhrase, setLastEmergencyPhrase] = useState<string | null>(null)
  const [codeChangeRequest, setCodeChangeRequest] = useState<CodeChangeRequest>({
    summary: '',
    details: '',
    stackTrace: '',
    severity: 'medium',
    complexity: 'moderate',
    targetPaths: '',
    confirmed: false,
  })

  // ── Bob Automation & Testing panel ──────────────────────────────────────
  type TestLine = { ok: boolean | null; text: string }
  const [testLines, setTestLines] = useState<TestLine[]>([])
  const [testRunning, setTestRunning] = useState(false)
  const [testSuiteLabel, setTestSuiteLabel] = useState('')

  const recognitionRef = useRef<any>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const voiceConversationActiveRef = useRef(false)
  const speakingRef = useRef(false)
  const wakeUnlockedRef = useRef(false)
  const inactivityTimerRef = useRef<number | null>(null)
  const radioStopTimerRef = useRef<number | null>(null)
  const bobPlaybackAudioRef = useRef<HTMLAudioElement | null>(null)
  const restartVoiceConversationRef = useRef<(() => void) | null>(null)
  const ambientAudioContextRef = useRef<AudioContext | null>(null)
  const ambientMonitorIntervalRef = useRef<number | null>(null)
  const ambientStreamRef = useRef<MediaStream | null>(null)
  const ambientRiskScoreRef = useRef(0)
  const previousAmbientRmsRef = useRef(0)
  const emergencyRecognitionRef = useRef<any>(null)
  const emergencyCountdownTimerRef = useRef<number | null>(null)
  const emergencyTranscriptEvidenceRef = useRef(false)
  const emergencyAmbientEvidenceRef = useRef(false)
  const emergencyTranscriptEvidenceAtRef = useRef<number | null>(null)
  const emergencyAmbientEvidenceAtRef = useRef<number | null>(null)
  const lastEmergencyPhraseRef = useRef<string | null>(null)

  const effectiveOrgId = useMemo(
    () =>
      user?.role === 'master' || user?.role === 'grand_master'
        ? organizationId || user?.organization_id || null
        : user?.organization_id || null,
    [organizationId, user?.organization_id, user?.role],
  )

  const selectedRadioChannel = useMemo(
    () => radioChannels.find((channel) => channel.id === selectedRadioChannelId) || radioChannels[0] || null,
    [radioChannels, selectedRadioChannelId],
  )

  const selectedRadioScope = useMemo(
    () => (selectedRadioChannel && effectiveOrgId ? getBobRadioChannelScope(selectedRadioChannel, effectiveOrgId) : null),
    [selectedRadioChannel, effectiveOrgId],
  )

  const {
    secureCancelVerificationEnabled,
    setSecureCancelVerificationEnabled,
    cancelVerificationMode,
    setCancelVerificationMode,
    cancelVerificationInProgress,
    orgVoiceprintEnrollmentAllowed,
    enrolledVoiceprint,
    lastVoiceprintScore,
    enrollCurrentVoiceprint,
    clearEnrolledVoiceprint,
    verifyPlatformBiometricCancel,
    verifyVoiceprintCancel,
  } = useBobIdentitySettings(user?.id, user?.organization_id)

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
    setSpeechStyle('default')
    setSpeechEnabled(true)
    setAutoSpeakReplies(true)
    toast.success('Classic command voice preset applied')
  }

  const applySoftConversationalPreset = () => {
    setVoiceGender('male')
    setAccent('en-NZ')
    setTone('professional')
    setSpeechStyle('default')
    setSpeechEnabled(true)
    setAutoSpeakReplies(true)
    toast.success('Soft conversational preset applied')
  }

  const applyBridgeLeadPreset = () => {
    setVoiceGender('male')
    setAccent('en-GB')
    setTone('professional')
    setSpeechStyle('bridge_lead')
    setSpeechEnabled(true)
    setAutoSpeakReplies(true)
    toast.success('Bridge Lead preset applied')
  }

  const applyWiseMentorPreset = () => {
    setVoiceGender('neutral')
    setAccent('en-NZ')
    setTone('coach')
    setSpeechStyle('wise_mentor')
    setSpeechEnabled(true)
    setAutoSpeakReplies(true)
    toast.success('Wise Mentor preset applied')
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
    if (!effectiveOrgId) {
      setRadioChannels(DEFAULT_BOB_RADIO_CHANNELS)
      setSelectedRadioChannelId(DEFAULT_BOB_RADIO_CHANNELS[0].id)
      return
    }

    let cancelled = false

    const loadRadioChannels = async () => {
      setRadioChannelsLoading(true)
      const { data, error } = await (supabase as any)
        .from('ptt_channels')
        .select('id, channel_number, name, channel_type, is_active')
        .eq('organization_id', effectiveOrgId)
        .eq('is_active', true)
        .order('channel_number', { ascending: true })

      if (cancelled) return

      if (error && error.code !== 'PGRST205' && error.code !== '42P01') {
        toast.error(`Could not load Bob radio channels: ${error.message}`)
      }

      const nextChannels = (data as BobRadioChannel[] | null)?.length ? (data as BobRadioChannel[]) : DEFAULT_BOB_RADIO_CHANNELS
      setRadioChannels(nextChannels)
      setSelectedRadioChannelId((current) => nextChannels.some((channel) => channel.id === current) ? current : nextChannels[0].id)
      setRadioChannelsLoading(false)
    }

    void loadRadioChannels()

    return () => {
      cancelled = true
    }
  }, [effectiveOrgId])

  useEffect(() => {
    return () => {
      if (radioStopTimerRef.current !== null) {
        window.clearTimeout(radioStopTimerRef.current)
      }
      if (emergencyCountdownTimerRef.current !== null) {
        window.clearInterval(emergencyCountdownTimerRef.current)
      }
      if (emergencyRecognitionRef.current) {
        emergencyRecognitionRef.current.stop()
        emergencyRecognitionRef.current = null
      }
      if (ambientMonitorIntervalRef.current !== null) {
        window.clearInterval(ambientMonitorIntervalRef.current)
      }
      if (ambientStreamRef.current) {
        ambientStreamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (ambientAudioContextRef.current) {
        void ambientAudioContextRef.current.close()
      }
      clearPTTCustomAudioSourceFactory()
    }
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

  const synthesizeBobSpeech = useCallback(async (text: string) => {
    const voice = accent === 'en-NZ' ? 'en-nz' : accent === 'en-AU' ? 'en-au' : 'en'
    const baseRate = tone === 'professional' ? 150 : tone === 'coach' ? 170 : 160
    const rate = Math.round(baseRate * speechRate)
    const pitch = speechStyle === 'bridge_lead'
      ? 44
      : speechStyle === 'wise_mentor'
        ? 58
        : tone === 'coach'
          ? (voiceGender === 'neutral' ? 56 : 52)
          : voiceGender === 'female'
            ? 60
            : voiceGender === 'male'
              ? 47
              : 52

    const { data, error } = await edgeFunctions.synthesizeSpeech({
      text,
      voice,
      rate,
      pitch,
      style: speechStyle,
      format: 'wav',
    })

    if (error || !data) {
      throw new Error(error || 'Speech synthesis unavailable')
    }

    const audioBase64 = String((data as any)?.audio_base64 || '').trim()
    if (!audioBase64) {
      throw new Error('Speech synthesis returned empty audio payload')
    }

    return {
      audioBase64,
      audioMimeType: String((data as any)?.audio_mime_type || 'audio/wav'),
    }
  }, [accent, speechStyle, tone, voiceGender, speechRate])

  const playSynthesizedSpeech = useCallback(async (audioBase64: string, audioMimeType = 'audio/wav') => {
    const binary = atob(audioBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }

    const blob = new Blob([bytes], { type: audioMimeType })
    const objectUrl = URL.createObjectURL(blob)
    try {
      if (bobPlaybackAudioRef.current) {
        bobPlaybackAudioRef.current.pause()
        bobPlaybackAudioRef.current = null
      }

      const audio = new Audio(objectUrl)
      bobPlaybackAudioRef.current = audio
      await audio.play()
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
      })
    } finally {
      URL.revokeObjectURL(objectUrl)
      bobPlaybackAudioRef.current = null
    }
  }, [])

  const speak = useCallback((text: string) => {
    if (!speechEnabled || typeof window === 'undefined') return
    if (voiceConversationActiveRef.current && recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }

    speakingRef.current = true
    setIsBobSpeaking(true)

    const finishSpeaking = () => {
      speakingRef.current = false
      setIsBobSpeaking(false)
      if (voiceConversationActiveRef.current) {
        restartVoiceConversationRef.current?.()
      }
    }

    void (async () => {
      try {
        const synthesized = await synthesizeBobSpeech(text)
        await playSynthesizedSpeech(synthesized.audioBase64, synthesized.audioMimeType)
        finishSpeaking()
        return
      } catch {
        // Fall back to browser-native speech synthesis when Bob TTS is unavailable.
      }

      const utterance = new SpeechSynthesisUtterance(text)
      if (selectedVoice) utterance.voice = selectedVoice
      utterance.lang = accent
      const baseBrowserRate = tone === 'professional' ? 0.95 : tone === 'coach' ? 1.03 : 1
      utterance.rate = Math.max(0.7, Math.min(1.3, baseBrowserRate * speechRate))
      utterance.pitch = voiceGender === 'male' ? 0.9 : voiceGender === 'female' ? 1.08 : 1
      utterance.onend = finishSpeaking
      utterance.onerror = finishSpeaking
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    })()
  }, [speechEnabled, selectedVoice, accent, tone, voiceGender, speechRate, synthesizeBobSpeech, playSynthesizedSpeech])

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
  restartVoiceConversationRef.current = startVoiceConversation

  const sendMessage = async (override?: string) => {
    const message = (override ?? chatInput).trim()
    if (!message || thinking) return

    const normalizedMessage = normalize(message)
    const isConfirmCommand = normalizedMessage === 'confirm command' || normalizedMessage === 'confirm'
    const isCancelCommand = normalizedMessage === 'cancel command' || normalizedMessage === 'cancel'

    let command = classifyBobCommand(message)
    let commandPolicy = evaluateBobCommandPolicy(command, {
      role: String(user?.role ?? 'officer'),
      orgId: user?.organization_id ?? null,
      route: window.location.pathname,
    })

    if (pendingCommandConfirmation) {
      if (isCancelCommand) {
        const cancelledMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: `Command cancelled: ${pendingCommandConfirmation.command.intent}.`,
          createdAt: new Date().toISOString(),
        }
        setChat((prev) => [...prev, cancelledMsg])
        setPendingCommandConfirmation(null)
        setChatInput('')
        return
      }

      if (isConfirmCommand) {
        command = pendingCommandConfirmation.command
        commandPolicy = evaluateBobCommandPolicy(command, {
          role: String(user?.role ?? 'officer'),
          orgId: user?.organization_id ?? null,
          route: window.location.pathname,
        })
        setPendingCommandConfirmation(null)
      }
    }

    if (!commandPolicy.allowed) {
      const blockedMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: `Command blocked by policy: ${commandPolicy.reason}`,
        createdAt: new Date().toISOString(),
      }
      setChat((prev) => [...prev, blockedMsg])
      setChatInput('')
      toast.error(commandPolicy.reason)
      return
    }

    if (effectivePolicy.mode === 'officer_assist' && command.intent !== 'unknown') {
      const restrictedMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: 'Officer assist mode is active. I can assess and prepare task steps, but execution commands are restricted. Please escalate to master/grand master for run actions.',
        createdAt: new Date().toISOString(),
      }
      setChat((prev) => [...prev, restrictedMsg])
      setChatInput('')
      return
    }

    if (command.intent !== 'unknown' && commandPolicy.requiresApproval && !isConfirmCommand) {
      const promptMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: `Command requires confirmation (${command.intent}). Say or type "confirm command" to continue, or "cancel command" to stop.`,
        createdAt: new Date().toISOString(),
      }
      setChat((prev) => [...prev, promptMsg])
      setPendingCommandConfirmation({
        command,
        requestedAt: new Date().toISOString(),
      })
      setChatInput('')
      return
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: message,
      createdAt: new Date().toISOString(),
    }

    setChat((prev) => [...prev, userMsg])
    setChatInput('')
    setThinking(true)
    setBobDegraded(false)
    const learningUserId = user?.id ?? 'anonymous'

    const pushAssistantReply = (text: string) => {
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text,
        createdAt: new Date().toISOString(),
      }
      setChat((prev) => [...prev, assistantMsg])
      return assistantMsg
    }

    if (command.intent === 'navigate' && command.args.route && !commandPolicy.requiresApproval) {
      const route = String(command.args.route)
      pushAssistantReply(`Command accepted. Navigating to ${route}.`)
      setThinking(false)
      navigate(route)
      return
    }

    if (command.intent === 'run_diagnostics' && !commandPolicy.requiresApproval) {
      const mutationAccess = assertBobMutationAccess('run_grandmaster_diagnostics', effectivePolicy.mode)
      if (!mutationAccess.allowed) {
        pushAssistantReply(`Diagnostics command blocked by catalog policy: ${mutationAccess.reason}`)
        setThinking(false)
        return
      }

      try {
        const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'doctor_health' })
        if (error) {
          pushAssistantReply(`Diagnostics command failed: ${error}`)
        } else {
          const health = data?.health ?? data
          const summary = [
            `Diagnostics complete.`,
            `Status: ${String(health?.status ?? 'unknown')}.`,
            `Provider: ${String(health?.provider ?? 'unknown')}.`,
            `Mode: ${String(health?.mode ?? 'unknown')}.`,
          ].join(' ')
          pushAssistantReply(summary)
        }
      } catch (diagErr: any) {
        pushAssistantReply(`Diagnostics command failed: ${String(diagErr?.message ?? diagErr)}`)
      } finally {
        setThinking(false)
      }
      return
    }

    const buildRequestBody = () => {
      const historyMessages = chat
        .slice(-16)
        .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
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
      if (command.intent !== 'unknown') {
        rawMessages.push({
          role: 'system',
          content: [
            'Command bus classification active.',
            `intent=${command.intent}`,
            `safety=${command.safety}`,
            `confidence=${(command.confidence ?? 0).toFixed(2)}`,
            `requires_approval=${commandPolicy.requiresApproval ? 'true' : 'false'}`,
            `policy_reason=${commandPolicy.reason}`,
          ].join(' | '),
        })
      }
      rawMessages.push(...historyMessages, { role: 'user', content: message })

      return {
        messages: rawMessages,
        provider: 'auto' as const,
        context: {
          tone,
          source: 'bob-studio',
          currentRoute: window.location.pathname,
          privacy: {
            expressPermission: expressUserDataPermission,
            permittedUserIdentity: permittedUserIdentity || null,
          },
          biometric_scaffold: {
            voicePatternLearningConsent,
            faceClarificationConsent,
            note: 'Consent scaffold only - no biometric persistence enabled in this build.',
          },
          command_bus: {
            intent: command.intent,
            confidence: command.confidence,
            safety: command.safety,
            requires_approval: commandPolicy.requiresApproval,
            policy_reason: commandPolicy.reason,
            args: command.args,
            matched_pattern: command.matchedPattern,
          },
        },
      }
    }

    const cooldown = isBobServiceInCooldown()
    if (cooldown.active) {
      const retrySeconds = Math.max(10, Math.ceil(cooldown.remainingMs / 1000))
      setBobDegraded(true)
      setChat((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: `Bob/Ollama is still reconnecting. Please retry in about ${retrySeconds}s. I can still provide a quick local action checklist while AI service recovers.`,
          createdAt: new Date().toISOString(),
        },
      ])
      toast.error(`Bob/Ollama service recovering (retry in ~${retrySeconds}s)`)
      setThinking(false)
      return
    }

    try {
      const { data, error } = await withPromiseTimeout(
        edgeFunctions.aiChat(buildRequestBody()),
        BOB_CHAT_RESPONSE_TIMEOUT_MS,
        `Bob response timeout after ${Math.round(BOB_CHAT_RESPONSE_TIMEOUT_MS / 1000)}s`,
      )
      if (error || !data?.response) {
        throw new Error(error || 'Bob returned an empty response')
      }

      const replyText: string = data?.response || 'I could not generate a response. Please try again.'
      setBobDegraded(data?.provider === 'local-fallback')
      clearBobServiceOutage()

      const bobMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: replyText,
        createdAt: new Date().toISOString(),
        actionChecklist: Array.isArray((data as any)?.actionChecklist)
          ? ((data as any).actionChecklist as string[])
          : [],
        executionReview: (data as any)?.executionReview,
      }

      setChat((prev) => [...prev, bobMsg])

      // Run memory writes in background so chat UX is not blocked by DB latency.
      void (async () => {
        try {
          await Promise.all([
            persistBobLearningRemote({
              userId: learningUserId,
              organizationId: user?.organization_id ?? null,
              route: '/bob-assistant',
              source: collaborationPacket?.source ?? 'bob-studio',
              userMessage: message,
              assistantReply: replyText,
            }),
            persistConversationTurnRemote({
              userId: learningUserId,
              organizationId: user?.organization_id ?? null,
              route: '/bob-assistant',
              source: collaborationPacket?.source ?? 'bob-studio',
              userMessage: message,
              assistantReply: replyText,
              currentRoute: window.location.pathname,
              destinationHint: destination || null,
              executionReview: (data as any)?.executionReview ?? null,
            }),
          ])

          if (learningUserId !== 'anonymous') {
            const [refreshedRemote, refreshedContinuation] = await Promise.all([
              buildBobLearningContextRemote(learningUserId, 20),
              buildConversationContinuationContextRemote(learningUserId, 16),
            ])
            setRemoteLearningContext(refreshedRemote)
            setConversationContinuationContext(refreshedContinuation)
          }
        } catch {
          // Keep chat resilient even if memory persistence fails.
        }
      })()

      // Gateway-side learning ingest (privacy-first): only when explicit
      // permission has been granted for user-data-aware processing.
      if (expressUserDataPermission) {
        void edgeFunctions.bobResponseFeedback({
          session_id: collaborationPacket?.id || userMsg.id,
          source: collaborationPacket?.source || 'bob-studio',
          source_provider: (() => {
            const src = String(collaborationPacket?.source || '').toLowerCase()
            return src.includes('openai') ? 'openai-reference' : 'internal'
          })(),
          interaction: {
            prompt: message,
            response: replyText,
            outcome: 'accepted',
            rating: 4,
          },
          privacy: {
            consent_provided: true,
            data_sharing: 'minimal',
            redact_pii: true,
          },
        })
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

      const mergedText = `${message}\n${replyText}`
      if (isEmergencyCancelCommand(mergedText) && emergencyCountdownSeconds !== null) {
        void cancelPendingEmergencyCall()
      } else if (isEmergencyCallNowCommand(mergedText) && emergencyCountdownSeconds !== null) {
        void triggerEmergencyCallNow(message)
      } else if (shouldTriggerDangerAssist(mergedText)) {
        registerEmergencySignal('transcript', `TRANSCRIPT RISK: ${message}`)
      }
    } catch (err: any) {
      console.error('Bob assistant invoke failed:', err)
      markBobServiceOutage()
      setBobDegraded(true)
      const replyText = 'Bob/Ollama is temporarily unavailable right now. Please retry in a moment.'
      const bobMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: replyText,
        createdAt: new Date().toISOString(),
      }
      setChat((prev) => [...prev, bobMsg])

      // Capture degraded-mode turn in background so errors here never block UI.
      void (async () => {
        try {
          await Promise.all([
            persistBobLearningRemote({
              userId: learningUserId,
              organizationId: user?.organization_id ?? null,
              route: '/bob-assistant',
              source: collaborationPacket?.source ?? 'bob-ollama-unavailable',
              userMessage: message,
              assistantReply: replyText,
            }),
            persistConversationTurnRemote({
              userId: learningUserId,
              organizationId: user?.organization_id ?? null,
              route: '/bob-assistant',
              source: collaborationPacket?.source ?? 'bob-ollama-unavailable',
              userMessage: message,
              assistantReply: replyText,
              currentRoute: window.location.pathname,
              destinationHint: destination || null,
              executionReview: null,
            }),
          ])

          if (learningUserId !== 'anonymous') {
            const refreshedContinuation = await buildConversationContinuationContextRemote(learningUserId, 16)
            setConversationContinuationContext(refreshedContinuation)
          }
        } catch {
          // Best-effort persistence only.
        }
      })()

      if (expressUserDataPermission) {
        void edgeFunctions.bobResponseFeedback({
          session_id: collaborationPacket?.id || userMsg.id,
          source: collaborationPacket?.source || 'bob-ollama-unavailable',
          source_provider: 'internal',
          interaction: {
            prompt: message,
            response: replyText,
            outcome: 'degraded_fallback',
            rating: 3,
          },
          privacy: {
            consent_provided: true,
            data_sharing: 'minimal',
            redact_pii: true,
          },
        })
      }

      if (collaborationPacket && !hasPublishedResponseRef.current) {
        hasPublishedResponseRef.current = true
        publishBobResponse(collaborationPacket.id, replyText)
        if (collaborationPacket.autoSubmit && collaborationPacket.returnRoute) {
          setTimeout(() => navigate(collaborationPacket.returnRoute!), 1800)
        }
      }

      if (autoSpeakReplies) speak(replyText)

      const mergedText = `${message}\n${replyText}`
      if (isEmergencyCancelCommand(mergedText) && emergencyCountdownSeconds !== null) {
        void cancelPendingEmergencyCall()
      } else if (isEmergencyCallNowCommand(mergedText) && emergencyCountdownSeconds !== null) {
        void triggerEmergencyCallNow(message)
      } else if (shouldTriggerDangerAssist(mergedText)) {
        registerEmergencySignal('transcript', `TRANSCRIPT RISK: ${message}`)
      }

      const shortError = String(err?.message || 'unknown_error').slice(0, 120)
      toast.error(`Bob/Ollama service unavailable (${shortError})`)
    } finally {
      setThinking(false)
    }
  }

  const connectBobRadioChannel = async () => {
    if (!selectedRadioChannel || !selectedRadioScope) {
      toast.error('Select a valid Bob radio channel first')
      return
    }

    setRadioConnecting(true)
    try {
      await connectToPTT(selectedRadioScope, selectedRadioChannel.name)
      toast.success(`Bob radio agent connected to ${selectedRadioChannel.name}`)
    } catch (error: any) {
      toast.error(error?.message || 'Could not connect Bob radio agent')
    } finally {
      setRadioConnecting(false)
    }
  }

  const disconnectBobRadioChannel = async () => {
    if (radioStopTimerRef.current !== null) {
      window.clearTimeout(radioStopTimerRef.current)
      radioStopTimerRef.current = null
    }

    if (pttIsSpeaking) {
      try {
        await stopSpeaking()
      } catch {
        // Ignore stop errors during manual disconnect.
      }
    }

    clearPTTCustomAudioSourceFactory()
    disconnectFromPTT()
    setRadioTransmitting(false)
  }

  const transmitBobRadioSignal = async () => {
    if (!selectedRadioChannel || !selectedRadioScope) {
      toast.error('Select a valid Bob radio channel first')
      return
    }

    if (radioTransmitting || pttIsSpeaking) return

    const fallbackText = chat.slice().reverse().find((message) => message.role === 'assistant')?.text || 'BOB LINK TEST'
    const requestedText = radioSignalText.trim() || fallbackText
    const signalText = radioSignalProfile === 'spoken'
      ? requestedText.slice(0, 160)
      : requestedText.slice(0, 24)
    let durationMs = estimateBobRadioSignalDurationMs({ profile: radioSignalProfile, signalText })

    try {
      if (pttChannelId !== selectedRadioScope || pttConnectionStatus !== 'connected') {
        await connectToPTT(selectedRadioScope, selectedRadioChannel.name)
      }

      if (radioSignalProfile === 'spoken') {
        const synthesized = await synthesizeBobSpeech(signalText)
        const speechSource = await createBobSpeechAudioSourceFromBase64({
          audioBase64: synthesized.audioBase64,
          mimeType: synthesized.audioMimeType,
          level: 0.28,
        })
        durationMs = speechSource.durationMs ?? Math.max(1800, signalText.split(/\s+/).filter(Boolean).length * 520)
        setPTTCustomAudioSourceFactory(async () => speechSource)
      } else {
        setPTTCustomAudioSourceFactory(async () => createBobRadioAudioSource({
          profile: radioSignalProfile,
          signalText,
        }))
      }

      await startSpeaking()
      setRadioTransmitting(true)
      toast.success(
        radioSignalProfile === 'spoken'
          ? `Bob sent a spoken WebRTC relay on ${selectedRadioChannel.name}`
          : `Bob sent a real browser WebRTC test transmission on ${selectedRadioChannel.name}`,
      )

      radioStopTimerRef.current = window.setTimeout(() => {
        void stopSpeaking()
          .catch(() => undefined)
          .finally(() => {
            clearPTTCustomAudioSourceFactory()
            setRadioTransmitting(false)
            radioStopTimerRef.current = null
          })
      }, durationMs + 260)
    } catch (error: any) {
      clearPTTCustomAudioSourceFactory()
      setRadioTransmitting(false)
      toast.error(error?.message || 'Bob radio transmission failed')
    }
  }

  const shouldTriggerDangerAssist = useCallback((text: string): boolean => {
    if (!dangerAutoAssistArmed) return false
    if (Date.now() < dangerCooldownUntil) return false

    const normalized = text.toLowerCase()
    const keys = dangerKeywords
      .split(',')
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean)

    return keys.some((key) => normalized.includes(key))
  }, [dangerAutoAssistArmed, dangerCooldownUntil, dangerKeywords])

  const isEmergencyCancelCommand = useCallback((text: string): boolean => {
    const normalized = text.toLowerCase()
    return (
      normalized.includes('cancel emergency') ||
      normalized.includes('cancel call') ||
      normalized.includes('stand down') ||
      normalized.includes('false alarm') ||
      normalized.includes('no emergency')
    )
  }, [])

  const isEmergencyCallNowCommand = useCallback((text: string): boolean => {
    const normalized = text.toLowerCase()
    return (
      normalized.includes('make the call') ||
      normalized.includes('call now') ||
      normalized.includes('send assistance') ||
      normalized.includes('request backup now')
    )
  }, [])

  const refreshEmergencyLocationLabel = useCallback(async (): Promise<string> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      const fallback = 'Location unavailable'
      setEmergencyLocationLabel(fallback)
      return fallback
    }

    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude.toFixed(5)
          const lon = position.coords.longitude.toFixed(5)
          const next = `${lat}, ${lon}`
          setEmergencyLocationLabel(next)
          resolve(next)
        },
        () => {
          const fallback = 'Location unavailable'
          setEmergencyLocationLabel(fallback)
          resolve(fallback)
        },
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 6_000 },
      )
    })
  }, [])

  const broadcastAutomatedAssistanceCall = useCallback(async (reasonText: string): Promise<boolean> => {
    if (!effectiveOrgId) return false
    if (radioTransmitting || pttIsSpeaking) return false

    const emergencyChannel = resolveEmergencyChannel(radioChannels, selectedRadioChannel)
    if (!emergencyChannel) return false

    const emergencyScope = getBobRadioChannelScope(emergencyChannel, effectiveOrgId)
    const locationLabel = await refreshEmergencyLocationLabel()
    const firstName = (user?.first_name || 'OFFICER').trim().toUpperCase().slice(0, 10)
    const emergencyPhrase = buildEmergencyAssistPhrase({
      firstName,
      locationLabel,
      reasonText,
      channelName: emergencyChannel.name,
    })
    const compactLocation = locationLabel === 'Location unavailable'
      ? 'LOC UNK'
      : locationLabel.replace(/\s+/g, '').slice(0, 11)

    const condensedReason = reasonText
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 18)
      .toUpperCase()

    const signalText = `SOS ${firstName} ${compactLocation}`.slice(0, 24)
    let durationMs = estimateBobRadioSignalDurationMs({ profile: 'attention', signalText })

    try {
      if (pttChannelId !== emergencyScope || pttConnectionStatus !== 'connected') {
        await connectToPTT(emergencyScope, emergencyChannel.name)
      }

      const synthesized = await synthesizeBobSpeech(emergencyPhrase)
      const speechSource = await createBobSpeechAudioSourceFromBase64({
        audioBase64: synthesized.audioBase64,
        mimeType: synthesized.audioMimeType,
        level: 0.3,
      })
      durationMs = speechSource.durationMs ?? Math.max(2600, emergencyPhrase.split(/\s+/).filter(Boolean).length * 540)
      setPTTCustomAudioSourceFactory(async () => speechSource)

      await startSpeaking()
      setRadioTransmitting(true)
      setDangerCooldownUntil(Date.now() + 90_000)
      setLastEmergencyPhrase(emergencyPhrase)
      lastEmergencyPhraseRef.current = emergencyPhrase

      radioStopTimerRef.current = window.setTimeout(() => {
        void stopSpeaking()
          .catch(() => undefined)
          .finally(() => {
            clearPTTCustomAudioSourceFactory()
            setRadioTransmitting(false)
            radioStopTimerRef.current = null
          })
      }, durationMs + 260)

      toast.warning(`Bob auto-assist sent on ${emergencyChannel.name}: ${firstName} @ ${locationLabel}. ${condensedReason || 'UNSPECIFIED'}`)
      return true
    } catch (error) {
      clearPTTCustomAudioSourceFactory()
      setRadioTransmitting(false)
      console.error('Bob auto-assist broadcast failed', error)
      return false
    }
  }, [
    effectiveOrgId,
    pttIsSpeaking,
    radioTransmitting,
    radioChannels,
    selectedRadioChannel,
    synthesizeBobSpeech,
    user?.first_name,
    pttChannelId,
    pttConnectionStatus,
    refreshEmergencyLocationLabel,
  ])

  const clearEmergencyCountdown = useCallback(() => {
    if (emergencyCountdownTimerRef.current !== null) {
      window.clearInterval(emergencyCountdownTimerRef.current)
      emergencyCountdownTimerRef.current = null
    }
    setEmergencyCountdownSeconds(null)
    setPendingEmergencyReason(null)
  }, [])

  const resetEmergencyEvidence = useCallback(() => {
    emergencyTranscriptEvidenceRef.current = false
    emergencyAmbientEvidenceRef.current = false
    emergencyTranscriptEvidenceAtRef.current = null
    emergencyAmbientEvidenceAtRef.current = null
  }, [])

  const cancelPendingEmergencyCall = useCallback(async (spoken = true, requireVerification = true) => {
    if (secureCancelVerificationEnabled && requireVerification) {
      const verified = cancelVerificationMode === 'voiceprint'
        ? await verifyVoiceprintCancel()
        : await verifyPlatformBiometricCancel()

      if (!verified) {
        return false
      }
    }

    clearEmergencyCountdown()
    resetEmergencyEvidence()
    if (spoken) {
      speak('Emergency assist cancelled. I will keep monitoring while armed.')
      toast.message('Emergency assist countdown cancelled')
    }
    return true
  }, [
    secureCancelVerificationEnabled,
    cancelVerificationMode,
    verifyVoiceprintCancel,
    verifyPlatformBiometricCancel,
    clearEmergencyCountdown,
    resetEmergencyEvidence,
    speak,
  ])

  const triggerEmergencyCallNow = useCallback(async (reasonOverride?: string) => {
    const reason = reasonOverride || pendingEmergencyReason || 'USER CONFIRMED EMERGENCY CALL'
    clearEmergencyCountdown()
    const sent = await broadcastAutomatedAssistanceCall(reason)
    resetEmergencyEvidence()
    if (sent) {
      const phrase = lastEmergencyPhraseRef.current
        ? `Emergency assistance request sent. ${lastEmergencyPhraseRef.current}`
        : 'Emergency assistance request sent on the emergency channel.'
      speak(phrase)
    }
  }, [pendingEmergencyReason, clearEmergencyCountdown, broadcastAutomatedAssistanceCall, resetEmergencyEvidence, speak])

  const startEmergencyCountdown = useCallback((reasonText: string) => {
    if (emergencyCountdownSeconds !== null || Date.now() < dangerCooldownUntil) return

    const COUNTDOWN_START = 7
    setPendingEmergencyReason(reasonText)
    setEmergencyCountdownSeconds(COUNTDOWN_START)

    const firstName = user?.first_name?.trim() || 'Officer'
    toast.warning(`Potential emergency detected. Calling for assistance in ${COUNTDOWN_START} seconds unless cancelled.`)
    speak(`${firstName}, potential emergency detected. Assistance call will be sent in ${COUNTDOWN_START} seconds. Say cancel emergency to stop, or say call now.`)

    emergencyCountdownTimerRef.current = window.setInterval(() => {
      setEmergencyCountdownSeconds((current) => {
        if (current === null) return null

        const next = current - 1
        if (next <= 0) {
          if (emergencyCountdownTimerRef.current !== null) {
            window.clearInterval(emergencyCountdownTimerRef.current)
            emergencyCountdownTimerRef.current = null
          }
          void triggerEmergencyCallNow(reasonText)
          return null
        }

        if (next <= 3) {
          speak(`${next}`)
        }

        return next
      })
    }, 1000)
  }, [dangerCooldownUntil, emergencyCountdownSeconds, triggerEmergencyCallNow, user?.first_name, speak])

  const registerEmergencySignal = useCallback((kind: 'ambient' | 'transcript', reasonText: string) => {
    if (!dangerAutoAssistArmed) return
    if (Date.now() < dangerCooldownUntil) return
    if (emergencyCountdownSeconds !== null) return

    const now = Date.now()
    if (kind === 'ambient') {
      emergencyAmbientEvidenceRef.current = true
      emergencyAmbientEvidenceAtRef.current = now
    }
    if (kind === 'transcript') {
      emergencyTranscriptEvidenceRef.current = true
      emergencyTranscriptEvidenceAtRef.current = now
    }

    const hasAmbient = emergencyAmbientEvidenceRef.current
    const hasTranscript = emergencyTranscriptEvidenceRef.current
    const dualWindowMs = Math.max(3, Math.min(60, dualSignalWindowSeconds)) * 1000
    const transcriptAt = emergencyTranscriptEvidenceAtRef.current
    const ambientAt = emergencyAmbientEvidenceAtRef.current
    const withinWindow = !!(transcriptAt && ambientAt && Math.abs(transcriptAt - ambientAt) <= dualWindowMs)

    const thresholdReached = requireDualSignal
      ? (hasAmbient && hasTranscript && withinWindow)
      : (hasAmbient || hasTranscript)

    if (requireDualSignal && hasAmbient && hasTranscript && !withinWindow) {
      // Keep only the newest signal when evidence is too far apart.
      if ((transcriptAt || 0) > (ambientAt || 0)) {
        emergencyAmbientEvidenceRef.current = false
        emergencyAmbientEvidenceAtRef.current = null
      } else {
        emergencyTranscriptEvidenceRef.current = false
        emergencyTranscriptEvidenceAtRef.current = null
      }
    }

    if (thresholdReached) {
      startEmergencyCountdown(reasonText)
    }
  }, [dangerAutoAssistArmed, dangerCooldownUntil, emergencyCountdownSeconds, requireDualSignal, dualSignalWindowSeconds, startEmergencyCountdown])

  useEffect(() => {
    const consumeQueuedPanicRequests = () => {
      const packet = consumeLatestEmergencyAssistRequest()
      if (!packet) return

      if (packet.organizationId && effectiveOrgId && packet.organizationId !== effectiveOrgId) {
        return
      }

      const officerLabel = packet.officerName?.trim() || 'Officer'
      const reason = packet.reason?.trim() || 'Welfare panic button activated'
      const locationText = packet.locationLabel?.trim() || 'Location unavailable'

      setEmergencyLocationLabel(locationText)
      startEmergencyCountdown(`WELFARE PANIC: ${officerLabel}. ${reason}.`)
      toast.warning(`Welfare panic assist queued for ${officerLabel}. Emergency countdown started.`)
    }

    consumeQueuedPanicRequests()

    if (typeof window === 'undefined') return
    const handler = () => {
      consumeQueuedPanicRequests()
    }
    window.addEventListener(EMERGENCY_ASSIST_REQUEST_EVENT, handler)
    return () => {
      window.removeEventListener(EMERGENCY_ASSIST_REQUEST_EVENT, handler)
    }
  }, [effectiveOrgId, startEmergencyCountdown])

  const pttDiagnostics = getPTTDiagnostics()

  useEffect(() => {
    if (dangerAutoAssistArmed) return
    void cancelPendingEmergencyCall(false, false)
    resetEmergencyEvidence()
  }, [dangerAutoAssistArmed, cancelPendingEmergencyCall, resetEmergencyEvidence])

  useEffect(() => {
    if (!dangerAutoAssistArmed || !ambientRiskMonitoring) {
      if (ambientMonitorIntervalRef.current !== null) {
        window.clearInterval(ambientMonitorIntervalRef.current)
        ambientMonitorIntervalRef.current = null
      }
      if (ambientStreamRef.current) {
        ambientStreamRef.current.getTracks().forEach((track) => track.stop())
        ambientStreamRef.current = null
      }
      if (ambientAudioContextRef.current) {
        void ambientAudioContextRef.current.close()
        ambientAudioContextRef.current = null
      }
      ambientRiskScoreRef.current = 0
      previousAmbientRmsRef.current = 0
      return
    }

    let cancelled = false

    const startAmbientMonitor = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        const ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)

        ambientStreamRef.current = stream
        ambientAudioContextRef.current = ctx

        const samples = new Uint8Array(analyser.fftSize)
        ambientMonitorIntervalRef.current = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples)

          let sum = 0
          let peak = 0
          for (let i = 0; i < samples.length; i++) {
            const centered = (samples[i] - 128) / 128
            const abs = Math.abs(centered)
            sum += centered * centered
            if (abs > peak) peak = abs
          }

          const rms = Math.sqrt(sum / samples.length)
          const rmsPercent = rms * 100
          const peakPercent = peak * 100
          const previous = previousAmbientRmsRef.current
          const jump = rmsPercent - previous
          previousAmbientRmsRef.current = rmsPercent

          const highNoise = rmsPercent >= ambientSensitivity * 0.28
          const sharpImpulse = peakPercent >= ambientSensitivity && jump >= 18
          if (highNoise || sharpImpulse) {
            ambientRiskScoreRef.current += sharpImpulse ? 3 : 1
          } else {
            ambientRiskScoreRef.current = Math.max(0, ambientRiskScoreRef.current - 1)
          }

          if (ambientRiskScoreRef.current >= 7 && Date.now() >= dangerCooldownUntil) {
            ambientRiskScoreRef.current = 0
            registerEmergencySignal(
              'ambient',
              sharpImpulse
                ? 'POSSIBLE GUNSHOT OR IMPACT-LIKE IMPULSE'
                : 'SUSTAINED HIGH-RISK AMBIENT ESCALATION',
            )
          }
        }, 250)
      } catch {
        toast.error('Could not start ambient risk monitoring (microphone access denied)')
      }
    }

    void startAmbientMonitor()

    return () => {
      cancelled = true
      if (ambientMonitorIntervalRef.current !== null) {
        window.clearInterval(ambientMonitorIntervalRef.current)
        ambientMonitorIntervalRef.current = null
      }
      if (ambientStreamRef.current) {
        ambientStreamRef.current.getTracks().forEach((track) => track.stop())
        ambientStreamRef.current = null
      }
      if (ambientAudioContextRef.current) {
        void ambientAudioContextRef.current.close()
        ambientAudioContextRef.current = null
      }
      ambientRiskScoreRef.current = 0
      previousAmbientRmsRef.current = 0
    }
  }, [ambientRiskMonitoring, ambientSensitivity, dangerAutoAssistArmed, dangerCooldownUntil, registerEmergencySignal])

  useEffect(() => {
    if (!dangerAutoAssistArmed || !ambientRiskMonitoring) {
      if (emergencyRecognitionRef.current) {
        emergencyRecognitionRef.current.stop()
        emergencyRecognitionRef.current = null
      }
      return
    }

    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor || voiceActivatedConversation || listening || thinking) return

    const recognition = new Ctor()
    recognition.lang = accent
    recognition.interimResults = false
    recognition.continuous = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event?.results ?? [])
        .filter((result: any) => result?.isFinal)
        .map((result: any) => result?.[0]?.transcript ?? '')
        .join(' ')
        .trim()

      if (!transcript) return
      if (isEmergencyCancelCommand(transcript) && emergencyCountdownSeconds !== null) {
        void cancelPendingEmergencyCall()
        return
      }

      if (isEmergencyCallNowCommand(transcript) && emergencyCountdownSeconds !== null) {
        void triggerEmergencyCallNow(`VOICE CONFIRMED: ${transcript}`)
        return
      }

      if (shouldTriggerDangerAssist(transcript)) {
        registerEmergencySignal('transcript', `TRANSCRIPT RISK: ${transcript}`)
      }
    }

    recognition.onend = () => {
      emergencyRecognitionRef.current = null
      if (dangerAutoAssistArmed && ambientRiskMonitoring && !voiceActivatedConversation && !listening && !thinking) {
        setTimeout(() => {
          if (emergencyRecognitionRef.current) return
          try {
            const next = new Ctor()
            next.lang = accent
            next.interimResults = false
            next.continuous = true
            next.maxAlternatives = 1
            next.onresult = recognition.onresult
            next.onend = recognition.onend
            emergencyRecognitionRef.current = next
            next.start()
          } catch {
            // Swallow restart failures.
          }
        }, 400)
      }
    }

    emergencyRecognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      emergencyRecognitionRef.current = null
    }

    return () => {
      if (emergencyRecognitionRef.current) {
        emergencyRecognitionRef.current.stop()
        emergencyRecognitionRef.current = null
      }
    }
  }, [accent, ambientRiskMonitoring, dangerAutoAssistArmed, listening, thinking, voiceActivatedConversation, shouldTriggerDangerAssist, emergencyCountdownSeconds, isEmergencyCancelCommand, isEmergencyCallNowCommand, cancelPendingEmergencyCall, triggerEmergencyCallNow, registerEmergencySignal])

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

  const executeSaveLivePlan = async () => {
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

  const requestSaveLivePlanApproval = () => {
    if (!generatedPlan.trim()) {
      toast.error('Generate a draft before requesting approval')
      return
    }

    const recommendation: BobRecommendation = {
      id: `bob-live-plan-${Date.now()}`,
      actionType: 'create_live_plan',
      title: 'Approve Bob live plan save',
      description: 'Bob wants to save the generated live operational plan to CRM and activate it for operational use.',
      entityType: 'ops_live_plan',
      entityId: planForm.planTitle.trim() || PLAN_TYPE_LABELS[planForm.planType],
      confidence: 92,
      riskLevel: 'medium',
      evidence: [
        `Plan type: ${PLAN_TYPE_LABELS[planForm.planType]}`,
        `Assignment scope: ${planForm.assignmentScope}`,
        `Generated plan length: ${generatedPlan.length} characters`,
        `Field staff visibility: ${planForm.fieldStaffCanView ? 'enabled' : 'disabled'}`,
      ],
      suggestedPayload: {
        planType: planForm.planType,
        assignmentScope: planForm.assignmentScope,
        fieldStaffCanView: planForm.fieldStaffCanView,
      },
    }

    bobActionApproval.showDialog(recommendation)
  }

  const copyPlan = async () => {
    if (!generatedPlan.trim()) {
      toast.error('Generate a plan first')
      return
    }
    await navigator.clipboard.writeText(generatedPlan)
    toast.success('Plan copied to clipboard')
  }

  const executeGenerateCodeChangeTask = async () => {
    const mutationAccess = assertBobMutationAccess('queue_bob_code_change_task', effectivePolicy.mode)
    if (!mutationAccess.allowed) {
      throw new Error(mutationAccess.reason)
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
  }

  const requestCodeChangeTaskApproval = () => {
    const summary = codeChangeRequest.summary.trim()
    const targetPathCount = codeChangeRequest.targetPaths
      .split(',')
      .map((path) => path.trim())
      .filter(Boolean).length

    const recommendation: BobRecommendation = {
      id: `bob-code-task-${Date.now()}`,
      actionType: 'generate_code_patch_task',
      title: 'Approve Bob code patch task generation',
      description: 'Bob wants to generate a code patch task from the supplied issue summary and diagnostics.',
      entityType: 'code_patch_task',
      entityId: summary,
      confidence: 88,
      riskLevel: codeChangeRequest.severity === 'critical' || codeChangeRequest.severity === 'high' ? 'high' : 'medium',
      evidence: [
        `Summary: ${summary}`,
        `Severity: ${codeChangeRequest.severity}`,
        `Complexity: ${codeChangeRequest.complexity}`,
        `Target paths supplied: ${targetPathCount || 0}`,
      ],
      suggestedPayload: {
        severity: codeChangeRequest.severity,
        complexity: codeChangeRequest.complexity,
        targetPaths: codeChangeRequest.targetPaths,
      },
    }

    bobActionApproval.showDialog(recommendation)
  }

  const resolveRecommendationExecutor = (actionType?: string) => {
    if (actionType === 'create_live_plan') return executeSaveLivePlan
    if (actionType === 'generate_code_patch_task') return executeGenerateCodeChangeTask
    return undefined
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

        await bobActionApproval.logBobAction(
          'recommendation_approved',
          {
            id: `bob-code-change-${Date.now()}`,
            actionType: 'request_code_change_approval',
            title: 'Bob code-change approval request',
            description: summary,
            entityType: 'code_change_request',
            entityId: summary,
            riskLevel: codeChangeRequest.severity === 'critical' || codeChangeRequest.severity === 'high' ? 'high' : 'medium',
          },
          'approved',
          `Approval request sent to ${rows.length} Grand Master approver(s).`,
        )

        setCodeTaskResult(JSON.stringify({
          status: 'approval_requested',
          approvers_notified: rows.length,
          note: 'Only Grand Master can approve code changes. Bob has notified Don/Grand Master approvers.',
        }, null, 2))

        toast.success('Approval request sent to Don/Grand Master approvers')
        return
      }

      requestCodeChangeTaskApproval()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate code patch task')
    } finally {
      setCodeTaskLoading(false)
    }
  }

  // Runs one of the four test suites, captures console output into testLines,
  // then offers results to Bob via sendMessage().
  const runAutomationSuite = async (suite: 'smoke' | 'data' | 'performance' | 'bugfix') => {
    if (testRunning) return
    setTestRunning(true)
    setTestLines([])

    const label: Record<typeof suite, string> = {
      smoke: 'Smoke Tests',
      data: 'Data Verification',
      performance: 'Performance Benchmark',
      bugfix: 'Bug Fix Audit',
    }
    setTestSuiteLabel(label[suite])

    const lines: TestLine[] = []
    const emit = (ok: boolean | null, text: string) => {
      lines.push({ ok, text })
      setTestLines([...lines])
    }

    try {
      if (suite === 'smoke') {
        emit(null, 'Running smoke tests…')
        const result = await smokeTests.runAll() as any
        const testResults = result?.results ?? result ?? {}
        Object.entries(testResults).forEach(([name, res]: [string, any]) => {
          emit(res?.success ?? null, `${name}: ${res?.success ? 'PASS' : 'FAIL'}${res?.error ? ` — ${res.error}` : ''}`)
        })
        const all = result?.summary?.allPassed ?? Object.values(testResults).every((r: any) => r?.success)
        emit(all, all ? '✓ All smoke tests passed' : '✗ Some smoke tests failed')
      } else if (suite === 'data') {
        emit(null, 'Running data verification…')
        const dup = await dataVerification.checkDuplicateObservations()
        emit(dup !== null, `Duplicate observations check: ${dup !== null ? 'complete' : 'unavailable'}`)
        const comp = await dataVerification.verifyComplianceResults()
        if (comp) {
          const ok = comp.missing === 0
          emit(ok, `Compliance state: ${comp.withCompliance}/${comp.total} observations populated${ok ? '' : ` (${comp.missing} missing)`}`)
        }
        const stays = await dataVerification.verifyMonthlyStays()
        if (stays) {
          emit(true, `Monthly stay snapshots (${stays.month}): ${stays.vehicleCount} vehicles, ${stays.totalNights} nights total`)
        }
        emit(true, '✓ Data verification complete')
      } else if (suite === 'performance') {
        emit(null, 'Running performance benchmark…')
        const bench = await performanceTests.runBenchmark() as any
        Object.entries(bench ?? {}).forEach(([name, res]: [string, any]) => {
          const ok = res?.success ?? false
          emit(ok, `${name}: ${res?.duration?.toFixed(1) ?? '?'}ms — ${ok ? 'OK' : res?.error ?? 'FAILED'}`)
        })
        const all = Object.values(bench ?? {}).every((r: any) => r?.success)
        emit(all, all ? '✓ All benchmarks passed' : '⚠ Some benchmarks had issues')
      } else if (suite === 'bugfix') {
        emit(null, 'Running bug fix system audit…')
        const audit = await runBugFixDeepDive(30) as any
        if (audit?.success === false && audit.error) {
          emit(false, `Audit error: ${audit.error}`)
        } else if (audit) {
          const s = audit.summary ?? {}
          emit(true, `Reports: ${s.total ?? 0} total | ${s.aiAnalyzed ?? 0} AI-analyzed | ${s.autoReported ?? 0} auto-reported | ${s.terminal ?? 0} terminal | ${s.withHumanReview ?? 0} needs human review`)
          if ((audit.anomalies ?? []).length === 0) {
            emit(true, '✓ No anomalies detected in recent bug reports')
          } else {
            ;(audit.anomalies ?? []).forEach((a: string) => emit(false, `⚠ ${a}`))
          }
        }
      }
    } catch (err: any) {
      emit(false, `Suite error: ${err?.message ?? 'unknown'}`)
    } finally {
      setTestRunning(false)
    }
  }

  const sendTestResultsToBob = () => {
    if (!testLines.length) return
    const MAX_LINES = 50
    const lines = testLines.length > MAX_LINES ? testLines.slice(-MAX_LINES) : testLines
    const truncated = testLines.length > MAX_LINES ? `\n(Showing last ${MAX_LINES} of ${testLines.length} lines)\n` : ''
    const summary = lines.map((l) => `${l.ok === true ? '✓' : l.ok === false ? '✗' : '→'} ${l.text}`).join('\n')
    const prompt = `Here are the latest ${testSuiteLabel} results from inside the FieldOps Manager app. Please analyse them and highlight any issues, failures, or recommendations:${truncated}\n\n${summary}`
    sendMessage(prompt)
  }

  const loadPendingApprovals = useCallback(async () => {
    const isSupervisor = ['admin', 'admin_officer', 'master', 'grand_master'].includes(String(user?.role ?? ''))
    if (!user?.id || !effectiveOrgId || !isSupervisor) {
      setPendingApprovalsCount(0)
      setPendingApprovalItems([])
      return
    }

    try {
      const queue = await listPendingBobActionProposals({
        organizationId: effectiveOrgId,
        limit: 5,
      })
      setPendingApprovalsCount(queue.length)
      setPendingApprovalItems(queue)
      setStatusLastCheckedAt(new Date().toISOString())
    } catch {
      setPendingApprovalsCount(0)
      setPendingApprovalItems([])
    }
  }, [effectiveOrgId, user?.id, user?.role])

  const loadDoctorHealth = useCallback(async () => {
    if (!isGrandMaster) return
    setDoctorLoading(true)
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'doctor_health' })
      if (error) throw new Error(String(error))
      setDoctorHealth(data)
    } catch (err: any) {
      toast.error(err?.message || 'Could not load Doctor health')
    } finally {
      setDoctorLoading(false)
    }
  }, [isGrandMaster])

  const loadEndpointHealth = useCallback(async () => {
    if (!isGrandMaster) return
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({ action: 'inference_endpoint_health' })
      if (!error && data) setEndpointHealth(data)
    } catch {
      // non-fatal: endpoint health is best-effort
    }
  }, [isGrandMaster])

  const refreshStatusCockpit = useCallback(async () => {
    setStatusRefreshing(true)
    try {
      await Promise.all([
        loadPendingApprovals(),
        isGrandMaster ? loadDoctorHealth() : Promise.resolve(),
        loadEndpointHealth(),
      ])
    } finally {
      setStatusRefreshing(false)
    }
  }, [isGrandMaster, loadPendingApprovals, loadDoctorHealth, loadEndpointHealth])

  const runDoctorPlaybook = async (playbook: DoctorPlaybookId, dryRun = false) => {
    if (!isGrandMaster) return
    setDoctorPlaybookRunning(playbook)
    try {
      const { data, error } = await edgeFunctions.grandmasterStudio({
        action: 'doctor_playbook_run',
        playbook,
        dry_run: dryRun,
      })
      if (error) throw new Error(String(error))
      toast.success(`${playbook} completed`)
      if (data?.remediation?.length) {
        toast.message(`Doctor found ${data.remediation.length} remediation item(s)`)
      }
      await loadDoctorHealth()
    } catch (err: any) {
      toast.error(err?.message || `Playbook ${playbook} failed`)
    } finally {
      setDoctorPlaybookRunning(null)
    }
  }

  useEffect(() => {
    if (!isGrandMaster) return
    void loadDoctorHealth()
  }, [isGrandMaster, loadDoctorHealth])

  useEffect(() => {
    void loadPendingApprovals()
    const timer = setInterval(() => {
      void loadPendingApprovals()
    }, 30_000)
    return () => clearInterval(timer)
  }, [loadPendingApprovals])

  return (
    <AppLayout title="Bob Assistant Studio" description="Personality, voice, mapping, and drawing controls for Bob.">
      <GlobalFilterRibbon />

      <BobActionApprovalDialog
        open={bobActionApproval.isOpen}
        recommendation={bobActionApproval.recommendation}
        isLoading={bobActionApproval.isLoading}
        onApprove={(recommendation, notes) => bobActionApproval.approve(
          recommendation,
          notes,
          resolveRecommendationExecutor(recommendation.actionType),
        )}
        onReject={bobActionApproval.reject}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BrainCircuit className="h-4 w-4" /> Bob Personality</CardTitle>
              <div className="space-y-2">
                <Label htmlFor="speech-rate">Voice Speed ({(speechRate ?? 1).toFixed(2)}x)</Label>
                <Input
                  id="speech-rate"
                  type="number"
                  min={0.7}
                  max={1.3}
                  step={0.05}
                  value={speechRate}
                  onChange={(e) => setSpeechRate(Number(e.target.value || 1))}
                />
              </div>
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
                  <Button type="button" variant="outline" size="sm" onClick={applyBridgeLeadPreset}>
                    Bridge Lead
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={applyWiseMentorPreset}>
                    Wise Mentor
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Inspired styles only. Exact character/celebrity voice imitation is not supported.</p>
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
                <Label>Speech Style</Label>
                <Select value={speechStyle} onValueChange={(value) => setSpeechStyle(value as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="bridge_lead">Bridge Lead (inspired)</SelectItem>
                    <SelectItem value="wise_mentor">Wise Mentor (inspired)</SelectItem>
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
                <span className="flex items-center gap-2"><SignalHigh className="h-4 w-4" /> Bob Status Cockpit</span>
                <Button variant="outline" size="sm" onClick={() => void refreshStatusCockpit()} disabled={statusRefreshing}>
                  {statusRefreshing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <SignalHigh className="h-4 w-4 mr-1" />}
                  Refresh
                </Button>
              </CardTitle>
              <CardDescription>
                Live operating context for Bob command safety and enterprise execution readiness.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant={bobDegraded ? 'destructive' : 'default'}>
                  Runtime: {bobDegraded ? 'DEGRADED' : thinking ? 'BUSY' : 'READY'}
                </Badge>
                <Badge variant="outline">Role: {String(user?.role ?? 'unknown')}</Badge>
                <Badge variant="outline">Org: {effectiveOrgId ? 'scoped' : 'missing'}</Badge>
                <Badge variant="outline">PTT: {pttConnectionStatus}</Badge>
                <Badge variant={pendingApprovalsCount > 0 ? 'secondary' : 'outline'}>
                  Pending approvals: {pendingApprovalsCount}
                </Badge>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded border p-3 text-xs">
                  <div className="font-medium text-muted-foreground">Provider</div>
                  <div className="mt-1">{String(doctorHealth?.provider ?? (bobDegraded ? 'local-fallback' : 'runpod/inference'))}</div>
                </div>
                <div className="rounded border p-3 text-xs">
                  <div className="font-medium text-muted-foreground">Mode</div>
                  <div className="mt-1">{String(doctorHealth?.mode ?? doctorHealth?.status ?? 'standard')}</div>
                </div>
                <div className="rounded border p-3 text-xs">
                  <div className="font-medium text-muted-foreground">Voice Input</div>
                  <div className="mt-1">{voiceSupported ? 'ready' : 'not supported'}</div>
                </div>
                <div className="rounded border p-3 text-xs">
                  <div className="font-medium text-muted-foreground">Translation Pipeline</div>
                  <div className="mt-1">{radioTranslationService.isReady() ? 'active' : 'warming/fallback'}</div>
                </div>
              </div>

              {pendingApprovalItems.length > 0 && (
                <div className="rounded border p-3 text-xs space-y-2">
                  <div className="font-medium text-muted-foreground">Bob approval queue</div>
                  {pendingApprovalItems.slice(0, 3).map((proposal) => (
                    <div key={proposal.id} className="flex items-center justify-between gap-3 rounded border px-2 py-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{proposal.title}</div>
                        <div className="text-muted-foreground">
                          {proposal.impact_level} impact · {proposal.status}
                        </div>
                      </div>
                      <Badge variant={proposal.status === 'pending_escalation' ? 'destructive' : 'secondary'}>
                        {formatApprovalDueState(proposal.approval_due_at)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              {endpointHealth && (
                <div className="rounded border p-3 text-xs space-y-1">
                  <div className="font-medium text-muted-foreground">Inference Endpoints</div>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {endpointHealth.endpoints.map((ep, i) => (
                      <Badge
                        key={i}
                        variant={ep.status === 'healthy' ? 'default' : ep.status === 'degraded' ? 'secondary' : 'destructive'}
                        className="text-[10px]"
                        title={ep.url}
                      >
                        {ep.status === 'healthy' ? '✓' : ep.status === 'degraded' ? '⚠' : '✗'} #{i + 1} {ep.latencyMs}ms
                      </Badge>
                    ))}
                  </div>
                  <div className="text-muted-foreground">{endpointHealth.healthyCount}/{endpointHealth.totalEndpoints} healthy · recommended: {endpointHealth.recommended ? new URL(endpointHealth.recommended).hostname : 'none'}</div>
                </div>
              )}

              {pendingCommandConfirmation && (
                <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                  Confirmation pending: {pendingCommandConfirmation.command.intent}. Say or type "confirm command" to proceed.
                </div>
              )}

              <div className="text-[11px] text-muted-foreground">
                Last status check: {statusLastCheckedAt ? new Date(statusLastCheckedAt).toLocaleString('en-NZ') : 'pending'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Radio className="h-4 w-4" /> Bob Radio Agent</CardTitle>
              <CardDescription>
                Bob can originate real browser WebRTC audio onto PTT channels using a generated signal source. This enables active link checks and guarded emergency assist calls.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Radio Channel</Label>
                  <Select value={selectedRadioChannelId} onValueChange={setSelectedRadioChannelId}>
                    <SelectTrigger>
                      <SelectValue placeholder={radioChannelsLoading ? 'Loading channels…' : 'Select channel'} />
                    </SelectTrigger>
                    <SelectContent>
                      {radioChannels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          CH {channel.channel_number} · {channel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Signal Profile</Label>
                  <Select value={radioSignalProfile} onValueChange={(value) => setRadioSignalProfile(value as BobRadioSignalProfile)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="link-test">Link Test</SelectItem>
                      <SelectItem value="attention">Attention Tone</SelectItem>
                      <SelectItem value="warble">Warble Sweep</SelectItem>
                      <SelectItem value="spoken">Spoken Relay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Signal Text</Label>
                <Input
                  value={radioSignalText}
                  onChange={(e) => setRadioSignalText(e.target.value.toUpperCase())}
                  placeholder="BOB LINK TEST"
                  maxLength={24}
                />
                <p className="text-xs text-muted-foreground">
                  Tone profiles generate deterministic browser audio. Spoken Relay uses Bob speech synthesis and sends it through the same WebRTC/TURN path as live speech.
                </p>
              </div>

              <div className="grid gap-2 text-sm md:grid-cols-3">
                <div className="rounded border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Connection</div>
                  <div className="mt-1 font-medium">{pttConnectionStatus}</div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Scope</div>
                  <div className="mt-1 font-medium break-all">{selectedRadioScope || 'none'}</div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Outbound Source</div>
                  <div className="mt-1 font-medium">{pttDiagnostics.outboundAudioSource}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void connectBobRadioChannel()} disabled={!effectiveOrgId || radioConnecting}>
                  {radioConnecting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <SignalHigh className="mr-1 h-4 w-4" />}
                  Join Channel
                </Button>
                <Button variant="outline" onClick={() => void transmitBobRadioSignal()} disabled={!effectiveOrgId || radioTransmitting || radioConnecting}>
                  {radioTransmitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Radio className="mr-1 h-4 w-4" />}
                  Transmit Test Signal
                </Button>
                <Button variant="outline" onClick={() => void disconnectBobRadioChannel()} disabled={pttConnectionStatus === 'disconnected' && !radioTransmitting}>
                  <PhoneOff className="mr-1 h-4 w-4" /> Disconnect
                </Button>
              </div>

              <div className="rounded border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="bob-danger-auto-assist">Armed danger auto-assist</Label>
                  <Switch
                    id="bob-danger-auto-assist"
                    checked={dangerAutoAssistArmed}
                    onCheckedChange={setDangerAutoAssistArmed}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="bob-ambient-monitor">Monitor ambient risk audio</Label>
                  <Switch
                    id="bob-ambient-monitor"
                    checked={ambientRiskMonitoring}
                    onCheckedChange={setAmbientRiskMonitoring}
                    disabled={!dangerAutoAssistArmed}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="bob-dual-signal">Require dual-signal confirmation</Label>
                  <Switch
                    id="bob-dual-signal"
                    checked={requireDualSignal}
                    onCheckedChange={setRequireDualSignal}
                    disabled={!dangerAutoAssistArmed}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Dual-signal window seconds</Label>
                  <Input
                    type="number"
                    min={3}
                    max={60}
                    step={1}
                    value={dualSignalWindowSeconds}
                    onChange={(e) => setDualSignalWindowSeconds(Math.max(3, Math.min(60, Number(e.target.value) || 12)))}
                    disabled={!dangerAutoAssistArmed || !requireDualSignal}
                  />
                </div>
                <Input
                  value={dangerKeywords}
                  onChange={(e) => setDangerKeywords(e.target.value)}
                  placeholder="Comma-separated danger phrases"
                />
                <div className="space-y-1.5">
                  <Label>Ambient Sensitivity ({ambientSensitivity})</Label>
                  <Input
                    type="number"
                    min={35}
                    max={95}
                    step={1}
                    value={ambientSensitivity}
                    onChange={(e) => setAmbientSensitivity(Math.max(35, Math.min(95, Number(e.target.value) || 65)))}
                  />
                </div>
                <div className="flex items-center justify-between rounded border bg-muted/20 px-3 py-2">
                  <div>
                    <Label className="text-sm">Secure cancel verification</Label>
                    <p className="text-xs text-muted-foreground">Require identity check before emergency cancel is accepted.</p>
                  </div>
                  <Switch checked={secureCancelVerificationEnabled} onCheckedChange={setSecureCancelVerificationEnabled} />
                </div>
                {secureCancelVerificationEnabled && (
                  <div className="space-y-2 rounded border bg-muted/20 p-3">
                    <div className="space-y-1.5">
                      <Label>Cancel Verification Mode</Label>
                      <Select value={cancelVerificationMode} onValueChange={(value: EmergencyCancelVerificationMode) => setCancelVerificationMode(value)}>
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Select verification mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="platform_biometric">Fingerprint / Face (platform)</SelectItem>
                          <SelectItem value="voiceprint" disabled={!orgVoiceprintEnrollmentAllowed}>Voiceprint match</SelectItem>
                        </SelectContent>
                      </Select>
                      {!orgVoiceprintEnrollmentAllowed && (
                        <p className="text-xs text-amber-700">Voiceprint mode is disabled by organization policy.</p>
                      )}
                    </div>
                    {cancelVerificationMode === 'voiceprint' && orgVoiceprintEnrollmentAllowed && (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void enrollCurrentVoiceprint()}
                            disabled={cancelVerificationInProgress}
                          >
                            {enrolledVoiceprint?.length ? 'Re-enroll Voiceprint' : 'Enroll Voiceprint'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={clearEnrolledVoiceprint}
                            disabled={!enrolledVoiceprint?.length || cancelVerificationInProgress}
                          >
                            Clear Enrollment
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Enrollment status: {enrolledVoiceprint?.length ? 'Enrolled' : 'Not enrolled'}
                          {typeof lastVoiceprintScore === 'number' ? ` • Last similarity ${Math.round(lastVoiceprintScore * 100)}%` : ''}
                        </p>
                      </>
                    )}
                    {cancelVerificationInProgress && (
                      <p className="text-xs text-amber-700">Verification in progress...</p>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Emergency location context: {emergencyLocationLabel}</p>
                  <Button variant="outline" size="sm" onClick={() => void refreshEmergencyLocationLabel()}>
                    Refresh Location
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  When armed, Bob can trigger from transcript danger phrases and ambient escalation patterns. With dual-signal on, both transcript and ambient evidence are required before the countdown starts. Emergency broadcast forces the emergency channel and includes first name plus location context.
                </p>
                <p className="text-xs text-amber-700">
                  Assistive only: ambient and transcript detection are heuristic indicators, not forensic proof.
                </p>
                {emergencyCountdownSeconds !== null && (
                  <div className="rounded border border-red-300 bg-red-50 p-3 space-y-2">
                    <div className="text-sm font-semibold text-red-700">
                      Emergency assist pending: calling in {emergencyCountdownSeconds}s
                    </div>
                    <p className="text-xs text-red-700">Reason: {pendingEmergencyReason || 'Potential critical escalation detected'}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="destructive" size="sm" onClick={() => void triggerEmergencyCallNow(pendingEmergencyReason || undefined)}>
                        Make Call Now
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void cancelPendingEmergencyCall()} disabled={cancelVerificationInProgress}>
                        {cancelVerificationInProgress ? 'Verifying...' : 'Cancel Call'}
                      </Button>
                    </div>
                  </div>
                )}
                {dangerCooldownUntil > Date.now() && (
                  <p className="text-xs text-amber-600">
                    Auto-assist cooldown active until {new Date(dangerCooldownUntil).toLocaleTimeString('en-NZ')}
                  </p>
                )}
                {lastEmergencyPhrase && (
                  <div className="rounded border bg-muted/30 p-2 text-xs text-muted-foreground">
                    Emergency phrase template: {lastEmergencyPhrase}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <BobOrb
                    size="sm"
                    state={
                      (listening ? 'listening'
                        : thinking ? 'thinking'
                        : isBobSpeaking ? 'speaking'
                        : bobDegraded ? 'degraded'
                        : 'idle') as BobOrbState
                    }
                  />
                  Conversation
                </span>
                <Badge variant="outline">{displayName}</Badge>
              </CardTitle>
              <CardDescription>Talk to Bob by typing or voice. Bob is your inference agent and assistant, and can coordinate build context across DB, UI, Expo, RunPod, and Vercel workflows.</CardDescription>
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

              <div className="rounded-lg border bg-muted/30 px-3 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-sm font-medium">Execution Policy</div>
                  <Badge variant="outline">Effective: {effectivePolicy.mode}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Role: {effectivePolicy.role} · Title: {effectivePolicy.title || 'not set'}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={policyMode === 'auto' ? 'default' : 'outline'} onClick={() => setPolicyMode('auto')} disabled={!isPolicyManager || thinking}>Auto</Button>
                  <Button size="sm" variant={policyMode === 'owner_full' ? 'default' : 'outline'} onClick={() => setPolicyMode('owner_full')} disabled={!isPolicyManager || thinking}>Owner Full</Button>
                  <Button size="sm" variant={policyMode === 'master_balanced' ? 'default' : 'outline'} onClick={() => setPolicyMode('master_balanced')} disabled={!isPolicyManager || thinking}>Master Balanced</Button>
                  <Button size="sm" variant={policyMode === 'officer_assist' ? 'default' : 'outline'} onClick={() => setPolicyMode('officer_assist')} disabled={!isPolicyManager || thinking}>Officer Assist</Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex items-center justify-between rounded border px-2 py-1.5">
                    <Label className="text-xs">Schema checks</Label>
                    <Switch checked={enforceSchemaCheck} onCheckedChange={setEnforceSchemaCheck} disabled={!isPolicyManager || thinking} />
                  </div>
                  <div className="flex items-center justify-between rounded border px-2 py-1.5">
                    <Label className="text-xs">Hard section rules</Label>
                    <Switch checked={enforceHardSections} onCheckedChange={setEnforceHardSections} disabled={!isPolicyManager || thinking} />
                  </div>
                  <div className="flex items-center justify-between rounded border px-2 py-1.5">
                    <Label className="text-xs">Action checklist</Label>
                    <Switch checked={showActionChecklist} onCheckedChange={setShowActionChecklist} disabled={!isPolicyManager || thinking} />
                  </div>
                </div>
                {!isPolicyManager && (
                  <div className="text-xs text-muted-foreground">Manual restriction controls are available for master and grand master roles.</div>
                )}
              </div>

              <div className="h-[45vh] min-h-[200px] overflow-auto rounded border p-3 space-y-2 bg-muted/20">
                {chat.length === 0 && !thinking ? (
                  <div className="text-sm text-muted-foreground">No messages yet. Ask Bob for import help, directions, or operational guidance.</div>
                ) : (
                  chat.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] rounded px-3 py-2 text-sm ${message.role === 'assistant' ? 'bg-primary text-primary-foreground mr-auto' : 'bg-background border ml-auto text-right'}`}>
                        <div className="text-[11px] opacity-80 mb-1">{message.role === 'assistant' ? displayName : 'You'}</div>
                        <div className="text-left">{message.text}</div>
                        {message.role === 'assistant' && !!message.actionChecklist?.length && (
                          <div className="mt-2 rounded border border-white/40 bg-white/10 p-2 space-y-1">
                            <div className="text-xs font-semibold">Action Checklist</div>
                            {message.actionChecklist.map((task, index) => {
                              const key = `${message.id}-${index}`
                              const done = !!completedChecklist[key]
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  className="block w-full text-left text-xs rounded border border-white/30 px-2 py-1 hover:bg-white/10"
                                  onClick={() => setCompletedChecklist((prev) => ({ ...prev, [key]: !done }))}
                                >
                                  {done ? '[x]' : '[ ]'} {task}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {message.role === 'assistant' && !!message.executionReview && (
                          <div className="mt-2 rounded border border-white/40 bg-white/10 p-2 space-y-1 text-xs">
                            <div className="font-semibold">Execution Review</div>
                            <div>Policy mode: {message.executionReview.policyMode || 'unknown'}</div>
                            {!!message.executionReview.currentRoute && (
                              <div>Current route: {message.executionReview.currentRoute}</div>
                            )}
                            {!!message.executionReview.matchedRoutes?.length && (
                              <div>Matched routes: {message.executionReview.matchedRoutes.join(', ')}</div>
                            )}
                            {!!message.executionReview.matchedEntities?.length && (
                              <div>Matched entities: {message.executionReview.matchedEntities.join(', ')}</div>
                            )}
                            {!!message.executionReview.candidateMutationContracts?.length && (
                              <div>Candidate contracts: {message.executionReview.candidateMutationContracts.join(', ')}</div>
                            )}
                            {!!message.executionReview.requestedMutationContract && (
                              <div>
                                Requested contract: {message.executionReview.requestedMutationContract}
                                {message.executionReview.mutationAccess
                                  ? ` (${message.executionReview.mutationAccess.allowed ? 'allowed' : 'blocked'})`
                                  : ''}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {thinking && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded px-3 py-2 text-sm bg-primary/70 text-primary-foreground mr-auto flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                      <span>{displayName} is thinking…</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="flex gap-2 pb-safe">
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask Bob anything operational..."
                  className="min-h-[72px] resize-none"
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
                <Button variant="secondary" onClick={requestSaveLivePlanApproval} disabled={savingPlan}>{savingPlan ? 'Saving…' : 'Approve & Save Live Plan'}</Button>
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Stethoscope className="h-4 w-4" /> Doctor Control Room</CardTitle>
              <CardDescription>
                System-level self-healing controls for Bob and Ollama. Includes health scoring, active risks, and guarded playbooks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isGrandMaster ? (
                <p className="text-xs text-muted-foreground">
                  Grand Master access is required to run Doctor playbooks.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => void loadDoctorHealth()} disabled={doctorLoading}>
                      {doctorLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Stethoscope className="h-4 w-4 mr-1" />}
                      Refresh Doctor Health
                    </Button>
                    <Badge variant={doctorHealth?.doctor_score >= 90 ? 'default' : doctorHealth?.doctor_score >= 75 ? 'secondary' : 'destructive'}>
                      Score: {typeof doctorHealth?.doctor_score === 'number' ? doctorHealth.doctor_score : '--'}
                    </Badge>
                    {doctorHealth?.status && <Badge variant="outline">{String(doctorHealth.status).toUpperCase()}</Badge>}
                  </div>

                  {Array.isArray(doctorHealth?.active_risks) && doctorHealth.active_risks.length > 0 ? (
                    <div className="rounded border bg-muted/30 p-3 space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">Active Risks</div>
                      {doctorHealth.active_risks.slice(0, 5).map((risk: any) => (
                        <div key={String(risk.id)} className="text-xs">
                          <div className="font-medium">{String(risk.id)} · {String(risk.severity)}</div>
                          <div className="text-muted-foreground">{String(risk.message || '')}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded border bg-emerald-50 dark:bg-emerald-950/20 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                      No active Doctor risks detected.
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runDoctorPlaybook('ollama_recovery')}
                      disabled={doctorPlaybookRunning !== null}
                    >
                      {doctorPlaybookRunning === 'ollama_recovery' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                      Run Ollama Recovery
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runDoctorPlaybook('ptt_token_path_repair', true)}
                      disabled={doctorPlaybookRunning !== null}
                    >
                      {doctorPlaybookRunning === 'ptt_token_path_repair' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                      Check PTT Token Path
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runDoctorPlaybook('edge_auth_alignment', true)}
                      disabled={doctorPlaybookRunning !== null}
                    >
                      {doctorPlaybookRunning === 'edge_auth_alignment' ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                      Check Edge Auth Alignment
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Bob Automation & Testing ─────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4" /> Automation &amp; Testing
              </CardTitle>
              <CardDescription>
                Run live smoke tests, data verification, performance benchmarks, or a bug-fix audit directly inside the app.
                Bob can analyse the results and suggest remediation steps.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Suite buttons */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  { suite: 'smoke', label: 'Smoke Tests', desc: 'Auth, DB, edge functions, NZSCV, welfare' },
                  { suite: 'data', label: 'Data Check', desc: 'Compliance state, monthly stays, duplicates' },
                  { suite: 'performance', label: 'Benchmark', desc: 'Query timing across key tables' },
                  { suite: 'bugfix', label: 'Bug Audit', desc: 'Bob analysis status, anomalies in recent reports' },
                ] as const).map(({ suite, label, desc }) => (
                  <button
                    key={suite}
                    disabled={testRunning}
                    onClick={() => runAutomationSuite(suite)}
                    title={desc}
                    className="flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {testRunning && testSuiteLabel === ({ smoke: 'Smoke Tests', data: 'Data Verification', performance: 'Performance Benchmark', bugfix: 'Bug Fix Audit' })[suite]
                      ? <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      : <Play className="h-5 w-5 text-primary" />
                    }
                    {label}
                  </button>
                ))}
              </div>

              {/* Results area */}
              {testLines.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1 max-h-64 overflow-auto font-mono text-xs">
                  <div className="flex items-center gap-2 mb-2 text-[11px] font-sans text-muted-foreground font-semibold">
                    {testSuiteLabel} — {testRunning ? 'Running…' : 'Complete'}
                    {!testRunning && (
                      testLines.some((l) => l.ok === false)
                        ? <span className="ml-auto text-red-500 font-medium flex items-center gap-1"><XCircle className="h-3 w-3" /> Issues detected</span>
                        : <span className="ml-auto text-green-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> All clear</span>
                    )}
                  </div>
                  {testLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={
                        line.ok === true ? 'text-green-700 dark:text-green-400'
                        : line.ok === false ? 'text-red-600 dark:text-red-400'
                        : 'text-muted-foreground'
                      }
                    >
                      {line.ok === true ? '✓ ' : line.ok === false ? '✗ ' : '→ '}{line.text}
                    </div>
                  ))}
                </div>
              )}

              {/* Ask Bob to analyse */}
              {testLines.length > 0 && !testRunning && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={sendTestResultsToBob}
                  disabled={thinking}
                  className="w-full"
                >
                  <BrainCircuit className="h-4 w-4 mr-1" />
                  Ask Bob to analyse these results
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}
