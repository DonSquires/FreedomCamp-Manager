import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSessionMock = vi.fn()
const edgeFunctionsStub = {
  checkNZSCVStatus: vi.fn(),
  enrichFromMotorWeb: vi.fn(),
  analyzeVehiclePhoto: vi.fn(),
  selectBestVehiclePhoto: vi.fn(),
  checkServicesHealth: vi.fn(),
}

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}))

vi.mock('./edgeFunctions', () => ({
  edgeFunctions: edgeFunctionsStub,
}))

describe('runBobAgentLoop', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('prefers the signed-in Supabase JWT for Authorization', async () => {
    vi.stubEnv('VITE_INFERENCE_SERVICE_URL', 'https://inference.example.com')
    vi.stubEnv('VITE_INFERENCE_API_KEY', 'env-api-key')
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'jwt-token-123',
        },
      },
      error: null,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, sessionId: 'session-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runBobAgentLoop } = await import('./inferenceService')
    const result = await runBobAgentLoop({ prompt: 'status check', user_id: 'user-1' })

    expect(result).toEqual({ success: true, sessionId: 'session-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://inference.example.com/bob/agent-loop',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer jwt-token-123',
        }),
      }),
    )

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers['x-inference-api-key']).toBeUndefined()
  })

  it('falls back to x-inference-api-key when no JWT is available', async () => {
    vi.stubEnv('VITE_INFERENCE_SERVICE_URL', 'https://inference.example.com')
    vi.stubEnv('VITE_INFERENCE_API_KEY', 'env-api-key')
    getSessionMock.mockResolvedValue({
      data: {
        session: null,
      },
      error: null,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, sessionId: 'session-2' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runBobAgentLoop } = await import('./inferenceService')
    await runBobAgentLoop({ prompt: 'status check', user_id: 'user-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://inference.example.com/bob/agent-loop',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-inference-api-key': 'env-api-key',
        }),
      }),
    )
  })

  it('surfaces server-side contract errors from the agent loop endpoint', async () => {
    vi.stubEnv('VITE_INFERENCE_SERVICE_URL', 'https://inference.example.com')
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'jwt-token-123',
        },
      },
      error: null,
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Access Denied: Cross-tenant operation detected.' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runBobAgentLoop } = await import('./inferenceService')

    await expect(runBobAgentLoop({ prompt: 'status check', user_id: 'user-1' })).rejects.toThrow(
      'Access Denied: Cross-tenant operation detected.',
    )
  })
})
