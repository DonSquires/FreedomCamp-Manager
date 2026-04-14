import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveTheme,
  applyTheme,
  brandColors,
  chartColors,
  statusColors,
  THEME_STORAGE_KEY,
} from '../theme'

// ── THEME_STORAGE_KEY ───────────────────────────────────────────────────────

describe('THEME_STORAGE_KEY', () => {
  it('has the expected value', () => {
    expect(THEME_STORAGE_KEY).toBe('fcm-theme')
  })
})

// ── resolveTheme ────────────────────────────────────────────────────────────

describe('resolveTheme', () => {
  const originalMatchMedia = window.matchMedia

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    })
  })

  it('returns "light" when stored theme is "light"', () => {
    expect(resolveTheme('light')).toBe('light')
  })

  it('returns "dark" when stored theme is "dark"', () => {
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('returns "high-contrast" when stored theme is "high-contrast"', () => {
    expect(resolveTheme('high-contrast')).toBe('high-contrast')
  })

  it('returns "night-patrol" when stored theme is "night-patrol"', () => {
    expect(resolveTheme('night-patrol')).toBe('night-patrol')
  })

  it('follows OS dark preference when stored theme is "system" and OS is dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    })
    expect(resolveTheme('system')).toBe('dark')
  })

  it('falls back to "light" when stored theme is "system" and OS is light', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
    expect(resolveTheme('system')).toBe('light')
  })

  it('falls back to "light" when stored theme is null and OS is light', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
    expect(resolveTheme(null)).toBe('light')
  })

  it('falls back to "dark" when stored theme is null and OS is dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    })
    expect(resolveTheme(null)).toBe('dark')
  })
})

// ── applyTheme ──────────────────────────────────────────────────────────────

describe('applyTheme', () => {
  beforeEach(() => {
    // Reset all theme classes before each test
    document.documentElement.classList.remove('dark', 'high-contrast', 'night-patrol')
  })

  it('adds "dark" class for dark theme', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false)
    expect(document.documentElement.classList.contains('night-patrol')).toBe(false)
  })

  it('adds "high-contrast" class for high-contrast theme', () => {
    applyTheme('high-contrast')
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('adds both "dark" and "night-patrol" classes for night-patrol theme', () => {
    applyTheme('night-patrol')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('night-patrol')).toBe(true)
  })

  it('removes all theme classes for light theme', () => {
    document.documentElement.classList.add('dark', 'night-patrol')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.classList.contains('night-patrol')).toBe(false)
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false)
  })

  it('switches from dark to light cleanly', () => {
    applyTheme('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('switches from high-contrast to dark cleanly', () => {
    applyTheme('high-contrast')
    applyTheme('dark')
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

// ── brandColors ─────────────────────────────────────────────────────────────

describe('brandColors', () => {
  it('has the expected primary colour', () => {
    expect(brandColors.primary).toBe('#0891b2')
  })

  it('has danger, warning, success and info colours', () => {
    expect(brandColors.danger).toBeTruthy()
    expect(brandColors.warning).toBeTruthy()
    expect(brandColors.success).toBeTruthy()
    expect(brandColors.info).toBeTruthy()
  })

  it('all colour values start with #', () => {
    Object.values(brandColors).forEach((colour) => {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/i)
    })
  })
})

// ── chartColors ─────────────────────────────────────────────────────────────

describe('chartColors', () => {
  it('has compliant and nonCompliant colours', () => {
    expect(chartColors.compliant).toBeTruthy()
    expect(chartColors.nonCompliant).toBeTruthy()
  })

  it('series array has at least 4 colours', () => {
    expect(chartColors.series.length).toBeGreaterThanOrEqual(4)
  })

  it('primary matches brandColors.primary', () => {
    expect(chartColors.primary).toBe(brandColors.primary)
  })
})

// ── statusColors ─────────────────────────────────────────────────────────────

describe('statusColors', () => {
  it('has entries for common statuses', () => {
    expect(statusColors.pending).toBeDefined()
    expect(statusColors.resolved).toBeDefined()
    expect(statusColors.compliant).toBeDefined()
    expect(statusColors.non_compliant).toBeDefined()
    expect(statusColors.active).toBeDefined()
    expect(statusColors.inactive).toBeDefined()
  })

  it('every status entry has bg, text and border properties', () => {
    Object.entries(statusColors).forEach(([, val]) => {
      expect(val.bg).toBeTruthy()
      expect(val.text).toBeTruthy()
      expect(val.border).toBeTruthy()
    })
  })
})
