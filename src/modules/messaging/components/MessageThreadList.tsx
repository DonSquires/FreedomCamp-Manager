import { Button } from '@/components/ui/button'
import type { MessageThread } from '../types'

interface MessageThreadListProps {
  threads: MessageThread[]
  activeThreadId: string | null
  onSelectThread: (threadId: string) => void
  loading?: boolean
}

export function MessageThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  loading = false,
}: MessageThreadListProps) {
  return (
    <div className="w-64 border-r border-slate-800 bg-slate-900/30 flex flex-col overflow-y-auto">
      <div className="px-3 py-3 border-b border-slate-800">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Messages</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-slate-500">No conversations yet</p>
          </div>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              disabled={loading}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-800 transition-colors ${
                activeThreadId === thread.id ? 'bg-slate-700 border-l-2 border-blue-500' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-200 truncate">{thread.thread_name}</p>
                <p className="text-slate-500 text-xs truncate">
                  {thread.last_message?.content || 'No messages'}
                </p>
              </div>
              {thread.unread_count > 0 && (
                <div className="ml-2 px-1.5 py-0.5 rounded-full bg-blue-600 text-xs font-semibold text-white">
                  {thread.unread_count}
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
