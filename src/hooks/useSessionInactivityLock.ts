import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useSessionLockStore } from '@/stores/sessionLockStore'
import { useSessionPreferencesStore } from '@/stores/sessionPreferencesStore'

const WARNING_SECONDS = 60
const WARNING_MS = WARNING_SECONDS * 1000
const STAY_ACTIVE_EVENT = 'session:stay-active'

export function signalSessionActivity(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STAY_ACTIVE_EVENT))
}

export function useSessionInactivityLock() {
  const { user } = useAuthStore()
  const { isLocked, isWarningVisible, lock, showWarning, clearWarning, updateWarningSeconds } = useSessionLockStore()
  const { autoLogoffEnabled, inactivityMinutes } = useSessionPreferencesStore()

  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isLockedRef = useRef(isLocked)
  const isWarningVisibleRef = useRef(isWarningVisible)

  useEffect(() => {
    isLockedRef.current = isLocked
    isWarningVisibleRef.current = isWarningVisible
  }, [isLocked, isWarningVisible])

  useEffect(() => {
    if (!user || !autoLogoffEnabled) {
      return
    }

    const timeoutMs = Math.max(inactivityMinutes * 60 * 1000, WARNING_MS + 1000)
    const warningDelay = Math.max(timeoutMs - WARNING_MS, 1000)

    const clearTimers = () => {
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
      warningTimerRef.current = null
      lockTimerRef.current = null
      countdownRef.current = null
    }

    const startCountdown = () => {
      let secondsLeft = WARNING_SECONDS
      showWarning(secondsLeft)

      if (countdownRef.current) clearInterval(countdownRef.current)
      countdownRef.current = setInterval(() => {
        secondsLeft -= 1
        updateWarningSeconds(secondsLeft)
        if (secondsLeft <= 0 && countdownRef.current) {
          clearInterval(countdownRef.current)
          countdownRef.current = null
        }
      }, 1000)
    }

    const resetInactivity = () => {
      clearTimers()
      clearWarning()

      warningTimerRef.current = setTimeout(() => {
        startCountdown()
      }, warningDelay)

      lockTimerRef.current = setTimeout(() => {
        lock('Session Timed Out', 'Your session was locked after inactivity. Log back in to continue or log out completely.')
      }, timeoutMs)
    }

    const handleActivity = (event: Event) => {
      const isExplicitStayActive = event.type === STAY_ACTIVE_EVENT

      // When warning/lock overlays are showing, do not auto-clear or auto-reset
      // from incidental activity like mousemove/click/scroll. Only explicit
      // Continue action dispatches `session:stay-active`.
      if ((isWarningVisibleRef.current || isLockedRef.current) && !isExplicitStayActive) {
        return
      }

      resetInactivity()
    }

    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click', STAY_ACTIVE_EVENT]
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true })
    })

    resetInactivity()

    return () => {
      clearTimers()
      clearWarning()
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity)
      })
    }
  }, [
    user,
    autoLogoffEnabled,
    inactivityMinutes,
    lock,
    showWarning,
    clearWarning,
    updateWarningSeconds,
  ])
}
