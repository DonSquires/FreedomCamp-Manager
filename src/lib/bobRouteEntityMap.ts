export interface BobRouteEntityMapEntry {
  path: string
  label: string
  primaryEntities: string[]
  supportingEntities: string[]
  recommendedMutations: string[]
  purpose: string
}

export const BOB_ROUTE_ENTITY_MAP: BobRouteEntityMapEntry[] = [
  {
    path: '/bob-assistant',
    label: 'Bob Assistant Studio',
    primaryEntities: ['bob_user_profiles', 'user_profiles'],
    supportingEntities: ['organizations'],
    recommendedMutations: ['queue_bob_code_change_task'],
    purpose: 'General Bob tasking, assisted execution, and operator guidance.',
  },
  {
    path: '/bob-intake-queue',
    label: 'Bob Intake Queue',
    primaryEntities: ['patrol_events', 'client_sites'],
    supportingEntities: ['organizations', 'user_profiles', 'zones'],
    recommendedMutations: ['import_data_file', 'import_historical_patrol_data'],
    purpose: 'Review staged intake packages and track downstream import/action state.',
  },
  {
    path: '/crm',
    label: 'CRM',
    primaryEntities: ['organizations', 'client_sites'],
    supportingEntities: ['user_profiles'],
    recommendedMutations: ['create_user_account'],
    purpose: 'Client and commercial relationship management.',
  },
  {
    path: '/client-sites',
    label: 'Client Sites',
    primaryEntities: ['client_sites', 'zones'],
    supportingEntities: ['organizations'],
    recommendedMutations: ['import_data_file'],
    purpose: 'Site setup and geospatial service footprint management.',
  },
  {
    path: '/pricing',
    label: 'Service Pricing',
    primaryEntities: ['organizations', 'client_sites'],
    supportingEntities: ['zones'],
    recommendedMutations: ['process_tender_document', 'generate_tender_sections'],
    purpose: 'Quote building, service-rate planning, and proposal generation.',
  },
  {
    path: '/compliance',
    label: 'Compliance',
    primaryEntities: ['zones', 'patrol_events'],
    supportingEntities: ['organizations', 'user_profiles'],
    recommendedMutations: ['generate_dashboard_report', 'email_dashboard_report'],
    purpose: 'Compliance review, enforcement context, and reportable outcomes.',
  },
  {
    path: '/incidents',
    label: 'Incidents',
    primaryEntities: ['operational_cases', 'patrol_events'],
    supportingEntities: ['user_profiles', 'zones'],
    recommendedMutations: ['import_historical_patrol_data'],
    purpose: 'Operational event investigation and case-linked patrol history.',
  },
  {
    path: '/reports',
    label: 'Reports',
    primaryEntities: ['patrol_events', 'zones', 'organizations'],
    supportingEntities: ['user_profiles'],
    recommendedMutations: ['generate_dashboard_report', 'email_dashboard_report'],
    purpose: 'Analytical exports and email distribution of report outputs.',
  },
  {
    path: '/settings',
    label: 'Settings',
    primaryEntities: ['user_profiles', 'organizations', 'bob_user_profiles'],
    supportingEntities: ['zones'],
    recommendedMutations: ['create_user_account', 'set_user_active_status'],
    purpose: 'Administrative configuration, user state, and Bob control settings.',
  },
  {
    path: '/data-management',
    label: 'Data Management',
    primaryEntities: ['observations', 'patrol_events', 'client_sites'],
    supportingEntities: ['organizations', 'zones'],
    recommendedMutations: ['import_data_file', 'import_historical_patrol_data'],
    purpose: 'Bulk data review, cleanup, import, and integrity workflows.',
  },
  {
    path: '/grandmaster-studio',
    label: 'Grandmaster Studio',
    primaryEntities: ['bob_user_profiles', 'user_profiles'],
    supportingEntities: ['organizations'],
    recommendedMutations: ['run_grandmaster_diagnostics', 'queue_owner_research_task', 'queue_bob_code_change_task'],
    purpose: 'Restricted coding, diagnostics, and owner-level task routing.',
  },
]

export function getBobRouteEntityMapSummary(limit = 8): string {
  return BOB_ROUTE_ENTITY_MAP.slice(0, limit)
    .map((entry) => `${entry.path} -> entities: ${entry.primaryEntities.join(', ')} | use: ${entry.recommendedMutations.join(', ')}`)
    .join('\n')
}

const ROUTE_LABEL_ALIASES: Record<string, string[]> = {
  '/bob-assistant': ['bob assistant', 'assistant studio'],
  '/bob-intake-queue': ['intake queue', 'bob intake'],
  '/crm': ['crm', 'customer relationship'],
  '/client-sites': ['client sites', 'sites', 'facilities'],
  '/pricing': ['pricing', 'quote', 'tender'],
  '/compliance': ['compliance', 'breach'],
  '/incidents': ['incident', 'case'],
  '/reports': ['report', 'dashboard'],
  '/settings': ['settings', 'admin settings'],
  '/data-management': ['data management', 'import data', 'cleanup'],
  '/grandmaster-studio': ['grandmaster', 'coding studio', 'diagnostics'],
}

export function findBobRouteEntriesForText(text: string, currentRoute?: string | null): BobRouteEntityMapEntry[] {
  const normalized = text.toLowerCase()
  const matches = new Map<string, BobRouteEntityMapEntry>()

  for (const entry of BOB_ROUTE_ENTITY_MAP) {
    if (currentRoute && currentRoute === entry.path) {
      matches.set(entry.path, entry)
      continue
    }

    if (normalized.includes(entry.path.toLowerCase())) {
      matches.set(entry.path, entry)
      continue
    }

    const aliases = ROUTE_LABEL_ALIASES[entry.path] ?? [entry.label.toLowerCase()]
    if (aliases.some((alias) => normalized.includes(alias))) {
      matches.set(entry.path, entry)
    }
  }

  return Array.from(matches.values())
}