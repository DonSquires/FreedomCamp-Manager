// Messaging Module - Text-based team communication

export { useMessagingStore } from './store'
export { messagingService } from './service'
export {
  useMessages,
  useMessageThreads,
  useSendMessage,
  useDirectMessageThread,
  useMarkMessagesRead,
} from './hooks'
export type { MessageType, MessageStatus, TextMessage, MessageThread } from './types'
export * as Components from './components'
export { MessagingPage as default } from './page'
