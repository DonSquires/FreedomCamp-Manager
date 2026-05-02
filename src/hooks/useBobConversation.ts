/**
 * useBobConversation Hook
 * 
 * Manages conversation state, message history, and learning scores for Bob.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import * as conversationService from '@/lib/bobConversationService'
import type { BobMessage, BobConversation } from '@/lib/bobConversationService'

interface UseBobConversationOptions {
  conversationId?: string
  organizationId: string
}

interface UseBobConversationReturn {
  conversation: BobConversation | null | undefined
  messages: BobMessage[]
  messageHistory: Array<{ role: string; content: string }>
  loading: boolean
  error: Error | null
  isNewConversation: boolean
  
  // Actions
  createConversation: (title: string, summary?: string) => Promise<BobConversation>
  loadConversation: (id: string) => Promise<BobConversation | null>
  sendMessage: (role: 'user' | 'assistant', content: string, metadata?: BobMessage['metadata']) => Promise<BobMessage>
  scoreMessage: (messageId: string, score: number, lessonKey: string, feedback?: string) => Promise<void>
  updateConversationTitle: (title: string) => Promise<void>
  clearConversation: () => void
}

export function useBobConversation(options: UseBobConversationOptions): UseBobConversationReturn {
  const { conversationId, organizationId } = options
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(conversationId)
  const [isNewConversation, setIsNewConversation] = useState(!conversationId)

  // Ref mirrors currentConversationId so mutations always read the latest value
  // even if React hasn't re-rendered yet (e.g. right after createConversation).
  const currentConversationIdRef = useRef<string | undefined>(conversationId)

  /** Update both state and the synchronous ref in one call. */
  const setConversationId = useCallback((id: string | undefined) => {
    currentConversationIdRef.current = id
    setCurrentConversationId(id)
  }, [])

  // Load conversation if ID provided
  const {
    data: conversation,
    isLoading: conversationLoading,
    error: conversationError,
    refetch: refetchConversation,
  } = useQuery({
    queryKey: ['bob-conversation', currentConversationId, organizationId],
    queryFn: () => {
      if (!currentConversationId) return null
      return conversationService.loadConversation(currentConversationId, organizationId)
    },
    enabled: !!currentConversationId,
    staleTime: 30 * 1000, // 30 seconds
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (params: { title: string; summary?: string }) => {
      const conv = await conversationService.createConversation(
        params.title,
        organizationId,
        params.summary
      )
      setConversationId(conv.conversation_id)
      setIsNewConversation(false)
      return conv
    },
  })

  const sendMessageMutation = useMutation({
    mutationFn: async (params: {
      role: 'user' | 'assistant'
      content: string
      metadata?: BobMessage['metadata']
    }) => {
      // Use the ref so we always have the latest conversation ID even when
      // React hasn't yet re-rendered after a createConversation call.
      const convId = currentConversationIdRef.current
      if (!convId) {
        throw new Error('No active conversation')
      }
      const message = await conversationService.appendMessage(
        convId,
        params,
        organizationId
      )
      // Refresh conversation to get updated messages
      await refetchConversation()
      return message
    },
  })

  const scoreMessageMutation = useMutation({
    mutationFn: async (params: {
      messageId: string
      score: number
      lessonKey: string
      feedback?: string
    }) => {
      if (!currentConversationId) {
        throw new Error('No active conversation')
      }
      await conversationService.scoreMessage(
        params.messageId,
        currentConversationId,
        params.score,
        params.lessonKey,
        organizationId,
        params.feedback
      )
      // Refresh to get updated metadata
      await refetchConversation()
    },
  })

  const updateTitleMutation = useMutation({
    mutationFn: async (title: string) => {
      if (!currentConversationId) {
        throw new Error('No active conversation')
      }
      await conversationService.updateConversation(
        currentConversationId,
        organizationId,
        { title }
      )
      await refetchConversation()
    },
  })

  // Build message history for AI context (chronological order)
  const messageHistory = conversation?.messages
    ? conversation.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }))
    : []

  const clearConversation = useCallback(() => {
    setConversationId(undefined)
    setIsNewConversation(true)
  }, [setConversationId])

  // Store current conversation ID in session storage so it persists across page reloads
  useEffect(() => {
    if (currentConversationId) {
      sessionStorage.setItem(`bob-conversation-id-${organizationId}`, currentConversationId)
    }
  }, [currentConversationId, organizationId])

  // Restore conversation ID from session storage on mount
  useEffect(() => {
    if (!conversationId && !currentConversationId) {
      const stored = sessionStorage.getItem(`bob-conversation-id-${organizationId}`)
      if (stored) {
        setConversationId(stored)
        setIsNewConversation(false)
      }
    }
  }, [organizationId, conversationId, currentConversationId, setConversationId])

  return {
    conversation,
    messages: conversation?.messages || [],
    messageHistory,
    loading: conversationLoading || createMutation.isPending || sendMessageMutation.isPending,
    error: conversationError as Error | null,
    isNewConversation,
    
    createConversation: (title, summary) => createMutation.mutateAsync({ title, summary }),
    loadConversation: async (id) => {
      setConversationId(id)
      setIsNewConversation(false)
      return conversationService.loadConversation(id, organizationId)
    },
    sendMessage: (role, content, metadata) => 
      sendMessageMutation.mutateAsync({ role, content, metadata }),
    scoreMessage: (messageId, score, lessonKey, feedback) =>
      scoreMessageMutation.mutateAsync({ messageId, score, lessonKey, feedback }),
    updateConversationTitle: (title) => updateTitleMutation.mutateAsync(title),
    clearConversation,
  }
}
