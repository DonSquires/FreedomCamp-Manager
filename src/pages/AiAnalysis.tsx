/**
 * AiAnalysis.tsx
 *
 * Bob Analysis — Bob-powered analysis and chat for admins and master users.
 *
 * Uses the onspace-ai-chat edge function with Bob/Ollama provider routing.
 *
 * Features:
 *   - Multi-turn conversation with full message history
 *   - Domain-specific suggested prompts
 *   - Markdown-style formatting for Bob responses
 *   - Model selector (optional override)
 *   - Clear conversation button
 *   - Auto-scroll to latest message
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/features/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import {
  Bot,
  User,
  Send,
  Trash2,
  Sparkles,
  ChevronRight,
  AlertTriangle,
  BarChart3,
  FileText,
  MapPin,
  Shield,
  Copy,
  CheckCheck,
  Loader2,
  Mic2,
} from 'lucide-react'
import { toast } from 'sonner'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'
import { useBobAssistantStore } from '@/stores/bobAssistantStore'
import { getEffectiveBobExecutionPolicy, useBobExecutionPolicyStore } from '@/stores/bobExecutionPolicyStore'
import { supabase } from '@/lib/supabase'
import { TERMINAL_BUG_REPORT_STATUSES } from '@/lib/bugReportStatus'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isError?: boolean
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

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

interface SuggestedPrompt {
  label: string
  prompt: string
  icon: React.ReactNode
  category: 'compliance' | 'enforcement' | 'legislation' | 'reporting' | 'operations'
}

interface BugDigest {
  id: string
  title: string
  status: string | null
  severity: string | null
  description: string | null
  created_at: string
}

type AgreementIntakeType = 'service_agreement' | 'alarm_contact_matrix' | 'historical_patrol_data'
type IntakeExecutionMode = 'draft_plan' | 'review_assess_action'

// ── Suggested prompts ─────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  {
    label: 'Breach trends',
    prompt: 'What are the most common reasons vehicles receive breach alerts in freedom camping zones, and what enforcement strategies are most effective at reducing repeat offenders?',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    category: 'compliance',
  },
  {
    label: 'SCV exemption rules',
    prompt: 'Explain exactly when a self-contained vehicle is exempt from stay limits under the Freedom Camping Act 2011. What evidence do officers need to verify SCV status on-site?',
    icon: <Shield className="h-3.5 w-3.5" />,
    category: 'legislation',
  },
  {
    label: 'Zone policy review',
    prompt: 'What factors should I consider when reviewing zone stay limits? How do I balance enforcement with the needs of freedom campers and the requirements of the Freedom Camping Act?',
    icon: <MapPin className="h-3.5 w-3.5" />,
    category: 'operations',
  },
  {
    label: 'Notice to Vacate guide',
    prompt: 'Walk me through the correct process for issuing a Notice to Vacate under the Freedom Camping Act 2011. What sections apply, what must the notice include, and what are the time limits?',
    icon: <FileText className="h-3.5 w-3.5" />,
    category: 'enforcement',
  },
  {
    label: 'Compliance rate dip',
    prompt: 'Our compliance rate has dropped this week. What are the most likely causes, and what immediate actions should I instruct my patrol team to take?',
    icon: <BarChart3 className="h-3.5 w-3.5" />,
    category: 'reporting',
  },
  {
    label: 'Homeless/vulnerable policy',
    prompt: 'What obligations does a council enforcement contractor have when a vehicle occupant claims to be homeless or in a vulnerable situation? How does this affect enforcement decisions?',
    icon: <Shield className="h-3.5 w-3.5" />,
    category: 'legislation',
  },
  {
    label: 'RMA noise powers',
    prompt: 'What enforcement powers does the Resource Management Act 1991 give local authorities for noise complaints? Explain the AN, DN, and END notice types and when each applies.',
    icon: <FileText className="h-3.5 w-3.5" />,
    category: 'legislation',
  },
  {
    label: 'Infringement notice steps',
    prompt: 'What is the correct step-by-step process for issuing a parking infringement notice in New Zealand? Include the legislative basis and what happens if it is disputed.',
    icon: <FileText className="h-3.5 w-3.5" />,
    category: 'enforcement',
  },
]

const CATEGORY_COLORS: Record<SuggestedPrompt['category'], string> = {
  compliance:   'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300',
  enforcement:  'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300',
  legislation:  'bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/20 dark:border-purple-700 dark:text-purple-300',
  reporting:    'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300',
  operations:   'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/20 dark:border-orange-700 dark:text-orange-300',
}

// ── Simple markdown renderer ──────────────────────────────────────────────────
// Converts **bold**, `code`, and line breaks without pulling in a full library.

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  return lines.map((line, lineIdx) => {
    // Heading: # or ##
    if (/^#{1,2} /.test(line)) {
      const content = line.replace(/^#{1,2} /, '')
      return (
        <p key={lineIdx} className="font-semibold text-sm mt-3 mb-1">
          {renderInline(content)}
        </p>
      )
    }
    // Bullet: - or *
    if (/^[-*] /.test(line)) {
      return (
        <li key={lineIdx} className="ml-4 text-sm list-disc">
          {renderInline(line.replace(/^[-*] /, ''))}
        </li>
      )
    }
    // Numbered: 1.
    if (/^\d+\. /.test(line)) {
      return (
        <li key={lineIdx} className="ml-4 text-sm list-decimal">
          {renderInline(line.replace(/^\d+\. /, ''))}
        </li>
      )
    }
    // Blank line = spacer
    if (line.trim() === '') {
      return <div key={lineIdx} className="h-2" />
    }
    // Normal paragraph
    return (
      <p key={lineIdx} className="text-sm">
        {renderInline(line)}
      </p>
    )
  })
}

function renderInline(text: string): React.ReactNode {
  // Split on **bold**, *italic*, and `code` spans
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (/^\*[^*]+\*$/.test(part)) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={i} className="bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AiAnalysis() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { expressUserDataPermission } = useBobAssistantStore()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [edgeOutageDetected, setEdgeOutageDetected] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isPttSupported, setIsPttSupported] = useState(false)
  const [isPttRecording, setIsPttRecording] = useState(false)
  const [latestBug, setLatestBug] = useState<BugDigest | null>(null)
  const [bugLoading, setBugLoading] = useState(false)
  const [agreementClientName, setAgreementClientName] = useState('')
  const [agreementExcerpt, setAgreementExcerpt] = useState('')
  const [agreementContextChunks, setAgreementContextChunks] = useState<string[]>([])
  const [agreementIntakeType, setAgreementIntakeType] = useState<AgreementIntakeType>('service_agreement')
  const [intakeExecutionMode, setIntakeExecutionMode] = useState<IntakeExecutionMode>('draft_plan')
  const [isQueueingOwnerTask, setIsQueueingOwnerTask] = useState(false)
  const [completedChecklist, setCompletedChecklist] = useState<Record<string, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const speechRecognitionRef = useRef<any>(null)
  const pttBaseInputRef = useRef('')
  const isGrandMasterOwner = user?.role === 'grand_master'
  const isPolicyManager = user?.role === 'master' || user?.role === 'grand_master'
  const policyMode = useBobExecutionPolicyStore((state) => state.mode)
  const setPolicyMode = useBobExecutionPolicyStore((state) => state.setMode)
  const enforceSchemaCheck = useBobExecutionPolicyStore((state) => state.enforceSchemaCheck)
  const setEnforceSchemaCheck = useBobExecutionPolicyStore((state) => state.setEnforceSchemaCheck)
  const enforceHardSections = useBobExecutionPolicyStore((state) => state.enforceHardSections)
  const setEnforceHardSections = useBobExecutionPolicyStore((state) => state.setEnforceHardSections)
  const showActionChecklist = useBobExecutionPolicyStore((state) => state.showActionChecklist)
  const setShowActionChecklist = useBobExecutionPolicyStore((state) => state.setShowActionChecklist)
  const speechIntentPilotEnabled = useBobExecutionPolicyStore((state) => state.speechIntentPilotEnabled)
  const setSpeechIntentPilotEnabled = useBobExecutionPolicyStore((state) => state.setSpeechIntentPilotEnabled)
  const effectivePolicy = getEffectiveBobExecutionPolicy()

  // Auto-scroll to the latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
    if (isLoading || isPttRecording || speechRecognitionRef.current) return
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
      pttBaseInputRef.current = inputValue.trim()

      recognition.onstart = () => setIsPttRecording(true)
      recognition.onresult = (event: any) => {
        let transcript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript
        }
        const cleaned = transcript.trim()
        const combined = pttBaseInputRef.current
          ? `${pttBaseInputRef.current} ${cleaned}`.trim()
          : cleaned
        setInputValue(combined)
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

  // Pull a simple digest of the latest active bug so users can ask for progress.
  useEffect(() => {
    let isCancelled = false
    const fetchLatestBug = async () => {
      setBugLoading(true)
      const { data, error } = await supabase
        .from('bug_reports')
        .select('id,title,status,severity,description,created_at')
        .not('status', 'in', `(${TERMINAL_BUG_REPORT_STATUSES.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(1)
      if (!isCancelled) {
        if (error) {
          console.error('Failed to load latest bug digest', error)
        } else {
          setLatestBug((data?.[0] as BugDigest) ?? null)
        }
        setBugLoading(false)
      }
    }
    fetchLatestBug()
    const interval = setInterval(fetchLatestBug, 60_000)
    return () => {
      isCancelled = true
      clearInterval(interval)
    }
  }, [])

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMsg])
    setInputValue('')
    setIsLoading(true)
    setEdgeOutageDetected(false)

    // Build the full conversation history for context
    const conversationHistory = [...messages, userMsg].map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    const requestBody = { messages: conversationHistory, provider: 'auto' as const }

    try {
      const result = await withTimeout(edgeFunctions.aiChat(requestBody), 60000, 'Bob chat request')
      if (result.error || !result.data?.response) {
        throw new Error(result.error || 'Bob returned an empty response')
      }

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result.data.response,
        timestamp: new Date(),
        actionChecklist: Array.isArray((result.data as any)?.actionChecklist)
          ? ((result.data as any).actionChecklist as string[])
          : [],
        executionReview: (result.data as any)?.executionReview,
      }
      setMessages(prev => [...prev, assistantMsg])

      if (expressUserDataPermission) {
        void edgeFunctions.bobResponseFeedback({
          session_id: assistantMsg.id,
          source: 'ai-analysis',
          source_provider: String(result.data?.provider || '').toLowerCase().includes('openai')
            ? 'openai-reference'
            : 'internal',
          interaction: {
            prompt: userMsg.content,
            response: assistantMsg.content,
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
    } catch (err: any) {
      const rawError = String(err?.message || '')
      const isEdgeOutage =
        rawError.toLowerCase().includes('unable to reach the edge function') ||
        rawError.toLowerCase().includes('network connectivity issue') ||
        rawError.toLowerCase().includes('failed to fetch') ||
        rawError.toLowerCase().includes('not be deployed')

      if (isEdgeOutage) {
        setEdgeOutageDetected(true)
      }

      const errorMsg: ChatMessage = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: isEdgeOutage
          ? '⚠️ Bob chat is temporarily unavailable on this page due to an edge-function connectivity issue. You can continue in Bob Assistant Studio while this reconnects.'
          : `⚠️ ${err.message || 'Failed to get a response. Please try again.'}`,
        timestamp: new Date(),
        isError: true,
      }
      setMessages(prev => [...prev, errorMsg])

      if (expressUserDataPermission) {
        void edgeFunctions.bobResponseFeedback({
          session_id: errorMsg.id,
          source: 'ai-analysis',
          source_provider: 'internal',
          interaction: {
            prompt: userMsg.content,
            response: errorMsg.content,
            outcome: isEdgeOutage ? 'degraded_fallback' : 'error',
            rating: isEdgeOutage ? 3 : 2,
          },
          privacy: {
            consent_provided: true,
            data_sharing: 'minimal',
            redact_pii: true,
          },
        })
      }
      toast.error('Bob request failed', { description: err.message })
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }, [expressUserDataPermission, messages, isLoading])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputValue)
    }
  }

  const handleCopy = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const clearConversation = () => {
    setMessages([])
    setInputValue('')
    textareaRef.current?.focus()
  }

  const hasMessages = messages.length > 0

  const askAboutLatestBug = useCallback(() => {
    if (!latestBug) return
    const friendlyPrompt = `Give everyone a simple, human-readable update on the known bug "${latestBug.title}" (status: ${latestBug.status ?? 'unknown'}). Summarise what went wrong, what we are doing to fix it, and the next milestone. Keep it short and avoid jargon.`
    sendMessage(friendlyPrompt)
  }, [latestBug, sendMessage])

  const addExcerptToAgreementContext = () => {
    const normalized = agreementExcerpt.trim()
    if (!normalized) {
      toast.error('Paste an agreement excerpt first')
      return
    }
    setAgreementContextChunks((prev) => [...prev, normalized])
    setAgreementExcerpt('')
    toast.success('Agreement excerpt added to Bob context')
  }

  const runAgreementSetupAssist = () => {
    const currentExcerpt = agreementExcerpt.trim()
    const chunks = currentExcerpt
      ? [...agreementContextChunks, currentExcerpt]
      : agreementContextChunks

    if (chunks.length === 0) {
      toast.error('Add at least one agreement excerpt')
      return
    }

    const compiledAgreement = chunks
      .map((chunk, index) => `Excerpt ${index + 1}:\n${chunk}`)
      .join('\n\n')

    const commonInstructions = [
      'Important: the supplied agreement content may be PARTIAL and incremental, not the full document.',
      'Treat this as a live intake where more excerpts can arrive later.',
      agreementClientName.trim() ? `Client candidate name: ${agreementClientName.trim()}.` : 'Client candidate name is not yet confirmed.',
      intakeExecutionMode === 'review_assess_action'
        ? 'Execution mode: review, assess risk, and action. Do not stop at recommendations. Provide concrete next actions that an operator can execute immediately in FieldOps.'
        : 'Execution mode: draft setup plan only.',
    ]

    const executionSuffix = intakeExecutionMode === 'review_assess_action'
      ? [
          '7) Review findings: blockers, assumptions, and critical validation checks before any write action.',
          '8) Assessment: risk rating (low/medium/high), data confidence score (0-100), and go/no-go decision with reason.',
          '9) Action pack: step-by-step execution checklist with exact payload examples and rollback notes for each step.',
          '10) Operator handoff: what to run now, what to queue, and what evidence to capture after execution.',
        ]
      : []

    const serviceAgreementPrompt = [
      'You are Bob, configuring FieldOps Manager from a service agreement.',
      ...commonInstructions,
      'Return in this exact structure:',
      '1) Extracted entities: clients, service provider, facilities/sites, services, frequencies, time windows, lock/unlock obligations, alarm response obligations, reporting/invoicing obligations.',
      '2) Proposed system actions: create/update client, create/update sites, assign service provider, create patrol templates, create gate lock schedules, create alarm response runbook, create reporting profile.',
      '3) Missing data to request next (because excerpt may be partial).',
      '4) Safe SQL/edge-function plan using existing FieldOps entities only; do not invent tables.',
      '5) A short operator checklist for admin/master to confirm before execution.',
      ...executionSuffix,
      '',
      'Agreement excerpts:',
      compiledAgreement,
    ].join('\n')

    const alarmMatrixPrompt = [
      'You are Bob, configuring FieldOps Manager from an alarm/security escalation matrix.',
      ...commonInstructions,
      'This is typically tabular and may include columns like site address, alarmed yes/no, business unit, response contact 1..4, revised date, and callout notes.',
      'Return in this exact structure:',
      '1) Matrix extraction table: site, alarmed, business unit, response order, contact names, phone numbers, notes, revised date, unresolved parsing issues.',
      '2) Escalation policy extraction: first call target, when to call police, when to notify tenants/keyholders, temporary securing responsibilities.',
      '3) Proposed system actions: create/update client sites, attach site security profile, set escalation workflow order, map contacts to site response roles, mark missing contacts.',
      '4) Data quality checks: duplicate phones, malformed numbers, ambiguous names, missing alarm flags, conflicting call order.',
      '5) Missing fields required before execution and a safe operator checklist for admin/master.',
      '6) JSON payload examples for site + contact + escalation objects compatible with existing FieldOps entities only.',
      ...executionSuffix,
      '',
      'Matrix excerpts:',
      compiledAgreement,
    ].join('\n')

    const historicalPatrolPrompt = [
      'You are Bob, enriching historical patrol data from a pasted spreadsheet extract.',
      ...commonInstructions,
      'The pasted data usually includes columns such as: Internal DispatchId, Client Name, On-site Date/Time, Off-site Date/Time, Patrol Complete Status, Visit Charge (ex. GST).',
      'Return in this exact structure:',
      '1) Normalized row schema and sample JSON rows: dispatch_id, client_name, site_name, po_reference, status, on_site_at_nz, off_site_at_nz, duration_minutes, visit_charge_nzd, source_quality_flags.',
      '2) Data quality report: missing timestamps, invalid timestamps, duplicates by dispatch ID, inconsistent statuses, probable OCR/spelling issues.',
      '3) Entity mapping plan: match site names to existing client_sites, identify unmatched sites to create, map client/provider organization context.',
      '4) Import execution plan using existing FieldOps entities only: which table(s) to insert/update, idempotency key strategy, and rollback-safe staging approach.',
      '5) KPI summary from the pasted sample: completed vs missed, average duration, charge totals, site-level completion rate, and anomaly list.',
      '6) Missing fields needed from operator before final import and an explicit operator checklist.',
      ...executionSuffix,
      '',
      'Historical patrol excerpts:',
      compiledAgreement,
    ].join('\n')

    const prompt = agreementIntakeType === 'alarm_contact_matrix'
      ? alarmMatrixPrompt
      : agreementIntakeType === 'historical_patrol_data'
        ? historicalPatrolPrompt
        : serviceAgreementPrompt

    void sendMessage(prompt)
  }

  const queueOwnerAgreementTask = async () => {
    const currentExcerpt = agreementExcerpt.trim()
    const chunks = currentExcerpt
      ? [...agreementContextChunks, currentExcerpt]
      : agreementContextChunks

    if (chunks.length === 0) {
      toast.error('Add at least one agreement excerpt before queueing owner task')
      return
    }

    if (!isGrandMasterOwner) {
      toast.error('Owner queue controls are restricted to Grand Master')
      return
    }

    setIsQueueingOwnerTask(true)
    try {
      const question = [
        `${agreementIntakeType === 'alarm_contact_matrix' ? 'Alarm/security contact matrix' : agreementIntakeType === 'historical_patrol_data' ? 'Historical patrol data' : 'Service agreement'} intake request${agreementClientName.trim() ? ` for ${agreementClientName.trim()}` : ''}.`,
        'Document excerpts may be partial; reconcile incrementally and output missing fields separately.',
        agreementIntakeType === 'alarm_contact_matrix'
          ? 'Need site-level escalation mapping: response order, police escalation rules, keyholder fallback, and security contractor defaults.'
          : agreementIntakeType === 'historical_patrol_data'
            ? 'Need historical patrol enrichment: normalize timestamps, dedupe by dispatch id, map site/client entities, and output import-safe payload plan.'
            : 'Need setup plan for both directions: service provider onboarding a new client, and client onboarding/changing service provider.',
        intakeExecutionMode === 'review_assess_action'
          ? 'Run as E2E review-assess-action: include decision gates, risk/confidence scores, and an execution checklist that can be actioned immediately.'
          : 'Run as planning mode with safe draft-only output.',
        'Produce grounded implementation steps for existing FieldOps routes, stores, and Supabase entities only.',
        '',
        chunks.map((chunk, index) => `Excerpt ${index + 1}:\n${chunk}`).join('\n\n'),
      ].join('\n')

      const { data, error } = await edgeFunctions.grandmasterStudio({
        action: 'ask_copilot_submit',
        question,
        category: 'service-agreement-intake',
      })

      if (error) throw new Error(String(error))
      const requestId = (data as any)?.id || (data as any)?.request_id || 'queued'
      toast.success(`Owner task queued (${requestId})`)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to queue owner task')
    } finally {
      setIsQueueingOwnerTask(false)
    }
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)] max-w-5xl mx-auto px-4 py-4 gap-4">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Sparkles className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Bob Analysis</h1>
              <p className="text-xs text-muted-foreground">
                Bob inference agent and assistant for FieldOps Manager
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasMessages && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearConversation}
                className="gap-1.5 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Known issue broadcast */}
        <Card className="shrink-0 border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/15">
          <CardContent className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-800 flex items-center justify-center mt-0.5">
                <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-200" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-amber-900 dark:text-amber-50">Known issue being fixed</p>
                  {latestBug?.status && (
                    <Badge variant="outline" className="text-[11px] capitalize border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-100">
                      {latestBug.status.replace('_', ' ')}
                    </Badge>
                  )}
                  {latestBug?.severity && (
                    <Badge variant="outline" className="text-[11px] uppercase border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-100">
                      {latestBug.severity}
                    </Badge>
                  )}
                </div>
                <p className="text-sm font-medium">
                  {latestBug?.title ?? (bugLoading ? 'Fetching the latest update…' : 'No active bugs right now.')}
                </p>
                {latestBug?.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {latestBug.description}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={askAboutLatestBug}
                disabled={!latestBug}
                className="whitespace-nowrap"
              >
                Ask Bob for progress
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="shrink-0 border-blue-200 bg-blue-50/70 dark:border-blue-900/40 dark:bg-blue-900/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Operational Intake Controller</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste source content in chunks. Bob treats this as partial/incremental intake, extracts what is known, and flags missing setup fields.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={intakeExecutionMode === 'draft_plan' ? 'default' : 'outline'}
                size="sm"
                disabled={isLoading}
                onClick={() => setIntakeExecutionMode('draft_plan')}
              >
                Draft Plan Mode
              </Button>
              <Button
                variant={intakeExecutionMode === 'review_assess_action' ? 'default' : 'outline'}
                size="sm"
                disabled={isLoading}
                onClick={() => setIntakeExecutionMode('review_assess_action')}
              >
                Review-Assess-Action Mode
              </Button>
              <Button
                variant={agreementIntakeType === 'service_agreement' ? 'default' : 'outline'}
                size="sm"
                disabled={isLoading}
                onClick={() => setAgreementIntakeType('service_agreement')}
              >
                Service Agreement Mode
              </Button>
              <Button
                variant={agreementIntakeType === 'alarm_contact_matrix' ? 'default' : 'outline'}
                size="sm"
                disabled={isLoading}
                onClick={() => setAgreementIntakeType('alarm_contact_matrix')}
              >
                Alarm Contact Matrix Mode
              </Button>
              <Button
                variant={agreementIntakeType === 'historical_patrol_data' ? 'default' : 'outline'}
                size="sm"
                disabled={isLoading}
                onClick={() => setAgreementIntakeType('historical_patrol_data')}
              >
                Historical Patrol Data Mode
              </Button>
              <Badge variant="outline">
                Active mode: {agreementIntakeType === 'alarm_contact_matrix' ? 'alarm/escalation matrix' : agreementIntakeType === 'historical_patrol_data' ? 'historical patrol data' : 'service agreement'}
              </Badge>
              <Badge variant="outline">
                Execution: {intakeExecutionMode === 'review_assess_action' ? 'review-assess-action' : 'draft plan'}
              </Badge>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr,2fr]">
              <Input
                value={agreementClientName}
                onChange={(e) => setAgreementClientName(e.target.value)}
                placeholder="Client or provider name (optional)"
                disabled={isLoading}
              />
              <Textarea
                value={agreementExcerpt}
                onChange={(e) => setAgreementExcerpt(e.target.value)}
                placeholder={agreementIntakeType === 'historical_patrol_data' ? 'Paste historical patrol rows (Excel export, CSV, or tabular text)...' : 'Paste agreement excerpt (partial is fine)...'}
                rows={3}
                disabled={isLoading}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Context chunks: {agreementContextChunks.length + (agreementExcerpt.trim() ? 1 : 0)}</Badge>
              <Button variant="outline" size="sm" onClick={addExcerptToAgreementContext} disabled={isLoading}>
                Add excerpt to context
              </Button>
              <Button size="sm" onClick={runAgreementSetupAssist} disabled={isLoading}>
                {intakeExecutionMode === 'review_assess_action' ? 'Ask Bob to review, assess, and action' : 'Ask Bob to draft setup plan'}
              </Button>
              {isGrandMasterOwner && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={queueOwnerAgreementTask}
                  disabled={isLoading || isQueueingOwnerTask}
                >
                  {isQueueingOwnerTask
                    ? 'Queueing…'
                    : intakeExecutionMode === 'review_assess_action'
                      ? 'Owner: queue E2E automation task'
                      : 'Owner: queue automation task'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shrink-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bob Execution Policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Effective mode: <strong>{effectivePolicy.mode}</strong> (role: {effectivePolicy.role}, title: {effectivePolicy.title || 'not set'})
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={policyMode === 'auto' ? 'default' : 'outline'} onClick={() => setPolicyMode('auto')} disabled={!isPolicyManager || isLoading}>Auto by role/title</Button>
              <Button size="sm" variant={policyMode === 'owner_full' ? 'default' : 'outline'} onClick={() => setPolicyMode('owner_full')} disabled={!isPolicyManager || isLoading}>Owner Full</Button>
              <Button size="sm" variant={policyMode === 'master_balanced' ? 'default' : 'outline'} onClick={() => setPolicyMode('master_balanced')} disabled={!isPolicyManager || isLoading}>Master Balanced</Button>
              <Button size="sm" variant={policyMode === 'officer_assist' ? 'default' : 'outline'} onClick={() => setPolicyMode('officer_assist')} disabled={!isPolicyManager || isLoading}>Officer Assist</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={enforceSchemaCheck ? 'default' : 'outline'} onClick={() => setEnforceSchemaCheck(!enforceSchemaCheck)} disabled={!isPolicyManager || isLoading}>Schema checks {enforceSchemaCheck ? 'on' : 'off'}</Button>
              <Button size="sm" variant={enforceHardSections ? 'default' : 'outline'} onClick={() => setEnforceHardSections(!enforceHardSections)} disabled={!isPolicyManager || isLoading}>Hard sections {enforceHardSections ? 'on' : 'off'}</Button>
              <Button size="sm" variant={showActionChecklist ? 'default' : 'outline'} onClick={() => setShowActionChecklist(!showActionChecklist)} disabled={!isPolicyManager || isLoading}>Action checklist {showActionChecklist ? 'on' : 'off'}</Button>
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Speech Intent Advisory Pilot</p>
                <p className="text-xs text-muted-foreground">Turn Bob voice-intent advisory card on or off for owner manager and master sessions.</p>
              </div>
              <Switch
                checked={speechIntentPilotEnabled}
                onCheckedChange={setSpeechIntentPilotEnabled}
                disabled={!isPolicyManager || isLoading}
              />
            </div>
            {!isPolicyManager && (
              <p className="text-xs text-muted-foreground">Manual policy controls are restricted to master and grand master roles.</p>
            )}
          </CardContent>
        </Card>

        {/* ── Main layout ─────────────────────────────────────────────────────── */}
        <div className="flex gap-4 flex-1 min-h-0">

          {/* ── Suggested prompts sidebar ──────────────────────────────────── */}
          {!hasMessages && (
            <div className="w-64 shrink-0 hidden lg:flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
                Suggested prompts
              </p>
              {SUGGESTED_PROMPTS.map((sp) => (
                <button
                  key={sp.label}
                  onClick={() => sendMessage(sp.prompt)}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-xs hover:opacity-80 transition-opacity ${CATEGORY_COLORS[sp.category]}`}
                >
                  <span className="mt-0.5 shrink-0">{sp.icon}</span>
                  <span className="font-medium leading-snug">{sp.label}</span>
                  <ChevronRight className="h-3 w-3 ml-auto mt-0.5 shrink-0 opacity-50" />
                </button>
              ))}
            </div>
          )}

          {/* ── Chat pane ─────────────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0 gap-3">

            {/* ── Messages area ─────────────────────────────────────────── */}
            <Card className="flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full">
                <CardContent className="p-4 space-y-4">

                  {!hasMessages && (
                    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/40 dark:to-indigo-900/40 flex items-center justify-center">
                        <Bot className="h-8 w-8 text-violet-600 dark:text-violet-400" />
                      </div>
                      <div>
                        <p className="font-semibold text-base">Welcome to Bob</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                          Ask anything about compliance, enforcement, NZ legislation, breach trends, or operational strategy.
                        </p>
                      </div>
                      {/* Mobile suggested prompts */}
                      <div className="lg:hidden grid grid-cols-2 gap-2 w-full max-w-md mt-2">
                        {SUGGESTED_PROMPTS.slice(0, 4).map((sp) => (
                          <button
                            key={sp.label}
                            onClick={() => sendMessage(sp.prompt)}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-xs hover:opacity-80 transition-opacity ${CATEGORY_COLORS[sp.category]}`}
                          >
                            {sp.icon}
                            <span className="font-medium truncate">{sp.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      {/* Avatar */}
                      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium mt-1 ${
                        msg.role === 'user'
                          ? 'bg-blue-600'
                          : msg.isError
                            ? 'bg-red-500'
                            : 'bg-gradient-to-br from-violet-500 to-indigo-600'
                      }`}>
                        {msg.role === 'user'
                          ? <User className="h-3.5 w-3.5" />
                          : <Bot className="h-3.5 w-3.5" />
                        }
                      </div>

                      {/* Bubble */}
                      <div className={`group relative max-w-[78%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white rounded-tr-sm'
                            : msg.isError
                              ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-tl-sm'
                              : 'bg-gray-100 dark:bg-gray-800 rounded-tl-sm'
                        }`}>
                          {msg.role === 'user'
                            ? <p>{msg.content}</p>
                            : <div className="space-y-0.5">{renderMarkdown(msg.content)}</div>
                          }
                          {msg.role === 'assistant' && !msg.isError && !!msg.actionChecklist?.length && (
                            <div className="mt-3 rounded-lg border border-white/30 bg-white/10 p-2">
                              <p className="text-xs font-semibold mb-1">Action Checklist</p>
                              <div className="space-y-1">
                                {msg.actionChecklist.map((task, index) => {
                                  const key = `${msg.id}-${index}`
                                  const done = !!completedChecklist[key]
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => setCompletedChecklist((prev) => ({ ...prev, [key]: !done }))}
                                      className="w-full text-left text-xs rounded border border-white/30 px-2 py-1 hover:bg-white/10"
                                    >
                                      {done ? '[x]' : '[ ]'} {task}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {msg.role === 'assistant' && !msg.isError && !!msg.executionReview && (
                            <div className="mt-3 rounded-lg border border-white/30 bg-white/10 p-2 text-xs space-y-1">
                              <p className="font-semibold">Execution Review</p>
                              <p>Policy mode: {msg.executionReview.policyMode || 'unknown'}</p>
                              {!!msg.executionReview.currentRoute && <p>Current route: {msg.executionReview.currentRoute}</p>}
                              {!!msg.executionReview.matchedRoutes?.length && <p>Matched routes: {msg.executionReview.matchedRoutes.join(', ')}</p>}
                              {!!msg.executionReview.matchedEntities?.length && <p>Matched entities: {msg.executionReview.matchedEntities.join(', ')}</p>}
                              {!!msg.executionReview.candidateMutationContracts?.length && <p>Candidate contracts: {msg.executionReview.candidateMutationContracts.join(', ')}</p>}
                            </div>
                          )}
                        </div>

                        {/* Timestamp + copy */}
                        <div className={`flex items-center gap-2 px-1 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                          <span className="text-[10px] text-muted-foreground">
                            {msg.timestamp.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {msg.role === 'assistant' && !msg.isError && (
                            <button
                              onClick={() => handleCopy(msg.id, msg.content)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                              title="Copy response"
                            >
                              {copiedId === msg.id
                                ? <CheckCheck className="h-3 w-3 text-green-500" />
                                : <Copy className="h-3 w-3" />
                              }
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Loading indicator */}
                  {isLoading && (
                    <div className="flex gap-3">
                      <div className="shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mt-1">
                        <Bot className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                        <span className="text-sm text-muted-foreground">Thinking…</span>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </CardContent>
              </ScrollArea>
            </Card>

            {/* ── Input row ─────────────────────────────────────────────── */}
            <Card>
              <CardContent className="p-3">
                <div className="flex gap-2 items-end">
                  <Textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about compliance, enforcement, legislation, or operations… (Enter to send, Shift+Enter for new line)"
                    className="resize-none min-h-[52px] max-h-40 text-sm flex-1 border-0 shadow-none focus-visible:ring-0 p-0"
                    rows={2}
                    disabled={isLoading}
                  />
                  <Button
                    type="button"
                    variant={isPttRecording ? 'destructive' : 'outline'}
                    size="sm"
                    disabled={!isPttSupported || isLoading}
                    className={`h-9 w-9 p-0 shrink-0 ${isPttRecording ? 'animate-pulse ring-2 ring-red-300 ring-offset-1' : ''}`}
                    title={isPttRecording ? 'Release to stop' : 'Hold to talk'}
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
                    <Mic2 className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => sendMessage(inputValue)}
                    disabled={!inputValue.trim() || isLoading}
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-700 text-white h-9 w-9 p-0 shrink-0"
                  >
                    {isLoading
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Send className="h-4 w-4" />
                    }
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 px-0.5">
                  Bob uses your organisation's inference backend. Responses may not always be accurate — verify important information.
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 px-0.5">
                  {isPttSupported ? 'Push-to-talk: hold the mic button while speaking.' : 'Push-to-talk works in Chrome/Edge.'}
                </p>
                {isPttRecording && (
                  <p className="text-[10px] text-red-700 mt-1 px-0.5 font-medium inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-600 animate-pulse" />
                    Recording now... release the mic button to stop.
                  </p>
                )}
                {edgeOutageDetected && (
                  <div className="mt-2 px-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => navigate('/bob-assistant')}
                    >
                      Continue in Bob Assistant Studio
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
