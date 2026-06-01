import type { RosterServiceType } from '@/hooks/useRosteredShift'

export type CanonicalSpecialty =
  | 'freedom_camping'
  | 'parking'
  | 'noise'
  | 'biosecurity'
  | 'smoke'
  | 'general'

export interface SpecialtyRegistryEntry {
  key: CanonicalSpecialty
  label: string
  portalPath: string
  badgeClassName: string
  accentColor: string
  routeArea: 'parking' | 'noise' | 'biosecurity' | 'smoke' | 'field_operations'
  allowedRoles: ReadonlyArray<'officer' | 'admin_officer' | 'admin' | 'master'>
  serviceTypes: ReadonlyArray<RosterServiceType>
  specialtyTypes: ReadonlyArray<string>
  legacyAliases: ReadonlyArray<string>
}

const SPECIALTY_REGISTRY_MAP: Record<CanonicalSpecialty, SpecialtyRegistryEntry> = {
  freedom_camping: {
    key: 'freedom_camping',
    label: 'Freedom Camping',
    portalPath: '/field-officer?service=freedom_camping',
    badgeClassName: 'bg-green-100 text-green-800 border-green-200',
    accentColor: '#16a34a',
    routeArea: 'field_operations',
    allowedRoles: ['officer', 'admin_officer', 'admin', 'master'],
    serviceTypes: ['freedom_camping'],
    specialtyTypes: ['freedom_camping'],
    legacyAliases: ['freedom camping', 'freedom-camping'],
  },
  parking: {
    key: 'parking',
    label: 'Parking',
    portalPath: '/parking-officer',
    badgeClassName: 'bg-blue-100 text-blue-800 border-blue-200',
    accentColor: '#2563eb',
    routeArea: 'parking',
    allowedRoles: ['officer', 'admin_officer', 'admin', 'master'],
    serviceTypes: ['parking'],
    specialtyTypes: ['parking_warden', 'parking'],
    legacyAliases: ['parking warden', 'parking enforcement', 'parking-warden'],
  },
  noise: {
    key: 'noise',
    label: 'Noise Control',
    portalPath: '/noise-officer',
    badgeClassName: 'bg-purple-100 text-purple-800 border-purple-200',
    accentColor: '#7c3aed',
    routeArea: 'noise',
    allowedRoles: ['officer', 'admin_officer', 'admin', 'master'],
    serviceTypes: ['noise'],
    specialtyTypes: ['noise_control', 'noise'],
    legacyAliases: ['noise control', 'noise-control'],
  },
  biosecurity: {
    key: 'biosecurity',
    label: 'Biosecurity',
    portalPath: '/biosecurity-officer',
    badgeClassName: 'bg-teal-100 text-teal-800 border-teal-200',
    accentColor: '#0f766e',
    routeArea: 'biosecurity',
    allowedRoles: ['officer', 'admin_officer', 'admin', 'master'],
    serviceTypes: ['biosecurity_inspection'],
    specialtyTypes: ['biosecurity'],
    legacyAliases: ['biosecurity inspection', 'biosecurity-inspection'],
  },
  smoke: {
    key: 'smoke',
    label: 'Excessive Smoke',
    portalPath: '/smoke-officer',
    badgeClassName: 'bg-orange-100 text-orange-800 border-orange-200',
    accentColor: '#ea580c',
    routeArea: 'smoke',
    allowedRoles: ['officer', 'admin_officer', 'admin', 'master'],
    serviceTypes: ['smoke_complaint_ooh'],
    specialtyTypes: ['excessive_smoke', 'smoke'],
    legacyAliases: ['smoke complaint', 'smoke complaint ooh', 'excessive-smoke'],
  },
  general: {
    key: 'general',
    label: 'General',
    portalPath: '/field-officer?service=patrol',
    badgeClassName: 'bg-gray-100 text-gray-700 border-gray-200',
    accentColor: '#6b7280',
    routeArea: 'field_operations',
    allowedRoles: ['officer', 'admin_officer', 'admin', 'master'],
    serviceTypes: ['patrol', 'alarm_response', 'ems', 'guarding'],
    specialtyTypes: ['general'],
    legacyAliases: ['general patrol', 'general_patrol'],
  },
}

const NORMALIZED_SPECIALTY_LOOKUP = Object.values(SPECIALTY_REGISTRY_MAP).reduce<Record<string, CanonicalSpecialty>>((acc, entry) => {
  const values = [entry.key, ...entry.specialtyTypes, ...entry.legacyAliases]
  for (const value of values) {
    acc[normalizeKey(value)] = entry.key
  }
  return acc
}, {})

const SERVICE_TYPE_LOOKUP = Object.values(SPECIALTY_REGISTRY_MAP).reduce<Record<string, CanonicalSpecialty>>((acc, entry) => {
  for (const serviceType of entry.serviceTypes) {
    acc[serviceType] = entry.key
  }
  return acc
}, {})

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function resolveCanonicalSpecialty(input: string | null | undefined): CanonicalSpecialty | null {
  if (!input || typeof input !== 'string') return null
  return NORMALIZED_SPECIALTY_LOOKUP[normalizeKey(input)] ?? null
}

export function resolveCanonicalSpecialtyFromServiceType(
  serviceType: RosterServiceType | string | null | undefined,
): CanonicalSpecialty | null {
  if (!serviceType || typeof serviceType !== 'string') return null
  return SERVICE_TYPE_LOOKUP[serviceType] ?? null
}

export function getSpecialtyRegistryEntry(input: string | null | undefined): SpecialtyRegistryEntry | null {
  const resolved = resolveCanonicalSpecialty(input)
  return resolved ? SPECIALTY_REGISTRY_MAP[resolved] : null
}

export function getSpecialtyRegistryEntryFromServiceType(
  serviceType: RosterServiceType | string | null | undefined,
): SpecialtyRegistryEntry | null {
  const resolved = resolveCanonicalSpecialtyFromServiceType(serviceType)
  return resolved ? SPECIALTY_REGISTRY_MAP[resolved] : null
}

export function appendQueryParams(
  basePath: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const [rawPath, existingQuery = ''] = basePath.split('?')
  const searchParams = new URLSearchParams(existingQuery)
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue
    searchParams.set(key, String(value))
  }
  const query = searchParams.toString()
  return query.length > 0 ? `${rawPath}?${query}` : rawPath
}

export function buildSpecialtyDispatchPath(
  specialtyInput: string | null | undefined,
  context: Record<string, string | number | boolean | null | undefined>,
): string | null {
  const entry = getSpecialtyRegistryEntry(specialtyInput)
  if (!entry) return null
  return appendQueryParams(entry.portalPath, context)
}

export function canRoleAccessSpecialty(
  role: string | null | undefined,
  specialtyInput: string | null | undefined,
): boolean {
  const entry = getSpecialtyRegistryEntry(specialtyInput)
  if (!entry || !role) return false
  const normalizedRole = role.trim().toLowerCase()
  return entry.allowedRoles.includes(normalizedRole as SpecialtyRegistryEntry['allowedRoles'][number])
}

export const SPECIALTY_REGISTRY = SPECIALTY_REGISTRY_MAP
