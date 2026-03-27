/**
 * useWelfareCheckin – WelfareFirst-style proactive lone-worker check-in.
 *
 * Tracks the time since the officer last tapped "I'm OK", warns when they
 * are approaching / past the configured check-in interval, and writes each
 * check-in to the `welfare_checkins` table for a full audit trail.
 *
 * Interval configuration comes from officer_welfare_settings.check_in_interval_minutes.
 * If the value is 0 the scheduled check-in feature is disabled.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface WelfareCheckinState {
  /** Minutes since the officer's last check-in (null = no check-in yet) */
  minutesSinceCheckin: number | null
  /** Configured interval in minutes (0 = disabled) */
  intervalMinutes: number
  /** True when minutesSinceCheckin >= intervalMinutes * 0.8 (approaching due) */
  isDue: boolean
  /** True when minutesSinceCheckin >= intervalMinutes (overdue) */
  isOverdue: boolean
  /** Seconds remaining until check-in is due (negative when overdue) */
  secondsUntilDue: number | null
  /** ISO timestamp of last check-in, or null */
  lastCheckinAt: string | null
  /** Whether a check-in submission is in flight */
  isSubmitting: boolean
}

interface CheckinOptions {
  officerId: string | null
  organizationId: string | null
  shiftId: string | null
  /** Current GPS position for recording with the check-in */
  position?: { latitude: number; longitude: number; accuracy?: number } | null
}

export function useWelfareCheckin(opts: CheckinOptions) {
  const { officerId, organizationId, shiftId, position } = opts
  const qc = useQueryClient()

  // ── Load check-in interval from welfare settings ──────────────────────────
  const { data: intervalMinutes = 30 } = useQuery<number>({
    queryKey: ['welfare-checkin-interval', officerId],
    queryFn: async () => {
      if (!officerId) return 30
      const { data, error } = await supabase
        .from('officer_welfare_settings')
        .select('check_in_interval_minutes')
        .eq('user_id', officerId)
        .maybeSingle()
      if (error || !data) return 30
      return (data as any).check_in_interval_minutes ?? 30
    },
    enabled: !!officerId,
    staleTime: 1000 * 60 * 5, // cache for 5 min
  })

  // ── Last check-in timestamp (kept in state + persisted to localStorage) ───
  const storageKey = officerId ? `welfare_last_checkin_${officerId}` : null

  const [lastCheckinAt, setLastCheckinAt] = useState<string | null>(() => {
    if (!storageKey) return null
    return localStorage.getItem(storageKey)
  })

  // ── Tick state – updated every 10 s ───────────────────────────────────────
  const [tick, setTick] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    tickRef.current = setInterval(() => setTick(t => t + 1), 10_000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [])

  // ── Derived state ─────────────────────────────────────────────────────────
  const minutesSinceCheckin: number | null = (() => {
    if (!lastCheckinAt) return null
    return Math.floor((Date.now() - new Date(lastCheckinAt).getTime()) / 60_000)
  })()

  const disabled = intervalMinutes <= 0

  const secondsUntilDue: number | null = (() => {
    if (disabled || !lastCheckinAt) return null
    const dueAt = new Date(lastCheckinAt).getTime() + intervalMinutes * 60_000
    return Math.floor((dueAt - Date.now()) / 1_000)
  })()

  const isDue    = !disabled && secondsUntilDue !== null && secondsUntilDue <= intervalMinutes * 60 * 0.2
  const isOverdue = !disabled && secondsUntilDue !== null && secondsUntilDue < 0

  // ── Overdue toast (fired once per overdue event) ──────────────────────────
  const overdueToasted = useRef(false)
  useEffect(() => {
    if (isOverdue && !overdueToasted.current) {
      overdueToasted.current = true
      toast.warning('Welfare check-in overdue', {
        description: `Please tap "I'm OK" to confirm you are safe.`,
        duration: 0, // persistent until dismissed
        id: 'welfare-overdue',
      })
    }
    if (!isOverdue) {
      overdueToasted.current = false
    }
  }, [isOverdue])

  // ── Submit check-in mutation ───────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!officerId || !organizationId) throw new Error('Not authenticated')
      const now = new Date().toISOString()
      const overdueMins = (minutesSinceCheckin !== null && intervalMinutes > 0)
        ? Math.max(0, minutesSinceCheckin - intervalMinutes)
        : 0

      const { error } = await supabase.from('welfare_checkins').insert({
        officer_id:       officerId,
        organization_id:  organizationId,
        officer_shift_id: shiftId,
        checked_in_at:    now,
        gps_latitude:     position?.latitude   ?? null,
        gps_longitude:    position?.longitude  ?? null,
        gps_accuracy:     position?.accuracy   ?? null,
        is_overdue:       overdueMins > 0,
        overdue_minutes:  overdueMins > 0 ? overdueMins : null,
      })
      if (error) throw error
      return now
    },
    onSuccess: (now) => {
      setLastCheckinAt(now)
      if (storageKey) localStorage.setItem(storageKey, now)
      toast.dismiss('welfare-overdue')
      toast.success("You're safe – check-in recorded ✓", { duration: 3000 })
      qc.invalidateQueries({ queryKey: ['welfare-checkins'] })
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Check-in failed – please try again')
    },
  })

  const checkIn = useCallback(() => {
    submitMutation.mutate()
  }, [submitMutation])

  // ── Public API ────────────────────────────────────────────────────────────
  const state: WelfareCheckinState = {
    minutesSinceCheckin,
    intervalMinutes,
    isDue,
    isOverdue,
    secondsUntilDue,
    lastCheckinAt,
    isSubmitting: submitMutation.isPending,
  }

  return { state, checkIn }
}
