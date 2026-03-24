/**
 * useFeedbackCapture
 *
 * Global hook that passively captures context needed for rich feedback reports:
 *   - Navigation breadcrumbs (last 20 routes with timestamps)
 *   - Console errors and unhandled promise rejections
 *   - Browser and device info
 *   - A live snapshot of recent user actions
 *
 * Install once at the AppLayout level.  Any component can then call
 * getFeedbackSnapshot() to get the full context at submission time.
 */

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

const MAX_NAV_HISTORY = 20
const MAX_CONSOLE_ERRORS = 30

// ── Shared in-memory store (module-level so it survives re-renders) ───────────

export interface NavEntry {
  path: string
  title: string
  timestamp: string
}

export interface ConsoleEntry {
  level: 'error' | 'warn' | 'unhandled'
  message: string
  stack?: string
  timestamp: string
}

export interface FeedbackSnapshot {
  currentPage: string
  navigationHistory: NavEntry[]
  consoleErrors: ConsoleEntry[]
  browserInfo: {
    userAgent: string
    language: string
    screenResolution: string
    viewportSize: string
    platform: string
    cookiesEnabled: boolean
    onLine: boolean
    timeZone: string
  }
  capturedAt: string
  appVersion: string
}

// Module-level mutable state so the hook can be called from multiple components
const _navHistory: NavEntry[] = []
const _consoleErrors: ConsoleEntry[] = []
let _patchedConsole = false
let _patchedUnhandled = false

function pushNav(entry: NavEntry) {
  // Avoid consecutive duplicates
  if (_navHistory.length > 0 && _navHistory[_navHistory.length - 1].path === entry.path) return
  _navHistory.push(entry)
  if (_navHistory.length > MAX_NAV_HISTORY) _navHistory.shift()
}

function pushConsoleEntry(entry: ConsoleEntry) {
  _consoleErrors.push(entry)
  if (_consoleErrors.length > MAX_CONSOLE_ERRORS) _consoleErrors.shift()
}

function sanitiseMessage(args: any[]): string {
  return args
    .map(a => {
      if (a === null) return 'null'
      if (a === undefined) return 'undefined'
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.name}: ${a.message}`
      try { return JSON.stringify(a) } catch { return String(a) }
    })
    .join(' ')
    .slice(0, 1000)
}

/** Patch console.error + console.warn and window unhandledrejection once */
function patchGlobals() {
  if (typeof window === 'undefined') return

  if (!_patchedConsole) {
    _patchedConsole = true
    const origError = console.error.bind(console)
    const origWarn = console.warn.bind(console)

    console.error = (...args: any[]) => {
      pushConsoleEntry({ level: 'error', message: sanitiseMessage(args), timestamp: new Date().toISOString() })
      origError(...args)
    }
    console.warn = (...args: any[]) => {
      pushConsoleEntry({ level: 'warn', message: sanitiseMessage(args), timestamp: new Date().toISOString() })
      origWarn(...args)
    }
  }

  if (!_patchedUnhandled) {
    _patchedUnhandled = true
    window.addEventListener('unhandledrejection', (ev) => {
      const reason = ev.reason
      const message = reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : sanitiseMessage([reason])
      const stack = reason instanceof Error ? reason.stack?.slice(0, 800) : undefined
      pushConsoleEntry({ level: 'unhandled', message, stack, timestamp: new Date().toISOString() })
    })
  }
}

/** Derive a human-readable page title from a route path */
function pathToTitle(path: string): string {
  const seg = path.split('/').filter(Boolean)
  if (seg.length === 0) return 'Dashboard'
  return seg
    .map(s => s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(' › ')
}

function getBrowserInfo(): FeedbackSnapshot['browserInfo'] {
  const tz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'unknown' }
  })()
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    screenResolution: `${screen.width}×${screen.height}`,
    viewportSize: `${window.innerWidth}×${window.innerHeight}`,
    platform: navigator.platform ?? 'unknown',
    cookiesEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    timeZone: tz,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Call from any component to get the full context snapshot at submission time. */
export function getFeedbackSnapshot(): FeedbackSnapshot {
  return {
    currentPage: typeof window !== 'undefined' ? window.location.pathname : '',
    navigationHistory: [..._navHistory],
    consoleErrors: [..._consoleErrors],
    browserInfo: typeof window !== 'undefined' ? getBrowserInfo() : ({} as any),
    capturedAt: new Date().toISOString(),
    appVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
  }
}

/** Clear stored console errors (call after user submits a report). */
export function clearCapturedErrors() {
  _consoleErrors.length = 0
}

// ── Hook (install once at AppLayout) ─────────────────────────────────────────

export function useFeedbackCapture() {
  const location = useLocation()
  const initialised = useRef(false)

  // Patch globals once
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true
      patchGlobals()
    }
  }, [])

  // Record each navigation
  useEffect(() => {
    pushNav({
      path: location.pathname + location.search,
      title: pathToTitle(location.pathname),
      timestamp: new Date().toISOString(),
    })
  }, [location.pathname, location.search])
}
