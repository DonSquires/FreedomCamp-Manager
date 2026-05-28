import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useRosteredShift } from '@/hooks/useRosteredShift'

export const WAITING_FOR_SHIFT_PATH = '/officer-home'

const DIRECTOR_OFFICER_ALLOWED_PATH_PREFIXES = [
  '/field-officer',
  '/radio',
  '/ptt-radio',
  '/radio-ui',
  '/team-chat',
  '/profile',
  '/settings',
  '/notifications',
  WAITING_FOR_SHIFT_PATH,
]

type DirectorOfficerPathAllowOptions = {
  noiseEnabled?: boolean
  siteGuardEnabled?: boolean
}

export function isDirectorOfficerPathAllowed(pathname: string, options: DirectorOfficerPathAllowOptions = {}): boolean {
  const normalized = String(pathname || '').trim()
  const allowedPrefixes = [...DIRECTOR_OFFICER_ALLOWED_PATH_PREFIXES]

  if (options.noiseEnabled) {
    allowedPrefixes.push('/noise-officer')
  }

  if (options.siteGuardEnabled) {
    allowedPrefixes.push('/site-guard')
  }

  return allowedPrefixes.some((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  )
}

type SiteToolKey = 'alpr' | 'noise' | 'site_guard'

type SiteToolPermissions = {
  alpr: boolean
  noise: boolean
  siteGuard: boolean
  isLoading: boolean
}

function fieldGroupForSiteTool(clientSiteId: string, key: SiteToolKey): string {
  return `client_site:${clientSiteId}:tool:${key}`
}

export function useDirectorRosterGate() {
  const { user } = useAuthStore()
  const { rosteredShift, isLoading } = useRosteredShift()

  const gateApplies = user?.role === 'officer'
  const shouldRestrictToWaiting = gateApplies && !isLoading && !rosteredShift

  return {
    isLoading: gateApplies && isLoading,
    gateApplies,
    shouldRestrictToWaiting,
    shouldReleaseFromWaiting: gateApplies && !isLoading && !!rosteredShift,
  }
}

export function useSiteToolPermissions(userId: string | null | undefined, clientSiteId: string | null | undefined): SiteToolPermissions {
  const normalizedUserId = String(userId || '').trim()
  const normalizedClientSiteId = String(clientSiteId || '').trim()

  const fieldGroups = useMemo(() => {
    if (!normalizedClientSiteId) return []
    return [
      fieldGroupForSiteTool(normalizedClientSiteId, 'alpr'),
      fieldGroupForSiteTool(normalizedClientSiteId, 'noise'),
      fieldGroupForSiteTool(normalizedClientSiteId, 'site_guard'),
    ]
  }, [normalizedClientSiteId])

  const { data = [], isLoading } = useQuery<Array<{ field_group: string; can_view: boolean | null }>>({
    queryKey: ['director-site-tool-permissions', normalizedUserId, normalizedClientSiteId],
    enabled: Boolean(normalizedUserId && normalizedClientSiteId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_user_permissions')
        .select('field_group, can_view')
        .eq('user_id', normalizedUserId)
        .in('field_group', fieldGroups)

      if (error) throw error
      return (data || []) as Array<{ field_group: string; can_view: boolean | null }>
    },
    staleTime: 60_000,
  })

  const canView = (toolKey: SiteToolKey) => {
    if (!normalizedClientSiteId) return false
    const fieldGroup = fieldGroupForSiteTool(normalizedClientSiteId, toolKey)
    return data.some((row) => row.field_group === fieldGroup && row.can_view === true)
  }

  return {
    alpr: canView('alpr'),
    noise: canView('noise'),
    siteGuard: canView('site_guard'),
    isLoading,
  }
}
