import { describe, expect, it } from 'vitest'

import {
  deriveNamePartsFromEmail,
  normalizeStringArray,
  resolveAuthorizedWorkLocations,
  resolveEmployerOrganizationId,
  resolveOrganizationParentId,
  resolveUserNames,
} from '@/lib/entityCreationDefaults'

describe('entityCreationDefaults', () => {
  it('derives readable names from email addresses', () => {
    expect(deriveNamePartsFromEmail('don.squires@firstsecurity.co.nz')).toEqual({
      firstName: 'Don',
      lastName: 'Squires',
    })
  })

  it('fills missing user names from the email local part', () => {
    expect(resolveUserNames({
      email: 'jane.doe@example.com',
      first_name: '  ',
      last_name: '',
      role: 'master',
    })).toEqual({
      first_name: 'Jane',
      last_name: 'Doe',
    })
  })

  it('merges org-derived work locations without duplicates', () => {
    const extraOrganizationIds = normalizeStringArray(['org-2', ' org-3 ', 'org-2'])
    expect(resolveAuthorizedWorkLocations('org-1', extraOrganizationIds, ['org-3', 'org-4'])).toEqual([
      'org-1',
      'org-2',
      'org-3',
      'org-4',
    ])
    expect(resolveEmployerOrganizationId('org-1', null)).toBe('org-1')
  })

  it('respects explicit top-level organization selections', () => {
    expect(resolveOrganizationParentId('client', null)).toBeNull()
    expect(resolveOrganizationParentId('owner', 'org-parent')).toBeNull()
    expect(resolveOrganizationParentId('service_provider', 'org-parent')).toBe('org-parent')
  })
})
