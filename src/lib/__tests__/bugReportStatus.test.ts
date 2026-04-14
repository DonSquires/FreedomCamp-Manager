import { describe, it, expect } from 'vitest'
import {
  BUG_REPORT_STATUSES,
  NON_TERMINAL_BUG_REPORT_STATUSES,
  TERMINAL_BUG_REPORT_STATUSES,
  isKnownBugReportStatus,
  isTerminalBugReportStatus,
  nextStatusAfterAnalysis,
  shouldAutoAcknowledge,
} from '../bugReportStatus'

// ── BUG_REPORT_STATUSES ─────────────────────────────────────────────────────

describe('BUG_REPORT_STATUSES', () => {
  it('contains all expected statuses', () => {
    expect(BUG_REPORT_STATUSES).toContain('submitted')
    expect(BUG_REPORT_STATUSES).toContain('acknowledged')
    expect(BUG_REPORT_STATUSES).toContain('investigating')
    expect(BUG_REPORT_STATUSES).toContain('in_progress')
    expect(BUG_REPORT_STATUSES).toContain('resolved')
    expect(BUG_REPORT_STATUSES).toContain('closed')
    expect(BUG_REPORT_STATUSES).toContain('wont_fix')
    expect(BUG_REPORT_STATUSES).toContain('duplicate')
  })

  it('has 8 total statuses', () => {
    expect(BUG_REPORT_STATUSES).toHaveLength(8)
  })
})

// ── NON_TERMINAL_BUG_REPORT_STATUSES ────────────────────────────────────────

describe('NON_TERMINAL_BUG_REPORT_STATUSES', () => {
  it('contains the 4 non-terminal statuses', () => {
    expect(NON_TERMINAL_BUG_REPORT_STATUSES).toContain('submitted')
    expect(NON_TERMINAL_BUG_REPORT_STATUSES).toContain('acknowledged')
    expect(NON_TERMINAL_BUG_REPORT_STATUSES).toContain('investigating')
    expect(NON_TERMINAL_BUG_REPORT_STATUSES).toContain('in_progress')
  })

  it('has 4 non-terminal statuses', () => {
    expect(NON_TERMINAL_BUG_REPORT_STATUSES).toHaveLength(4)
  })

  it('does not contain terminal statuses', () => {
    expect(NON_TERMINAL_BUG_REPORT_STATUSES).not.toContain('resolved')
    expect(NON_TERMINAL_BUG_REPORT_STATUSES).not.toContain('closed')
    expect(NON_TERMINAL_BUG_REPORT_STATUSES).not.toContain('wont_fix')
    expect(NON_TERMINAL_BUG_REPORT_STATUSES).not.toContain('duplicate')
  })
})

// ── TERMINAL_BUG_REPORT_STATUSES ────────────────────────────────────────────

describe('TERMINAL_BUG_REPORT_STATUSES', () => {
  it('contains the 4 terminal statuses', () => {
    expect(TERMINAL_BUG_REPORT_STATUSES).toContain('resolved')
    expect(TERMINAL_BUG_REPORT_STATUSES).toContain('closed')
    expect(TERMINAL_BUG_REPORT_STATUSES).toContain('wont_fix')
    expect(TERMINAL_BUG_REPORT_STATUSES).toContain('duplicate')
  })

  it('has 4 terminal statuses', () => {
    expect(TERMINAL_BUG_REPORT_STATUSES).toHaveLength(4)
  })

  it('does not contain non-terminal statuses', () => {
    expect(TERMINAL_BUG_REPORT_STATUSES).not.toContain('submitted')
    expect(TERMINAL_BUG_REPORT_STATUSES).not.toContain('acknowledged')
    expect(TERMINAL_BUG_REPORT_STATUSES).not.toContain('investigating')
    expect(TERMINAL_BUG_REPORT_STATUSES).not.toContain('in_progress')
  })
})

// ── isKnownBugReportStatus ──────────────────────────────────────────────────

describe('isKnownBugReportStatus', () => {
  it('returns true for all known non-terminal statuses', () => {
    expect(isKnownBugReportStatus('submitted')).toBe(true)
    expect(isKnownBugReportStatus('acknowledged')).toBe(true)
    expect(isKnownBugReportStatus('investigating')).toBe(true)
    expect(isKnownBugReportStatus('in_progress')).toBe(true)
  })

  it('returns true for all known terminal statuses', () => {
    expect(isKnownBugReportStatus('resolved')).toBe(true)
    expect(isKnownBugReportStatus('closed')).toBe(true)
    expect(isKnownBugReportStatus('wont_fix')).toBe(true)
    expect(isKnownBugReportStatus('duplicate')).toBe(true)
  })

  it('returns false for unknown strings', () => {
    expect(isKnownBugReportStatus('open')).toBe(false)
    expect(isKnownBugReportStatus('unknown')).toBe(false)
    expect(isKnownBugReportStatus('')).toBe(false)
  })

  it('returns false for non-string values', () => {
    expect(isKnownBugReportStatus(null)).toBe(false)
    expect(isKnownBugReportStatus(undefined)).toBe(false)
    expect(isKnownBugReportStatus(42)).toBe(false)
    expect(isKnownBugReportStatus({})).toBe(false)
  })
})

// ── isTerminalBugReportStatus ───────────────────────────────────────────────

describe('isTerminalBugReportStatus', () => {
  it('returns true for terminal statuses', () => {
    expect(isTerminalBugReportStatus('resolved')).toBe(true)
    expect(isTerminalBugReportStatus('closed')).toBe(true)
    expect(isTerminalBugReportStatus('wont_fix')).toBe(true)
    expect(isTerminalBugReportStatus('duplicate')).toBe(true)
  })

  it('returns false for non-terminal statuses', () => {
    expect(isTerminalBugReportStatus('submitted')).toBe(false)
    expect(isTerminalBugReportStatus('acknowledged')).toBe(false)
    expect(isTerminalBugReportStatus('investigating')).toBe(false)
    expect(isTerminalBugReportStatus('in_progress')).toBe(false)
  })

  it('returns false for unknown values', () => {
    expect(isTerminalBugReportStatus('open')).toBe(false)
    expect(isTerminalBugReportStatus('')).toBe(false)
    expect(isTerminalBugReportStatus(null)).toBe(false)
    expect(isTerminalBugReportStatus(undefined)).toBe(false)
  })
})

// ── nextStatusAfterAnalysis ─────────────────────────────────────────────────

describe('nextStatusAfterAnalysis', () => {
  it('returns "investigating" for non-terminal statuses', () => {
    expect(nextStatusAfterAnalysis('submitted')).toBe('investigating')
    expect(nextStatusAfterAnalysis('acknowledged')).toBe('investigating')
    expect(nextStatusAfterAnalysis('investigating')).toBe('investigating')
    expect(nextStatusAfterAnalysis('in_progress')).toBe('investigating')
  })

  it('returns the same status for terminal statuses (no regression)', () => {
    expect(nextStatusAfterAnalysis('resolved')).toBe('resolved')
    expect(nextStatusAfterAnalysis('closed')).toBe('closed')
    expect(nextStatusAfterAnalysis('wont_fix')).toBe('wont_fix')
    expect(nextStatusAfterAnalysis('duplicate')).toBe('duplicate')
  })

  it('returns "investigating" for null', () => {
    expect(nextStatusAfterAnalysis(null)).toBe('investigating')
  })

  it('returns "investigating" for undefined', () => {
    expect(nextStatusAfterAnalysis(undefined)).toBe('investigating')
  })

  it('returns "investigating" for unknown status strings', () => {
    expect(nextStatusAfterAnalysis('open')).toBe('investigating')
    expect(nextStatusAfterAnalysis('')).toBe('investigating')
  })
})

// ── shouldAutoAcknowledge ───────────────────────────────────────────────────

describe('shouldAutoAcknowledge', () => {
  it('returns true when status is "submitted"', () => {
    expect(shouldAutoAcknowledge('submitted')).toBe(true)
  })

  it('returns true when status is null (new report)', () => {
    expect(shouldAutoAcknowledge(null)).toBe(true)
  })

  it('returns true when status is undefined', () => {
    expect(shouldAutoAcknowledge(undefined)).toBe(true)
  })

  it('returns true when status is empty string', () => {
    expect(shouldAutoAcknowledge('')).toBe(true)
  })

  it('returns false for already-acknowledged reports', () => {
    expect(shouldAutoAcknowledge('acknowledged')).toBe(false)
    expect(shouldAutoAcknowledge('investigating')).toBe(false)
    expect(shouldAutoAcknowledge('in_progress')).toBe(false)
  })

  it('returns false for terminal statuses', () => {
    expect(shouldAutoAcknowledge('resolved')).toBe(false)
    expect(shouldAutoAcknowledge('closed')).toBe(false)
    expect(shouldAutoAcknowledge('wont_fix')).toBe(false)
    expect(shouldAutoAcknowledge('duplicate')).toBe(false)
  })
})
