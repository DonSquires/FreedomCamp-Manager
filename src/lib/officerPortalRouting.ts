import type { RosterServiceType, RosteredShift } from '@/hooks/useRosteredShift'

export const SERVICE_TYPE_PORTAL: Record<
  RosterServiceType,
  { path: string; label: string; buildPath?: (shift: RosteredShift) => string }
> = {
  freedom_camping: { path: '/field-officer?service=freedom_camping', label: 'Freedom Camping Patrol' },
  guarding: {
    path: '/site-guard',
    label: 'Site Guarding',
    buildPath: (shift) =>
      shift.client_site_id
        ? `/site-guard?site=${shift.client_site_id}${shift.id ? `&roster=${shift.id}` : ''}`
        : '/field-officer?service=guarding',
  },
  parking: { path: '/parking-officer', label: 'Parking Enforcement' },
  noise: { path: '/noise-officer', label: 'Noise Control' },
  patrol: { path: '/field-officer?service=patrol', label: 'General Patrol' },
  alarm_response: { path: '/field-officer?service=alarm_response', label: 'Alarm Response' },
  ems: { path: '/ems', label: 'EMS' },
  biosecurity_inspection: { path: '/biosecurity-officer', label: 'Biosecurity Inspection' },
  smoke_complaint_ooh: { path: '/smoke-officer', label: 'Smoke Complaint (OOH)' },
}

export function getOfficerPortalPath(shift: RosteredShift): string | null {
  if (!shift.service_type) return null
  const portal = SERVICE_TYPE_PORTAL[shift.service_type]
  return portal.buildPath ? portal.buildPath(shift) : portal.path
}

type RoleLike = string | null | undefined

const FIELD_OPERATION_ROLES = new Set([
  'field_officer',
  'officer',
  'dispatch',
  'dispatcher',
  'command_center',
])

const ANALYTICS_LANDING_ROLES = new Set(['analyst', 'intel_supervisor'])
const ADMIN_LANDING_ROLES = new Set(['master', 'admin', 'admin_officer', 'manager', 'supervisor', 'regional_manager', 'grand_master'])

const SPECIALTY_ACCESS_ROLES = new Set([
  'master',
  'admin',
  'admin_officer',
  'manager',
  'supervisor',
  'regional_manager',
  'officer',
  'analyst',
  'intel_supervisor',
  'grand_master',
])

export const resolvePortalRole = (role: RoleLike): string | null => {
  if (!role || typeof role !== 'string') return null
  const normalized = role.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

export const getHomePathForRole = (role: RoleLike): string => {
  const resolved = resolvePortalRole(role)
  if (!resolved) return '/dashboard'
  if (FIELD_OPERATION_ROLES.has(resolved)) return '/roster-planner'
  if (ANALYTICS_LANDING_ROLES.has(resolved)) return '/strategic-intelligence'
  if (ADMIN_LANDING_ROLES.has(resolved)) return '/admin-portal'
  return '/dashboard'
}

export const resolveOfficerPortalLandingRoute = (role: RoleLike): string => getHomePathForRole(role)

export const canAccessSpecialtyFunctions = (role: RoleLike): boolean => {
  const resolved = resolvePortalRole(role)
  if (!resolved) return false
  return SPECIALTY_ACCESS_ROLES.has(resolved)
}

export const canShowSpecialtyQuickLink = (role: RoleLike, hasRosteredShift: boolean): boolean =>
  canAccessSpecialtyFunctions(role) && !hasRosteredShift
