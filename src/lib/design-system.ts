/**
 * design-system.ts — Design system utilities.
 *
 * Centralised spacing, typography, and component-size constants that are used
 * across the codebase when Tailwind utilities alone aren't sufficient (e.g.
 * conditional class composition helpers, chart sizing, dynamic style objects).
 */

// ── Spacing scale (maps to Tailwind defaults in px) ──────────────────────────

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const

// ── Typography ────────────────────────────────────────────────────────────────

export const fontSize = {
  xs:   '0.75rem',
  sm:   '0.875rem',
  base: '1rem',
  lg:   '1.125rem',
  xl:   '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.875rem',
  '4xl': '2.25rem',
} as const

export const fontWeight = {
  normal:    '400',
  medium:    '500',
  semibold:  '600',
  bold:      '700',
  extrabold: '800',
  black:     '900',
} as const

// ── Border radius ─────────────────────────────────────────────────────────────

export const radius = {
  none:  '0',
  sm:    '0.125rem',
  md:    '0.375rem',
  lg:    '0.5rem',
  xl:    '0.75rem',
  '2xl': '1rem',
  full:  '9999px',
} as const

// ── Breakpoints ───────────────────────────────────────────────────────────────

export const breakpoints = {
  sm:  640,
  md:  768,
  lg:  1024,
  xl:  1280,
  '2xl': 1536,
} as const

// ── Z-index scale ─────────────────────────────────────────────────────────────

export const zIndex = {
  base:       0,
  raised:     10,
  dropdown:   20,
  sticky:     30,
  overlay:    40,
  modal:      50,
  popover:    60,
  toast:      70,
  tooltip:    80,
} as const

// ── Component sizes ───────────────────────────────────────────────────────────

export const componentSize = {
  buttonSm:  { height: '32px', padding: '0 12px', fontSize: fontSize.sm },
  buttonMd:  { height: '40px', padding: '0 16px', fontSize: fontSize.sm },
  buttonLg:  { height: '48px', padding: '0 24px', fontSize: fontSize.base },
  inputMd:   { height: '40px', padding: '0 12px', fontSize: fontSize.sm },
  iconSm:    { size: '14px' },
  iconMd:    { size: '16px' },
  iconLg:    { size: '20px' },
  iconXl:    { size: '24px' },
} as const

// ── Shadow tokens ─────────────────────────────────────────────────────────────

export const shadows = {
  sm:  '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md:  '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg:  '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl:  '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
} as const

// ── Helper: merge Tailwind class strings conditionally ────────────────────────

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

// ── Chart defaults ────────────────────────────────────────────────────────────

export const chartDefaults = {
  height: 300,
  margin: { top: 5, right: 30, left: 20, bottom: 5 },
  animationDuration: 300,
  tooltipCursorStyle: { fill: 'rgba(0,0,0,0.04)' },
} as const
