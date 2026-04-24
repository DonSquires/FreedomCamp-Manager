import { useEffect, useRef } from 'react'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'
import type { TextMessage } from '../types'

interface MessageThreadProps {
  threadName: string
  messages: TextMessage[]
  currentUserId: string
  onSendMessage: (content: string) => Promise<void>
  onDeleteMessage?: (messageId: string) => void
  loading?: boolean
}

export function MessageThread({
  threadName,
  messages,
  currentUserId,
  onSendMessage,
  onDeleteMessage,
  loading = false,
}: MessageThreadProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50">
        <h2 className="text-sm font-semibold text-slate-100">{threadName}</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-500">
            <p className="text-sm">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages
            .slice()
            .reverse()
            .map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={msg.sender_id === currentUserId}
                onDelete={onDeleteMessage}
              />
            ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <MessageInput onSend={onSendMessage} loading={loading} />
    </div>
  )
}
