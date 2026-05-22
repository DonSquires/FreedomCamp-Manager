import { useMemo, useRef, useState } from 'react'
import { X, Send, Loader2, BrainCircuit, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type BobQuickChatWidgetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenStudio: () => void
  currentRoute: string
}

type BobQuickPrompt = {
  id: string
  label: string
  prompt: string
}

const GREETING: ChatMessage = {
  id: 'greeting',
  role: 'assistant',
  content: 'Hi, I am Bob. Ask a quick operational question and I will help right here.',
}

function getBobManagerUrl(): string {
  const envUrl = String(import.meta.env.VITE_BOB_MANAGER_URL ?? '').trim()
  if (envUrl.length > 0) {
    return envUrl.replace(/\/$/, '')
  }

  return 'http://localhost:3000'
}

async function streamBobResponse(
  payload: Record<string, unknown>,
  onToken: (text: string) => void,
): Promise<string> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 30000)

  const response = await fetch(`${getBobManagerUrl()}/api/heal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    signal: controller.signal,
    body: JSON.stringify({ ...payload, stream: true }),
  })
  window.clearTimeout(timeoutId)

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Bob manager request failed (${response.status}): ${errorText}`)
  }

  if (!response.body) {
    const text = await response.text()
    try {
      const parsed = JSON.parse(text)
      return String(parsed?.bobResponse ?? parsed?.response ?? parsed?.message ?? parsed?.text ?? '')
    } catch {
      return text
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let collected = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const packets = buffer.split('\n\n')
    buffer = packets.pop() ?? ''

    for (const packet of packets) {
      const lines = packet.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue

        const raw = trimmed.slice(5).trim()
        if (!raw) continue

        try {
          const event = JSON.parse(raw) as { type?: string; token?: string; text?: string }
          if (event.type === 'token' && typeof event.token === 'string') {
            collected += event.token
            onToken(collected)
          }
          if (event.type === 'final' && typeof event.text === 'string') {
            collected = event.text
            onToken(collected)
          }
          if (event.type === 'done' && typeof event.text === 'string') {
            collected = event.text
            onToken(collected)
          }
        } catch {
          // Ignore malformed event frames and keep reading.
        }
      }
    }
  }

  if (buffer.trim().length > 0) {
    try {
      const raw = buffer.trim().replace(/^data:\s*/, '')
      const event = JSON.parse(raw) as { type?: string; token?: string; text?: string }
      if (typeof event.text === 'string' && event.text.length > 0) {
        collected = event.text
        onToken(collected)
      }
    } catch {
      // ignore trailing noise
    }
  }

  return collected
}

function getRouteDomain(route: string): 'biosecurity' | 'noise' | 'parking' | 'freedom_camping' | 'patrol' | 'general' {
  const normalized = String(route || '').toLowerCase()

  const isPatrolRoute =
    normalized.includes('/patrol') ||
    normalized.includes('/live-patrol') ||
    normalized.includes('/officer-home') ||
    normalized.includes('/field-officer') ||
    normalized.includes('/field')

  const isFreedomCampingRoute =
    normalized.includes('/compliance') ||
    normalized.includes('/enforcement') ||
    normalized.includes('/zones') ||
    normalized.includes('/camper-registrations') ||
    normalized.includes('/breaches')

  if (normalized.includes('/biosecurity')) return 'biosecurity'
  if (normalized.includes('/noise')) return 'noise'
  if (normalized.includes('/parking')) return 'parking'
  if (isPatrolRoute) return 'patrol'
  if (isFreedomCampingRoute) return 'freedom_camping'
  return 'general'
}

function getQuickPrompts(route: string): BobQuickPrompt[] {
  const domain = getRouteDomain(route)

  if (domain === 'biosecurity') {
    return [
      {
        id: 'bio-risk-summary',
        label: 'Risk Summary',
        prompt: 'Give me a concise biosecurity risk summary for this job with immediate containment priorities and officer safety notes.',
      },
      {
        id: 'bio-legal-basis',
        label: 'Legal Basis',
        prompt: 'Summarize the likely legal basis and evidence checklist for this biosecurity action in New Zealand.',
      },
      {
        id: 'bio-next-actions',
        label: 'Next Actions',
        prompt: 'List the next 5 operational actions for this biosecurity case with urgency order.',
      },
    ]
  }

  if (domain === 'noise') {
    return [
      {
        id: 'noise-notice-path',
        label: 'Notice Path',
        prompt: 'Based on standard NZ noise enforcement progression, should this case be Abatement, Direction, or Enforcement notice and why?',
      },
      {
        id: 'noise-evidence-checklist',
        label: 'Evidence Checklist',
        prompt: 'Provide a practical evidence checklist for this noise complaint before issuing the next notice.',
      },
      {
        id: 'noise-officer-brief',
        label: 'Officer Brief',
        prompt: 'Generate a short officer brief for this noise job including safety posture, prior-history checks, and escalation triggers.',
      },
    ]
  }

  if (domain === 'parking') {
    return [
      {
        id: 'parking-infringement-check',
        label: 'Infringement Check',
        prompt: 'Review this parking scenario and give a decision checklist before issuing or updating an infringement.',
      },
      {
        id: 'parking-appeal-risk',
        label: 'Appeal Risk',
        prompt: 'Estimate likely appeal risk for this parking action and list what evidence should be captured now.',
      },
      {
        id: 'parking-zone-compliance',
        label: 'Zone Compliance',
        prompt: 'Summarize zone compliance points to verify before enforcing this parking case.',
      },
    ]
  }

  if (domain === 'freedom_camping') {
    return [
      {
        id: 'camp-compliance-check',
        label: 'Compliance Check',
        prompt: 'Can you quickly check this freedom camping case and tell me whether we should do a warning, an infringement (FCA s.20), or a Notice to Vacate (s.32/bylaw)?',
      },
      {
        id: 'camp-enforcement-brief',
        label: 'Enforcement Brief',
        prompt: 'Please draft a short enforcement brief with the legal basis (FCA s.20(1)(a) or s.32), plus the evidence we need (plate, zone, GPS, photos) and the best service method (hand/post/email).',
      },
      {
        id: 'camp-case-next-steps',
        label: 'Case Next Steps',
        prompt: 'What are the next 5 steps for this freedom camping case, including self-contained checks, bylaw limits, and when to escalate to supervisor review or court referral?',
      },
    ]
  }

  if (domain === 'patrol') {
    return [
      {
        id: 'patrol-shift-plan',
        label: 'Shift Plan',
        prompt: 'Can you map out a simple patrol shift plan from this screen: start patrol, priority checkpoints, in-progress milestones, and end-of-patrol handover?',
      },
      {
        id: 'patrol-incident-triage',
        label: 'Incident Triage',
        prompt: 'Please give me the patrol incident triage order with immediate H&S checks, dispatch priority, and lone-worker or missed patrol escalation triggers.',
      },
      {
        id: 'patrol-officer-brief',
        label: 'Officer Brief',
        prompt: 'Write a quick patrol handover brief with route focus, known risks, open incidents, follow-ups, and required evidence capture (GPS, photos, timestamps).',
      },
    ]
  }

  return [
    {
      id: 'general-summary',
      label: 'Operational Summary',
      prompt: 'Give me a concise operational summary and next steps for the current screen context.',
    },
    {
      id: 'general-risk',
      label: 'Risk Review',
      prompt: 'Identify key risks, blockers, and recommended mitigations for the task I am on.',
    },
  ]
}

export function BobQuickChatWidget({ open, onOpenChange, onOpenStudio, currentRoute }: BobQuickChatWidgetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const quickSessionIdRef = useRef(`quick-chat-${Date.now()}`)
  const routeDomain = useMemo(() => getRouteDomain(currentRoute), [currentRoute])
  const quickPrompts = useMemo(() => getQuickPrompts(currentRoute), [currentRoute])

  const replaceAssistantMessage = (assistantMessageId: string, content: string) => {
    setMessages((prev) => {
      let found = false
      const updated = prev.map((message) => {
        if (message.id !== assistantMessageId) {
          return message
        }
        found = true
        return {
          ...message,
          content,
        }
      })

      if (found) {
        return updated
      }

      return [
        ...updated,
        {
          id: assistantMessageId,
          role: 'assistant',
          content,
        },
      ]
    })
  }

  const hasConversation = useMemo(
    () => messages.some((msg) => msg.role === 'user' && msg.content.trim().length > 0),
    [messages],
  )

  const sendMessage = async () => {
    const prompt = input.trim()
    if (!prompt || sending) return

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: prompt,
    }

    const history = messages
      .filter((msg) => msg.id !== 'greeting')
      .slice(-8)
      .map((msg) => ({ role: msg.role, content: msg.content }))

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setSending(true)

    const assistantMessageId = `a-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: 'Bob is thinking…',
      },
    ])

    try {
      const bobResponse = await streamBobResponse(
        {
          errorMessage: 'MANUAL_USER_INSTRUCTION',
          userPrompt: prompt,
          stackTrace: prompt,
          sessionId: quickSessionIdRef.current,
          messages: [...history, { role: 'user', content: prompt }],
          errorPayload: {
            tag: 'MANUAL_USER_INSTRUCTION',
            route: currentRoute,
            domain: routeDomain,
            text: prompt,
          },
        },
        (text) => {
          replaceAssistantMessage(assistantMessageId, text)
        },
      )

      replaceAssistantMessage(assistantMessageId, bobResponse.trim() || 'Command acknowledged.')
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err)
      const friendlyMessage =
        rawMessage === 'Failed to fetch' || rawMessage.includes('NetworkError') || rawMessage.includes('network')
          ? "I can't reach the Bob service right now. Please check your connection or try again shortly."
          : rawMessage.toLowerCase().includes('timed out')
          ? "The request timed out. Bob may be busy — please try again."
          : `I hit an error while responding: ${rawMessage}`
      replaceAssistantMessage(assistantMessageId, friendlyMessage)
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed bottom-24 right-4 z-[70] w-[22rem] max-w-[calc(100vw-2rem)] md:w-[26rem]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white">
              <BrainCircuit className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Bob Chat</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Quick assist</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onOpenStudio} className="h-8 px-2 text-xs">
              Studio
              <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close Bob quick chat" className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[22rem] bg-slate-50/70 px-3 py-3 dark:bg-slate-900/50">
          <div className="space-y-2.5">
            {messages.map((msg) => (
              <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'rounded-tr-sm bg-violet-600 text-white'
                      : 'rounded-tl-sm border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100',
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quickPrompts.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-2.5 text-[11px]"
                onClick={() => setInput(item.prompt)}
                disabled={sending}
              >
                {item.label}
              </Button>
            ))}
          </div>

          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask a quick question..."
            className="min-h-[74px] resize-none"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
          />

          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {hasConversation ? `Connected to Bob runtime (${routeDomain})` : `Ready (${routeDomain})`}
            </p>
            <Button type="button" size="sm" onClick={() => void sendMessage()} disabled={sending || !input.trim()}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
