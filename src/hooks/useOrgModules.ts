/**
 * useOrgModules
 * Returns the list of module keys subscribed by the current user's organisation.
 * Caches per org_id. Falls back to ALL modules if no subscription rows exist
 * (opt-in model: unsubscribed orgs get everything until explicitly scoped).
 *
 * Usage:
 *   const { modules, hasModule, isLoading } = useOrgModules()
 *   if (!hasModule('noise_control')) return <Navigate to="/portal-selection" />
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

export const ALL_MODULES = [
  'noise_control',
  'parking',
  'dispatch',
  'roster',
  'patrol',
  'compliance',
  'crm',
  'ptt',
  'bob',
  'enforcement',
  'biosecurity',
  'smoke_control',
  'asset_management',
  'reporting',
  'alpr',
  'identity_verification',
] as const

export type ModuleKey = (typeof ALL_MODULES)[number]

/** Maps a module key to the portal route area codes it covers. */
export const MODULE_AREA_MAP: Record<ModuleKey, string[]> = {
  noise_control:         ['noise', 'noise-control', 'noise-officer'],
  parking:               ['parking', 'parking-officer'],
  dispatch:              ['dispatch', 'dispatch-monitor', 'dispatch-wizard', 'dispatched-jobs'],
  // Workforce/user-management surfaces are hosted under roster workflows.
  roster:                ['roster', 'users', 'open-shifts', 'officer-availability', 'timesheet'],
  patrol:                ['field-officer', 'patrol', 'live-patrol-monitor', 'patrol-checkpoint'],
  compliance:            ['compliance', 'compliance-dashboard', 'compliance-analytics', 'compliance-escalations'],
  crm:                   ['crm', 'client-account', 'client-sites', 'client-portal'],
  ptt:                   ['ptt', 'ptt-log'],
  bob:                   ['bob', 'bob-intake'],
  enforcement:           ['enforcement', 'breach-alerts', 'infringement', 'notices'],
  biosecurity:           ['biosecurity', 'biosecurity-officer'],
  smoke_control:         ['smoke-control', 'smoke-officer'],
  asset_management:      ['asset-management'],
  reporting:             ['reports', 'reports-hub', 'compliance-report'],
  alpr:                  ['nzscv', 'alpr'],
  identity_verification: ['identity-verification'],
}

interface OrgModule {
  module_key: string
  config: Record<string, unknown>
}

export function useOrgModules() {
  const { user } = useAuthStore()
  const orgId = user?.organization_id ?? null

  const { data, isLoading, error } = useQuery<OrgModule[]>({
    queryKey: ['org-modules', orgId],
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    queryFn: async () => {
      const { data, error } = await supabase
        .from('org_module_subscriptions' as any)
        .select('module_key, config')
        .eq('organization_id', orgId!)
        .eq('is_active', true)
      if (error) throw error
      return (data ?? []) as unknown as OrgModule[]
    },
  })

  // If no subscription rows exist for this org → fall back to all modules (backwards-compatible)
  const modules: ModuleKey[] = (
    !data || data.length === 0
      ? [...ALL_MODULES]
      : data.map((m) => m.module_key as ModuleKey)
  )

  const hasModule = (key: ModuleKey): boolean => {
    // Master/grand_master always has everything
    if (user?.role === 'master' || user?.role === 'grand_master') return true
    return modules.includes(key)
  }

  /**
   * Returns true if the given portal area code is accessible based on module subscriptions.
   * Pass the area code string used in AreaRoute / portal_access.
   */
  const hasAreaAccess = (area: string): boolean => {
    if (user?.role === 'master' || user?.role === 'grand_master') return true
    return modules.some((mod) =>
      MODULE_AREA_MAP[mod]?.some((a) => area.startsWith(a))
    )
  }

  const moduleConfig = (key: ModuleKey): Record<string, unknown> => {
    if (!data) return {}
    const row = data.find((m) => m.module_key === key)
    return (row?.config as Record<string, unknown>) ?? {}
  }

  return {
    modules,
    hasModule,
    hasAreaAccess,
    moduleConfig,
    isLoading,
    error,
  }
}
