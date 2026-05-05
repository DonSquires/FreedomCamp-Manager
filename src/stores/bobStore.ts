import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { BobConversation, BobMessage } from '@/lib/bobConversationService'
import { useAuthStore } from './authStore'

/**
 * Bob's Operational State Store
 *
 * Manages persistent state for Bob's conversational AI:
 * - Conversation threading & history
 * - Learned tone & personality patterns
 * - Active task tracking
 * - Reasoning context (decision gates, approvals)
 * - Response scoring & learning feedback loop
 */

export interface BobLearningPattern {
  key: string
  description: string
  confidence: number // 0-1
  lastObserved: Date
  timesApplied: number
}

export interface BobTask {
  id: string
  type: 'breach-triage' | 'compliance-report' | 'officer-wellness' | 'vehicle-scan' | 'planning'
  status: 'active' | 'paused' | 'completed' | 'blocked'
  context: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface BobApprovalGate {
  id: string
  taskId: string
  action: string
  status: 'pending' | 'approved' | 'rejected' | 'escalated'
  requiresHuman: boolean
  reason?: string
  createdAt: Date
}

export interface BobReasoning {
  conversationId: string
  hypothesis: string
  evidenceFor: string[]
  evidenceAgainst: string[]
  confidence: number
  nextSteps: string[]
  requiresApproval: boolean
}

export interface BobStore {
  // Active conversation
  activeConversationId: string | null
  activeConversation: BobConversation | null
  messages: BobMessage[]
  setActiveConversation: (id: string | null, conv: BobConversation | null) => void
  addMessage: (msg: BobMessage) => void
  clearMessages: () => void

  // Tone & Personality (learned from response_scores)
  tone: {
    formal: number // 0-1 - preference for formal language
    verbose: number // 0-1 - preference for detail vs brevity
    proactive: number // 0-1 - likelihood to suggest actions
    cautious: number // 0-1 - tendency to include disclaimers/risks
  }
  updateTone: (partial: Partial<BobStore['tone']>) => void

  // Learning patterns (derived from bob_learning_log)
  learningPatterns: BobLearningPattern[]
  addLearningPattern: (pattern: BobLearningPattern) => void
  updateLearningPattern: (key: string, confidence: number) => void
  clearLearningPatterns: () => void

  // Active task tracking
  activeTask: BobTask | null
  setActiveTask: (task: BobTask | null) => void
  updateTaskStatus: (taskId: string, status: BobTask['status']) => void
  taskHistory: BobTask[]
  addTaskToHistory: (task: BobTask) => void

  // Reasoning context
  currentReasoning: BobReasoning | null
  setCurrentReasoning: (reasoning: BobReasoning | null) => void
  clearReasoning: () => void

  // Approval gates (hold user actions pending human review)
  approvalGates: BobApprovalGate[]
  addApprovalGate: (gate: BobApprovalGate) => void
  resolveApprovalGate: (gateId: string, approved: boolean, reason?: string) => void
  pendingApprovals: () => BobApprovalGate[]

  // Response scoring & feedback
  lastScoreAction: {
    messageId: string
    score: number
    feedback?: string
    timestamp: Date
  } | null
  recordScoreFeedback: (messageId: string, score: number, feedback?: string) => void

  // Context metadata
  organizationId: string | null
  setOrganizationId: (id: string | null) => void
  sessionStartedAt: Date
  messageCount: number

  // Reset
  reset: () => void
}

const BOB_STORE_STORAGE_NAME = 'bob-store'

function resolveUserScopedBobStoreKey(userId?: string | null): string {
  return `${BOB_STORE_STORAGE_NAME}:${userId || 'anon'}`
}

function getCurrentUserId(): string | null {
  try {
    return useAuthStore.getState().user?.id ?? null
  } catch {
    return null
  }
}

const bobStoreScopedStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === 'undefined') return null
    const key = resolveUserScopedBobStoreKey(getCurrentUserId())
    const scoped = window.localStorage.getItem(key)
    if (scoped !== null) return scoped

    // Legacy fallback for first run after upgrade.
    const legacy = window.localStorage.getItem(name)
    if (legacy !== null) {
      window.localStorage.setItem(key, legacy)
      window.localStorage.removeItem(name)
      return legacy
    }

    return null
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === 'undefined') return
    const key = resolveUserScopedBobStoreKey(getCurrentUserId())
    window.localStorage.setItem(key, value)
  },
  removeItem: (name: string): void => {
    if (typeof window === 'undefined') return
    const key = resolveUserScopedBobStoreKey(getCurrentUserId())
    window.localStorage.removeItem(key)
  },
}

/**
 * Zustand store for Bob's persistent conversational state.
 *
 * Invariants:
 * - Messages are immutable once added (history only)
 * - Learning patterns confidence is clamped [0, 1]
 * - Approval gates must be resolved explicitly
 * - Tone adjustments persist across sessions (via localStorage)
 * - Organization ID is required for multi-tenant operations
 */
export const useBobStore = create<BobStore>()(
  persist(
    (set, get) => ({
      // Conversation state
      activeConversationId: null,
      activeConversation: null,
      messages: [],
      setActiveConversation: (id, conv) => set({ activeConversationId: id, activeConversation: conv }),
      addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg], messageCount: state.messageCount + 1 })),
      clearMessages: () => set({ messages: [], messageCount: 0 }),

      // Tone & personality (persisted via localStorage adapter)
      tone: {
        formal: 0.6,
        verbose: 0.5,
        proactive: 0.7,
        cautious: 0.65,
      },
      updateTone: (partial) =>
        set((state) => ({
          tone: { ...state.tone, ...partial },
        })),

      // Learning patterns
      learningPatterns: [],
      addLearningPattern: (pattern) =>
        set((state) => {
          const existing = state.learningPatterns.findIndex((p) => p.key === pattern.key)
          if (existing >= 0) {
            const updated = [...state.learningPatterns]
            updated[existing] = pattern
            return { learningPatterns: updated }
          }
          return { learningPatterns: [...state.learningPatterns, pattern] }
        }),
      updateLearningPattern: (key, confidence) =>
        set((state) => {
          const idx = state.learningPatterns.findIndex((p) => p.key === key)
          if (idx < 0) return state
          const updated = [...state.learningPatterns]
          updated[idx] = {
            ...updated[idx],
            confidence: Math.max(0, Math.min(1, confidence)),
            lastObserved: new Date(),
            timesApplied: updated[idx].timesApplied + 1,
          }
          return { learningPatterns: updated }
        }),
      clearLearningPatterns: () => set({ learningPatterns: [] }),

      // Active task
      activeTask: null,
      setActiveTask: (task) => set({ activeTask: task }),
      updateTaskStatus: (taskId, status) =>
        set((state) => {
          if (state.activeTask?.id === taskId) {
            return {
              activeTask: { ...state.activeTask, status, updatedAt: new Date() },
            }
          }
          return state
        }),
      taskHistory: [],
      addTaskToHistory: (task) => set((state) => ({ taskHistory: [...state.taskHistory, task] })),

      // Reasoning
      currentReasoning: null,
      setCurrentReasoning: (reasoning) => set({ currentReasoning: reasoning }),
      clearReasoning: () => set({ currentReasoning: null }),

      // Approval gates
      approvalGates: [],
      addApprovalGate: (gate) => set((state) => ({ approvalGates: [...state.approvalGates, gate] })),
      resolveApprovalGate: (gateId, approved, reason) =>
        set((state) => ({
          approvalGates: state.approvalGates.map((g) =>
            g.id === gateId
              ? {
                  ...g,
                  status: approved ? 'approved' : 'rejected',
                  reason: reason || g.reason,
                }
              : g
          ),
        })),
      pendingApprovals: () => get().approvalGates.filter((g) => g.status === 'pending'),

      // Response scoring
      lastScoreAction: null,
      recordScoreFeedback: (messageId, score, feedback) =>
        set({
          lastScoreAction: {
            messageId,
            score: Math.max(0, Math.min(1, score)),
            feedback,
            timestamp: new Date(),
          },
        }),

      // Context
      organizationId: null,
      setOrganizationId: (id) => set({ organizationId: id }),
      sessionStartedAt: new Date(),
      messageCount: 0,

      reset: () =>
        set({
          activeConversationId: null,
          activeConversation: null,
          messages: [],
          tone: { formal: 0.6, verbose: 0.5, proactive: 0.7, cautious: 0.65 },
          learningPatterns: [],
          activeTask: null,
          taskHistory: [],
          currentReasoning: null,
          approvalGates: [],
          lastScoreAction: null,
          organizationId: null,
          sessionStartedAt: new Date(),
          messageCount: 0,
        }),
    }),
    {
      name: BOB_STORE_STORAGE_NAME,
      storage: createJSONStorage(() => bobStoreScopedStorage),
      partialize: (state) => ({
        tone: state.tone,
        organizationId: state.organizationId,
      }),
      version: 1,
    }
  )
)

let bobStoreAuthScopeBridgeInitialized = false

function initializeBobStoreAuthScopeBridge() {
  if (bobStoreAuthScopeBridgeInitialized || typeof window === 'undefined') {
    return
  }
  bobStoreAuthScopeBridgeInitialized = true

  let previousUserId: string | null = useAuthStore.getState().user?.id ?? null
  void useBobStore.persist.rehydrate()

  useAuthStore.subscribe((state) => {
    const nextUserId = state.user?.id ?? null
    if (nextUserId === previousUserId) {
      return
    }
    previousUserId = nextUserId
    useBobStore.getState().reset()
    void useBobStore.persist.rehydrate()
  })
}

initializeBobStoreAuthScopeBridge()

/**
 * Selectors for common Bob store queries
 */

export const selectActiveBobConversation = (state: BobStore) => state.activeConversation
export const selectBobMessages = (state: BobStore) => state.messages
export const selectBobTone = (state: BobStore) => state.tone
export const selectBobLearningPatterns = (state: BobStore) => state.learningPatterns
export const selectBobActiveTask = (state: BobStore) => state.activeTask
export const selectBobReasoning = (state: BobStore) => state.currentReasoning
export const selectBobPendingApprovals = (state: BobStore) => state.pendingApprovals()
export const selectBobOrganization = (state: BobStore) => state.organizationId

/**
 * Hook for accessing Bob's tone settings (tone affects response format)
 */
export const useBobTone = () => {
  const tone = useBobStore((state) => state.tone)
  const updateTone = useBobStore((state) => state.updateTone)
  return { tone, updateTone }
}

/**
 * Hook for managing Bob's current reasoning context
 */
export const useBobReasoning = () => {
  const reasoning = useBobStore((state) => state.currentReasoning)
  const setReasoning = useBobStore((state) => state.setCurrentReasoning)
  const clearReasoning = useBobStore((state) => state.clearReasoning)
  return { reasoning, setReasoning, clearReasoning }
}

/**
 * Hook for Bob's approval gates (multi-step workflows)
 */
export const useBobApprovals = () => {
  const gates = useBobStore((state) => state.approvalGates)
  const pending = useBobStore((state) => state.pendingApprovals)
  const addGate = useBobStore((state) => state.addApprovalGate)
  const resolve = useBobStore((state) => state.resolveApprovalGate)
  return { gates, pending, addGate, resolve }
}
