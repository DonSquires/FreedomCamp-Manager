import { describe, expect, it } from 'vitest'
import {
  buildBobExecutionReview,
  evaluateEmergencyPriorityGate,
} from '@/lib/edgeFunctions'

describe('edgeFunctions emergency gate policy', () => {
  it('blocks explicit mutation contracts when emergency priority is active', () => {
    const result = evaluateEmergencyPriorityGate(
      { context: { emergencyPriorityActive: true } },
      'create_client_site_shift_bundle',
    )

    expect(result.active).toBe(true)
    expect(result.blocked).toBe(true)
    expect(result.reasonCode).toBe('emergency_priority_active')
  })

  it('keeps safety-first mode without blocking when no mutation contract is requested', () => {
    const result = evaluateEmergencyPriorityGate(
      { context: { danger_auto_assist_active: true } },
      null,
    )

    expect(result.active).toBe(true)
    expect(result.blocked).toBe(false)
    expect(result.reasonCode).toBe('emergency_priority_active')
  })
})

describe('edgeFunctions execution review payload', () => {
  it('includes deterministic reason-code and confidence metadata', () => {
    const executionReview = buildBobExecutionReview(
      {
        messages: [
          { role: 'user', content: 'create client site and shift now' },
        ],
        context: {
          currentRoute: '/bob-assistant',
          requested_mutation_contract: 'create_client_site_shift_bundle',
          emergencyPriorityActive: true,
          command_bus: { confidence: 0.83 },
        },
      },
      {
        mode: 'master_balanced',
        role: 'master',
        title: 'Master',
        requiresGuardrails: true,
        enforceSchemaCheck: true,
        enforceHardSections: true,
        showActionChecklist: true,
      } as any,
    )

    expect(executionReview.decisionReasonCodes).toContain('allowed_review_required')
    expect(executionReview.decisionReasonCodes).toContain('emergency_priority_active')
    expect(executionReview.confidence.composite).toBeGreaterThanOrEqual(0)
    expect(executionReview.confidence.composite).toBeLessThanOrEqual(1)
    expect(executionReview.emergencyGate?.blocked).toBe(true)
  })
})
