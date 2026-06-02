import { describe, expect, it } from 'vitest'
import {
  BOB_MUTATION_CATALOG,
  assertBobMutationAccess,
  findBobMutationContractsForText,
  getBobGatekeeperPolicyMatrix,
  getBobGatekeeperPolicySummary,
  getBobMutationCatalogEntry,
  getBobMutationCatalogSummary,
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

describe('bobMutationCatalog getBobMutationCatalogSummary', () => {
  it('returns a non-empty formatted string', () => {
    const summary = getBobMutationCatalogSummary()
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toContain('->')
    expect(summary).toContain('writes:')
    expect(summary).toContain('approval:')
  })

  it('respects the limit parameter', () => {
    const twoLines = getBobMutationCatalogSummary(2)
    expect(twoLines.split('\n')).toHaveLength(2)
  })

  it('defaults to 9 entries', () => {
    const summary = getBobMutationCatalogSummary()
    const lines = summary.split('\n')
    expect(lines).toHaveLength(Math.min(9, BOB_MUTATION_CATALOG.length))
  })
})

describe('bobMutationCatalog getBobMutationCatalogEntry', () => {
  it('returns the matching catalog entry by id', () => {
    const entry = getBobMutationCatalogEntry('generate_dashboard_report')
    expect(entry).not.toBeNull()
    expect(entry?.id).toBe('generate_dashboard_report')
    expect(entry?.approvalLevel).toBe('none')
  })

  it('returns null for an unknown contract id', () => {
    expect(getBobMutationCatalogEntry('totally_unknown_contract')).toBeNull()
  })

  it('returns the owner_only entry correctly', () => {
    const entry = getBobMutationCatalogEntry('queue_bob_code_change_task')
    expect(entry).not.toBeNull()
    expect(entry?.approvalLevel).toBe('owner_only')
  })
})

describe('bobMutationCatalog findBobMutationContractsForText', () => {
  it('finds contracts by keyword in text', () => {
    const ids = findBobMutationContractsForText('I need to generate a dashboard report')
    expect(ids).toContain('generate_dashboard_report')
  })

  it('finds import contract when text contains "import data"', () => {
    const ids = findBobMutationContractsForText('bulk import data from the file')
    expect(ids).toContain('import_data_file')
  })

  it('includes seed contract ids in output', () => {
    const ids = findBobMutationContractsForText('unrelated text', ['create_user_account'])
    expect(ids).toContain('create_user_account')
  })

  it('deduplicates when seed and keyword match same contract', () => {
    const ids = findBobMutationContractsForText('tender document processing', ['process_tender_document'])
    const count = ids.filter((id) => id === 'process_tender_document').length
    expect(count).toBe(1)
  })

  it('returns empty array for unrecognised text with no seeds', () => {
    const ids = findBobMutationContractsForText('zzz-gibberish-no-match-xyz')
    expect(ids).toHaveLength(0)
  })
})

describe('bobMutationCatalog getBobGatekeeperPolicySummary', () => {
  it('returns a non-empty formatted string', () => {
    const summary = getBobGatekeeperPolicySummary()
    expect(summary.length).toBeGreaterThan(0)
  })

  it('respects the limit parameter', () => {
    const oneLineSummary = getBobGatekeeperPolicySummary(1)
    expect(oneLineSummary.split('\n')).toHaveLength(1)
  })
})
