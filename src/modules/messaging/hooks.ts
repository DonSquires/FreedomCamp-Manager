import { useCallback, useEffect } from 'react'
import { useMessagingStore } from './store'
import { messagingService } from './service'

export function useMessages(threadId: string | null) {
  const { messages, loading, setMessages, setLoading, setError } = useMessagingStore()

  useEffect(() => {
    if (!threadId) {
      setMessages([])
      return
    }

    const loadMessages = async () => {
      setLoading(true)
      try {
        const threadMessages = await messagingService.getThreadMessages(threadId)
        setMessages(threadMessages)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load messages')
      } finally {
        setLoading(false)
      }
    }

    loadMessages()
  }, [threadId, setMessages, setLoading, setError])

  return { messages, loading }
}

export function useMessageThreads(organizationId: string | null, userId: string | null) {
  const { threads, setThreads, setLoading, setError } = useMessagingStore()

  useEffect(() => {
    if (!organizationId || !userId) {
      setThreads([])
      return
    }

    const loadThreads = async () => {
      setLoading(true)
      try {
        const userThreads = await messagingService.getUserThreads(organizationId, userId)
        setThreads(userThreads)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load threads')
      } finally {
        setLoading(false)
      }
    }

    loadThreads()
  }, [organizationId, userId, setThreads, setLoading, setError])

  return { threads }
}

export function useSendMessage() {
  const { addMessage, setError } = useMessagingStore()

  const sendMessage = useCallback(
    async (
      organizationId: string,
      senderId: string,
      content: string,
      messageType: string,
      targetId: string | null,
    ) => {
      try {
        const message = await messagingService.sendMessage(
          organizationId,
          senderId,
          content,
          messageType,
          targetId,
        )
        addMessage(message)
        return message
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to send message'
        setError(errorMsg)
        throw err
      }
    },
    [addMessage, setError],
  )

  return { sendMessage }
}

export function useDirectMessageThread(organizationId: string | null) {
  const { setError } = useMessagingStore()

  const getOrCreateThread = useCallback(
    async (
      userId1: string,
      userId2: string,
      senderName?: string,
      recipientName?: string,
    ) => {
      if (!organizationId) throw new Error('Organization ID required')
      try {
        const thread = await messagingService.getOrCreateDirectThread(
          organizationId,
          userId1,
          userId2,
          senderName,
          recipientName,
        )
        return thread
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to get or create thread'
        setError(errorMsg)
        throw err
      }
    },
    [organizationId, setError],
  )

  return { getOrCreateThread }
}

export function useMarkMessagesRead() {
  const { markAsRead } = useMessagingStore()

  const markRead = useCallback(
    async (messageIds: string[]) => {
      try {
        await messagingService.markMessagesRead(messageIds)
        markAsRead(messageIds)
      } catch (err) {
        console.error('Failed to mark messages as read:', err)
      }
    },
    [markAsRead],
  )

  return { markRead }
}
