import { create } from 'zustand'
import type { TextMessage, MessageThread } from './types'

interface MessagingStore {
  messages: TextMessage[]
  threads: MessageThread[]
  activeThreadId: string | null
  loading: boolean
  error: string | null
  
  // Actions
  setMessages: (messages: TextMessage[]) => void
  addMessage: (message: TextMessage) => void
  updateMessage: (id: string, updates: Partial<TextMessage>) => void
  setThreads: (threads: MessageThread[]) => void
  setActiveThread: (threadId: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  markAsRead: (messageIds: string[]) => void
  clearError: () => void
}

export const useMessagingStore = create<MessagingStore>((set) => ({
  messages: [],
  threads: [],
  activeThreadId: null,
  loading: false,
  error: null,

  setMessages: (messages) => set({ messages }),
  
  addMessage: (message) => set((state) => ({
    messages: [message, ...state.messages],
  })),
  
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map((m) => m.id === id ? { ...m, ...updates } : m),
  })),
  
  setThreads: (threads) => set({ threads }),
  
  setActiveThread: (threadId) => set({ activeThreadId: threadId }),
  
  setLoading: (loading) => set({ loading }),
  
  setError: (error) => set({ error }),
  
  markAsRead: (messageIds) => set((state) => ({
    messages: state.messages.map((m) =>
      messageIds.includes(m.id) ? { ...m, read_at: new Date().toISOString() } : m
    ),
  })),
  
  clearError: () => set({ error: null }),
}))
