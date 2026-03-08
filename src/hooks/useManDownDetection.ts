/**
 * useManDownDetection
 *
 * Client-side Man-Down detection for the Field Officer Portal.
 * Triggers when the officer's GPS has not moved beyond the movement threshold
 * for longer than `man_down_stationary_minutes` AND an active welfare alert
 * has not been acknowledged within `man_down_escalation_minutes`.
 *
 * Compliant with Health & Safety at Work Act 2015 (s36 PCBU duties, s38 officer duties).
 *
 * Integration:
 *   Mount inside FieldOfficerPortal. Call `recordGPSUpdate()` each time the
 *   officer's position is refreshed.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 15_000        // Check every 15 seconds
const MOVEMENT_THRESHOLD_M = 15         // Metres of movement required to reset timer
const DEFAULT_STATIONARY_MINUTES = 15   // Trigger man-down after 15 min stationary
const DEFAULT_ESCALATION_MINUTES = 5    // Escalate if unacknowledged for 5 min

// ─────────────────────────────────────────────────────────────────────────────
// Haversine
// ─────────────────────────────────────────────────────────────────────────────

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

interface ManDownState {
  isActive: boolean           // man-down alert currently firing
  alertId: string | null      // ID of the welfare alert record
  triggeredAt: Date | null    // When the alert was first triggered
}

interface UseManDownDetectionOptions {
  /** Minutes without GPS movement before alert fires (default: 15) */
  stationaryMinutes?: number
  /** Minutes before unacknowledged alert escalates (default: 5) */
  escalationMinutes?: number
  /** Called when a man-down alert is triggered */
  onManDown?: (alertId: string) => void
  /** Called when alert is resolved (officer moved or acknowledged) */
  onResolved?: () => void
}

export function useManDownDetection(options: UseManDownDetectionOptions = {}) {
  const { user } = useAuthStore()

  const stationaryMs = (options.stationaryMinutes ?? DEFAULT_STATIONARY_MINUTES) * 60_000
  const escalationMs = (options.escalationMinutes ?? DEFAULT_ESCALATION_MINUTES) * 60_000

  // GPS history
  const lastMovementRef = useRef<{ lat: number; lng: number; at: number } | null>(null)
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null)

  const [manDownState, setManDownState] = useState<ManDownState>({
    isActive: false,
    alertId: null,
    triggeredAt: null,
  })

  const manDownStateRef = useRef(manDownState)
  useEffect(() => { manDownStateRef.current = manDownState }, [manDownState])

  // ─── Resolve / acknowledge ─────────────────────────────────────────────────

  const resolveManDownAlert = useCallback(async (alertId: string) => {
    const { error } = await (supabase as any)
      .from('officer_welfare_alerts')
      .update({
        status: 'resolved',
        resolved_by: user?.id,
        resolved_at: new Date().toISOString(),
        resolution_notes: 'Officer self-resolved via Man-Down acknowledgement',
      })
      .eq('id', alertId)

    if (error) {
      toast.error('Could not clear Man-Down alert — please contact admin')
      return
    }

    setManDownState({ isActive: false, alertId: null, triggeredAt: null })
    toast.success('Man-Down alert cleared')
    options.onResolved?.()
  }, [user, options])

  // ─── Fire man-down alert ───────────────────────────────────────────────────

  const fireManDownAlert = useCallback(async () => {
    if (!user?.id || !user?.organization_id) return
    if (manDownStateRef.current.isActive) return  // Already firing

    const pos = lastPositionRef.current
    const { data, error } = await (supabase as any)
      .from('officer_welfare_alerts')
      .insert({
        officer_id: user.id,
        organization_id: user.organization_id,
        alert_type: 'man_down',
        status: 'pending',
        officer_name: user.full_name ?? user.email ?? 'Officer',
        officer_phone: null,
        gps_latitude: pos?.lat ?? null,
        gps_longitude: pos?.lng ?? null,
        last_activity_at: new Date().toISOString(),
        alert_sent_at: new Date().toISOString(),
        escalation_level: 1,
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('Man-down alert creation failed:', error)
      return
    }

    const alertId = data.id
    setManDownState({ isActive: true, alertId, triggeredAt: new Date() })
    options.onManDown?.(alertId)

    toast.error('🚨 MAN DOWN ALERT — No movement detected', {
      duration: 0,   // Persistent until dismissed
      description: 'Emergency alert sent to admin. Acknowledge to clear.',
      action: {
        label: 'I\'m OK',
        onClick: () => resolveManDownAlert(alertId),
      },
    })
  }, [user, options, resolveManDownAlert])

  // ─── GPS update (called by parent on each position fix) ───────────────────

  const recordGPSUpdate = useCallback((lat: number, lng: number) => {
    const prev = lastPositionRef.current
    const now = Date.now()

    if (prev) {
      const moved = haversineMetres(prev.lat, prev.lng, lat, lng)
      if (moved >= MOVEMENT_THRESHOLD_M) {
        // Officer has moved — reset stationary timer
        lastMovementRef.current = { lat, lng, at: now }

        // If man-down was active, resolve it automatically
        if (manDownStateRef.current.isActive && manDownStateRef.current.alertId) {
          resolveManDownAlert(manDownStateRef.current.alertId)
        }
      }
    } else {
      lastMovementRef.current = { lat, lng, at: now }
    }

    lastPositionRef.current = { lat, lng }
  }, [resolveManDownAlert])

  // ─── Periodic check ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return

    let running = false  // Prevent overlapping async executions

    const runCheck = async () => {
      if (running) return
      running = true
      try {
        const lastMovement = lastMovementRef.current
        if (!lastMovement) return
        if (manDownStateRef.current.isActive) {
          // Check if escalation threshold passed
          const { triggeredAt, alertId } = manDownStateRef.current
          if (triggeredAt && alertId) {
            const elapsedSinceAlert = Date.now() - triggeredAt.getTime()
            if (elapsedSinceAlert >= escalationMs) {
              // Escalate to level 2
              await (supabase as any)
                .from('officer_welfare_alerts')
                .update({
                  escalation_level: 2,
                  escalated_at: new Date().toISOString(),
                })
                .eq('id', alertId)
                .lt('escalation_level', 2)
            }
          }
          return
        }

        const elapsedStationary = Date.now() - lastMovement.at
        if (elapsedStationary >= stationaryMs) {
          await fireManDownAlert()
        }
      } finally {
        running = false
      }
    }

    const interval = setInterval(runCheck, CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [user?.id, stationaryMs, escalationMs, fireManDownAlert])

  return {
    manDownState,
    recordGPSUpdate,
    resolveManDownAlert: (alertId?: string) => {
      const id = alertId ?? manDownStateRef.current.alertId
      if (id) resolveManDownAlert(id)
    },
    isManDownActive: manDownState.isActive,
  }
}
