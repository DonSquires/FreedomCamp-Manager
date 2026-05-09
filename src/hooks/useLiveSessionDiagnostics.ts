import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { getFeedbackSnapshot } from '@/hooks/useFeedbackCapture'
import {
  drainLiveSessionDiagnostics,
  getLiveSessionDiagnosticsSessionId,
  getLiveSessionPttSnapshot,
  recordLiveSessionDiagnostic,
} from '@/lib/liveSessionDiagnostics'

const FLUSH_INTERVAL_MS = 15_000

function getDocumentTitle(): string | null {
  if (typeof document === 'undefined') return null
  const value = document.title?.trim()
  return value ? value : null
}

export function useLiveSessionDiagnostics() {
  const location = useLocation()
  const { user } = useAuthStore()
  const inFlightRef = useRef(false)
  const sessionStartedRef = useRef(false)
  const currentRouteRef = useRef(`${location.pathname}${location.search}`)
  const flushRef = useRef<(reason: string) => Promise<void>>(async () => {})

  useEffect(() => {
    currentRouteRef.current = `${location.pathname}${location.search}`
  }, [location.pathname, location.search])

  const flush = useCallback(async (reason: string) => {
    if (!user?.id || inFlightRef.current) return

    const snapshot = getFeedbackSnapshot()
    const events = drainLiveSessionDiagnostics(80)
    const includePtt = snapshot.currentPage.startsWith('/radio') || snapshot.currentPage.startsWith('/team-chat')
    const pttDiagnostics = includePtt ? getLiveSessionPttSnapshot() : null

    if (events.length === 0 && !pttDiagnostics && reason === 'interval') {
      return
    }

    inFlightRef.current = true
    try {
      const result = await edgeFunctions.liveSessionDiagnosticsIngest({
        session_id: getLiveSessionDiagnosticsSessionId(),
        current_route: `${location.pathname}${location.search}`,
        flush_reason: reason,
        snapshot: {
          current_page: snapshot.currentPage,
          navigation_history: snapshot.navigationHistory.slice(-12),
          recent_user_actions: snapshot.recentUserActions.slice(-25),
          console_errors: snapshot.consoleErrors.slice(-12),
          browser_info: snapshot.browserInfo,
          ptt_diagnostics: pttDiagnostics,
          captured_at: snapshot.capturedAt,
          app_version: snapshot.appVersion,
        },
        events,
      })
      // If the ingest call fails for any reason, put the events back at the front
      // of the queue so they are not permanently lost. We keep only the first 80
      // to match the drain limit and avoid unbounded growth.
      if (result && (result as any).error) {
        events.slice(0, 80).reverse().forEach((e) => recordLiveSessionDiagnostic(
          e.event_type,
          e.details,
          e.route_path,
          e.title,
        ))
      }
    } catch {
      // Network or unexpected failure — requeue all drained events
      events.slice(0, 80).reverse().forEach((e) => recordLiveSessionDiagnostic(
        e.event_type,
        e.details,
        e.route_path,
        e.title,
      ))
    } finally {
      inFlightRef.current = false
    }
  }, [location.pathname, location.search, user?.id])

  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  useEffect(() => {
    if (!user?.id || sessionStartedRef.current) return

    sessionStartedRef.current = true
    recordLiveSessionDiagnostic('session_started', {
      role: user.role,
      organization_id: user.organization_id ?? null,
    }, `${location.pathname}${location.search}`, getDocumentTitle())
    void flush('session-start')
  }, [flush, location.pathname, location.search, user?.id, user?.organization_id, user?.role])

  useEffect(() => {
    if (!user?.id) return

    recordLiveSessionDiagnostic('route_changed', {
      search: location.search || '',
      hash: location.hash || '',
    }, `${location.pathname}${location.search}`, getDocumentTitle())

    void flush('route-change')
  }, [flush, location.hash, location.pathname, location.search, user?.id])

  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') return

    const onOnline = () => recordLiveSessionDiagnostic('browser_online', {}, currentRouteRef.current, getDocumentTitle())
    const onOffline = () => recordLiveSessionDiagnostic('browser_offline', {}, currentRouteRef.current, getDocumentTitle())
    const onFocus = () => recordLiveSessionDiagnostic('window_focus', {}, currentRouteRef.current, getDocumentTitle())
    const onBlur = () => recordLiveSessionDiagnostic('window_blur', {}, currentRouteRef.current, getDocumentTitle())
    const onVisibility = () => {
      recordLiveSessionDiagnostic(
        document.visibilityState === 'hidden' ? 'document_hidden' : 'document_visible',
        { visibility_state: document.visibilityState },
        currentRouteRef.current,
        getDocumentTitle(),
      )

      if (document.visibilityState === 'hidden') {
        void flushRef.current('document-hidden')
      }
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return

    const interval = window.setInterval(() => {
      void flush('interval')
    }, FLUSH_INTERVAL_MS)

    return () => {
      window.clearInterval(interval)
    }
  }, [flush, user?.id])

  useEffect(() => {
    if (!user?.id) return

    return () => {
      recordLiveSessionDiagnostic('session_observer_unmounted', {}, currentRouteRef.current, getDocumentTitle())
      void flushRef.current('unmount')
    }
  }, [user?.id])
}
