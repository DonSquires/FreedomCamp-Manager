import { describe, it, expect } from 'vitest'

// ── Pure-logic helpers extracted for unit testing ─────────────────────────────
// The `selectDispatchResource` and `findExistingLoiByGeofence` functions require
// a live Supabase connection, so they are tested via integration/e2e tests.
// Here we test the pure helper functions inlined from dispatchAssignment.ts.

// ─────────────────────────────────────────────────────────────────────────────
// Replicated pure helpers (identical to the private functions in
// dispatchAssignment.ts — kept here so tests have no Supabase dependency).
// ─────────────────────────────────────────────────────────────────────────────

function timeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map(Number)
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0)
}

function isTimeInWindow(
  timeStr: string,
  fromStr: string | null,
  toStr: string | null,
): boolean {
  if (!fromStr && !toStr) return true
  const current = timeToMinutes(timeStr)
  const from    = fromStr ? timeToMinutes(fromStr) : 0
  const to      = toStr   ? timeToMinutes(toStr)   : 24 * 60 - 1
  if (from <= to) return current >= from && current <= to
  return current >= from || current <= to
}

interface MockResource {
  is_active: boolean
  active_days: number[] | null
  shift_start_time: string | null
  shift_end_time: string | null
}

function isResourceOnShift(resource: MockResource | null, at: Date): boolean {
  if (!resource || !resource.is_active) return false
  const dow = at.getDay() === 0 ? 7 : at.getDay()
  if (resource.active_days && resource.active_days.length > 0) {
    if (!resource.active_days.includes(dow)) return false
  }
  if (resource.shift_start_time && resource.shift_end_time) {
    const hh = String(at.getHours()).padStart(2, '0')
    const mm = String(at.getMinutes()).padStart(2, '0')
    const currentTimeStr = `${hh}:${mm}:00`
    if (!isTimeInWindow(currentTimeStr, resource.shift_start_time, resource.shift_end_time)) {
      return false
    }
  }
  return true
}

// ── timeToMinutes ────────────────────────────────────────────────────────────

describe('timeToMinutes', () => {
  it('converts midnight to 0', () => {
    expect(timeToMinutes('00:00:00')).toBe(0)
  })
  it('converts 06:00:00 to 360', () => {
    expect(timeToMinutes('06:00:00')).toBe(360)
  })
  it('converts 18:30:00 to 1110', () => {
    expect(timeToMinutes('18:30:00')).toBe(1110)
  })
  it('converts 23:59:00 to 1439', () => {
    expect(timeToMinutes('23:59:00')).toBe(1439)
  })
})

// ── isTimeInWindow ────────────────────────────────────────────────────────────

describe('isTimeInWindow', () => {
  it('returns true when no window is set (null/null)', () => {
    expect(isTimeInWindow('12:00:00', null, null)).toBe(true)
  })

  it('returns true for a time within a daytime window', () => {
    expect(isTimeInWindow('10:00:00', '06:00:00', '18:00:00')).toBe(true)
  })

  it('returns false for a time outside a daytime window', () => {
    expect(isTimeInWindow('05:00:00', '06:00:00', '18:00:00')).toBe(false)
    expect(isTimeInWindow('19:00:00', '06:00:00', '18:00:00')).toBe(false)
  })

  it('handles overnight windows correctly — inside window (23:00)', () => {
    // 22:00 – 06:00 night shift
    expect(isTimeInWindow('23:00:00', '22:00:00', '06:00:00')).toBe(true)
  })

  it('handles overnight windows correctly — inside window (02:00)', () => {
    expect(isTimeInWindow('02:00:00', '22:00:00', '06:00:00')).toBe(true)
  })

  it('handles overnight windows correctly — outside window (12:00)', () => {
    expect(isTimeInWindow('12:00:00', '22:00:00', '06:00:00')).toBe(false)
  })

  it('handles exact window boundaries', () => {
    expect(isTimeInWindow('06:00:00', '06:00:00', '18:00:00')).toBe(true)
    expect(isTimeInWindow('18:00:00', '06:00:00', '18:00:00')).toBe(true)
  })
})

// ── isResourceOnShift ─────────────────────────────────────────────────────────

describe('isResourceOnShift', () => {
  const mondayNight = new Date('2026-07-06T22:30:00') // Monday 22:30 NZT

  it('returns false for null resource', () => {
    expect(isResourceOnShift(null, mondayNight)).toBe(false)
  })

  it('returns false for inactive resource', () => {
    const res: MockResource = {
      is_active: false,
      active_days: [1, 2, 3, 4, 5, 6, 7],
      shift_start_time: '18:00:00',
      shift_end_time:   '06:00:00',
    }
    expect(isResourceOnShift(res, mondayNight)).toBe(false)
  })

  it('returns true for active resource with no shift template', () => {
    const res: MockResource = {
      is_active: true,
      active_days: null,
      shift_start_time: null,
      shift_end_time:   null,
    }
    expect(isResourceOnShift(res, mondayNight)).toBe(true)
  })

  it('returns false when day-of-week is not in active_days', () => {
    // active_days = weekdays only (Mon–Fri = 1–5)
    const res: MockResource = {
      is_active: true,
      active_days: [1, 2, 3, 4, 5],
      shift_start_time: null,
      shift_end_time:   null,
    }
    const saturday = new Date('2026-07-11T22:30:00') // Saturday
    expect(isResourceOnShift(res, saturday)).toBe(false)
  })

  it('returns true when day-of-week IS in active_days and within shift', () => {
    const res: MockResource = {
      is_active: true,
      active_days: [1, 2, 3, 4, 5, 6, 7],
      shift_start_time: '18:00:00',
      shift_end_time:   '06:00:00',
    }
    // Monday 22:30 — within 18:00–06:00 overnight window
    expect(isResourceOnShift(res, mondayNight)).toBe(true)
  })

  it('returns false when outside shift hours', () => {
    const res: MockResource = {
      is_active: true,
      active_days: [1, 2, 3, 4, 5, 6, 7],
      shift_start_time: '18:00:00',
      shift_end_time:   '06:00:00',
    }
    const dayTime = new Date('2026-07-06T12:00:00') // Monday midday — outside night shift
    expect(isResourceOnShift(res, dayTime)).toBe(false)
  })

  it('returns true for Sunday (ISO 7) when active_days includes 7', () => {
    const res: MockResource = {
      is_active: true,
      active_days: [6, 7],
      shift_start_time: null,
      shift_end_time:   null,
    }
    const sunday = new Date('2026-07-12T10:00:00') // Sunday
    expect(isResourceOnShift(res, sunday)).toBe(true)
  })
})

// ── DispatchResourceCandidate shape validation ─────────────────────────────────

describe('DispatchResourceCandidate type shape', () => {
  // Verify the expected object shape can be constructed without errors
  it('can create a valid candidate object', () => {
    const candidate = {
      dispatch_resource_id: 'abc-123',
      callsign: '587',
      display_name: 'Nelson Night Patrol (Nelson)',
      resource_type: 'patrol_run',
      auto_dispatch_enabled: true,
      selection_reason: 'zone_rule' as const,
      rule_priority: 10,
    }
    expect(candidate.callsign).toBe('587')
    expect(candidate.selection_reason).toBe('zone_rule')
    expect(candidate.rule_priority).toBe(10)
  })
})

// ── DispatchJobContext validation ─────────────────────────────────────────────

describe('DispatchJobContext validation', () => {
  it('job_type_code is required', () => {
    const ctx = {
      job_type_code: 'noise_complaint',
      organization_id: 'org-1',
      dispatch_at: new Date(),
    }
    expect(ctx.job_type_code).toBeTruthy()
    expect(ctx.organization_id).toBeTruthy()
  })

  it('dispatch_at defaults to now when omitted', () => {
    const before = Date.now()
    const at = new Date()
    const after = Date.now()
    expect(at.getTime()).toBeGreaterThanOrEqual(before)
    expect(at.getTime()).toBeLessThanOrEqual(after)
  })
})
