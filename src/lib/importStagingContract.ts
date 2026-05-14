export type NormalizedImportSourceKind = 'historical_patrol' | 'historical_alarm_dispatch'

export type NormalizedImportActionType = 'import_historical_patrol_data' | 'historical_alarm_dispatch_review'

export interface NormalizedImportStagingContract {
  sourceKind: NormalizedImportSourceKind
  sourceSystem: string
  actionType: NormalizedImportActionType
  recommendedTable: 'ai_import_intakes'
  actionTargetTable: 'ai_import_intakes'
  rowCount: number
  rowsRequiringReview: number
  reviewCoverage: number
  qualitySignals: string[]
  summary: string
}

export function buildNormalizedImportStagingContract(input: {
  sourceKind: NormalizedImportSourceKind
  sourceSystem: string
  actionType: NormalizedImportActionType
  rowCount: number
  rowsRequiringReview: number
  summaryParts: string[]
  qualitySignals?: string[]
}): NormalizedImportStagingContract {
  const rowCount = Math.max(0, Math.trunc(input.rowCount))
  const rowsRequiringReview = Math.max(0, Math.trunc(input.rowsRequiringReview))

  return {
    sourceKind: input.sourceKind,
    sourceSystem: input.sourceSystem,
    actionType: input.actionType,
    recommendedTable: 'ai_import_intakes',
    actionTargetTable: 'ai_import_intakes',
    rowCount,
    rowsRequiringReview,
    reviewCoverage: rowCount > 0 ? Number(((rowCount - rowsRequiringReview) / rowCount).toFixed(2)) : 0,
    qualitySignals: Array.from(new Set((input.qualitySignals ?? []).map((signal) => signal.trim()).filter(Boolean))),
    summary: input.summaryParts.map((part) => part.trim()).filter(Boolean).join(' · '),
  }
}