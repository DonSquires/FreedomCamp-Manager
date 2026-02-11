/**
 * FreedomCamp Manager - Unified Design System
 * Shared tokens and utilities for responsive, accessible UI
 */

// ============================================================================
// BREAKPOINTS (Mobile-First)
// ============================================================================
export const breakpoints = {
  sm: 640,   // Small devices (landscape phones)
  md: 768,   // Medium devices (tablets)
  lg: 1024,  // Large devices (desktops)
  xl: 1280,  // Extra large devices
  '2xl': 1536, // Ultra-wide screens
} as const;

// ============================================================================
// SPACING (8px grid)
// ============================================================================
export const spacing = {
  xs: '0.25rem',   // 4px - fine adjustments
  sm: '0.5rem',    // 8px - tight spacing
  md: '1rem',      // 16px - base spacing
  lg: '1.5rem',    // 24px - comfortable spacing
  xl: '2rem',      // 32px - section spacing
  '2xl': '3rem',   // 48px - major sections
  '3xl': '4rem',   // 64px - page sections
} as const;

// ============================================================================
// TOUCH TARGETS (Accessibility)
// ============================================================================
export const touchTargets = {
  min: '44px',     // Minimum touch target (iOS/Android standard)
  comfortable: '48px', // Comfortable for most users
  large: '56px',   // Large for critical actions
} as const;

// ============================================================================
// TYPOGRAPHY SCALE (16px base)
// ============================================================================
export const typography = {
  // Desktop scale
  desktop: {
    xs: '0.75rem',    // 12px - captions
    sm: '0.875rem',   // 14px - small text
    base: '1rem',     // 16px - body
    lg: '1.125rem',   // 18px - large body
    xl: '1.25rem',    // 20px - headings
    '2xl': '1.5rem',  // 24px - section titles
    '3xl': '1.875rem', // 30px - page titles
    '4xl': '2.25rem', // 36px - hero
  },
  // Mobile scale (slightly larger for readability)
  mobile: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.375rem',   // 22px - headings
    '2xl': '1.75rem', // 28px - section titles
    '3xl': '2.25rem', // 36px - page titles
    '4xl': '3rem',    // 48px - hero
  },
} as const;

// ============================================================================
// Z-INDEX LAYERS (Stacking context)
// ============================================================================
export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
  notification: 1080,
} as const;

// ============================================================================
// ANIMATION DURATIONS
// ============================================================================
export const animation = {
  fast: '150ms',
  base: '200ms',
  slow: '300ms',
  slower: '500ms',
} as const;

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Check if current viewport is mobile
 */
export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < breakpoints.md;
}

/**
 * Check if current viewport is tablet
 */
export function isTablet(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= breakpoints.md && window.innerWidth < breakpoints.lg;
}

/**
 * Check if current viewport is desktop
 */
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= breakpoints.lg;
}

/**
 * Get current viewport size
 */
export function getViewportSize(): 'mobile' | 'tablet' | 'desktop' {
  if (isMobile()) return 'mobile';
  if (isTablet()) return 'tablet';
  return 'desktop';
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Get responsive value based on viewport
 */
export function responsive<T>(mobile: T, desktop: T): T {
  return isMobile() ? mobile : desktop;
}
