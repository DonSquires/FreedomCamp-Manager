import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ChatTarget =
  | { type: 'admin' }
  | {
      type: 'user'
      user: {
        id: string
        first_name: string
        last_name: string
        role: string
        organization_id: string | null
      }
    }

interface ChatTargetState {
  target: ChatTarget
  setTarget: (target: ChatTarget) => void
  reset: () => void
}

export const useChatTargetStore = create<ChatTargetState>()(
  persist(
    (set) => ({
      target: { type: 'admin' },
      setTarget: (target) => set({ target }),
      reset: () => set({ target: { type: 'admin' } }),
    }),
    {
      name: 'chat-target',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
)
