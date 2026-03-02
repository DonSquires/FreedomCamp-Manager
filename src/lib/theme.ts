/**
 * theme.ts — Theme management utilities.
 *
 * Works in conjunction with Tailwind's `dark` class strategy and the
 * `useDarkMode` hook. Also exports the app's brand colour palette and
 * semantic colour mappings for use in components that can't use Tailwind
 * classes directly (e.g. recharts, inline styles).
 */

export type Theme = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'fcm-theme'

/** Resolve the effective theme based on the stored preference and system setting */
export function resolveTheme(stored: Theme | null): 'light' | 'dark' {
  if (stored === 'light') return 'light'
  if (stored === 'dark') return 'dark'
  // 'system' or null — follow OS preference
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

/** Apply a resolved theme to the DOM */
export function applyTheme(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

/** Load and apply the theme on app startup */
export function initTheme(): void {
  const stored = (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? 'system'
  const resolved = resolveTheme(stored)
  applyTheme(resolved)
}

// ── Brand Colours ─────────────────────────────────────────────────────────────

export const brandColors = {
  primary: '#1d4ed8',       // blue-700
  primaryLight: '#3b82f6',  // blue-500
  primaryDark: '#1e40af',   // blue-800
  danger: '#dc2626',        // red-600
  warning: '#d97706',       // amber-600
  success: '#16a34a',       // green-600
  info: '#0891b2',          // cyan-600
  neutral: '#6b7280',       // gray-500
} as const

// ── Semantic Chart Colours ─────────────────────────────────────────────────────

export const chartColors = {
  compliant: '#16a34a',
  nonCompliant: '#dc2626',
  pending: '#d97706',
  resolved: '#6b7280',
  primary: brandColors.primary,
  secondary: brandColors.primaryLight,
  series: [
    '#1d4ed8', '#16a34a', '#d97706', '#dc2626',
    '#0891b2', '#7c3aed', '#db2777', '#ea580c',
  ],
} as const

// ── Status Badge Colours ────────────────────────────────────────────────────────

export const statusColors: Record<string, { bg: string; text: string; border: string }> = {
  pending:               { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
  acknowledged:          { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
  enforcement_started:   { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' },
  resolved:              { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' },
  dismissed:             { bg: '#f3f4f6', text: '#6b7280', border: '#e5e7eb' },
  compliant:             { bg: '#d1fae5', text: '#065f46', border: '#a7f3d0' },
  non_compliant:         { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' },
  active:                { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
  inactive:              { bg: '#f3f4f6', text: '#6b7280', border: '#e5e7eb' },
}
