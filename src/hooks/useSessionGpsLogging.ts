import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalLocationTracking } from '@/hooks/useGlobalLocationTracking'

const GPS_LOG_INTERVAL_MS = 60_000

function shouldTrackRole(role: string | undefined) {
  if (role === 'officer') return true
  if (role === 'admin_officer' && typeof window !== 'undefined') {
    return window.sessionStorage.getItem('adminOfficerPortalChoice') === 'selected'
  }
  return false
}

export function useSessionGpsLogging(): void {
  const { user, isAuthenticated, loading } = useAuthStore()
  const shouldTrack = !loading && isAuthenticated && !!user?.id && shouldTrackRole(user?.role)
  const lastLoggedAtRef = useRef(0)

  const { coords, timestamp } = useGlobalLocationTracking({
    autoStart: shouldTrack,
    highAccuracy: true,
    positionCacheMs: 30_000,
  })

  useEffect(() => {
    if (!shouldTrack || !user?.id || !coords || !timestamp) return

    const now = Date.now()
    if (now - lastLoggedAtRef.current < GPS_LOG_INTERVAL_MS) return
    lastLoggedAtRef.current = now

    void (async () => {
      const { error } = await (supabase as any).rpc('log_officer_gps_update', {
        p_user_id: user.id,
        p_latitude: coords.latitude,
        p_longitude: coords.longitude,
        p_accuracy: coords.accuracy ?? 0,
        p_activity_type: 'gps_update',
      })

      if (error) {
        console.warn('Session GPS logging failed:', error)
      }
    })()
  }, [shouldTrack, user?.id, coords, timestamp])
}