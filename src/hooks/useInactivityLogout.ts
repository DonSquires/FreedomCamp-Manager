/**
 * Custom Hook: useInactivityLogout
 * Auto-logout after 10 minutes of inactivity (Privacy Act 2020 compliance)
 */

import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export function useInactivityLogout() {
  const { user, logout } = useAuthStore()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleLogout = useCallback(async () => {
    toast.info('You have been logged out due to 10 minutes of inactivity.')
    await logout()
  }, [logout])

  const resetTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(handleLogout, INACTIVITY_TIMEOUT_MS)
  }, [handleLogout])

  useEffect(() => {
    // Only set up inactivity timer when user is logged in
    if (!user) return

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

    activityEvents.forEach((event) => {
      window.addEventListener(event, resetTimer, { passive: true })
    })

    // Start the timer immediately
    resetTimer()

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      activityEvents.forEach((event) => {
        window.removeEventListener(event, resetTimer)
      })
    }
  }, [user, resetTimer])
}
