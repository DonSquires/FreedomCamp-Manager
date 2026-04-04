/**
 * Zone feature keys and metadata.
 *
 * When an admin sets up a zone under a client/organisation they choose which
 * officer portal functions are available at that location.  The selected keys
 * are stored in zones.zone_features (text[]).
 *
 * An EMPTY array means "all features permitted" (default / unconfigured zone —
 * backwards-compatible with zones created before this field was added).
 */

export const ZONE_FEATURE_KEYS = [
  'freedom_camping',
  'guarding',
  'parking',
  'noise',
  'ems',
  'access_control',
] as const

export type ZoneFeatureKey = (typeof ZONE_FEATURE_KEYS)[number]

export interface ZoneFeatureMeta {
  key: ZoneFeatureKey
  label: string
  description: string
}

export const ZONE_FEATURES: ZoneFeatureMeta[] = [
  {
    key: 'freedom_camping',
    label: 'Freedom Camping Patrol',
    description: 'Vehicle scanning, breach detection, compliance reporting',
  },
  {
    key: 'guarding',
    label: 'Site Guarding',
    description: 'Checkpoints, incidents, POI, face recognition',
  },
  {
    key: 'parking',
    label: 'Parking Enforcement',
    description: 'Chalk pass, recheck, infringement notices',
  },
  {
    key: 'noise',
    label: 'Noise Control',
    description: 'Complaints, assessments, abatement notices, seizures',
  },
  {
    key: 'ems',
    label: 'Electronic Monitoring Services',
    description: 'EMS attendance logging and reporting',
  },
  {
    key: 'access_control',
    label: 'Access Control',
    description: 'User portal access and permission management',
  },
]

/**
 * Returns true if the officer is allowed to use a feature based on the zone's
 * configured feature list.
 *
 * Rule: an empty allowed list means ALL features are permitted (unconfigured /
 * legacy zone).  A non-empty list restricts access to only the listed keys.
 */
export function isFeatureAllowed(feature: ZoneFeatureKey, allowedFeatures: string[]): boolean {
  return allowedFeatures.length === 0 || allowedFeatures.includes(feature)
}
