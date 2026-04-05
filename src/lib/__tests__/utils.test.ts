import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cn,
  formatDateTime,
  formatDate,
  formatTime,
  formatRelativeTime,
  debounce,
  getOrgTypeLabel,
  getOvernightVerificationModeLabel,
} from '../utils'

// ── cn (class name merge) ───────────────────────────────────────────────────

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'extra')).toBe('base extra')
  })

  it('deduplicates Tailwind classes', () => {
    // tailwind-merge keeps the last conflicting class
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  it('returns empty string for no args', () => {
    expect(cn()).toBe('')
  })

  it('handles undefined and null', () => {
    expect(cn('a', undefined, null, 'b')).toBe('a b')
  })
})

// ── formatDateTime ──────────────────────────────────────────────────────────

describe('formatDateTime', () => {
  it('formats a date string to NZ locale', () => {
    const result = formatDateTime('2025-01-15T02:30:00Z')
    // NZ is UTC+13 (NZDT in Jan), so 02:30 UTC = 15:30 NZDT
    expect(result).toContain('15')
    expect(result).toContain('Jan')
    expect(result).toContain('2025')
  })

  it('handles ISO date strings', () => {
    const result = formatDateTime('2024-06-20T10:00:00.000Z')
    expect(result).toContain('Jun')
    expect(result).toContain('2024')
  })
})

// ── formatDate ──────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats date without time', () => {
    const result = formatDate('2025-03-01T00:00:00Z')
    expect(result).toContain('Mar')
    expect(result).toContain('2025')
    // Should not contain a colon (no time component)
    expect(result).not.toContain(':')
  })
})

// ── formatTime ──────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('formats time without date', () => {
    const result = formatTime('2025-03-01T03:45:00Z')
    // Should contain a colon (time portion)
    expect(result).toContain(':')
  })
})

// ── formatRelativeTime ──────────────────────────────────────────────────────

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for very recent dates', () => {
    expect(formatRelativeTime('2025-06-15T11:59:30Z')).toBe('just now')
  })

  it('returns minutes ago', () => {
    expect(formatRelativeTime('2025-06-15T11:55:00Z')).toBe('5 minutes ago')
  })

  it('returns singular minute', () => {
    expect(formatRelativeTime('2025-06-15T11:59:00Z')).toBe('1 minute ago')
  })

  it('returns hours ago', () => {
    expect(formatRelativeTime('2025-06-15T09:00:00Z')).toBe('3 hours ago')
  })

  it('returns singular hour', () => {
    expect(formatRelativeTime('2025-06-15T11:00:00Z')).toBe('1 hour ago')
  })

  it('returns days ago', () => {
    expect(formatRelativeTime('2025-06-13T12:00:00Z')).toBe('2 days ago')
  })

  it('returns singular day', () => {
    expect(formatRelativeTime('2025-06-14T12:00:00Z')).toBe('1 day ago')
  })
})

// ── debounce ────────────────────────────────────────────────────────────────

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls function after specified delay', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    debounced()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('resets timer on subsequent calls', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 200)

    debounced()
    vi.advanceTimersByTime(100)
    debounced() // reset
    vi.advanceTimersByTime(100)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('passes arguments to the original function', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('hello', 42)
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledWith('hello', 42)
  })
})

// ── getOrgTypeLabel ─────────────────────────────────────────────────────────

describe('getOrgTypeLabel', () => {
  it('returns correct labels for known types', () => {
    expect(getOrgTypeLabel('owner')).toBe('Owner')
    expect(getOrgTypeLabel('service_provider')).toBe('Service Provider')
    expect(getOrgTypeLabel('client')).toBe('Client')
    expect(getOrgTypeLabel('contractor')).toBe('Contractor')
    expect(getOrgTypeLabel('operator')).toBe('Operator')
    expect(getOrgTypeLabel('security_company')).toBe('Security Company')
  })

  it('returns input as-is for unknown types', () => {
    expect(getOrgTypeLabel('unknown_type')).toBe('unknown_type')
  })
})

// ── getOvernightVerificationModeLabel ────────────────────────────────────────

describe('getOvernightVerificationModeLabel', () => {
  it('returns correct labels for known modes', () => {
    expect(getOvernightVerificationModeLabel('two_photo_verification')).toBe('2-photo verification')
    expect(getOvernightVerificationModeLabel('one_photo_per_day_inference')).toBe('1-photo/day + inference')
  })

  it('returns input as-is for unknown modes', () => {
    expect(getOvernightVerificationModeLabel('custom_mode')).toBe('custom_mode')
  })
})
