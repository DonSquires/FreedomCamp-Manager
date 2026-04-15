import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionLockStore } from '../sessionLockStore'

const DEFAULT_TITLE = 'Session Timed Out'
const DEFAULT_MESSAGE =
  'For security, this workspace has been locked. Log back in to continue or sign out completely.'

beforeEach(() => {
  // Reset store to pristine state between tests
  useSessionLockStore.setState({
    isLocked: false,
    isWarningVisible: false,
    warningSecondsRemaining: 60,
    title: DEFAULT_TITLE,
    message: DEFAULT_MESSAGE,
  })
})

// ── initial state ─────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('is not locked', () => {
    expect(useSessionLockStore.getState().isLocked).toBe(false)
  })

  it('has no warning visible', () => {
    expect(useSessionLockStore.getState().isWarningVisible).toBe(false)
  })

  it('has 60 seconds remaining by default', () => {
    expect(useSessionLockStore.getState().warningSecondsRemaining).toBe(60)
  })

  it('has the default title and message', () => {
    const state = useSessionLockStore.getState()
    expect(state.title).toBe(DEFAULT_TITLE)
    expect(state.message).toBe(DEFAULT_MESSAGE)
  })
})

// ── lock ──────────────────────────────────────────────────────────────────────

describe('lock', () => {
  it('sets isLocked to true', () => {
    useSessionLockStore.getState().lock()
    expect(useSessionLockStore.getState().isLocked).toBe(true)
  })

  it('hides the warning when locking', () => {
    useSessionLockStore.setState({ isWarningVisible: true })
    useSessionLockStore.getState().lock()
    expect(useSessionLockStore.getState().isWarningVisible).toBe(false)
  })

  it('uses default title and message when none provided', () => {
    useSessionLockStore.getState().lock()
    const state = useSessionLockStore.getState()
    expect(state.title).toBe(DEFAULT_TITLE)
    expect(state.message).toBe(DEFAULT_MESSAGE)
  })

  it('accepts a custom title and message', () => {
    useSessionLockStore.getState().lock('Admin Lock', 'Locked by admin.')
    const state = useSessionLockStore.getState()
    expect(state.title).toBe('Admin Lock')
    expect(state.message).toBe('Locked by admin.')
  })
})

// ── unlock ────────────────────────────────────────────────────────────────────

describe('unlock', () => {
  it('sets isLocked to false', () => {
    useSessionLockStore.setState({ isLocked: true })
    useSessionLockStore.getState().unlock()
    expect(useSessionLockStore.getState().isLocked).toBe(false)
  })

  it('hides the warning', () => {
    useSessionLockStore.setState({ isWarningVisible: true })
    useSessionLockStore.getState().unlock()
    expect(useSessionLockStore.getState().isWarningVisible).toBe(false)
  })

  it('resets warningSecondsRemaining to 60', () => {
    useSessionLockStore.setState({ warningSecondsRemaining: 5 })
    useSessionLockStore.getState().unlock()
    expect(useSessionLockStore.getState().warningSecondsRemaining).toBe(60)
  })

  it('resets title and message to defaults', () => {
    useSessionLockStore.getState().lock('Custom', 'Custom msg')
    useSessionLockStore.getState().unlock()
    const state = useSessionLockStore.getState()
    expect(state.title).toBe(DEFAULT_TITLE)
    expect(state.message).toBe(DEFAULT_MESSAGE)
  })
})

// ── showWarning ───────────────────────────────────────────────────────────────

describe('showWarning', () => {
  it('sets isWarningVisible to true', () => {
    useSessionLockStore.getState().showWarning(30)
    expect(useSessionLockStore.getState().isWarningVisible).toBe(true)
  })

  it('stores the seconds remaining', () => {
    useSessionLockStore.getState().showWarning(45)
    expect(useSessionLockStore.getState().warningSecondsRemaining).toBe(45)
  })

  it('clamps seconds remaining to at least 1', () => {
    useSessionLockStore.getState().showWarning(0)
    expect(useSessionLockStore.getState().warningSecondsRemaining).toBe(1)
  })

  it('clamps negative seconds to at least 1', () => {
    useSessionLockStore.getState().showWarning(-5)
    expect(useSessionLockStore.getState().warningSecondsRemaining).toBe(1)
  })
})

// ── updateWarningSeconds ──────────────────────────────────────────────────────

describe('updateWarningSeconds', () => {
  it('updates the countdown value', () => {
    useSessionLockStore.getState().updateWarningSeconds(20)
    expect(useSessionLockStore.getState().warningSecondsRemaining).toBe(20)
  })

  it('clamps to 0 (allows reaching zero)', () => {
    useSessionLockStore.getState().updateWarningSeconds(0)
    expect(useSessionLockStore.getState().warningSecondsRemaining).toBe(0)
  })

  it('clamps negative values to 0', () => {
    useSessionLockStore.getState().updateWarningSeconds(-1)
    expect(useSessionLockStore.getState().warningSecondsRemaining).toBe(0)
  })
})

// ── clearWarning ──────────────────────────────────────────────────────────────

describe('clearWarning', () => {
  it('hides the warning', () => {
    useSessionLockStore.setState({ isWarningVisible: true })
    useSessionLockStore.getState().clearWarning()
    expect(useSessionLockStore.getState().isWarningVisible).toBe(false)
  })

  it('resets warningSecondsRemaining to 60', () => {
    useSessionLockStore.setState({ warningSecondsRemaining: 10 })
    useSessionLockStore.getState().clearWarning()
    expect(useSessionLockStore.getState().warningSecondsRemaining).toBe(60)
  })
})
