import { describe, it, expect, beforeEach } from 'vitest'
import { useChatTargetStore } from '../chatTargetStore'

beforeEach(() => {
  useChatTargetStore.getState().reset()
})

// ── initial state ─────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('defaults to the admin target', () => {
    expect(useChatTargetStore.getState().target).toEqual({ type: 'admin' })
  })
})

// ── setTarget ─────────────────────────────────────────────────────────────────

describe('setTarget', () => {
  it('sets the target to admin', () => {
    useChatTargetStore.getState().setTarget({ type: 'admin' })
    expect(useChatTargetStore.getState().target).toEqual({ type: 'admin' })
  })

  it('sets the target to a specific user', () => {
    const userTarget = {
      type: 'user' as const,
      user: {
        id: 'user-1',
        first_name: 'Jane',
        last_name: 'Smith',
        role: 'officer',
        organization_id: 'org-1',
      },
    }
    useChatTargetStore.getState().setTarget(userTarget)
    expect(useChatTargetStore.getState().target).toEqual(userTarget)
  })

  it('preserves the full user object including organization_id', () => {
    const userTarget = {
      type: 'user' as const,
      user: {
        id: 'user-2',
        first_name: 'Bob',
        last_name: 'Jones',
        role: 'admin',
        organization_id: null,
      },
    }
    useChatTargetStore.getState().setTarget(userTarget)
    const stored = useChatTargetStore.getState().target
    expect(stored).toEqual(userTarget)
  })

  it('can switch from user target back to admin target', () => {
    useChatTargetStore.getState().setTarget({
      type: 'user',
      user: { id: 'u1', first_name: 'A', last_name: 'B', role: 'officer', organization_id: 'org-1' },
    })
    useChatTargetStore.getState().setTarget({ type: 'admin' })
    expect(useChatTargetStore.getState().target).toEqual({ type: 'admin' })
  })
})

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('reverts to the admin target', () => {
    useChatTargetStore.getState().setTarget({
      type: 'user',
      user: { id: 'u1', first_name: 'X', last_name: 'Y', role: 'officer', organization_id: null },
    })
    useChatTargetStore.getState().reset()
    expect(useChatTargetStore.getState().target).toEqual({ type: 'admin' })
  })
})
