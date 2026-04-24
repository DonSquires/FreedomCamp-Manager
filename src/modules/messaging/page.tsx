import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { MessageThreadList, MessageThread } from './components'
import { useMessagingStore } from './store'

export function MessagingPage() {
  const user = useAuthStore((s) => s.user)
  const organizationId = useGlobalFiltersStore((s) => s.organizationId)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)

  const { error: storeError } = useMessagingStore()

  // Mock threads for demo
  const threads = [
    {
      id: 'thread-bex-don',
      organization_id: organizationId || 'org-demo',
      thread_type: 'direct' as const,
      thread_id: 'direct_bex_don',
      thread_name: 'Bex Littlemiss & Don Squires',
      participant_ids: ['user-bex', 'user-don'],
      last_message: {
        id: 'msg-1',
        organization_id: organizationId || 'org-demo',
        sender_id: 'user-bex',
        sender_name: 'Bex',
        content: 'Did you finish the west zone check?',
        message_type: 'direct' as const,
        target_id: 'thread-bex-don',
        status: 'delivered' as const,
        created_at: new Date(Date.now() - 300000).toISOString(),
        updated_at: new Date(Date.now() - 300000).toISOString(),
      },
      message_count: 42,
      unread_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  ]

  // Mock messages for the active thread
  const messages = activeThreadId === 'thread-bex-don' ? [
    {
      id: 'msg-1',
      organization_id: organizationId ||  'org-demo',
      sender_id: 'user-bex',
      sender_name: 'Bex',
      content: 'Morning! How was the night shift?',
      message_type: 'direct' as const,
      target_id: activeThreadId,
      status: 'delivered' as const,
      created_at: new Date(Date.now() - 900000).toISOString(),
      updated_at: new Date(Date.now() - 900000).toISOString(),
    },
    {
      id: 'msg-2',
      organization_id: organizationId || 'org-demo',
      sender_id: 'user-don',
      sender_name: 'Don',
      content: 'Pretty quiet! Got some good footage of the central area.',
      message_type: 'direct' as const,
      target_id: activeThreadId,
      status: 'delivered' as const,
      created_at: new Date(Date.now() - 600000).toISOString(),
      updated_at: new Date(Date.now() - 600000).toISOString(),
    },
    {
      id: 'msg-3',
      organization_id: organizationId || 'org-demo',
      sender_id: 'user-bex',
      sender_name: 'Bex',
      content: 'Did you finish the west zone check?',
      message_type: 'direct' as const,
      target_id: activeThreadId,
      status: 'delivered' as const,
      created_at: new Date(Date.now() - 300000).toISOString(),
      updated_at: new Date(Date.now() - 300000).toISOString(),
    },
  ] : []

  const activeThread = threads.find((t) => t.id === activeThreadId)


  const handleSendMessage = async (content: string) => {
      console.log('Message sent (demo):', content)
  }

  const handleDeleteMessage = async (messageId: string) => {
      console.log('Message deleted (demo):', messageId)
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      {/* Thread List */}
      <MessageThreadList
        threads={threads}
        activeThreadId={activeThreadId}
        onSelectThread={setActiveThreadId}
          loading={false}
      />

      {/* Main Thread View */}
      <div className="flex-1 flex flex-col">
        {activeThreadId && activeThread ? (
          <MessageThread
            threadName={activeThread.thread_name || 'Conversation'}
            messages={messages}
              currentUserId={user?.id || 'user-demo'}
            onSendMessage={handleSendMessage}
            onDeleteMessage={handleDeleteMessage}
              loading={false}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">Welcome to Messages</h2>
              <p className="text-slate-400 mb-4">Select a conversation to start messaging</p>
              {threads.length === 0 && (
                <p className="text-sm text-slate-500">No conversations yet. Start a new one!</p>
              )}
              <p className="text-xs text-slate-600 mt-6">
                Info: Demo interface with mock data. Database tables creation pending.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Error Toast */}
      {storeError && (
        <div className="fixed bottom-4 right-4 px-4 py-2 bg-red-900/80 border border-red-700 rounded text-sm text-red-200">
          {storeError}
        </div>
      )}
    </div>
  )
}

export default MessagingPage
