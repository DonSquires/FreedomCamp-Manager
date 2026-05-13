import { describe, expect, it, vi, afterEach } from 'vitest'
import { toUserFacingError } from '../userFacingError'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('toUserFacingError', () => {
  it('maps row-level security errors to a permission-safe message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(
      toUserFacingError(
        { code: '42501', message: 'new row violates row-level security policy for table incidents' },
        'Failed to create incident',
      ),
    ).toBe('You do not have permission to perform this action.')
  })

  it('maps network failures to a generic retry message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(
      toUserFacingError({ message: 'TypeError: Failed to fetch' }, 'Scan failed — please try again'),
    ).toBe('Network connection failed. Please try again.')
  })

  it('maps duplicate constraint failures to a safe message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(
      toUserFacingError({ code: '23505', message: 'duplicate key value violates unique constraint' }, 'Save failed'),
    ).toBe('This record already exists.')
  })

  it('falls back when the error does not match a known pattern', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(toUserFacingError({ message: 'unexpected backend condition' }, 'Manual entry failed')).toBe('Manual entry failed')
  })
})