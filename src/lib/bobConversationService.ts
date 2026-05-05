/**
 * Bob Conversation Service
 * 
 * Manages persistent conversation history, message storage, and learning logs
 * for Bob's integrated operations.
 * 
 * Conversations are user-owned via RLS policies in Supabase.
 */

import { supabase } from './supabase'

const sb = supabase as any

export interface BobMessage {
  message_id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata?: {
    model?: string
    provider?: string
    confidence?: number
    sources?: string[]
    tokens_input?: number
    tokens_output?: number
    latency_ms?: number
    temperature?: number
    system_prompt_version?: string
  }
}

export interface BobConversation {
  conversation_id: string
  user_id: string
  organization_id: string
  title: string
  summary?: string
  tags?: string[]
  is_archived?: boolean
  messages?: BobMessage[]
  created_at: string
  updated_at: string
}

export interface BobLearningEntry {
  entry_id?: string
  message_id: string
  score: number
  feedback?: string
  lesson_key: string
  lesson_detail?: Record<string, unknown>
}

/**
 * Create a new conversation
 */
export async function createConversation(
  title: string,
  organizationId: string,
  summary?: string,
  tags?: string[]
): Promise<BobConversation> {
  const { data, error } = await sb
    .from('bob_conversations')
    .insert({
      title,
      organization_id: organizationId,
      summary,
      tags,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create conversation: ${error.message}`)
  }

  return data as BobConversation
}

/**
 * Load a conversation with its full message history
 */
export async function loadConversation(
  conversationId: string,
  organizationId?: string
): Promise<BobConversation | null> {
  const { data: conversation, error: convError } = await sb
    .from('bob_conversations')
    .select()
    .eq('conversation_id', conversationId)
    .single()

  if (convError) {
    if (convError.code === 'PGRST116') return null // Not found
    throw new Error(`Failed to load conversation: ${convError.message}`)
  }

  const { data: messages, error: messError } = await sb
    .from('bob_messages')
    .select()
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (messError) {
    throw new Error(`Failed to load messages: ${messError.message}`)
  }

  return {
    ...(conversation as BobConversation),
    messages: messages as BobMessage[],
  }
}

/**
 * Append a message to a conversation
 */
export async function appendMessage(
  conversationId: string,
  message: BobMessage,
  organizationId?: string
): Promise<BobMessage> {
  const { data: conversation, error: conversationError } = await sb
    .from('bob_conversations')
    .select('organization_id')
    .eq('conversation_id', conversationId)
    .single()

  if (conversationError) {
    throw new Error(`Failed to resolve conversation organization: ${conversationError.message}`)
  }

  const resolvedOrganizationId = conversation?.organization_id ?? organizationId
  if (!resolvedOrganizationId) {
    throw new Error('Conversation organization could not be resolved')
  }

  const { data, error } = await sb
    .from('bob_messages')
    .insert({
      conversation_id: conversationId,
      organization_id: resolvedOrganizationId,
      role: message.role,
      content: message.content,
      metadata: message.metadata || {},
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to append message: ${error.message}`)
  }

  return data as BobMessage
}

/**
 * Score a message and log the learning
 */
export async function scoreMessage(
  messageId: string,
  conversationId: string,
  score: number,
  lessonKey: string,
  organizationId: string,
  feedback?: string,
  lessonDetail?: Record<string, unknown>
): Promise<BobLearningEntry> {
  if (score < 0 || score > 1) {
    throw new Error('Score must be between 0 and 1')
  }

  const { data, error } = await sb
    .from('bob_learning_log')
    .insert({
      message_id: messageId,
      conversation_id: conversationId,
      organization_id: organizationId,
      score,
      feedback,
      lesson_key: lessonKey,
      lesson_detail: lessonDetail || {},
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to score message: ${error.message}`)
  }

  return data as BobLearningEntry
}

/**
 * List conversations for the current user/org
 */
export async function listConversations(
  organizationId: string,
  limit: number = 20,
  offset: number = 0,
  includeArchived: boolean = false
): Promise<BobConversation[]> {
  let query = sb
    .from('bob_conversations')
    .select()
    .eq('organization_id', organizationId)

  if (!includeArchived) {
    query = query.eq('is_archived', false)
  }

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    throw new Error(`Failed to list conversations: ${error.message}`)
  }

  return data as BobConversation[]
}

/**
 * Get lesson patterns (what Bob is learning)
 */
export async function getLessonPatterns(
  organizationId: string,
  hoursBack: number = 24
): Promise<
  Array<{
    lesson_key: string
    count: number
    average_score: number
    sample_feedback: string | null
  }>
> {
  const { data, error } = await sb.rpc('get_bob_lesson_summary', {
    p_organization_id: organizationId,
    p_hours: hoursBack,
  })

  if (error) {
    throw new Error(`Failed to get lesson patterns: ${error.message}`)
  }

  return data || []
}

/**
 * Archive a conversation
 */
export async function archiveConversation(
  conversationId: string,
  organizationId?: string
): Promise<void> {
  const { error } = await sb
    .from('bob_conversations')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)

  if (error) {
    throw new Error(`Failed to archive conversation: ${error.message}`)
  }
}

/**
 * Delete a conversation (soft delete via archiving recommended)
 */
export async function deleteConversation(
  conversationId: string,
  organizationId?: string
): Promise<void> {
  const { error } = await sb
    .from('bob_conversations')
    .delete()
    .eq('conversation_id', conversationId)

  if (error) {
    throw new Error(`Failed to delete conversation: ${error.message}`)
  }
}

/**
 * Get full conversation context (for Bob system prompt)
 * Returns messages in chronological order for context window
 */
export async function getConversationContext(
  conversationId: string,
  organizationId: string,
  limitMessages: number = 10
): Promise<
  Array<{
    message_role: string
    message_content: string
    message_order: number
  }>
> {
  const { data, error } = await sb.rpc('get_bob_conversation_context', {
    p_conversation_id: conversationId,
    p_limit: limitMessages,
  })

  if (error) {
    throw new Error(`Failed to get conversation context: ${error.message}`)
  }

  return data || []
}

/**
 * Update conversation title or metadata
 */
export async function updateConversation(
  conversationId: string,
  organizationId: string,
  updates: Partial<{
    title: string
    summary: string
    tags: string[]
  }>
): Promise<BobConversation> {
  const { data, error } = await sb
    .from('bob_conversations')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('conversation_id', conversationId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update conversation: ${error.message}`)
  }

  return data as BobConversation
}

/**
 * Search conversations by title or tags
 */
export async function searchConversations(
  organizationId: string,
  query: string,
  tags?: string[]
): Promise<BobConversation[]> {
  let search = sb
    .from('bob_conversations')
    .select()
    .eq('organization_id', organizationId)
    .eq('is_archived', false)

  if (query) {
    search = search.ilike('title', `%${query}%`)
  }

  const { data, error } = await search.order('updated_at', {
    ascending: false,
  })

  if (error) {
    throw new Error(`Failed to search conversations: ${error.message}`)
  }

  // Filter by tags if provided (client-side since Supabase array filters are limited)
  if (tags && tags.length > 0) {
    return (data as BobConversation[]).filter(
      (conv) =>
        conv.tags &&
        tags.some((tag) => conv.tags?.includes(tag))
    )
  }

  return data as BobConversation[]
}
