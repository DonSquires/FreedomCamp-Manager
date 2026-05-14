import { describe, expect, it } from 'vitest'

import { buildHistoricalImportAuditPayload, deriveHistoricalImportAuditAction } from '@/lib/historicalImportAudit'

describe('historicalImportAudit', () => {
  it('maps intake statuses to audit actions', () => {
    expect(deriveHistoricalImportAuditAction('staged')).toBe('historical_import_stage')
    expect(deriveHistoricalImportAuditAction('actioned')).toBe('historical_import_accept')
    expect(deriveHistoricalImportAuditAction('failed')).toBe('historical_import_reject')
    expect(deriveHistoricalImportAuditAction('historical_started')).toBe('historical_import_replay')
    expect(deriveHistoricalImportAuditAction('draft')).toBeNull()
  })

  it('builds an org-scoped audit payload for intake changes', () => {
    const payload = buildHistoricalImportAuditPayload({
      organizationId: 'org-1',
      performedBy: 'user-1',
      intakeId: 'intake-1',
      oldStatus: 'draft',
      newStatus: 'historical_started',
      actionSummary: 'Historical replay started',
      fileName: 'import.csv',
      fileKind: 'spreadsheet',
      sourceSystem: 'historical_import',
    })

    expect(payload).toMatchObject({
      organization_id: 'org-1',
      performed_by: 'user-1',
      entity_type: 'ai_import_intakes',
      entity_id: 'intake-1',
      action: 'historical_import_replay',
    })
    expect(payload?.new_values).toMatchObject({
      status: 'historical_started',
      action_summary: 'Historical replay started',
      file_name: 'import.csv',
      file_kind: 'spreadsheet',
      source_system: 'historical_import',
    })
  })
})