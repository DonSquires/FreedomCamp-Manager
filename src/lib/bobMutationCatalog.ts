export interface BobMutationCatalogEntry {
  id: string
  contract: string
  writesTo: string[]
  purpose: string
  allowedExecutionModes: Array<'owner_full' | 'master_balanced' | 'officer_assist'>
  approvalLevel: 'none' | 'review' | 'owner_only'
  dryRunSupported: boolean
  notes?: string
}

export const BOB_MUTATION_CATALOG: BobMutationCatalogEntry[] = [
  {
    id: 'create_patrol_setup_draft',
    contract: 'supabase.directPatrolSetupDraft',
    writesTo: ['client_sites', 'zones'],
    purpose: 'Create draft site and linked zone records from approved patrol setup briefs.',
    allowedExecutionModes: ['owner_full', 'master_balanced'],
    approvalLevel: 'review',
    dryRunSupported: true,
    notes: 'Creates draft setup records only. Geofence coordinates and patrol schedules still require verified site location data.',
  },
  {
    id: 'import_data_file',
    contract: 'edgeFunctions.importData',
    writesTo: ['zones', 'observations'],
    purpose: 'General AI-assisted file import for operational data using controlled backend validation.',
    allowedExecutionModes: ['owner_full', 'master_balanced'],
    approvalLevel: 'review',
    dryRunSupported: false,
    notes: 'Use for staged imports, not arbitrary table writes.',
  },
  {
    id: 'import_historical_patrol_data',
    contract: 'edgeFunctions.importHistoricalData',
    writesTo: ['patrol_events', 'zones'],
    purpose: 'Excel or batch import path for historical patrol records with controlled matching.',
    allowedExecutionModes: ['owner_full', 'master_balanced'],
    approvalLevel: 'review',
    dryRunSupported: false,
  },
  {
    id: 'process_tender_document',
    contract: 'edgeFunctions.processTenderDocument',
    writesTo: ['organizations', 'assessment artifact'],
    purpose: 'Analyze tender/RFP material and persist structured assessment safely.',
    allowedExecutionModes: ['owner_full', 'master_balanced'],
    approvalLevel: 'review',
    dryRunSupported: false,
  },
  {
    id: 'generate_tender_sections',
    contract: 'edgeFunctions.generateTenderSections',
    writesTo: ['generated tender content only'],
    purpose: 'Generate application or response sections from approved tender context.',
    allowedExecutionModes: ['owner_full', 'master_balanced'],
    approvalLevel: 'review',
    dryRunSupported: false,
  },
  {
    id: 'generate_dashboard_report',
    contract: 'edgeFunctions.generateDashboardReport',
    writesTo: ['generated report artifact only'],
    purpose: 'Create report output from existing operational data without direct table mutation.',
    allowedExecutionModes: ['owner_full', 'master_balanced', 'officer_assist'],
    approvalLevel: 'none',
    dryRunSupported: true,
  },
    {
      id: 'generate_briefing_video',
      contract: 'edgeFunctions.generateBriefingVideo',
      writesTo: ['media_generation_log', 'video_briefing_packs'],
      purpose: 'Generate briefing video artifact via FFmpeg or deterministic rendering, with immutable audit trail.',
      allowedExecutionModes: ['owner_full', 'master_balanced', 'officer_assist'],
      approvalLevel: 'review',
      dryRunSupported: true,
      notes: 'Bob can extract video parameters (quality, format, purpose, incident_id) from natural language requests and invoke generation. All creations logged immutably with actor_user_id and org_id scoping.',
    },
  {
    id: 'email_dashboard_report',
    contract: 'edgeFunctions.sendReportEmail',
    writesTo: ['email delivery only'],
    purpose: 'Send generated report output to a validated recipient.',
    allowedExecutionModes: ['owner_full', 'master_balanced'],
    approvalLevel: 'review',
    dryRunSupported: false,
  },
  {
    id: 'create_user_account',
    contract: 'edgeFunctions.createUser',
    writesTo: ['user_profiles', 'auth.users'],
    purpose: 'Create a user via the managed user creation path.',
    allowedExecutionModes: ['owner_full', 'master_balanced'],
    approvalLevel: 'review',
    dryRunSupported: false,
  },
  {
    id: 'set_user_active_status',
    contract: 'edgeFunctions.setUserActiveStatus',
    writesTo: ['user_profiles'],
    purpose: 'Activate or deactivate a user via a controlled admin contract.',
    allowedExecutionModes: ['owner_full', 'master_balanced'],
    approvalLevel: 'review',
    dryRunSupported: false,
  },
  {
    id: 'queue_bob_code_change_task',
    contract: 'edgeFunctions.bobCodeChangeTask',
    writesTo: ['task queue only'],
    purpose: 'Queue a Bob code-change or human-test task instead of editing systems directly.',
    allowedExecutionModes: ['owner_full'],
    approvalLevel: 'owner_only',
    dryRunSupported: true,
  },
  {
    id: 'run_grandmaster_diagnostics',
    contract: 'edgeFunctions.grandmasterStudio',
    writesTo: ['diagnostic logs only'],
    purpose: 'Run guarded Bob health and infrastructure diagnostics through the Grandmaster workflow.',
    allowedExecutionModes: ['owner_full'],
    approvalLevel: 'owner_only',
    dryRunSupported: true,
  },
  {
    id: 'queue_owner_research_task',
    contract: 'edgeFunctions.grandmasterStudio',
    writesTo: ['owner research queue only'],
    purpose: 'Queue owner-reviewed research or Copilot task requests for later execution.',
    allowedExecutionModes: ['owner_full'],
    approvalLevel: 'owner_only',
    dryRunSupported: true,
  },
]

export function getBobMutationCatalogSummary(limit = 9): string {
  return BOB_MUTATION_CATALOG.slice(0, limit)
    .map((entry) => `${entry.id} -> ${entry.contract} | writes: ${entry.writesTo.join(', ')} | approval: ${entry.approvalLevel}`)
    .join('\n')
}

export type BobExecutionMode = 'owner_full' | 'master_balanced' | 'officer_assist'

export interface BobMutationAccessResult {
  allowed: boolean
  reason: string
  entry: BobMutationCatalogEntry | null
}

const MUTATION_KEYWORDS: Record<string, string[]> = {
  create_patrol_setup_draft: ['patrol setup', 'create sites', 'setup sites', 'security brief'],
  import_data_file: ['import data', 'bulk import', 'upload data'],
  import_historical_patrol_data: ['historical patrol', 'patrol import', 'visit import'],
  process_tender_document: ['tender', 'rfp', 'proposal'],
  generate_tender_sections: ['generate tender', 'draft response'],
  generate_dashboard_report: ['report', 'dashboard'],
    generate_briefing_video: ['briefing video', 'generate video', 'create video', 'video briefing', 'make video'],
  email_dashboard_report: ['email report', 'send report'],
  create_user_account: ['create user', 'new user', 'add staff'],
  set_user_active_status: ['deactivate user', 'activate user'],
  queue_bob_code_change_task: ['code change', 'patch task', 'fix bug'],
  run_grandmaster_diagnostics: ['diagnostics', 'health check', 'doctor health'],
  queue_owner_research_task: ['research task', 'ask copilot', 'queue owner'],
}

export function getBobMutationCatalogEntry(contractId: string): BobMutationCatalogEntry | null {
  return BOB_MUTATION_CATALOG.find((entry) => entry.id === contractId) ?? null
}

export function assertBobMutationAccess(contractId: string, mode: BobExecutionMode): BobMutationAccessResult {
  const entry = getBobMutationCatalogEntry(contractId)

  if (!entry) {
    return {
      allowed: false,
      reason: `Unknown Bob mutation contract: ${contractId}`,
      entry: null,
    }
  }

  if (!entry.allowedExecutionModes.includes(mode)) {
    return {
      allowed: false,
      reason: `Contract ${contractId} is not allowed for execution mode ${mode}.`,
      entry,
    }
  }

  return {
    allowed: true,
    reason: `Contract ${contractId} is allowed for execution mode ${mode}.`,
    entry,
  }
}

export function findBobMutationContractsForText(text: string, seedContractIds: string[] = []): string[] {
  const normalized = text.toLowerCase()
  const matches = new Set(seedContractIds)

  for (const entry of BOB_MUTATION_CATALOG) {
    const keywords = MUTATION_KEYWORDS[entry.id] ?? [entry.id]
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      matches.add(entry.id)
    }
  }

  return Array.from(matches)
}