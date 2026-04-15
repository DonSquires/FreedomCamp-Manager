/**
 * AiAnalysis.tsx
 *
 * Bob Analysis — Bob-powered analysis and chat for admins and master users.
 *
 * Uses the onspace-ai-chat edge function which connects to any
 * Bob-compatible inference backend. Supported providers (in priority order):
 *   1. GitHub Copilot  — set GITHUB_TOKEN secret in Supabase Edge Functions.
 *                        Recommended for code-level fix analysis.
 *   2. Custom inference backend — set OPENAI_API_KEY (and optionally OPENAI_BASE_URL)
 *                        to point at Azure, Ollama, vLLM, or compatible providers.
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
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { supabase } from '@/lib/supabase'
import { TERMINAL_BUG_REPORT_STATUSES } from '@/lib/bugReportStatus'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isError?: boolean
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
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [edgeOutageDetected, setEdgeOutageDetected] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isPttSupported, setIsPttSupported] = useState(false)
  const [isPttRecording, setIsPttRecording] = useState(false)
  const [latestBug, setLatestBug] = useState<BugDigest | null>(null)
  const [bugLoading, setBugLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const speechRecognitionRef = useRef<any>(null)
  const pttBaseInputRef = useRef('')

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

    const requestBody = { messages: conversationHistory }

    const invokeBobWithResilience = async () => {
      const firstAttempt = await edgeFunctions.aiChat(requestBody)
      if (!firstAttempt.error && firstAttempt.data?.response) {
        return firstAttempt.data
      }

      const firstError = String(firstAttempt.error || '')
      const shouldTryDirectFallback =
        firstError.toLowerCase().includes('unable to reach the edge function') ||
        firstError.toLowerCase().includes('network connectivity issue') ||
        firstError.toLowerCase().includes('failed to fetch') ||
        firstError.toLowerCase().includes('not be deployed')

      if (!shouldTryDirectFallback) {
        throw new Error(firstAttempt.error || 'Bob returned an empty response')
      }

      const { data: sessionData } = await supabase.auth.getSession()
      const sessionJwt = sessionData?.session?.access_token
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

      if (!sessionJwt || !supabaseUrl || !anonKey) {
        throw new Error(firstAttempt.error || 'No valid edge invocation path available')
      }

      const directResponse = await fetch(`${supabaseUrl}/functions/v1/onspace-ai-chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionJwt}`,
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const directText = await directResponse.text()
      const directJson = (() => {
        try {
          return JSON.parse(directText)
        } catch {
          return null
        }
      })()

      if (!directResponse.ok) {
        throw new Error(directJson?.error || `Edge function returned ${directResponse.status}`)
      }

      if (!directJson?.response) {
        throw new Error('Bob returned an empty response')
      }

      return directJson
    }

    try {
      const result = await withTimeout(invokeBobWithResilience(), 25000, 'Bob chat request')

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result?.response ?? 'No response received.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMsg])
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
      toast.error('Bob request failed', { description: err.message })
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }, [messages, isLoading])

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
                    className="h-9 w-9 p-0 shrink-0"
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
