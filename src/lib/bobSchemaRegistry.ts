export interface BobSchemaRegistryEntry {
  entity: string
  kind: 'table' | 'view' | 'rpc'
  purpose: string
  organizationScoped: boolean
  primaryIdentifiers: string[]
  keyColumns: string[]
  relatedEntities: string[]
  notes?: string
}

export const BOB_SCHEMA_REGISTRY: BobSchemaRegistryEntry[] = [
  {
    entity: 'organizations',
    kind: 'table',
    purpose: 'Tenant root for client, provider, and hierarchy-scoped operational data.',
    organizationScoped: false,
    primaryIdentifiers: ['id', 'name'],
    keyColumns: ['organization_type', 'parent_organization_id', 'is_active'],
    relatedEntities: ['user_profiles', 'zones', 'client_sites'],
  },
  {
    entity: 'user_profiles',
    kind: 'table',
    purpose: 'Role, job title, portal access, and organization scope for authenticated users.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'email'],
    keyColumns: ['role', 'organization_id', 'job_title', 'portal_access'],
    relatedEntities: ['organizations', 'bob_user_profiles', 'patrol_events'],
  },
  {
    entity: 'bob_user_profiles',
    kind: 'table',
    purpose: 'Bob-specific preferences, permissions, tiering, and memory namespace settings.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'user_id'],
    keyColumns: ['organization_id', 'bob_tier', 'permissions', 'computer_use_enabled'],
    relatedEntities: ['user_profiles'],
  },
  {
    entity: 'zones',
    kind: 'table',
    purpose: 'Jurisdiction and enforcement rule boundary records used for compliance and routing.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'name'],
    keyColumns: ['organization_id', 'zone_type', 'self_contained_required', 'is_active'],
    relatedEntities: ['organizations', 'client_sites', 'patrol_events'],
  },
  {
    entity: 'client_sites',
    kind: 'table',
    purpose: 'Commercial and operational site records for service delivery, response, and quoting.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'name'],
    keyColumns: ['organization_id', 'zone_id', 'gps_lat', 'gps_lng', 'is_active'],
    relatedEntities: ['organizations', 'zones'],
  },
  {
    entity: 'observations',
    kind: 'table',
    purpose: 'Primary field observation records for compliance, breaches, incidents, and evidence chains.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'plate_number'],
    keyColumns: ['organization_id', 'zone_id', 'recorded_by', 'status', 'incident_id'],
    relatedEntities: ['zones', 'user_profiles', 'operational_cases'],
  },
  {
    entity: 'operational_cases',
    kind: 'table',
    purpose: 'Case container for dispatched work, patrol work, and related operational events.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'title'],
    keyColumns: ['organization_id', 'status', 'dispatch_job_id'],
    relatedEntities: ['patrol_events', 'user_profiles', 'organizations'],
  },
  {
    entity: 'dispatch_jobs',
    kind: 'table',
    purpose: 'Scheduled or active dispatch work that can be linked to operational cases and field execution.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'title'],
    keyColumns: ['organization_id', 'status', 'priority', 'assigned_to'],
    relatedEntities: ['operational_cases', 'user_profiles', 'client_sites'],
  },
  {
    entity: 'patrol_events',
    kind: 'table',
    purpose: 'Historical or live patrol event records linked to cases, officers, and zones.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'case_id'],
    keyColumns: ['organization_id', 'officer_id', 'zone_id', 'event_type', 'event_timestamp'],
    relatedEntities: ['operational_cases', 'user_profiles', 'zones'],
    notes: 'Historical patrol enrichment should map into this entity only through controlled import contracts.',
  },
  {
    entity: 'person_observations',
    kind: 'table',
    purpose: 'Person-linked observation records used in investigation and repeat-contact workflows.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'person_id'],
    keyColumns: ['organization_id', 'recorded_by', 'zone_id', 'plate_number'],
    relatedEntities: ['observations', 'user_profiles', 'zones'],
  },
  {
    entity: 'vehicle_observations_v2',
    kind: 'table',
    purpose: 'Vehicle-centric observation records for stay tracking, breaches, and plate-linked compliance analysis.',
    organizationScoped: true,
    primaryIdentifiers: ['id', 'plate_number'],
    keyColumns: ['organization_id', 'zone_id', 'recorded_by', 'incident_id'],
    relatedEntities: ['observations', 'zones', 'user_profiles'],
  },
]

export function getBobSchemaRegistrySummary(limit = 7): string {
  return BOB_SCHEMA_REGISTRY.slice(0, limit)
    .map((entry) => {
      const scoped = entry.organizationScoped ? 'org-scoped' : 'global-scope'
      return `${entry.entity} [${entry.kind}; ${scoped}] - ${entry.purpose} Keys: ${entry.keyColumns.join(', ')} Related: ${entry.relatedEntities.join(', ')}`
    })
    .join('\n')
}

const ENTITY_KEYWORDS: Record<string, string[]> = {
  organizations: ['organization', 'org', 'tenant', 'client'],
  user_profiles: ['user', 'staff', 'officer', 'profile', 'account'],
  bob_user_profiles: ['bob profile', 'bob preferences', 'bob tier'],
  zones: ['zone', 'geofence', 'bylaw area'],
  client_sites: ['site', 'client site', 'facility', 'location'],
  observations: ['observation', 'breach', 'evidence', 'vehicle check'],
  operational_cases: ['case', 'incident case', 'dispatch case'],
  dispatch_jobs: ['dispatch', 'job', 'assignment'],
  patrol_events: ['patrol event', 'patrol history', 'visit'],
  person_observations: ['person observation', 'person record'],
  vehicle_observations_v2: ['vehicle observation', 'plate', 'vehicle'],
}

export function findBobSchemaEntitiesForText(text: string, seedEntities: string[] = []): string[] {
  const normalized = text.toLowerCase()
  const matches = new Set(seedEntities)

  for (const entry of BOB_SCHEMA_REGISTRY) {
    const keywords = ENTITY_KEYWORDS[entry.entity] ?? [entry.entity]
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      matches.add(entry.entity)
    }
  }

  return Array.from(matches)
}