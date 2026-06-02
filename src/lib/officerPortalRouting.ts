import type { RosterServiceType, RosteredShift } from '@/hooks/useRosteredShift'
import {
  SPECIALTY_REGISTRY,
  appendQueryParams,
  getSpecialtyRegistryEntry,
  getSpecialtyRegistryEntryFromServiceType,
  resolveCanonicalSpecialty,
} from '@/lib/specialtyRegistry'

export const SERVICE_TYPE_PORTAL: Record<
  RosterServiceType,
  { path: string; label: string; buildPath?: (shift: RosteredShift) => string }
> = {
  freedom_camping: { path: SPECIALTY_REGISTRY.freedom_camping.portalPath, label: 'Freedom Camping Patrol' },
  guarding: {
    path: '/site-guard',
    label: 'Site Guarding',
    buildPath: (shift) =>
      shift.client_site_id
        ? `/site-guard?site=${shift.client_site_id}${shift.id ? `&roster=${shift.id}` : ''}`
        : '/field-officer?service=guarding',
  },
  parking: { path: SPECIALTY_REGISTRY.parking.portalPath, label: 'Parking Enforcement' },
  noise: { path: SPECIALTY_REGISTRY.noise.portalPath, label: 'Noise Control' },
  patrol: { path: '/field-officer?service=patrol', label: 'General Patrol' },
  alarm_response: { path: '/field-officer?service=alarm_response', label: 'Alarm Response' },
  ems: { path: '/ems', label: 'EMS' },
  biosecurity_inspection: { path: SPECIALTY_REGISTRY.biosecurity.portalPath, label: 'Biosecurity Inspection' },
  smoke_complaint_ooh: { path: SPECIALTY_REGISTRY.smoke.portalPath, label: 'Smoke Complaint (OOH)' },
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

const SPECIALTY_ACCESS_ROLES = new Set(['officer', 'admin_officer', 'admin', 'master'])

export const resolvePortalRole = (role: RoleLike): string | null => {
  if (!role || typeof role !== 'string') return null
  const normalized = role.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

export const getHomePathForRole = (role: RoleLike): string => {
  const resolved = resolvePortalRole(role)
  if (!resolved) return '/dashboard'
  if (resolved === 'systems_administrator') return '/access-control'
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
  // Specialty quick access is only shown when the officer is currently unrostered;
  // rostered users should follow shift-specific portals from their assignment flow.
  canAccessSpecialtyFunctions(role) && !hasRosteredShift

// Maps specialty_type values (stored on patrols + dispatch_jobs) to
// officer portal routes used by dispatch and patrol UI cards.
export type SpecialtyType =
  | 'freedom_camping'
  | 'parking_warden'
  | 'excessive_smoke'
  | 'noise_control'
  | 'biosecurity'
  | 'general'

export const SPECIALTY_TYPE_META: Record<
  SpecialtyType,
  { label: string; portalPath: string; color: string }
> = {
  freedom_camping: {
    label: SPECIALTY_REGISTRY.freedom_camping.label,
    portalPath: SPECIALTY_REGISTRY.freedom_camping.portalPath,
    color: SPECIALTY_REGISTRY.freedom_camping.badgeClassName,
  },
  parking_warden: {
    label: SPECIALTY_REGISTRY.parking.label,
    portalPath: SPECIALTY_REGISTRY.parking.portalPath,
    color: SPECIALTY_REGISTRY.parking.badgeClassName,
  },
  excessive_smoke: {
    label: SPECIALTY_REGISTRY.smoke.label,
    portalPath: SPECIALTY_REGISTRY.smoke.portalPath,
    color: SPECIALTY_REGISTRY.smoke.badgeClassName,
  },
  noise_control: {
    label: SPECIALTY_REGISTRY.noise.label,
    portalPath: SPECIALTY_REGISTRY.noise.portalPath,
    color: SPECIALTY_REGISTRY.noise.badgeClassName,
  },
  biosecurity: {
    label: SPECIALTY_REGISTRY.biosecurity.label,
    portalPath: SPECIALTY_REGISTRY.biosecurity.portalPath,
    color: SPECIALTY_REGISTRY.biosecurity.badgeClassName,
  },
  general: {
    label: SPECIALTY_REGISTRY.general.label,
    portalPath: SPECIALTY_REGISTRY.general.portalPath,
    color: SPECIALTY_REGISTRY.general.badgeClassName,
  },
}

export function getSpecialtyPortalPath(specialtyType: string | null | undefined): string | null {
  if (!specialtyType) return null
  const canonical = resolveCanonicalSpecialty(specialtyType)
  if (canonical) return SPECIALTY_REGISTRY[canonical].portalPath
  return SPECIALTY_TYPE_META[specialtyType as SpecialtyType]?.portalPath ?? null
}

export function getSpecialtyMeta(specialtyType: string | null | undefined): { label: string; portalPath: string; color: string } | null {
  if (!specialtyType) return null
  const canonical = resolveCanonicalSpecialty(specialtyType)
  if (canonical) {
    const entry = SPECIALTY_REGISTRY[canonical]
    return { label: entry.label, portalPath: entry.portalPath, color: entry.badgeClassName }
  }
  return SPECIALTY_TYPE_META[specialtyType as SpecialtyType] ?? null
}

export function getSpecialtyPortalPathFromServiceType(serviceType: RosterServiceType | null | undefined): string | null {
  const entry = getSpecialtyRegistryEntryFromServiceType(serviceType)
  return entry?.portalPath ?? null
}

export function buildSpecialtyPortalLink(
  input: { specialtyType?: string | null; serviceType?: RosterServiceType | null },
  context: Record<string, string | number | boolean | null | undefined>,
): string | null {
  const entry = input.specialtyType
    ? getSpecialtyRegistryEntry(input.specialtyType)
    : getSpecialtyRegistryEntryFromServiceType(input.serviceType)
  if (!entry) return null
  return appendQueryParams(entry.portalPath, context)
}
