export type HistoricalImportAuditAction =
  | 'historical_import_stage'
  | 'historical_import_accept'
  | 'historical_import_reject'
  | 'historical_import_replay'

export interface HistoricalImportAuditPayload {
  organization_id: string
  performed_by: string | null
  entity_type: 'ai_import_intakes'
  entity_id: string
  action: HistoricalImportAuditAction
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown>
}

export function deriveHistoricalImportAuditAction(status: string): HistoricalImportAuditAction | null {
  switch (status) {
    case 'staged':
    case 'review_pending':
      return 'historical_import_stage'
    case 'actioned':
    case 'imported':
      return 'historical_import_accept'
    case 'failed':
      return 'historical_import_reject'
    case 'historical_started':
      return 'historical_import_replay'
    default:
      return null
  }
}

export function buildHistoricalImportAuditPayload(params: {
  organizationId: string
  performedBy: string | null
  intakeId: string
  oldStatus?: string | null
  newStatus: string
  actionTargetTable?: string | null
  actionTargetId?: string | null
  actionSummary?: string | null
  fileName?: string | null
  fileKind?: string | null
  sourceSystem?: string | null
  extraOldValues?: Record<string, unknown>
  extraNewValues?: Record<string, unknown>
}): HistoricalImportAuditPayload | null {
  const action = deriveHistoricalImportAuditAction(params.newStatus)
  if (!action) return null

  return {
    organization_id: params.organizationId,
    performed_by: params.performedBy,
    entity_type: 'ai_import_intakes',
    entity_id: params.intakeId,
    action,
    old_values: {
      status: params.oldStatus ?? null,
      ...params.extraOldValues,
    },
    new_values: {
      status: params.newStatus,
      action_target_table: params.actionTargetTable ?? null,
      action_target_id: params.actionTargetId ?? null,
      action_summary: params.actionSummary ?? null,
      file_name: params.fileName ?? null,
      file_kind: params.fileKind ?? null,
      source_system: params.sourceSystem ?? null,
      ...params.extraNewValues,
    },
  }
}

export async function recordHistoricalImportAudit(supabase: any, payload: HistoricalImportAuditPayload | null) {
  if (!payload) return
  const { error } = await supabase.from('audit_log').insert(payload)
  if (error) throw error
}