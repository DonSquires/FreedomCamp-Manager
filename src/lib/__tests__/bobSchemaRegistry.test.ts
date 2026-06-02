import { describe, expect, it } from 'vitest'

import {
  BOB_SCHEMA_REGISTRY,
  findBobSchemaEntitiesForText,
  getBobSchemaRegistrySummary,
} from '@/lib/bobSchemaRegistry'

describe('bobSchemaRegistry getBobSchemaRegistrySummary', () => {
  it('returns a non-empty formatted string', () => {
    const summary = getBobSchemaRegistrySummary()
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toContain('[')
    expect(summary).toContain('Keys:')
    expect(summary).toContain('Related:')
  })

  it('respects the limit parameter', () => {
    const twoLines = getBobSchemaRegistrySummary(2)
    expect(twoLines.split('\n')).toHaveLength(2)

    const oneLine = getBobSchemaRegistrySummary(1)
    expect(oneLine.split('\n')).toHaveLength(1)
  })

  it('defaults to 7 entries', () => {
    const summary = getBobSchemaRegistrySummary()
    const lines = summary.split('\n')
    expect(lines).toHaveLength(Math.min(7, BOB_SCHEMA_REGISTRY.length))
  })

  it('includes org-scoped label for organization-scoped entities', () => {
    const summary = getBobSchemaRegistrySummary(BOB_SCHEMA_REGISTRY.length)
    const orgScopedEntry = BOB_SCHEMA_REGISTRY.find((e) => e.organizationScoped)
    if (orgScopedEntry) {
      expect(summary).toContain('org-scoped')
    }
  })

  it('includes global-scope label for non-org-scoped entities', () => {
    const summary = getBobSchemaRegistrySummary(BOB_SCHEMA_REGISTRY.length)
    const globalEntry = BOB_SCHEMA_REGISTRY.find((e) => !e.organizationScoped)
    if (globalEntry) {
      expect(summary).toContain('global-scope')
    }
  })
})

describe('bobSchemaRegistry findBobSchemaEntitiesForText', () => {
  it('finds organization entity by keyword', () => {
    const entities = findBobSchemaEntitiesForText('show me the organization settings')
    expect(entities).toContain('organizations')
  })

  it('finds user_profiles entity by keyword', () => {
    const entities = findBobSchemaEntitiesForText('what is the user role')
    expect(entities).toContain('user_profiles')
  })

  it('finds observations entity by keyword', () => {
    const entities = findBobSchemaEntitiesForText('log a new observation for this vehicle')
    expect(entities).toContain('observations')
  })

  it('returns empty array for unrecognised text', () => {
    const entities = findBobSchemaEntitiesForText('zzz-no-match-gibberish-xyz')
    expect(entities).toHaveLength(0)
  })

  it('seeds carry through to results', () => {
    const entities = findBobSchemaEntitiesForText('unrelated text', ['zones'])
    expect(entities).toContain('zones')
  })

  it('deduplicates entities when text and seeds overlap', () => {
    const entities = findBobSchemaEntitiesForText('organization details for this site', ['organizations'])
    const count = entities.filter((e) => e === 'organizations').length
    expect(count).toBe(1)
  })
})
