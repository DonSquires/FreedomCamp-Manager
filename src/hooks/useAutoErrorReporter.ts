/**
 * useAutoErrorReporter
 *
 * Passive in-browser crash monitor.  Installed once at the AppLayout level.
 * Periodically inspects the console error buffer captured by useFeedbackCapture
 * and automatically submits a bug report to bug_reports when critical errors
 * accumulate — no user action required.
 *
 * Rules:
 *   - Only triggers on 'unhandled' promise rejections or real 'error' entries
 *     (React/Radix accessibility warnings and other known noise are filtered out)
 *   - Requires at least 2 distinct critical errors in the last 2 minutes
 *   - Rate-limited: at most one auto-report per 5 minutes per session
 *   - Deduplicates by hashing the leading error messages so the same crash
 *     does not generate repeated reports
 *   - Fires-and-forgets autoAnalyseReport so the report is AI-analysed
 *     automatically
 *   - Shows a subtle, non-intrusive toast so the user knows an auto-report
 *     was sent (they can optionally add more detail via the Feedback button)
 */

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { getFeedbackSnapshot } from '@/hooks/useFeedbackCapture'
import { edgeFunctions } from '@/lib/edgeFunctions'

// ── Noise filter ──────────────────────────────────────────────────────────────
// Patterns that are NOT worth auto-reporting (React dev warnings, a11y hints, etc.)

const NOISE_PATTERNS = [
  /React Router Future Flag Warning/i,
  /DialogContent.*DialogTitle/i,
  /Missing `Description` or `aria-describedby=\{undefined\}` for \{DialogContent\}/i,
  /Warning: Each child in a list/i,
  /Encountered two children with the same key/i,
  /validateDOMNesting/i,
  /Warning: ReactDOM\.render/i,
  /Warning: Can't perform a React state update/i,
  /Warning: An update to .* inside a test/i,
  /Download the React DevTools/i,
  /act\(\.\.\.\)/i,
  /key prop/i,
  /ResizeObserver loop/i,
  /Non-Error promise rejection/i,
  /Content Security Policy/i,
  /favicon/i,
  /Token mint rate limited/i,
  /recent Push to Talk token was already issued/i,
  /Session expired during request/i,
  /No active session found\. Please sign in again/i,
  /PTT: WebSocket error \{"isTrusted":true\}/i,
  /Notification permission denied/i,
  /Nominatim geocoding failed: TypeError: Failed to fetch/i,
  /Edge function request timed out after \d+s/i,
]

function isNoise(message: string): boolean {
  return NOISE_PATTERNS.some(p => p.test(message))
}

// ── Dedup + rate-limit (module-level, survives re-renders) ────────────────────

const _reportedHashes = new Set<string>()
const _reportedPrimaryErrors = new Map<string, number>()
let _lastAutoReportMs = 0
const MIN_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes between auto-reports
const PRIMARY_ERROR_SUPPRESS_MS = 30 * 60 * 1000 // suppress same root error for 30 minutes
const CHECK_INTERVAL_MS = 90_000        // check every 90 seconds
// Delay before the first check: long enough for the initial page render and
// React hydration to complete so transient startup errors are not captured.
const INITIAL_CHECK_DELAY_MS = 15_000

/** Cheap 32-bit string hash for deduplication. */
function hashString(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return (h >>> 0).toString(36)
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAutoErrorReporter() {
  const { user } = useAuthStore()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!user?.id) return

    const check = async () => {
      const now = Date.now()

      // Rate-limit: don't report more than once per MIN_INTERVAL_MS
      if (now - _lastAutoReportMs < MIN_INTERVAL_MS) return

      const snapshot = getFeedbackSnapshot()

      // Filter out noise — only keep unhandled rejections and real errors
      const critical = snapshot.consoleErrors.filter(e =>
        (e.level === 'unhandled' || e.level === 'error') && !isNoise(e.message)
      )

      // Need at least 2 distinct critical errors to auto-report
      if (critical.length < 2) return

      // Only consider errors from the last 2 minutes
      const cutoff = new Date(now - 2 * 60 * 1000).toISOString()
      const recent = critical.filter(e => e.timestamp >= cutoff)
      if (recent.length < 2) return

      // Dedup: hash the first 3 error messages to identify this "crash pattern"
      const errorKey = hashString(
        recent.slice(0, 3).map(e => e.message.slice(0, 120)).join('|')
      )
      if (_reportedHashes.has(errorKey)) return

      // Stronger dedupe: suppress repeated reports for the same leading error
      // message for a longer window even if surrounding errors vary.
      const primaryErrorKey = hashString(recent[0].message.slice(0, 180).toLowerCase())
      const lastPrimaryReportAt = _reportedPrimaryErrors.get(primaryErrorKey)
      if (typeof lastPrimaryReportAt === 'number' && (now - lastPrimaryReportAt) < PRIMARY_ERROR_SUPPRESS_MS) {
        return
      }

      // All checks passed — submit the auto-report
      _reportedHashes.add(errorKey)
      _reportedPrimaryErrors.set(primaryErrorKey, now)
      _lastAutoReportMs = now

      try {
        const createResult = await edgeFunctions.createBugReport({
          showToast: false,
          payload: {
            title: `Auto-detected: ${recent[0].message.slice(0, 100)}`,
            description:
              `${recent.length} error${recent.length !== 1 ? 's' : ''} detected automatically ` +
              `on page ${snapshot.currentPage}. ` +
              `This report was submitted by the in-browser error monitor — no user action required.\n\n` +
              `Errors:\n` +
              recent.slice(0, 5).map(e => `• [${e.level}] ${e.message.slice(0, 200)}`).join('\n'),
            severity: recent.some(e => e.level === 'unhandled') ? 'high' : 'medium',
            issue_type: 'bug',
            current_page: snapshot.currentPage,
            browser_info: {
              ...snapshot.browserInfo,
              navigationHistory: snapshot.navigationHistory,
            } as any,
            console_errors: snapshot.consoleErrors as any,
            app_version: snapshot.appVersion,
            status: 'submitted',
            auto_reported: true,
          },
        })
        const inserted = (createResult.data as any)?.data

        if (inserted?.id) {
          // Fire-and-forget AI analysis (with CI health check)
          edgeFunctions.autoAnalyseReport({ report_id: inserted.id }).catch(() => {})

          // Non-intrusive notification to the user
          toast.info('An error was automatically reported to the platform team.', {
            duration: 5000,
            id: 'auto-error-report',
            description: 'You can add more details via the Feedback button.',
          })
        }
      } catch {
        // Silent — the crash reporter must never crash the app
      }
    }

    // Run once shortly after mount, then on interval
    const initialTimer = setTimeout(check, INITIAL_CHECK_DELAY_MS)
    intervalRef.current = setInterval(check, CHECK_INTERVAL_MS)

    return () => {
      clearTimeout(initialTimer)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [user?.id, user?.organization_id, user?.role])
}
