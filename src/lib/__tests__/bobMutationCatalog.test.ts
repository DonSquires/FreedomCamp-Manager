import { describe, expect, it } from 'vitest'
import {
  BOB_MUTATION_CATALOG,
  assertBobMutationAccess,
  getBobGatekeeperPolicyMatrix,
} from '@/lib/bobMutationCatalog'

describe('bobMutationCatalog getBobGatekeeperPolicyMatrix', () => {
  it('maps review-gated contracts to approval_gated class', () => {
    const matrix = getBobGatekeeperPolicyMatrix()
    const entry = matrix.find((item) => item.id === 'create_client_site_shift_bundle')

    expect(entry).toBeDefined()
    expect(entry?.approvalLevel).toBe('review')
    expect(entry?.emergencyPriorityBehavior).toBe('block')
    expect(entry?.governanceClass).toBe('approval_gated')
  })

  it('maps owner-only contracts to owner_gated class', () => {
    const matrix = getBobGatekeeperPolicyMatrix()
    const entry = matrix.find((item) => item.id === 'queue_bob_code_change_task')

    expect(entry).toBeDefined()
    expect(entry?.approvalLevel).toBe('owner_only')
    expect(entry?.governanceClass).toBe('owner_gated')
  })

  it('maps non-approval contracts to assistive_only class', () => {
    const matrix = getBobGatekeeperPolicyMatrix()
    const entry = matrix.find((item) => item.id === 'generate_dashboard_report')

    expect(entry).toBeDefined()
    expect(entry?.approvalLevel).toBe('none')
    expect(entry?.emergencyPriorityBehavior).toBe('allow')
    expect(entry?.governanceClass).toBe('assistive_only')
  })
})

describe('bobMutationCatalog assertBobMutationAccess', () => {
  it('limits emergency allowlist to non-administrative contracts', () => {
    const emergencyAllowedIds = BOB_MUTATION_CATALOG
      .filter((entry) => entry.emergencyPriorityBehavior === 'allow')
      .map((entry) => entry.id)
      .sort()

    expect(emergencyAllowedIds).toEqual([
      'email_dashboard_report',
      'generate_briefing_video',
      'generate_dashboard_report',
      'generate_tender_sections',
      'queue_bob_code_change_task',
      'queue_owner_research_task',
      'run_grandmaster_diagnostics',
    ])
  })

  it('returns deterministic unknown contract reason code', () => {
    const access = assertBobMutationAccess('not_a_real_contract', 'master_balanced')

    expect(access.allowed).toBe(false)
    expect(access.reasonCode).toBe('unknown_contract')
    expect(access.governanceClass).toBeNull()
  })

  it('returns deterministic mode_not_allowed reason code', () => {
    const access = assertBobMutationAccess('queue_bob_code_change_task', 'officer_assist')

    expect(access.allowed).toBe(false)
    expect(access.reasonCode).toBe('mode_not_allowed')
    expect(access.governanceClass).toBe('owner_gated')
  })

  it('returns allowed_review_required for review contracts in allowed mode', () => {
    const access = assertBobMutationAccess('create_client_site_shift_bundle', 'master_balanced')

    expect(access.allowed).toBe(true)
    expect(access.reasonCode).toBe('allowed_review_required')
    expect(access.governanceClass).toBe('approval_gated')
  })

  it('blocks provisioning contract in officer mode', () => {
    const access = assertBobMutationAccess('create_client_site_shift_bundle', 'officer_assist')

    expect(access.allowed).toBe(false)
    expect(access.reasonCode).toBe('mode_not_allowed')
    expect(access.governanceClass).toBe('approval_gated')
  })

  it('returns allowed_owner_required for owner-only contracts in owner mode', () => {
    const access = assertBobMutationAccess('queue_bob_code_change_task', 'owner_full')

    expect(access.allowed).toBe(true)
    expect(access.reasonCode).toBe('allowed_owner_required')
    expect(access.governanceClass).toBe('owner_gated')
  })

  it('returns allowed_assistive for assistive contracts in officer mode', () => {
    const access = assertBobMutationAccess('generate_dashboard_report', 'officer_assist')

    expect(access.allowed).toBe(true)
    expect(access.reasonCode).toBe('allowed_assistive')
    expect(access.governanceClass).toBe('assistive_only')
  })
})
