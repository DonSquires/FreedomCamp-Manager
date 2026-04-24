import { formatRelativeTime } from '@/lib/utils'
import { Trash2 } from 'lucide-react'
import type { TextMessage } from '../types'

interface MessageBubbleProps {
  message: TextMessage
  isOwn: boolean
  onDelete?: (messageId: string) => void
}

export function MessageBubble({ message, isOwn, onDelete }: MessageBubbleProps) {
  return (
    <div className={`flex gap-2 mb-3 ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-xs px-3 py-2 rounded-lg break-words ${
          isOwn
            ? 'bg-blue-600 text-white rounded-br-none'
            : 'bg-slate-700 text-slate-100 rounded-bl-none'
        }`}
      >
        {!isOwn && message.sender_name && (
          <div className="text-xs font-semibold mb-1 opacity-80">{message.sender_name}</div>
        )}
        <div className="text-sm">{message.content}</div>
        <div className={`text-xs mt-1 ${isOwn ? 'text-blue-200' : 'text-slate-400'}`}>
          {formatRelativeTime(message.created_at)}
          {message.status === 'pending' && ' [pending]'}
          {message.status === 'failed' && ' [failed]'}
        </div>
      </div>
      {isOwn && onDelete && (
        <button
          onClick={() => onDelete(message.id)}
          className="mt-1 p-1 hover:bg-slate-700 rounded opacity-50 hover:opacity-100"
        >
          <Trash2 className="h-3 w-3 text-red-400" />
        </button>
      )}
    </div>
  )
}
