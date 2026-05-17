import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsertSpy = vi.fn(async () => ({ error: null }))

vi.mock('@/lib/supabase', () => {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(async () => ({ data: [], error: null })),
    insert: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: { id: 'mock-id' }, error: null })),
    upsert: upsertSpy,
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
  }

  return {
    supabase: {
      from: vi.fn(() => chain),
    },
  }
})

describe('executeAdministrativeActuation', () => {
  beforeEach(() => {
    upsertSpy.mockClear()
  })

  it('returns null for non-actuation text', async () => {
    const { executeAdministrativeActuation } = await import('@/lib/bob-brain')

    const result = await executeAdministrativeActuation({
      text: 'what is the weather today',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      emergencyPriorityActive: false,
      executionMode: 'master_balanced',
    })

    expect(result).toBeNull()
  })

  it('asks for clarification when required fields are missing', async () => {
    const { executeAdministrativeActuation } = await import('@/lib/bob-brain')

    const result = await executeAdministrativeActuation({
      text: 'create new client site',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      emergencyPriorityActive: false,
      executionMode: 'master_balanced',
    })

    expect(result?.status).toBe('needs_clarification')
    if (result?.status === 'needs_clarification') {
      expect(result.missingFields.length).toBeGreaterThan(0)
      expect(result.question.length).toBeGreaterThan(5)
    }
  })

  it('blocks when emergency priority is active', async () => {
    const { executeAdministrativeActuation } = await import('@/lib/bob-brain')

    const result = await executeAdministrativeActuation({
      text: 'create client "Harbor" at 12 Marine Rd start at 7am',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      emergencyPriorityActive: true,
      executionMode: 'master_balanced',
    })

    expect(result?.status).toBe('blocked')
  })

  it('blocks provisioning when execution mode is not allowed', async () => {
    const { executeAdministrativeActuation } = await import('@/lib/bob-brain')

    const result = await executeAdministrativeActuation({
      text: 'create client "Harbor" at 12 Marine Rd start at 7am',
      organizationId: 'org-1',
      actorUserId: 'user-1',
      emergencyPriorityActive: false,
      executionMode: 'officer_assist',
    })

    expect(result?.status).toBe('blocked')
    if (result?.status === 'blocked') {
      expect(result.reason).toContain('governance contract')
    }
  })
})
