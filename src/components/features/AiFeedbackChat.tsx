/**
 * AiFeedbackChat
 *
 * Bob-guided chat intake for bug reports, feature requests, and performance
 * issues. Bob asks targeted questions, understands the user's problem,
 * then produces a structured JSON summary that is submitted automatically —
 * no confirmation step required.
 *
 * Flow:
 *   1. Bob receives the user's full navigation history and any console errors
 *      as context so it already knows what the user was doing.
 *   2. Bob greets the user and asks 3–5 targeted questions.
 *   3. When Bob has enough information it embeds a JSON block
 *      (```json ... ```) in its response.
 *   4. The component detects the JSON, strips it from the visible message,
 *      and immediately submits the report — no extra tap required.
 *   5. The report is auto-analysed in the background via auto-analyse-report.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Bot, Send, Loader2, CheckCircle2, Mic2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { getFeedbackSnapshot } from '@/hooks/useFeedbackCapture'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { publishBobCollaborationPacket } from '@/lib/bobCollaboration'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}


interface ExtractedReport {
  title: string
  description: string
  issue_type: 'bug' | 'feature_request' | 'performance'
  severity: 'low' | 'medium' | 'high' | 'critical'
  steps_to_reproduce?: string | null
  expected_behavior?: string | null
  actual_behavior?: string | null
}

interface AiFeedbackChatProps {
  onSubmitted: () => void
  onCancel: () => void
}

// ── System prompt ─────────────────────────────────────────────────────────────

const INTAKE_SYSTEM_PROMPT = `You are a friendly support assistant for FieldOps Manager — a field operations management platform used by patrol officers, admins, and site managers.

Your job is to help users report bugs, request features, or flag performance issues. Ask simple, pointed questions one at a time to understand what happened. Be conversational and brief. Officers are often reporting from the field on mobile — keep it short.

Guidelines:
- Ask ONE question at a time.
- Use the navigation history and console errors provided below to inform your questions. If the history shows the user was on /officer-welfare before this, ask about that page. If there are console errors, mention them.
- After 3–5 exchanges you should have enough information to file the report.
- When ready, say something brief like "Got it, filing your report now." and include the JSON block immediately after.
- The JSON block MUST be valid JSON inside triple backticks with the json language tag.

When ready to submit, include EXACTLY this JSON structure:
\`\`\`json
{
  "title": "concise title under 120 characters",
  "description": "clear description synthesising the whole conversation",
  "issue_type": "bug",
  "severity": "high",
  "steps_to_reproduce": "numbered steps, or null",
  "expected_behavior": "what should have happened, or null",
  "actual_behavior": "what actually happened, or null"
}
\`\`\`

For issue_type use one of: bug, feature_request, performance
For severity use one of: low, medium, high, critical`

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build the full navigation + error context block to inject into the system prompt. */
function buildContextBlock(): string {
  const snapshot = getFeedbackSnapshot()

  // Full navigation history — most recent last so Bob reads it in order
  const navLines = snapshot.navigationHistory.length > 0
    ? snapshot.navigationHistory.map((n, i) => {
        const time = new Date(n.timestamp).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        const isCurrent = i === snapshot.navigationHistory.length - 1
        return `  ${i + 1}. [${time}] ${n.path}${n.title ? ` (${n.title})` : ''}${isCurrent ? '  ← current page' : ''}`
      }).join('\n')
    : '  (no navigation recorded)'

  // Console errors — include message and truncated stack
  const errors = snapshot.consoleErrors.filter(e => e.level === 'error' || e.level === 'unhandled')
  const errorLines = errors.length > 0
    ? errors.slice(-10).map(e =>
        `  [${e.level.toUpperCase()}] ${e.message.slice(0, 200)}${e.stack ? '\n    ' + e.stack.slice(0, 150) : ''}`
      ).join('\n')
    : '  (none)'

  return `\n\n---\n## User context (captured automatically — do NOT ask about these)\n\n` +
    `**Current page:** ${snapshot.currentPage || '/'}\n` +
    `**App version:** ${snapshot.appVersion}\n\n` +
    `**Navigation history (chronological, most recent last):**\n${navLines}\n\n` +
    `**Console errors at time of report:**\n${errorLines}`
}

function buildBobHandoffPrompt(messages: ChatMsg[], draftInput: string): string {
  const snapshot = getFeedbackSnapshot()
  const conversation = messages
    .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n')

  return [
    'Help me continue this FieldOps feedback or bug report.',
    `Current page: ${snapshot.currentPage || '/'}`,
    `App version: ${snapshot.appVersion}`,
    draftInput.trim() ? `Unsent draft: ${draftInput.trim()}` : '',
    conversation ? `Conversation so far:\n${conversation}` : '',
    'Please help triage the issue, gather any missing detail, and take over this support flow.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Extract the first ```json ... ``` block from Bob response text. */
function extractJsonBlock(text: string): ExtractedReport | null {
  const match = text.match(/```json\s*([\s\S]+?)\s*```/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    if (!parsed.title || !parsed.description || !parsed.issue_type || !parsed.severity) return null
    parsed.issue_type = ['bug', 'feature_request', 'performance'].includes(parsed.issue_type)
      ? parsed.issue_type : 'bug'
    parsed.severity = ['low', 'medium', 'high', 'critical'].includes(parsed.severity)
      ? parsed.severity : 'medium'
    return parsed as ExtractedReport
  } catch {
    return null
  }
}

/** Strip the ```json block from the visible message text. */
function stripJsonBlock(text: string): string {
  return text.replace(/```json\s*[\s\S]+?\s*```/, '').trim()
}

async function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
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

/** Simple inline renderer for **bold** and `code` spans. */
function renderInline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="bg-gray-100 dark:bg-gray-800 rounded px-1 text-xs font-mono">{part.slice(1, -1)}</code>
    return part
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AiFeedbackChat({ onSubmitted, onCancel }: AiFeedbackChatProps) {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [bobHandoffPrompt, setBobHandoffPrompt] = useState<string | null>(null)
  const [isPttSupported, setIsPttSupported] = useState(false)
  const [isPttRecording, setIsPttRecording] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const speechRecognitionRef = useRef<any>(null)
  const pttBaseInputRef = useRef('')
  // Ref guard so the opening greeting fires exactly once, even if sendAiMessage
  // changes identity (which it can when its useCallback deps update).
  const hasSentGreeting = useRef(false)

  // Auto-scroll on every new message or state change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, submitting])

  // Re-focus the input whenever the submitting spinner disappears
  useEffect(() => {
    if (!submitting && !loading) {
      textareaRef.current?.focus()
    }
  }, [submitting, loading])

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

  const buildHistory = useCallback((msgs: ChatMsg[]) =>
    msgs.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  , [])

  /** Auto-submit a report extracted from the Bob response. No user action required. */
  const autoSubmit = useCallback(async (reportData: ExtractedReport, convMessages: ChatMsg[]) => {
    if (!user?.id) return
    setSubmitting(true)
    const snapshot = getFeedbackSnapshot()

    try {
      const { data: inserted } = await withTimeout(
        supabase
          .from('bug_reports')
          .insert({
            user_id: user.id,
            organization_id: user.organization_id ?? null,
            user_role: user.role,
            title: reportData.title,
            description: reportData.description,
            severity: reportData.severity,
            issue_type: reportData.issue_type,
            steps_to_reproduce: reportData.steps_to_reproduce ?? null,
            expected_behavior: reportData.expected_behavior ?? null,
            actual_behavior: reportData.actual_behavior ?? null,
            current_page: snapshot.currentPage,
            browser_info: {
              ...snapshot.browserInfo,
              // Full navigation log stored for grand-master review
              navigationHistory: snapshot.navigationHistory,
              // Full Bob conversation stored for audit trail
              ai_intake_conversation: convMessages.map(m => ({
                role: m.role,
                content: m.content.slice(0, 600),
                timestamp: m.timestamp.toISOString(),
              })),
            } as any,
            console_errors: snapshot.consoleErrors as any,
            app_version: snapshot.appVersion,
            status: 'submitted',
            admin_notified: false,
          })
          .select('id')
          .single(),
        15000,
        'Bug report submission'
      )

      if (inserted?.id) {
        // Fire-and-forget Bob analysis with CI health check
        edgeFunctions.autoAnalyseReport({ report_id: inserted.id }).catch(() => {})
      }

      onSubmitted()
    } catch (err: any) {
      toast.error('Failed to submit report', { description: err.message })
      setSubmitting(false)
    }
  }, [user, onSubmitted])

  /** Call the Bob edge function with the current conversation history. */
  const sendAiMessage = useCallback(async (currentMsgs: ChatMsg[]) => {
    setLoading(true)

    // Inject full context on every call so Bob always has the latest snapshot
    const systemWithContext = INTAKE_SYSTEM_PROMPT + buildContextBlock()
    const history = buildHistory(currentMsgs)

    try {
      setBobHandoffPrompt(null)
      const result = await withTimeout(
        edgeFunctions.aiChat({
          messages: [
            { role: 'system', content: systemWithContext },
            ...history,
          ],
          temperature: 0.5,
          provider: 'ollama',
        }),
        25000,
        'Bob chat request'
      )

      if (result.error) {
        // Detect configuration issues vs. transient failures
        const isConfigError = result.error.includes('not configured') || result.error.includes('Bob service')
        const msg = isConfigError
          ? `Bob service not configured. A system administrator needs to set INFERENCE_SERVICE_URL (and optionally OLLAMA_BASE_URL) in Supabase Edge Function secrets: ${result.error}`
          : result.error
        throw new Error(msg)
      }

      const responseText = result.data?.response ?? "I'm having trouble connecting right now."

      // Check if Bob has produced the structured report JSON
      const reportData = extractJsonBlock(responseText)
      // Show the Bob message with the JSON block removed — it's not human-readable
      const visibleText = reportData ? stripJsonBlock(responseText) : responseText

      const assistantMsg: ChatMsg = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: visibleText,
        timestamp: new Date(),
      }
      const updatedMsgs = [...currentMsgs, assistantMsg]
      setMessages(updatedMsgs)

      // Auto-submit immediately if Bob provided structured data
      if (reportData) {
        await autoSubmit(reportData, updatedMsgs)
      }
    } catch (err: any) {
      setBobHandoffPrompt(buildBobHandoffPrompt(currentMsgs, input))
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ ${err.message || 'Something went wrong.'}\n\nBob Assistant is available to continue this report with full build context.`,
        timestamp: new Date(),
      }])
    } finally {
      setLoading(false)
    }
  }, [buildHistory, autoSubmit, input])

  // Fire the opening greeting once on mount, using a ref guard so it fires
  // exactly once even if sendAiMessage changes identity after mount.
  useEffect(() => {
    if (hasSentGreeting.current) return
    hasSentGreeting.current = true
    sendAiMessage([])
  }, [sendAiMessage])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading || submitting) return
    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content: text, timestamp: new Date() }
    const nextMsgs = [...messages, userMsg]
    setMessages(nextMsgs)
    setInput('')
    await sendAiMessage(nextMsgs)
  }, [input, loading, submitting, messages, sendAiMessage])

  const openBobAssistant = useCallback(() => {
    if (!bobHandoffPrompt) return
    publishBobCollaborationPacket({
      source: 'feedback-ai',
      title: 'Feedback Intake Handoff',
      summary: 'Bob feedback intake could not reach its edge-backed inference assistant and has handed context to Bob Assistant.',
      prompt: bobHandoffPrompt,
      route: '/bob-assistant',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      metadata: {
        flow: 'feedback-intake',
      },
    })
    navigate('/bob-assistant')
  }, [bobHandoffPrompt, navigate])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const startPushToTalk = () => {
    if (loading || submitting || isPttRecording || speechRecognitionRef.current) return
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
      pttBaseInputRef.current = input.trim()

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
        setInput(combined)
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

  const isInputDisabled = loading || submitting

  return (
    <div className="flex flex-col gap-3" style={{ minHeight: 320 }}>

      {/* ── Messages ───────────────────────────────────────────────────── */}
      <ScrollArea
        className="flex-1 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50"
        style={{ maxHeight: 340 }}
      >
        <div className="p-3 space-y-3">

          {/* Initial connecting indicator */}
          {messages.length === 0 && loading && (
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-2 flex items-center gap-2 shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                <span className="text-xs text-muted-foreground">Connecting…</span>
              </div>
            </div>
          )}

          {/* Conversation messages */}
          {messages.map(msg => (
            <div key={msg.id} className={`flex gap-2 items-start ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-white text-[10px] font-bold ${msg.role === 'user' ? 'bg-blue-600' : 'bg-gradient-to-br from-violet-500 to-indigo-600'}`}>
                {msg.role === 'user' ? 'Me' : <Bot className="h-3.5 w-3.5" />}
              </div>
              <div className={`max-w-[82%] rounded-2xl px-3 py-2 shadow-sm text-sm leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-white dark:bg-gray-800 rounded-tl-sm'}`}>
                {msg.content.split('\n').map((line, i) => (
                  <p key={i} className={line.trim() === '' ? 'h-2' : ''}>
                    {line.trim() === '' ? null : renderInline(line)}
                  </p>
                ))}
              </div>
            </div>
          ))}

          {/* Typing indicator while Bob is thinking */}
          {loading && messages.length > 0 && !submitting && (
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-2xl rounded-tl-sm px-3 py-2 flex items-center gap-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {/* Auto-submitting indicator */}
          {submitting && (
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="bg-violet-50 dark:bg-violet-900/30 border border-violet-200 dark:border-violet-700 rounded-2xl rounded-tl-sm px-3 py-2 flex items-center gap-2 shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                <span className="text-xs text-violet-700 dark:text-violet-300 font-medium">Submitting your report…</span>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </ScrollArea>

      {/* ── Input row (hidden once submitting) ────────────────────────── */}
      {!submitting && (
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your reply… (Enter to send)"
            className="min-h-[40px] max-h-[100px] text-sm resize-none"
            rows={1}
            disabled={isInputDisabled}
          />
          <Button
            type="button"
            size="sm"
            variant={isPttRecording ? 'destructive' : 'outline'}
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
            disabled={isInputDisabled || !isPttSupported}
            className="shrink-0"
            title={isPttRecording ? 'Release to stop' : 'Hold to talk'}
          >
            <Mic2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!input.trim() || isInputDisabled}
            className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {bobHandoffPrompt && !submitting && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">Continue with Bob Assistant</p>
              <p className="mt-1 text-amber-800 dark:text-amber-300">
                Your current report context is ready to hand off to Bob so you can continue in one place.
              </p>
            </div>
            <Button type="button" size="sm" onClick={openBobAssistant}>
              Open Bob
            </Button>
          </div>
        </div>
      )}

      {/* ── Bottom action bar ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        {!submitting && (
          <p className="text-[11px] text-muted-foreground italic flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-violet-500" />
            {isPttSupported ? 'Bob submits automatically when ready. Hold mic to dictate.' : 'Bob submits automatically when ready'}
          </p>
        )}
      </div>

    </div>
  )
}
