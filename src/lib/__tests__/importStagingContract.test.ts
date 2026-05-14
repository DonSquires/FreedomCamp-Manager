import { describe, expect, it } from 'vitest'

import {
  buildHistoricalDispatchPlacementReview,
} from '@/lib/historicalDispatchIntelligence'
import { buildHistoricalPatrolImportDraft } from '@/lib/historicalPatrolIntelligence'

describe('normalizedImportStagingContract', () => {
  it('adds a staging contract to historical patrol drafts', () => {
    const raw = [
      'Bureau ID\tClient Name\tClient Suburb\tClient Postcode\tOn-site Date/Time\tOff-site Date/Time\tComments\tIs Incident Report\tPatrol Complete Status\tVisit Charge (ex. GST)\tDespatch Zone\tDespatch Date/Time\tInternal DespatchId',
      'FSG-NCC\tTHE REFINERY\tNELSON\t7010\t1/04/2026 8:43\t1/04/2026 8:48\tSECURE\tFALSE\tCompleted\t6.05\t585\t1/04/2026 6:00\t59199452',
      'FSG-AR\tNAYLAND COLLEGE\tNELSON\t7010\t\t\t\tFALSE\tMissed\t0\t584\t4/04/2026 0:00\t59233078',
    ].join('\n')

    const draft = buildHistoricalPatrolImportDraft(raw)

    expect(draft.stagingContract).toMatchObject({
      sourceKind: 'historical_patrol',
      sourceSystem: 'historical_patrol_export',
      actionType: 'import_historical_patrol_data',
      sourceRecordTable: 'historical_patrol_exports',
      recommendedTable: 'ai_import_intakes',
      actionTargetTable: 'ai_import_intakes',
      rowCount: 2,
    })
    expect(draft.stagingContract.summary).toContain('Historical patrol import draft')
    expect(draft.stagingContract.sourceRecordIds).toEqual(expect.arrayContaining(['59199452', '59233078']))
    expect(draft.stagingContract.reviewCoverage).toBeGreaterThanOrEqual(0)
  })

  it('adds a staging contract to historical alarm dispatch reviews', () => {
    const raw = [
      'Bureau ID\tBureau Name\tClient ID\tClient Name\tAlarm Response Date/Time\tOn-site Date/Time\tOff-site Date/Time\tDespatch Comments\tFollow-up Info.\tDespatch Zone / Subcontractor\tDespatch No.',
      '302314\tNELSON CITY COUNCIL\tNCCNOISE\tNELSON NOISE CONTROL\t1/01/2026 0:14\t0:20\t0:21\tNOISE COMPLAINT\tNO NOISE\t587\t58184481',
      '32005\tGLOBAL SECURITY\tGL5841\tTONYS TYRE\t1/01/2026 17:21\t17:29\t17:34\t*** INTRUDER ALARM ***\tEXTERNAL SECURE\t585\t58188644',
    ].join('\n')

    const review = buildHistoricalDispatchPlacementReview(raw)

    expect(review.stagingContract).toMatchObject({
      sourceKind: 'historical_alarm_dispatch',
      sourceSystem: 'historical_alarm_dispatch_export',
      actionType: 'historical_alarm_dispatch_review',
      sourceRecordTable: 'historical_alarm_dispatch_exports',
      recommendedTable: 'ai_import_intakes',
      actionTargetTable: 'ai_import_intakes',
      rowCount: 2,
    })
    expect(review.stagingContract.summary).toContain('Historical alarm/dispatch review')
    expect(review.stagingContract.sourceRecordIds).toEqual(expect.arrayContaining(['58184481', '58188644']))
    expect(review.stagingContract.reviewCoverage).toBe(1)
  })
})
