import type { TextMessage, MessageThread } from './types'

const MESSAGE_STORE_KEY = 'fieldops_text_messages'
const THREAD_STORE_KEY = 'fieldops_message_threads'

function getStoredMessages(): TextMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(MESSAGE_STORE_KEY)
    return raw ? (JSON.parse(raw) as TextMessage[]) : []
  } catch {
    return []
  }
}

function setStoredMessages(messages: TextMessage[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(MESSAGE_STORE_KEY, JSON.stringify(messages))
}

function getStoredThreads(): MessageThread[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(THREAD_STORE_KEY)
    return raw ? (JSON.parse(raw) as MessageThread[]) : []
  } catch {
    return []
  }
}

function setStoredThreads(threads: MessageThread[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(THREAD_STORE_KEY, JSON.stringify(threads))
}

function normalizeThreadType(value: string): MessageThread['thread_type'] {
  if (value === 'direct' || value === 'channel' || value === 'incident' || value === 'broadcast') {
    return value
  }
  return 'direct'
}

function upsertThreadForMessage(message: TextMessage) {
  const threads = getStoredThreads()
  const idx = threads.findIndex((thread) => thread.id === message.target_id)

  if (idx >= 0) {
    const existing = threads[idx]
    const nextThread: MessageThread = {
      ...existing,
      last_message: message,
      message_count: (existing.message_count || 0) + 1,
      unread_count: 0,
      updated_at: message.created_at,
    }
    threads.splice(idx, 1)
    threads.unshift(nextThread)
    setStoredThreads(threads)
    return
  }

  if (!message.target_id) {
    return
  }

  const fallbackThread: MessageThread = {
    id: message.target_id,
    organization_id: message.organization_id,
    thread_type: normalizeThreadType(message.message_type),
    thread_id: message.target_id,
    thread_name: 'Conversation',
    participant_ids: [message.sender_id],
    last_message: message,
    message_count: 1,
    unread_count: 0,
    created_at: message.created_at,
    updated_at: message.created_at,
  }

  setStoredThreads([fallbackThread, ...threads])
}

export const messagingService = {
  /**
   * Send a text message
   */
  async sendMessage(
    organizationId: string,
    senderId: string,
    content: string,
    messageType: string,
    targetId: string | null,
  ): Promise<TextMessage> {
    const now = new Date().toISOString()
    const message: TextMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      organization_id: organizationId,
      sender_id: senderId,
      content,
      message_type: messageType as TextMessage['message_type'],
      target_id: targetId,
      status: 'sent',
      created_at: now,
      updated_at: now,
    }

    const messages = getStoredMessages()
    messages.unshift(message)
    setStoredMessages(messages)
    upsertThreadForMessage(message)

    return message
  },

  /**
   * Get messages for a thread
   */
  async getThreadMessages(threadId: string, limit = 50): Promise<TextMessage[]> {
    const messages = getStoredMessages()
      .filter((m) => m.target_id === threadId)
      .slice(0, limit)
    return messages
  },

  /**
   * Get message threads for user
   */
  async getUserThreads(organizationId: string, userId: string): Promise<MessageThread[]> {
    const threads = getStoredThreads()
      .filter((t) => t.organization_id === organizationId && t.participant_ids.includes(userId))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    return threads
  },

  /**
   * Create or get direct message thread
   */
  async getOrCreateDirectThread(
    organizationId: string,
    userId1: string,
    userId2: string,
    senderName?: string,
    recipientName?: string,
  ): Promise<MessageThread> {
    const existing = getStoredThreads().find(
      (thread) =>
        thread.organization_id === organizationId &&
        thread.thread_type === 'direct' &&
        thread.participant_ids.length === 2 &&
        thread.participant_ids.includes(userId1) &&
        thread.participant_ids.includes(userId2),
    )

    if (existing) return existing

    const now = new Date().toISOString()
    const threadId = `direct_${[userId1, userId2].sort().join('_')}`
    const newThread: MessageThread = {
      id: `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      organization_id: organizationId,
      thread_type: 'direct',
      thread_id: threadId,
      thread_name: `${senderName || 'User'} & ${recipientName || 'User'}`,
      participant_ids: [userId1, userId2],
      message_count: 0,
      unread_count: 0,
      created_at: now,
      updated_at: now,
    }

    const threads = getStoredThreads()
    threads.unshift(newThread)
    setStoredThreads(threads)
    return newThread
  },

  /**
   * Mark messages as read
   */
  async markMessagesRead(messageIds: string[]): Promise<void> {
    const now = new Date().toISOString()
    const updated = getStoredMessages().map((m) =>
      messageIds.includes(m.id) ? { ...m, read_at: now, updated_at: now } : m,
    )
    setStoredMessages(updated)

    const affectedThreadIds = new Set(
      updated
        .filter((message) => messageIds.includes(message.id) && typeof message.target_id === 'string')
        .map((message) => message.target_id as string),
    )

    if (affectedThreadIds.size > 0) {
      const threads = getStoredThreads().map((thread) =>
        affectedThreadIds.has(thread.id)
          ? { ...thread, unread_count: 0, updated_at: now }
          : thread,
      )
      setStoredThreads(threads)
    }
  },

  /**
   * Search messages
   */
  async searchMessages(
    organizationId: string,
    query: string,
    limit = 20,
  ): Promise<TextMessage[]> {
    const q = query.trim().toLowerCase()
    return getStoredMessages()
      .filter((m) => m.organization_id === organizationId && m.content.toLowerCase().includes(q))
      .slice(0, limit)
  },

  /**
   * Delete message (soft delete via status)
   */
  async deleteMessage(messageId: string): Promise<void> {
    const updated = getStoredMessages().filter((m) => m.id !== messageId)
    setStoredMessages(updated)
  },
}
