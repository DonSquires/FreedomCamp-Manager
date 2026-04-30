import { createJSONStorage, type PersistOptions, persist } from 'zustand/middleware'
import type { BobStore } from './bobStore'

type BobPersistedState = Pick<BobStore, 'tone' | 'organizationId'>

/**
 * Zustand localStorage middleware for Bob's persistent settings
 *
 * Persists:
 * - tone (formal, verbose, proactive, cautious)
 * - organizationId (org context for multi-tenant)
 *
 * Does NOT persist:
 * - activeConversation (loaded on demand)
 * - messages (loaded from DB per conversation)
 * - taskHistory (session-only)
 * - approvalGates (ephemeral)
 * - reasoning (ephemeral)
 */

export const bobPersistConfig: PersistOptions<BobStore, BobPersistedState> = {
  name: 'bob-store',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    tone: state.tone,
    organizationId: state.organizationId,
  }),
  version: 1,
  onRehydrateStorage: () => (state) => {
    if (state) {
      // Validate persisted data on rehydrate
      if (state.tone) {
        state.tone.formal = Math.max(0, Math.min(1, state.tone.formal || 0.6))
        state.tone.verbose = Math.max(0, Math.min(1, state.tone.verbose || 0.5))
        state.tone.proactive = Math.max(0, Math.min(1, state.tone.proactive || 0.7))
        state.tone.cautious = Math.max(0, Math.min(1, state.tone.cautious || 0.65))
      }
    }
  },
}

/**
 * Optional: Extend useBobStore with persistence
 *
 * Usage in any file:
 * ```typescript
 * import { createBobStoreWithPersist } from '@/stores/bobStorePersistence'
 * export const useBobStore = createBobStoreWithPersist()
 * ```
 *
 * Then tone + organizationId survive page reloads
 */
export function createBobStoreWithPersist(initializer: any) {
  return persist(initializer, bobPersistConfig)
}
