import { vi, describe, expect, it, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'insert', 'eq', 'order', 'limit']
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain)
  })
  // Simulate fire-and-forget .then() on insert
  ;(chain as any).then = vi.fn((cb: (v: { error: null }) => void) => {
    cb({ error: null })
    return Promise.resolve()
  })
  return { supabase: { from: vi.fn(() => chain) } }
})

import { ReasoningService } from '@/lib/bobReasoningService'

describe('ReasoningService formHypothesis', () => {
  let svc: ReasoningService

  beforeEach(() => {
    svc = new ReasoningService('org-test-1')
  })

  it('calculates confidence as forWeight / totalWeight', async () => {
    const r = await svc.formHypothesis(
      'conv-1',
      'Vehicle previously breached',
      [{ text: 'Match found', weight: 0.8 }],
      [{ text: 'Different owner', weight: 0.2 }],
    )
    expect(r.confidence).toBeCloseTo(0.8)
  })

  it('returns 0.5 confidence when no evidence provided', async () => {
    const r = await svc.formHypothesis('conv-2', 'No evidence scenario', [], [])
    expect(r.confidence).toBe(0.5)
  })

  it('returns confidence of 1 when there is only supporting evidence', async () => {
    const r = await svc.formHypothesis(
      'conv-3',
      'Confirmed breach',
      [{ text: 'Strong evidence', weight: 0.9 }],
    )
    expect(r.confidence).toBeCloseTo(1.0)
  })

  it('requires approval when confidence is below 0.8', async () => {
    const r = await svc.formHypothesis(
      'conv-4',
      'Weak case',
      [{ text: 'Weak signal', weight: 0.3 }],
      [{ text: 'Counterevidence', weight: 0.7 }],
    )
    expect(r.requiresApproval).toBe(true)
  })

  it('does NOT require approval when confidence is exactly 0.8', async () => {
    const r = await svc.formHypothesis(
      'conv-5',
      'Strong case',
      [{ text: 'Clear match', weight: 0.8 }],
      [{ text: 'Weak counter', weight: 0.2 }],
    )
    expect(r.requiresApproval).toBe(false)
  })

  it('populates all required fields', async () => {
    const r = await svc.formHypothesis(
      'conv-6',
      'Test hypothesis',
      [{ text: 'Evidence A', weight: 0.6 }],
    )
    expect(r.id).toMatch(/^reasoning_/)
    expect(r.conversationId).toBe('conv-6')
    expect(r.hypothesis).toBe('Test hypothesis')
    expect(r.approvalThreshold).toBe(0.8)
    expect(r.createdAt).toBeInstanceOf(Date)
  })
})

describe('ReasoningService updateEvidence', () => {
  let svc: ReasoningService

  beforeEach(() => {
    svc = new ReasoningService('org-test-1')
  })

  it('recalculates confidence after adding supporting evidence', async () => {
    const r = await svc.formHypothesis(
      'conv-7',
      'Initial',
      [{ text: 'Initial evidence', weight: 0.5 }],
    )
    expect(r.confidence).toBeCloseTo(1.0)

    const updated = await svc.updateEvidence(r, [
      { text: 'New counter', weight: 0.5, supportingHypothesis: false },
    ])
    expect(updated.confidence).toBeCloseTo(0.5)
  })

  it('clamps confidence to [0, 1]', async () => {
    const r = await svc.formHypothesis('conv-8', 'Test', [])
    const updated = await svc.updateEvidence(r, [
      { text: 'High weight against', weight: 9999, supportingHypothesis: false },
    ])
    expect(updated.confidence).toBeGreaterThanOrEqual(0)
    expect(updated.confidence).toBeLessThanOrEqual(1)
  })
})

describe('ReasoningService validateTransition', () => {
  const svc = new ReasoningService('org-test-1')

  it('allows reasoning → pending_approval', () => {
    expect(svc.validateTransition('reasoning', 'pending_approval')).toBe(true)
  })

  it('allows reasoning → reasoning (self-loop)', () => {
    expect(svc.validateTransition('reasoning', 'reasoning')).toBe(true)
  })

  it('denies reasoning → executed', () => {
    expect(svc.validateTransition('reasoning', 'executed')).toBe(false)
  })

  it('allows pending_approval → approved', () => {
    expect(svc.validateTransition('pending_approval', 'approved')).toBe(true)
  })

  it('allows pending_approval → rejected', () => {
    expect(svc.validateTransition('pending_approval', 'rejected')).toBe(true)
  })

  it('denies approved → reasoning', () => {
    expect(svc.validateTransition('approved', 'reasoning')).toBe(false)
  })

  it('allows approved → executed', () => {
    expect(svc.validateTransition('approved', 'executed')).toBe(true)
  })

  it('denies executed → any other state', () => {
    expect(svc.validateTransition('executed', 'approved')).toBe(false)
    expect(svc.validateTransition('executed', 'reasoning')).toBe(false)
  })

  it('allows rejected → reasoning (restart)', () => {
    expect(svc.validateTransition('rejected', 'reasoning')).toBe(true)
  })
})

describe('ReasoningService approveGate', () => {
  let svc: ReasoningService

  beforeEach(() => {
    svc = new ReasoningService('org-test-1')
  })

  it('approves gate for a valid role', async () => {
    const gate = await svc.requestApproval('r-1', 'create_infringement', ['admin', 'master'])
    const approved = await svc.approveGate(gate, 'user-123', 'admin', 'Looks good')
    expect(approved.status).toBe('approved')
    expect(approved.approvedBy).toBe('user-123')
    expect(approved.approvalReason).toBe('Looks good')
  })

  it('throws when approver role is not in required roles', async () => {
    const gate = await svc.requestApproval('r-2', 'escalate_breach', ['master', 'grand_master'])
    await expect(svc.approveGate(gate, 'user-456', 'admin', 'Trying to approve')).rejects.toThrow(/not authorized/)
  })
})

describe('ReasoningService executeAction', () => {
  let svc: ReasoningService

  beforeEach(() => {
    svc = new ReasoningService('org-test-1')
  })

  it('throws when gate status is not approved', async () => {
    const gate = await svc.requestApproval('r-3', 'schedule_revisit')
    await expect(svc.executeAction(gate, { note: 'test' })).rejects.toThrow(/Cannot execute action/)
  })

  it('executes successfully for an approved gate', async () => {
    const gate = await svc.requestApproval('r-4', 'create_infringement', ['admin'])
    const approved = await svc.approveGate(gate, 'user-789', 'admin', 'Approved')
    await expect(svc.executeAction(approved, { infringementType: 'parking' })).resolves.toBeUndefined()
  })
})

describe('ReasoningService rejectGate', () => {
  let svc: ReasoningService

  beforeEach(() => {
    svc = new ReasoningService('org-test-1')
  })

  it('sets gate status to rejected', async () => {
    const gate = await svc.requestApproval('r-5', 'create_infringement', ['admin'])
    const rejected = await svc.rejectGate(gate, 'user-admin', 'Insufficient evidence')
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectionReason).toBe('Insufficient evidence')
  })
})

describe('ReasoningService escalateGate', () => {
  let svc: ReasoningService

  beforeEach(() => {
    svc = new ReasoningService('org-test-1')
  })

  it('sets gate status to escalated', async () => {
    const gate = await svc.requestApproval('r-6', 'create_infringement', ['admin'])
    const escalated = await svc.escalateGate(gate, 'Conflicting evidence — escalating')
    expect(escalated.status).toBe('escalated')
    expect(escalated.escalationReason).toBe('Conflicting evidence — escalating')
  })
})
