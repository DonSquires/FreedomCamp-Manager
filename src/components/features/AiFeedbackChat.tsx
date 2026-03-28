/**
 * AiFeedbackChat
 *
 * AI-guided chat intake for bug reports, feature requests, and performance
 * issues.  The AI asks targeted questions, understands the user's problem,
 * then produces a structured JSON summary that is submitted as a bug_report
 * row — no manual form-filling required.
 *
 * Flow:
 *   1. AI greets the user and asks about the type of issue.
 *   2. 3–5 follow-up questions refine the details.
 *   3. When ready, the AI embeds a JSON block (```json ... ```) containing
 *      the structured report data.
 *   4. The component detects the JSON block, shows a confirmation card,
 *      and lets the user submit with one tap.
 *   5. On submit, the report is inserted and auto-analysed.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Bot, Send, Loader2, CheckCircle2, AlertTriangle, Lightbulb,
  Zap, Bug, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { getFeedbackSnapshot } from '@/hooks/useFeedbackCapture'
import { edgeFunctions } from '@/lib/edgeFunctions'

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
  steps_to_reproduce?: string
  expected_behavior?: string
  actual_behavior?: string
}

interface AiFeedbackChatProps {
  onSubmitted: () => void
  onCancel: () => void
}

// ── System prompt ─────────────────────────────────────────────────────────────

const INTAKE_SYSTEM_PROMPT = `You are a friendly support assistant for FreedomCamp Manager — a NZ freedom camping enforcement app used by patrol officers, admins, and councils.

Your job is to help users report bugs, request features, or flag performance issues. Ask simple, pointed questions one at a time to understand what happened. Be conversational and brief.

Guidelines:
- Ask ONE question at a time — don't overwhelm the user.
- After 3–5 exchanges you should have enough information.
- When you have enough, say something like "Got it! Here's what I'll submit:" followed by a JSON block.
- The JSON block MUST be valid JSON inside triple backticks with the json language tag.
- Be warm and reassuring — officers often report issues from the field on mobile.

When ready to submit, include EXACTLY this JSON structure (all fields required):
\`\`\`json
{
  "title": "short descriptive title under 120 chars",
  "description": "clear description of the issue or request",
  "issue_type": "bug",
  "severity": "high",
  "steps_to_reproduce": "1. Go to... 2. Tap... (or null if not applicable)",
  "expected_behavior": "what should have happened (or null)",
  "actual_behavior": "what actually happened (or null)"
}
\`\`\`

For issue_type use one of: bug, feature_request, performance
For severity use one of: low, medium, high, critical`

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the first ```json ... ``` block from AI text. */
function extractJsonBlock(text: string): ExtractedReport | null {
  const match = text.match(/```json\s*([\s\S]+?)\s*```/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    // Validate required fields
    if (!parsed.title || !parsed.description || !parsed.issue_type || !parsed.severity) return null
    // Normalise issue_type and severity
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

/** Simple inline renderer for **bold** and `code`. */
function renderInline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="bg-gray-100 dark:bg-gray-800 rounded px-1 text-xs font-mono">{part.slice(1, -1)}</code>
    return part
  })
}

const SEV_COLOR: Record<string, string> = {
  critical: 'text-red-700 bg-red-100 dark:bg-red-900/30',
  high:     'text-orange-700 bg-orange-100 dark:bg-orange-900/30',
  medium:   'text-yellow-700 bg-yellow-100 dark:bg-yellow-900/30',
  low:      'text-gray-600 bg-gray-100',
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  bug:             <Bug className="h-4 w-4 text-red-500" />,
  feature_request: <Lightbulb className="h-4 w-4 text-blue-500" />,
  performance:     <Zap className="h-4 w-4 text-orange-500" />,
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AiFeedbackChat({ onSubmitted, onCancel }: AiFeedbackChatProps) {
  const { user } = useAuthStore()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedReport | null>(null)
  const [started, setStarted] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, extracted])

  // Start the conversation when the component mounts.
  // The empty deps array is intentional: we only want the opening AI greeting
  // to fire once on mount, not re-fire if sendAiMessage changes identity.
  // sendAiMessage is stable (wrapped in useCallback with no volatile deps).
  useEffect(() => {
    if (started) return
    setStarted(true)
    sendAiMessage([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const buildHistory = useCallback((msgs: ChatMsg[]) => {
    return msgs.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  }, [])

  /** Send a user message to the AI (pass empty array for the opening greeting). */
  const sendAiMessage = useCallback(async (currentMsgs: ChatMsg[], userText?: string) => {
    setLoading(true)

    const snapshot = getFeedbackSnapshot()
    const systemWithContext = INTAKE_SYSTEM_PROMPT +
      `\n\nLive context (already captured — do NOT ask about these):\n` +
      `- Current page: ${snapshot.currentPage}\n` +
      `- Recent navigation: ${snapshot.navigationHistory.slice(-3).map(n => n.path).join(' → ')}\n` +
      `- Console errors captured: ${snapshot.consoleErrors.filter(e => e.level === 'error' || e.level === 'unhandled').length}`

    const history = buildHistory(currentMsgs)

    try {
      const result = await edgeFunctions.aiChat({
        messages: [
          { role: 'system', content: systemWithContext },
          ...history,
        ],
        temperature: 0.5,
      })

      if (result.error) throw new Error(result.error)

      const responseText = result.data?.response ?? "I'm having trouble right now. Please try the form instead."

      // Check if the AI has produced a structured JSON report
      const reportData = extractJsonBlock(responseText)
      const visibleText = reportData ? stripJsonBlock(responseText) : responseText

      const assistantMsg: ChatMsg = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: visibleText,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMsg])

      if (reportData) {
        setExtracted(reportData)
      }
    } catch (err: any) {
      const errMsg: ChatMsg = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ ${err.message || 'Something went wrong. Please try the form instead.'}`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }, [buildHistory])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    const nextMsgs = [...messages, userMsg]
    setMessages(nextMsgs)
    setInput('')

    await sendAiMessage(nextMsgs, text)
  }, [input, loading, messages, sendAiMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSubmit = useCallback(async () => {
    if (!extracted || !user?.id) return
    setSubmitting(true)
    const snapshot = getFeedbackSnapshot()

    try {
      const { data: inserted } = await supabase
        .from('bug_reports')
        .insert({
          user_id: user.id,
          organization_id: user.organization_id ?? null,
          user_role: user.role,
          title: extracted.title,
          description: extracted.description,
          severity: extracted.severity,
          issue_type: extracted.issue_type,
          steps_to_reproduce: extracted.steps_to_reproduce ?? null,
          expected_behavior: extracted.expected_behavior ?? null,
          actual_behavior: extracted.actual_behavior ?? null,
          current_page: snapshot.currentPage,
          browser_info: {
            ...snapshot.browserInfo,
            navigationHistory: snapshot.navigationHistory,
            ai_intake_conversation: messages.map(m => ({ role: m.role, content: m.content.slice(0, 500) })),
          } as any,
          console_errors: snapshot.consoleErrors as any,
          app_version: snapshot.appVersion,
          status: 'submitted',
          admin_notified: false,
        })
        .select('id')
        .single()

      if (inserted?.id) {
        edgeFunctions.autoAnalyseReport({ report_id: inserted.id }).catch(() => {})
      }

      toast.success('Report submitted — thank you!')
      onSubmitted()
    } catch (err: any) {
      toast.error('Failed to submit report', { description: err.message })
    } finally {
      setSubmitting(false)
    }
  }, [extracted, user, messages, onSubmitted])

  return (
    <div className="flex flex-col gap-3" style={{ minHeight: 320 }}>

      {/* Messages */}
      <ScrollArea className="flex-1 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50" style={{ maxHeight: 340 }}>
        <div className="p-3 space-y-3">

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

          {messages.map(msg => (
            <div key={msg.id} className={`flex gap-2 items-start ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-white ${msg.role === 'user' ? 'bg-blue-600' : 'bg-gradient-to-br from-violet-500 to-indigo-600'}`}>
                {msg.role === 'user'
                  ? <span className="text-[10px] font-bold">Me</span>
                  : <Bot className="h-3.5 w-3.5" />}
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

          {/* Typing indicator */}
          {loading && messages.length > 0 && (
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

          <div ref={endRef} />
        </div>
      </ScrollArea>

      {/* Extracted report confirmation card */}
      {extracted && (
        <div className="rounded-lg border border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600 shrink-0" />
            <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Ready to submit</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-start gap-2">
              {TYPE_ICON[extracted.issue_type] ?? <Bug className="h-4 w-4 text-gray-400" />}
              <p className="text-sm font-medium leading-tight">{extracted.title}</p>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2 ml-6">{extracted.description}</p>
            <div className="flex items-center gap-2 ml-6 mt-1">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SEV_COLOR[extracted.severity] ?? SEV_COLOR.low}`}>
                {extracted.severity}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {extracted.issue_type.replace('_', ' ')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Input row */}
      {!extracted && (
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your reply… (Enter to send)"
            className="min-h-[40px] max-h-[100px] text-sm resize-none"
            rows={1}
            disabled={loading}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        {extracted ? (
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
          >
            {submitting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting…</>
              : <><CheckCircle2 className="h-3.5 w-3.5" /> Submit Report</>}
          </Button>
        ) : (
          <p className="text-[11px] text-muted-foreground italic">
            <AlertTriangle className="h-3 w-3 inline mr-1" />
            AI will ask a few questions, then submit for you
          </p>
        )}
      </div>

    </div>
  )
}
