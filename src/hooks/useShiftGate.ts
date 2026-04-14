/**
 * useShiftGate
 *
 * Platform-wide access gate for officer-facing portals.
 *
 * Business rules:
 *  1. Officer on shift AND inside geofence → full portal access
 *  2. Officer on shift BUT outside geofence (non-patrol) → restricted, supervisor notified
 *  3. Officer NOT rostered for today → only Chat, Open Shifts, Request Adhoc Shift
 *
 * Patrol-based service types (freedom_camping, patrol, alarm_response) are exempt
 * from geofence restriction because they actively roam their zone.
 *
 * Admin / master / grand_master roles always bypass the gate.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useRosteredShift } from '@/hooks/useRosteredShift'
import { detectCurrentZones } from '@/lib/geofence'
import { isFeatureAllowed, type ZoneFeatureKey } from '@/lib/zoneFeatures'
import { format } from 'date-fns'
import { nzNow } from '@/lib/timezone'

// Service types that legitimately roam — don't restrict on geofence exit
const PATROL_BASED_TYPES = new Set([
  'freedom_camping',
  'patrol',
  'alarm_response',
])

export interface ShiftGateState {
  /** True if the current user is a role that the gate applies to */
  gateApplies: boolean
  /** Roster shift exists for today */
  isRostered: boolean
  /** officer_shifts record is open (shift started) */
  hasActiveShift: boolean
  /** Officer is physically inside their assigned zone / site geofence */
  isInsideGeofence: boolean
  /** Service type is patrol-based — geofence exit does NOT restrict */
  isPatrolBased: boolean
  /**
   * Full portal access = rostered + (patrol or inside geofence).
   * When false the portal should redirect to /officer-home.
   */
  canAccessPortal: boolean
  /**
   * On shift but geofence gap detected (non-patrol only).
   * Supervisor notification already fired; UI should show a banner.
   */
  geofenceViolation: boolean
  /**
   * Portal feature keys the admin has enabled for the officer's rostered zone.
   * Empty array = all features are permitted (unconfigured / legacy zone).
   * Non-empty = only the listed keys are accessible.
   * Use isFeatureAllowed(key, allowedFeatures) or canUseFeature(key) to check.
   */
  allowedFeatures: string[]
  /**
   * Convenience helper: returns true if the officer may use a given feature
   * at their current zone (respects the empty = all rule).
   */
  canUseFeature: (feature: ZoneFeatureKey) => boolean
  isLoading: boolean
}

export function useShiftGate(): ShiftGateState {
  const { user } = useAuthStore()
  const { rosteredShift, isLoading: rosterLoading } = useRosteredShift()

  const today = format(nzNow(), 'yyyy-MM-dd')

  // Only gate officer-role users; admins / masters bypass
  const gateApplies =
    !!user &&
    (user.role === 'officer' ||
      (user.role === 'admin_officer' &&
        typeof window !== 'undefined' &&
        window.sessionStorage.getItem('adminOfficerPortalChoice') === 'selected'))

  const isPatrolBased = PATROL_BASED_TYPES.has(rosteredShift?.service_type ?? '')

  // ── Zone feature config (from rostered zone) ─────────────────────────────
  const { data: allowedFeatures = [] } = useQuery<string[]>({
    queryKey: ['zone-features-gate', rosteredShift?.zone_id],
    queryFn: async () => {
      if (!rosteredShift?.zone_id) return []
      const { data } = await (supabase.from('zones') as any)
        .select('zone_features')
        .eq('id', rosteredShift.zone_id)
        .maybeSingle()
      return (data?.zone_features ?? []) as string[]
    },
    enabled: gateApplies && !!rosteredShift?.zone_id,
    staleTime: 300_000, // 5 min — zone config rarely changes mid-shift
  })

  // ── Active officer_shifts record ─────────────────────────────────────────
  const { data: activeShiftRecord, isLoading: shiftLoading } = useQuery({
    queryKey: ['officer-active-shift-gate', user?.id, today],
    queryFn: async () => {
      if (!user?.id) return null
      const { data } = await (supabase
        .from('officer_shifts') as any)
        .select('id, organization_id, parent_zone_id, started_at')
        .eq('officer_id', user.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data ?? null
    },
    enabled: gateApplies && !!user?.id,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  // ── Geofence check (only when on shift, non-patrol) ──────────────────────
  const [isInsideGeofence, setIsInsideGeofence] = useState(true) // optimistic default
  const [geofenceViolation, setGeofenceViolation] = useState(false)
  const violationNotifiedRef = useRef(false)

  useEffect(() => {
    if (!gateApplies || !activeShiftRecord || isPatrolBased) {
      setIsInsideGeofence(true)
      setGeofenceViolation(false)
      violationNotifiedRef.current = false
      return
    }

    let cancelled = false

    async function checkGeofence() {
      if (!navigator.geolocation) {
        setIsInsideGeofence(true) // can't check → don't restrict
        return
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          if (cancelled) return
          const { latitude, longitude } = pos.coords
          try {
            const zones = await detectCurrentZones(
              latitude,
              longitude,
              activeShiftRecord.organization_id,
            )
            const inside = zones.length > 0
            setIsInsideGeofence(inside)

            if (!inside && !violationNotifiedRef.current) {
              violationNotifiedRef.current = true
              setGeofenceViolation(true)
              await notifySupervisorGeofenceExit(user!, activeShiftRecord)
            } else if (inside) {
              setGeofenceViolation(false)
              violationNotifiedRef.current = false
            }
          } catch {
            setIsInsideGeofence(true) // on error, don't restrict
          }
        },
        () => {
          setIsInsideGeofence(true) // GPS unavailable → don't restrict
        },
        { timeout: 8000, maximumAge: 30_000 },
      )
    }

    const initial = setTimeout(checkGeofence, 3000)
    const interval = setInterval(checkGeofence, 60_000) // check every minute in gate
    return () => {
      cancelled = true
      clearTimeout(initial)
      clearInterval(interval)
    }
  }, [gateApplies, activeShiftRecord, isPatrolBased, user])

  const isLoading = gateApplies && (rosterLoading || shiftLoading)

  const canUseFeature = (feature: ZoneFeatureKey) =>
    isFeatureAllowed(feature, allowedFeatures)

  if (!gateApplies) {
    return {
      gateApplies: false,
      isRostered: true,
      hasActiveShift: true,
      isInsideGeofence: true,
      isPatrolBased: false,
      canAccessPortal: true,
      geofenceViolation: false,
      allowedFeatures: [],
      canUseFeature: () => true,
      isLoading: false,
    }
  }

  const isRostered = !!rosteredShift
  const hasActiveShift = !!activeShiftRecord

  // Portal access: must be rostered OR have an active shift (e.g. approved ad-hoc);
  // if non-patrol also needs to be inside geofence.
  const canAccessPortal =
    !isLoading &&
    (isRostered || hasActiveShift) &&
    (isPatrolBased || isInsideGeofence)

  return {
    gateApplies,
    isRostered,
    hasActiveShift,
    isInsideGeofence,
    isPatrolBased,
    canAccessPortal,
    geofenceViolation,
    allowedFeatures,
    canUseFeature,
    isLoading,
  }
}

// ─── Supervisor notification helper ──────────────────────────────────────────

async function notifySupervisorGeofenceExit(
  user: { id: string; first_name: string | null; last_name: string | null },
  activeShift: { id: string; organization_id: string },
) {
  try {
    // Find admin/master users in the same org to notify
    const { data: supervisors } = await (supabase
      .from('user_profiles') as any)
      .select('id')
      .eq('organization_id', activeShift.organization_id)
      .in('role', ['admin', 'master'])
      .eq('is_active', true)
      .limit(10)

    if (!supervisors?.length) return

    const officerName =
      [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Officer'

    const notifications = supervisors.map((s: { id: string }) => ({
      user_id: s.id,
      title: 'Officer Left Geofence',
      message: `${officerName} has left their assigned zone during shift. Shift ID: ${activeShift.id.substring(0, 8)}`,
      type: 'geofence_exit',
      is_read: false,
      metadata: {
        officer_id: user.id,
        shift_id: activeShift.id,
        organization_id: activeShift.organization_id,
      },
    }))

    await (supabase.from('notifications') as any).insert(notifications)
  } catch {
    // Non-critical — don't surface to the user
  }
}
