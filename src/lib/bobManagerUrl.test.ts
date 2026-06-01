import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getBobManagerUrl } from './bobManagerUrl'

describe('getBobManagerUrl', () => {
  const defaultOrigin = window.location.origin

  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.stubGlobal('window', {
      location: {
        origin: defaultOrigin,
      },
    })
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns normalized VITE_BOB_MANAGER_URL when provided', () => {
    vi.stubEnv('VITE_BOB_MANAGER_URL', '  https://manager.example.com/path///  ')

    expect(getBobManagerUrl()).toBe('https://manager.example.com/path')
  })

  it('falls back to normalized window.location.origin when env URL is empty', () => {
    vi.stubEnv('VITE_BOB_MANAGER_URL', '   ')
    vi.stubGlobal('window', {
      location: {
        origin: 'https://app.freedomcamp.nz///',
      },
    })

    expect(getBobManagerUrl()).toBe('https://app.freedomcamp.nz')
  })

  it('returns null when neither env URL nor window origin is available', () => {
    vi.stubEnv('VITE_BOB_MANAGER_URL', '')
    vi.stubGlobal('window', undefined)

    expect(getBobManagerUrl()).toBeNull()
  })
})
