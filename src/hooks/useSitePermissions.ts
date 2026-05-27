/**
 * useSitePermissions
 *
 * Returns field-group visibility/editability permissions for the current user
 * against client_sites data.
 *
 * Resolution order (highest-priority first):
 *   1. site_user_permissions for the current user (per-user override, if not NULL)
 *   2. site_role_permissions for the user's role  (role default)
 *   3. Deny-by-default: { canView: false, canEdit: false }
 *
 * Field groups:
 *   identity    – site name, code, type, zone
 *   location    – address, city, GPS
 *   operational – access instructions, hazards, special instructions
 *   contacts    – primary and emergency contacts
 *   sla         – response SLA, priority override
 *   notes       – general notes (officers may edit this group)
 *   financial   – pay/charge rates, contract dates, purchase order
 *   accounting  – Microsoft 365 / Business Central linking columns
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

// ── Types ────────────────────────────────────────────────────────────────────

export type SiteFieldGroup =
  | 'identity'
  | 'location'
  | 'operational'
  | 'contacts'
  | 'sla'
  | 'notes'
  | 'financial'
  | 'accounting'

export const SITE_FIELD_GROUPS: SiteFieldGroup[] = [
  'identity', 'location', 'operational', 'contacts',
  'sla', 'notes', 'financial', 'accounting',
]

/** Human-readable label for each field group */
export const SITE_FIELD_GROUP_LABELS: Record<SiteFieldGroup, string> = {
  identity:    'Site Identity',
  location:    'Location & GPS',
  operational: 'Operational Info',
  contacts:    'Contacts',
  sla:         'SLA & Priority',
  notes:       'Notes',
  financial:   'Financial Rates',
  accounting:  'Accounting (M365)',
}

interface FieldPerm { canView: boolean; canEdit: boolean }
type PermMap = Record<SiteFieldGroup, FieldPerm>

interface RolePermRow   { role: string; field_group: string; can_view: boolean; can_edit: boolean }
interface UserPermRow   { user_id: string; field_group: string; can_view: boolean | null; can_edit: boolean | null }

const DENY: FieldPerm = { canView: false, canEdit: false }

function buildDefaultMap(): PermMap {
  return Object.fromEntries(SITE_FIELD_GROUPS.map(g => [g, { ...DENY }])) as PermMap
}

function buildAllowAllMap(): PermMap {
  return Object.fromEntries(
    SITE_FIELD_GROUPS.map((g) => [g, { canView: true, canEdit: true }])
  ) as PermMap
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseSitePermissionsResult {
  /** Full resolved permission map */
  perms: PermMap
  /** Returns true if the current user can VIEW the given field group */
  canView: (group: SiteFieldGroup) => boolean
  /** Returns true if the current user can EDIT the given field group */
  canEdit: (group: SiteFieldGroup) => boolean
  isLoading: boolean
}

export function useSitePermissions(): UseSitePermissionsResult {
  const { user } = useAuthStore()
  const role   = user?.role
  const userId = user?.id
  const isSuperUser = role === 'master' || role === 'grand_master'

  // Fetch role defaults
  const { data: rolePerms = [], isLoading: loadingRole } = useQuery<RolePermRow[]>({
    queryKey: ['site-role-permissions', role],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_role_permissions' as any)
        .select('role, field_group, can_view, can_edit')
        .eq('role', role ?? '')
      if (error) throw error
      return (data ?? []) as unknown as RolePermRow[]
    },
    enabled: !!role,
    staleTime: 10 * 60 * 1000,
  })

  // Fetch per-user overrides
  const { data: userPerms = [], isLoading: loadingUser } = useQuery<UserPermRow[]>({
    queryKey: ['site-user-permissions', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_user_permissions' as any)
        .select('user_id, field_group, can_view, can_edit')
        .eq('user_id', userId ?? '')
      if (error) throw error
      return (data ?? []) as unknown as UserPermRow[]
    },
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
  })

  const isLoading = loadingRole || loadingUser

  // Merge: user override (if not null) → role default → deny
  const perms = buildDefaultMap()

  if (isSuperUser) {
    const fullAccess = buildAllowAllMap()
    return {
      perms: fullAccess,
      canView: (g) => fullAccess[g]?.canView ?? false,
      canEdit: (g) => fullAccess[g]?.canEdit ?? false,
      isLoading,
    }
  }

  for (const rp of rolePerms) {
    const g = rp.field_group as SiteFieldGroup
    if (SITE_FIELD_GROUPS.includes(g)) {
      perms[g] = { canView: rp.can_view, canEdit: rp.can_edit }
    }
  }

  for (const up of userPerms) {
    const g = up.field_group as SiteFieldGroup
    if (!SITE_FIELD_GROUPS.includes(g)) continue
    const current = perms[g]
    perms[g] = {
      canView: up.can_view  !== null ? up.can_view  : current.canView,
      canEdit: up.can_edit  !== null ? up.can_edit  : current.canEdit,
    }
  }

  return {
    perms,
    canView: (g) => perms[g]?.canView  ?? false,
    canEdit: (g) => perms[g]?.canEdit  ?? false,
    isLoading,
  }
}
