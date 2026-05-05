/**
 * useWelfareCheckin – WelfareFirst-style proactive lone-worker check-in.
 *
 * Tracks the time since the officer last tapped "I'm OK", warns when they
 * are approaching / past the configured check-in interval, and writes each
 * check-in to the `welfare_checkins` table for a full audit trail.
 *
 * Interval configuration comes from officer_welfare_settings.check_in_interval_minutes.
 * If the value is 0 the scheduled check-in feature is disabled.
 *
 * Alert schedule (visual banner + audio beep):
 *   - 10 minutes before due  → yellow warning
 *   -  5 minutes before due  → orange urgent warning
 *   - At / past due          → red overdue (persistent toast + repeated beep every 60s)
 *
 * Welfare monitoring only runs while `isShiftActive === true`.
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
  /** True when ≤ 10 minutes until check-in is due */
  isDueSoon10: boolean
  /** True when ≤ 5 minutes until check-in is due */
  isDueSoon5: boolean
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
  /** Welfare monitoring active (shift is running) */
  isActive: boolean
}

interface CheckinOptions {
  officerId: string | null
  organizationId: string | null
  shiftId: string | null
  /** Current GPS position for recording with the check-in */
  position?: { latitude: number; longitude: number; accuracy?: number } | null
  /** Whether the officer's shift is currently running. Welfare only monitors when true. */
  isShiftActive: boolean
}

/** Play a short beep using the Web Audio API. freq in Hz, duration in ms. */
function playBeep(freq = 880, durationMs = 200, volume = 0.4): void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + durationMs / 1000)
  } catch {
    // AudioContext may be unavailable in some environments
  }
}

/** Play a triple-beep pattern for urgent alerts. */
function playUrgentBeep(): void {
  playBeep(1047, 150, 0.5)
  setTimeout(() => playBeep(1047, 150, 0.5), 200)
  setTimeout(() => playBeep(1047, 300, 0.5), 400)
}

export function useWelfareCheckin(opts: CheckinOptions) {
  const { officerId, organizationId, shiftId, position, isShiftActive } = opts
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
    staleTime: 1000 * 60 * 5,
  })

  // ── Last check-in timestamp ───────────────────────────────────────────────
  const storageKey = officerId ? `welfare_last_checkin_${officerId}` : null

  const [lastCheckinAt, setLastCheckinAt] = useState<string | null>(() => {
    if (!storageKey) return null
    return localStorage.getItem(storageKey)
  })

  // ── Per-second tick (only when shift is active) ───────────────────────────
  const [tick, setTick] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isShiftActive) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      return
    }
    tickRef.current = setInterval(() => setTick(t => t + 1), 1_000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [isShiftActive])

  // Keep tick ref in scope for derived state (avoids stale closure warnings)
  void tick

  // ── Derived state ─────────────────────────────────────────────────────────
  const disabled = intervalMinutes <= 0 || !isShiftActive

  const secondsUntilDue: number | null = (() => {
    if (disabled || !lastCheckinAt) return null
    const dueAt = new Date(lastCheckinAt).getTime() + intervalMinutes * 60_000
    return Math.floor((dueAt - Date.now()) / 1_000)
  })()

  const minutesSinceCheckin: number | null = (() => {
    if (!lastCheckinAt || !isShiftActive) return null
    return Math.floor((Date.now() - new Date(lastCheckinAt).getTime()) / 60_000)
  })()

  const isDueSoon10 = !disabled && secondsUntilDue !== null && secondsUntilDue > 0 && secondsUntilDue <= 10 * 60
  const isDueSoon5  = !disabled && secondsUntilDue !== null && secondsUntilDue > 0 && secondsUntilDue <= 5 * 60
  const isDue       = !disabled && secondsUntilDue !== null && secondsUntilDue <= intervalMinutes * 60 * 0.2
  const isOverdue   = !disabled && secondsUntilDue !== null && secondsUntilDue < 0

  // ── Alert tracking refs (fire each alert once per check-in cycle) ─────────
  const alert10Fired  = useRef(false)
  const alert5Fired   = useRef(false)
  const overdueToasted = useRef(false)
  const overdueRepeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset alerts when officer checks in
  const resetAlerts = useCallback(() => {
    alert10Fired.current  = false
    alert5Fired.current   = false
    overdueToasted.current = false
    alertRaisedRef.current = false
    if (overdueRepeatRef.current) { clearInterval(overdueRepeatRef.current); overdueRepeatRef.current = null }
    toast.dismiss('welfare-overdue')
    toast.dismiss('welfare-due-10')
    toast.dismiss('welfare-due-5')
  }, [])

  // 10-minute warning
  useEffect(() => {
    if (!isShiftActive) return
    if (isDueSoon10 && !isDueSoon5 && !isOverdue && !alert10Fired.current) {
      alert10Fired.current = true
      playBeep(880, 300)
      toast.warning('Welfare check-in due in 10 minutes', {
        description: 'Tap "I\'m OK" when you\'re ready.',
        duration: 8000,
        id: 'welfare-due-10',
      })
    }
    if (!isDueSoon10) alert10Fired.current = false
  }, [isDueSoon10, isDueSoon5, isOverdue, isShiftActive])

  // 5-minute urgent warning
  useEffect(() => {
    if (!isShiftActive) return
    if (isDueSoon5 && !isOverdue && !alert5Fired.current) {
      alert5Fired.current = true
      playBeep(1047, 200)
      setTimeout(() => playBeep(1047, 200), 300)
      toast.warning('⚠️ Welfare check-in due in 5 minutes', {
        description: 'Please tap "I\'m OK" soon.',
        duration: 12000,
        id: 'welfare-due-5',
      })
    }
    if (!isDueSoon5) alert5Fired.current = false
  }, [isDueSoon5, isOverdue, isShiftActive])

  // Track whether a missed-check-in alert has been raised for the current cycle
  const alertRaisedRef = useRef(false)

  // Overdue persistent alert + repeating beep every 60 s + welfare alert row
  useEffect(() => {
    if (!isShiftActive) return
    if (isOverdue && !overdueToasted.current) {
      overdueToasted.current = true
      playUrgentBeep()
      toast.error('🚨 Welfare check-in OVERDUE', {
        description: 'Tap "I\'m OK" immediately to confirm you are safe.',
        duration: 0,
        id: 'welfare-overdue',
      })
      // Repeat beep every 60 s until checked in
      overdueRepeatRef.current = setInterval(() => {
        playUrgentBeep()
      }, 60_000)
      // Create a welfare alert so supervisors are notified (fire-and-forget)
      if (!alertRaisedRef.current && officerId && organizationId) {
        alertRaisedRef.current = true
        supabase.from('officer_welfare_alerts').insert({
          officer_id: officerId,
          organization_id: organizationId,
          officer_name: '',               // resolved server-side via officer_id
          alert_type: 'inactivity',
          status: 'pending',
          last_activity_at: lastCheckinAt ?? new Date().toISOString(),
          alert_sent_at: new Date().toISOString(),
          escalation_level: 1,
          gps_latitude: position?.latitude ?? null,
          gps_longitude: position?.longitude ?? null,
          gps_accuracy: position?.accuracy ?? null,
        } as any)
      }
    }
    if (!isOverdue) {
      overdueToasted.current = false
      alertRaisedRef.current = false
      if (overdueRepeatRef.current) { clearInterval(overdueRepeatRef.current); overdueRepeatRef.current = null }
    }
    return () => {
      if (overdueRepeatRef.current) { clearInterval(overdueRepeatRef.current); overdueRepeatRef.current = null }
    }
  }, [isOverdue, isShiftActive, officerId, organizationId, lastCheckinAt, position])

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
      resetAlerts()
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
    isDueSoon10,
    isDueSoon5,
    isDue,
    isOverdue,
    secondsUntilDue,
    lastCheckinAt,
    isSubmitting: submitMutation.isPending,
    isActive: isShiftActive && !disabled,
  }

  return { state, checkIn }
}
