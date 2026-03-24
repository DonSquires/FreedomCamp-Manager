/**
 * AiAnalysis.tsx
 *
 * AI — AI-powered analysis and chat for admins and master users.
 *
 * Uses the onspace-ai-chat edge function which connects to any
 * OpenAI-compatible backend.  Operators can point OPENAI_BASE_URL at their
 * own self-hosted model (Ollama, vLLM, LM Studio, etc.) by setting the
 * Supabase Edge Function secret, making this a fully independent AI system.
 *
 * Features:
 *   - Multi-turn conversation with full message history
 *   - Domain-specific suggested prompts
 *   - Markdown-style formatting for AI responses
 *   - Model selector (optional override)
 *   - Clear conversation button
 *   - Auto-scroll to latest message
 */

import { useState, useRef, useEffect, useCallback } from 'react'
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
} from 'lucide-react'
import { toast } from 'sonner'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { useAuthStore } from '@/stores/authStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isError?: boolean
}

interface SuggestedPrompt {
  label: string
  prompt: string
  icon: React.ReactNode
  category: 'compliance' | 'enforcement' | 'legislation' | 'reporting' | 'operations'
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
  const { user } = useAuthStore()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to the latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

    // Build the full conversation history for context
    const conversationHistory = [...messages, userMsg].map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))

    try {
      const result = await edgeFunctions.aiChat({ messages: conversationHistory })

      if (result.error) {
        throw new Error(result.error)
      }

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result.data?.response ?? 'No response received.',
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: `⚠️ ${err.message || 'Failed to get a response. Please try again.'}`,
        timestamp: new Date(),
        isError: true,
      }
      setMessages(prev => [...prev, errorMsg])
      toast.error('AI request failed', { description: err.message })
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
              <h1 className="text-lg font-semibold leading-tight">AI</h1>
              <p className="text-xs text-muted-foreground">
                AI-powered analysis for FreedomCamp Manager
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
                        <p className="font-semibold text-base">Welcome to AI</p>
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
                  AI uses your organisation's AI backend. Responses may not always be accurate — verify important information.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
