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
