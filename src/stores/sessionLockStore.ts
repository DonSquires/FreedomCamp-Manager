import { create } from 'zustand'

interface SessionLockState {
  isLocked: boolean
  isWarningVisible: boolean
  warningSecondsRemaining: number
  title: string
  message: string
  lock: (title?: string, message?: string) => void
  unlock: () => void
  showWarning: (secondsRemaining: number) => void
  updateWarningSeconds: (secondsRemaining: number) => void
  clearWarning: () => void
}

const DEFAULT_TITLE = 'Session Timed Out'
const DEFAULT_MESSAGE = 'For security, this workspace has been locked. Log back in to continue or sign out completely.'

export const useSessionLockStore = create<SessionLockState>((set) => ({
  isLocked: false,
  isWarningVisible: false,
  warningSecondsRemaining: 39,
  title: DEFAULT_TITLE,
  message: DEFAULT_MESSAGE,
  lock: (title = DEFAULT_TITLE, message = DEFAULT_MESSAGE) => {
    set({ isLocked: true, title, message, isWarningVisible: false })
  },
  unlock: () => {
    set({
      isLocked: false,
      isWarningVisible: false,
      warningSecondsRemaining: 39,
      title: DEFAULT_TITLE,
      message: DEFAULT_MESSAGE,
    })
  },
  showWarning: (secondsRemaining) => {
    set({ isWarningVisible: true, warningSecondsRemaining: Math.max(1, secondsRemaining) })
  },
  updateWarningSeconds: (secondsRemaining) => {
    set({ warningSecondsRemaining: Math.max(0, secondsRemaining) })
  },
  clearWarning: () => {
    set({ isWarningVisible: false, warningSecondsRemaining: 39 })
  },
}))
