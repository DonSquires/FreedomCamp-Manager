import { describe, expect, it } from 'vitest'
import { resolveAdminPortalOrganizationId } from './adminPortalScope'

describe('resolveAdminPortalOrganizationId', () => {
  it('uses selected organization for master roles', () => {
    expect(
      resolveAdminPortalOrganizationId(
        { role: 'master', organization_id: 'org-a' },
        'org-selected',
      ),
    ).toBe('org-selected')
  })

  it('returns null for master roles when no selected organization exists', () => {
    expect(
      resolveAdminPortalOrganizationId(
        { role: 'grand_master', organization_id: 'org-a' },
        null,
      ),
    ).toBeNull()
  })

  it('prefers user organization_id for non-master roles', () => {
    expect(
      resolveAdminPortalOrganizationId(
        { role: 'admin_officer', organization_id: 'org-primary', employer_organization_id: 'org-employer' },
        'org-selected',
      ),
    ).toBe('org-primary')
  })

  it('falls back to employer organization for non-master roles', () => {
    expect(
      resolveAdminPortalOrganizationId(
        { role: 'admin_officer', organization_id: null, employer_organization_id: 'org-employer' },
        null,
      ),
    ).toBe('org-employer')
  })

  it('falls back to authorized work locations and extra organizations', () => {
    expect(
      resolveAdminPortalOrganizationId(
        {
          role: 'admin',
          organization_id: null,
          employer_organization_id: null,
          authorized_work_locations: ['org-work'],
          extra_organization_ids: ['org-extra'],
        },
        null,
      ),
    ).toBe('org-work')

    expect(
      resolveAdminPortalOrganizationId(
        {
          role: 'admin',
          organization_id: null,
          employer_organization_id: null,
          authorized_work_locations: [],
          extra_organization_ids: ['org-extra'],
        },
        null,
      ),
    ).toBe('org-extra')
  })
})
