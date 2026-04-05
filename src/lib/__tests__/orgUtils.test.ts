import { describe, it, expect } from 'vitest'
import { getEffectiveOrgId } from '../orgUtils'

describe('getEffectiveOrgId', () => {
  it('returns null for null user', () => {
    expect(getEffectiveOrgId(null)).toBeNull()
  })

  it('returns null for undefined user', () => {
    expect(getEffectiveOrgId(undefined)).toBeNull()
  })

  it('returns selectedOrgId for master users when provided', () => {
    const user = { role: 'master', organization_id: 'org-1' }
    expect(getEffectiveOrgId(user, 'org-2')).toBe('org-2')
  })

  it('returns null for master users when no org selected', () => {
    const user = { role: 'master', organization_id: 'org-1' }
    expect(getEffectiveOrgId(user)).toBeNull()
  })

  it('returns null for master users when selectedOrgId is null', () => {
    const user = { role: 'master', organization_id: 'org-1' }
    expect(getEffectiveOrgId(user, null)).toBeNull()
  })

  it('returns organization_id for non-master users', () => {
    const user = { role: 'admin', organization_id: 'org-1' }
    expect(getEffectiveOrgId(user)).toBe('org-1')
  })

  it('ignores selectedOrgId for non-master users', () => {
    const user = { role: 'admin', organization_id: 'org-1' }
    expect(getEffectiveOrgId(user, 'org-2')).toBe('org-1')
  })

  it('returns null for non-master users without organization_id', () => {
    const user = { role: 'officer', organization_id: null }
    expect(getEffectiveOrgId(user)).toBeNull()
  })

  it('returns organization_id for officer role', () => {
    const user = { role: 'officer', organization_id: 'org-3' }
    expect(getEffectiveOrgId(user, 'org-5')).toBe('org-3')
  })

  it('handles user with no role', () => {
    const user = { organization_id: 'org-1' }
    expect(getEffectiveOrgId(user)).toBe('org-1')
  })

  it('handles user with null role', () => {
    const user = { role: null, organization_id: 'org-1' }
    expect(getEffectiveOrgId(user)).toBe('org-1')
  })
})
