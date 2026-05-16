import { useMemo, useState } from 'react'
import { X, Send, Loader2, BrainCircuit, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { edgeFunctions } from '@/lib/edgeFunctions'
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

const GREETING: ChatMessage = {
  id: 'greeting',
  role: 'assistant',
  content: 'Hi, I am Bob. Ask a quick operational question and I will help right here.',
}

function toAssistantText(payload: any): string {
  const direct = [
    payload?.response,
    payload?.answer,
    payload?.message,
    payload?.content,
    payload?.output?.response,
    payload?.output?.message,
    payload?.output?.content,
  ]

  for (const item of direct) {
    if (typeof item === 'string' && item.trim().length > 0) return item.trim()
  }

  return 'I am online, but I could not parse a response. Please try again.'
}

export function BobQuickChatWidget({ open, onOpenChange, onOpenStudio, currentRoute }: BobQuickChatWidgetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

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

    try {
      const { data, error } = await edgeFunctions.bobGateway({
        provider: 'inference',
        model: 'qwen2.5:7b',
        temperature: 0.2,
        messages: [...history, { role: 'user', content: prompt }],
        context: {
          source: 'bob-quick-chat-widget',
          app_route: currentRoute,
          compact_chat: true,
        },
      })

      if (error) throw new Error(error)

      const assistantMessage: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: toAssistantText(data),
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      const assistantMessage: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: `I hit an error while responding: ${err instanceof Error ? err.message : String(err)}`,
      }
      setMessages((prev) => [...prev, assistantMessage])
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
              {hasConversation ? 'Connected to Bob runtime' : 'Ready'}
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
