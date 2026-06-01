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

// ── Specialty type → portal path ──────────────────────────────────────────
// Maps specialty_type values (stored on patrols + dispatch_jobs) to the
// officer portal path that handles that specialty.  Used by PatrolCard and
// FieldOfficerDispatch to auto-navigate when a specialty job is activated.

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
    label: 'Freedom Camping',
    portalPath: '/field-officer?service=freedom_camping',
    color: 'bg-green-100 text-green-800 border-green-200',
  },
  parking_warden: {
    label: 'Parking',
    portalPath: '/parking-officer',
    color: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  excessive_smoke: {
    label: 'Excessive Smoke',
    portalPath: '/smoke-officer',
    color: 'bg-orange-100 text-orange-800 border-orange-200',
  },
  noise_control: {
    label: 'Noise Control',
    portalPath: '/noise-officer',
    color: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  biosecurity: {
    label: 'Biosecurity',
    portalPath: '/biosecurity-officer',
    color: 'bg-teal-100 text-teal-800 border-teal-200',
  },
  general: {
    label: 'General',
    portalPath: '/field-officer?service=patrol',
    color: 'bg-gray-100 text-gray-700 border-gray-200',
  },
}

/** Return the portal path for a given specialty_type, or null if unrecognised. */
export function getSpecialtyPortalPath(specialtyType: string | null | undefined): string | null {
  if (!specialtyType) return null
  return SPECIALTY_TYPE_META[specialtyType as SpecialtyType]?.portalPath ?? null
}

