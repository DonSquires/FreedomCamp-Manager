import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  nzNow,
  formatNZDateTime,
  formatNZDate,
  formatNZTime,
  nzStartOfDay,
  nzEndOfDay,
  toNZISOString,
  parseNZDate,
  nzDateToUTCStart,
  nzDateToUTCEnd,
  addDays,
  isToday,
  isPast,
  getDateRange,
} from '../timezone'

// ── nzNow ───────────────────────────────────────────────────────────────────

describe('nzNow', () => {
  it('returns a Date object', () => {
    const result = nzNow()
    expect(result).toBeInstanceOf(Date)
  })

  it('returns a date roughly near current time', () => {
    const now = new Date()
    const nz = nzNow()
    // Difference should be at most ~14 hours (NZ is UTC+12/+13)
    expect(Math.abs(nz.getTime() - now.getTime())).toBeLessThan(14 * 3600 * 1000)
  })
})

// ── formatNZDateTime ────────────────────────────────────────────────────────

describe('formatNZDateTime', () => {
  it('formats a date string', () => {
    const result = formatNZDateTime('2025-01-15T02:30:00Z')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    // Should contain the date
    expect(result).toContain('15')
    expect(result).toContain('Jan')
  })

  it('accepts Date objects', () => {
    const result = formatNZDateTime(new Date('2025-06-20T10:00:00Z'))
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ── formatNZDate ────────────────────────────────────────────────────────────

describe('formatNZDate', () => {
  it('formats date string without time component', () => {
    const result = formatNZDate('2025-03-01T00:00:00Z')
    expect(result).toContain('Mar')
    expect(result).toContain('2025')
  })

  it('accepts Date objects', () => {
    const result = formatNZDate(new Date('2025-12-25T00:00:00Z'))
    expect(result).toContain('Dec')
  })
})

// ── formatNZTime ────────────────────────────────────────────────────────────

describe('formatNZTime', () => {
  it('formats time', () => {
    const result = formatNZTime('2025-03-01T03:45:00Z')
    expect(typeof result).toBe('string')
    expect(result).toContain(':')
  })
})

// ── nzStartOfDay / nzEndOfDay ───────────────────────────────────────────────

describe('nzStartOfDay', () => {
  it('returns a Date at midnight', () => {
    const start = nzStartOfDay(new Date('2025-06-15T12:00:00Z'))
    expect(start).toBeInstanceOf(Date)
    expect(start.toISOString()).toContain('T')
  })
})

describe('nzEndOfDay', () => {
  it('returns a Date at 23:59:59', () => {
    const end = nzEndOfDay(new Date('2025-06-15T12:00:00Z'))
    expect(end).toBeInstanceOf(Date)
    const start = nzStartOfDay(new Date('2025-06-15T12:00:00Z'))
    expect(end.getTime()).toBeGreaterThan(start.getTime())
  })
})

// ── toNZISOString ───────────────────────────────────────────────────────────

describe('toNZISOString', () => {
  it('returns a string with T separator', () => {
    const result = toNZISOString(new Date('2025-06-15T03:00:00Z'))
    expect(result).toContain('T')
  })

  it('returns an ISO-like formatted string', () => {
    const result = toNZISOString(new Date('2025-01-15T00:00:00Z'))
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  })
})

// ── parseNZDate ─────────────────────────────────────────────────────────────

describe('parseNZDate', () => {
  it('parses a YYYY-MM-DD date string using fixed +12:00 NZ offset', () => {
    const result = parseNZDate('2025-06-15')
    expect(result).toBeInstanceOf(Date)
    // parseNZDate always uses +12:00 (NZST): "2025-06-15T00:00:00+12:00" → UTC "2025-06-14T12:00:00Z"
    expect(result.toISOString()).toBe('2025-06-14T12:00:00.000Z')
  })
})

// ── nzDateToUTCStart / nzDateToUTCEnd ───────────────────────────────────────

describe('nzDateToUTCStart', () => {
  it('uses fixed +13:00 offset to ensure no NZ data is missed at start of day', () => {
    const result = nzDateToUTCStart('2025-06-15')
    // Always uses +13:00 (max NZ offset) regardless of DST season
    expect(result).toBe('2025-06-14T11:00:00.000Z')
  })

  it('works for January dates', () => {
    const result = nzDateToUTCStart('2025-01-01')
    expect(result).toBe('2024-12-31T11:00:00.000Z')
  })
})

describe('nzDateToUTCEnd', () => {
  it('uses fixed +12:00 offset to ensure no NZ data is missed at end of day', () => {
    const result = nzDateToUTCEnd('2025-06-15')
    // Always uses +12:00 (min NZ offset) regardless of DST season
    expect(result).toBe('2025-06-15T11:59:59.000Z')
  })

  it('end is always after start for the same date', () => {
    const start = nzDateToUTCStart('2025-06-15')
    const end = nzDateToUTCEnd('2025-06-15')
    expect(new Date(end).getTime()).toBeGreaterThan(new Date(start).getTime())
  })
})

// ── addDays ─────────────────────────────────────────────────────────────────

describe('addDays', () => {
  it('adds positive days', () => {
    const base = new Date('2025-06-15T12:00:00Z')
    const result = addDays(base, 3)
    expect(result.toISOString()).toBe('2025-06-18T12:00:00.000Z')
  })

  it('adds negative days', () => {
    const base = new Date('2025-06-15T12:00:00Z')
    const result = addDays(base, -5)
    expect(result.toISOString()).toBe('2025-06-10T12:00:00.000Z')
  })

  it('does not mutate the original date', () => {
    const original = new Date('2025-06-15T12:00:00Z')
    const originalTime = original.getTime()
    addDays(original, 10)
    expect(original.getTime()).toBe(originalTime)
  })

  it('handles zero days', () => {
    const base = new Date('2025-06-15T12:00:00Z')
    const result = addDays(base, 0)
    expect(result.toISOString()).toBe('2025-06-15T12:00:00.000Z')
  })
})

// ── isToday ─────────────────────────────────────────────────────────────────

describe('isToday', () => {
  it('returns false for a date far in the past', () => {
    expect(isToday('2020-01-01T00:00:00Z')).toBe(false)
  })

  it('returns false for a date in the far future', () => {
    expect(isToday('2099-12-31T23:59:59Z')).toBe(false)
  })

  it('returns consistent results for string and Date inputs', () => {
    const dateStr = '2020-06-15T05:00:00Z'
    expect(isToday(dateStr)).toBe(isToday(new Date(dateStr)))
  })
})

// ── isPast ──────────────────────────────────────────────────────────────────

describe('isPast', () => {
  it('returns true for a past date', () => {
    expect(isPast('2020-01-01T00:00:00Z')).toBe(true)
  })

  it('returns false for a future date', () => {
    expect(isPast('2099-12-31T23:59:59Z')).toBe(false)
  })
})

// ── getDateRange ────────────────────────────────────────────────────────────

describe('getDateRange', () => {
  it('returns from and to for "today"', () => {
    const range = getDateRange('today')
    expect(range).toHaveProperty('from')
    expect(range).toHaveProperty('to')
    expect(typeof range.from).toBe('string')
    expect(typeof range.to).toBe('string')
  })

  it('returns from and to for "yesterday"', () => {
    const range = getDateRange('yesterday')
    expect(range.from).toBeDefined()
    expect(range.to).toBeDefined()
  })

  it('returns from and to for "week"', () => {
    const range = getDateRange('week')
    const from = new Date(range.from)
    const to = new Date(range.to)
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThanOrEqual(6.5)
    expect(diffDays).toBeLessThanOrEqual(8)
  })

  it('returns from and to for "month"', () => {
    const range = getDateRange('month')
    const from = new Date(range.from)
    const to = new Date(range.to)
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThanOrEqual(27)
    expect(diffDays).toBeLessThanOrEqual(32)
  })
})
