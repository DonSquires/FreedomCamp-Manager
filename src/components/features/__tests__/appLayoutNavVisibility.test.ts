import { describe, expect, it } from 'vitest'
import { pinnedItems, isNavItemVisibleForRole } from '@/components/features/AppLayout'
import type { AppRole } from '@/navigation/routeManifest'

describe('AppLayout pinned nav visibility', () => {
  it('enforces item role membership before route visibility checks', () => {
    const activeFeatureFlags = new Set<string>()

    const adminHub = pinnedItems.find((item) => item.label === 'Admin Hub')
    const officerHome = pinnedItems.find((item) => item.label === 'Home')

    expect(adminHub).toBeTruthy()
    expect(officerHome).toBeTruthy()

    expect(isNavItemVisibleForRole(adminHub!, 'admin' as AppRole, activeFeatureFlags)).toBe(true)
    expect(isNavItemVisibleForRole(officerHome!, 'admin' as AppRole, activeFeatureFlags)).toBe(false)
  })

  it('does not produce duplicate pinned paths for each role', () => {
    const roles: AppRole[] = ['admin', 'admin_officer', 'officer', 'master', 'grand_master', 'nzscv_monitor']
    const activeFeatureFlags = new Set<string>()

    for (const role of roles) {
      const visible = pinnedItems.filter((item) => isNavItemVisibleForRole(item, role, activeFeatureFlags))
      const paths = visible.map((item) => item.path)
      expect(new Set(paths).size).toBe(paths.length)
    }
  })
})
