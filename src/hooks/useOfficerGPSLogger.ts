/**
 * useOfficerGPSLogger
 *
 * Records officer activity to the `officer_activity_log` table via the
 * `log_officer_activity` SECURITY DEFINER RPC.  This makes the officer
 * visible in the admin live welfare-tracking map (get_live_officer_locations)
 * and feeds the server-side welfare-monitoring edge function.
 *
 * Activity types recorded:
 *   login         — portal mount (officer starts their shift in the app)
 *   gps_update    — every GPS fix (throttled: at most one write per LOG_INTERVAL_MS)
 *   vehicle_scan  — after each successful plate capture
 *   logout        — portal unmount / tab close
 *
 * Integration:
 *   Mount inside FieldOfficerPortal.
 *   Call logGPSFix()     on every GPS position update.
 *   Call logVehicleScan() after each successful scan capture.
 */

import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

// ─── Constants ────────────────────────────────────────────────────────────────

/** GPS accuracy (metres) above which fixes are NOT written to the DB */
const MAX_ACCURACY_M = 100

/**
 * Minimum gap between consecutive gps_update DB writes.
 * 30 s matches the welfare-ping interval documented in the system map.
 */
const LOG_INTERVAL_MS = 30_000

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOfficerGPSLogger() {
  const { user } = useAuthStore()

  /** Timestamp of the last successful gps_update write */
  const lastLoggedAtRef = useRef<number>(0)

  // ── Login / logout events ──────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return

    // Capture id in a variable so the cleanup closure always has it, even if
    // the user object becomes null before the portal unmounts.
    const userId = user.id

    // Login — fired once when the portal mounts
    ;(supabase as any).rpc('log_officer_activity', {
      p_user_id:       userId,
      p_activity_type: 'login',
      p_metadata:      { source: 'field_officer_portal' },
    }).catch((e: any) => console.warn('Activity log (login) failed:', e?.message))

    return () => {
      // Logout — fired when the portal unmounts (navigation away / tab close)
      ;(supabase as any).rpc('log_officer_activity', {
        p_user_id:       userId,
        p_activity_type: 'logout',
        p_metadata:      { source: 'field_officer_portal' },
      }).catch((e: any) => console.warn('Activity log (logout) failed:', e?.message))
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── GPS fix ────────────────────────────────────────────────────────────────

  /**
   * Call this with every GPS position update (from polling loop or scan pipeline).
   * DB writes are throttled to once per LOG_INTERVAL_MS.
   * Fixes with accuracy worse than MAX_ACCURACY_M are silently skipped.
   */
  const logGPSFix = useCallback(
    (lat: number, lng: number, accuracy?: number) => {
      if (!user?.id) return

      // Drop poor-quality fixes
      if (accuracy !== undefined && accuracy > MAX_ACCURACY_M) return

      // Throttle: one write per LOG_INTERVAL_MS
      const now = Date.now()
      if (now - lastLoggedAtRef.current < LOG_INTERVAL_MS) return
      lastLoggedAtRef.current = now

      ;(supabase as any).rpc('log_officer_activity', {
        p_user_id:        user.id,
        p_activity_type:  'gps_update',
        p_gps_latitude:   lat,
        p_gps_longitude:  lng,
        p_gps_accuracy:   accuracy ?? null,
      }).catch((e: any) => console.warn('Activity log (gps_update) failed:', e?.message))
    },
    [user?.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ── Vehicle scan event ─────────────────────────────────────────────────────

  /**
   * Call after each successful scan capture.
   * Records activity type 'vehicle_scan' so admins can see scan frequency
   * on the live tracking map.
   */
  const logVehicleScan = useCallback(
    (lat: number, lng: number, meta?: {
      observation_id?: string | null
      plate_number?:   string | null
      zone_id?:        string | null
    }) => {
      if (!user?.id) return

      ;(supabase as any).rpc('log_officer_activity', {
        p_user_id:        user.id,
        p_activity_type:  'vehicle_scan',
        p_gps_latitude:   lat,
        p_gps_longitude:  lng,
        p_metadata:       meta ?? {},
      }).catch((e: any) => console.warn('Activity log (vehicle_scan) failed:', e?.message))
    },
    [user?.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return { logGPSFix, logVehicleScan }
}
