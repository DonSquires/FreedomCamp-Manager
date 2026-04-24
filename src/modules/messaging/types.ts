/** Messaging Module - Text-based team communication (separate from PTT radio) */

export type MessageType = 'direct' | 'channel' | 'incident' | 'broadcast'

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed'

export interface TextMessage {
  id: string
  organization_id: string
  sender_id: string
  sender_name?: string
  content: string
  message_type: MessageType
  // For direct messages: recipient_id
  // For channel: channel_id
  // For incident: incident_id
  // For broadcast: broadcast_id
  target_id: string | null
  status: MessageStatus
  read_at?: string | null
  created_at: string
  updated_at: string
}

export interface MessageThread {
  id: string
  organization_id: string
  thread_type: MessageType
  thread_id: string // channel_id, incident_id, etc.
  thread_name?: string
  participant_ids: string[]
  last_message?: TextMessage
  message_count: number
  unread_count: number
  created_at: string
  updated_at: string
}

export interface MessageSearchResult {
  message: TextMessage
  highlight?: string // snippet around match
}

export interface MessagingState {
  messages: TextMessage[]
  threads: MessageThread[]
  activeThreadId: string | null
  loading: boolean
  error: string | null
  unreadCount: number
}
