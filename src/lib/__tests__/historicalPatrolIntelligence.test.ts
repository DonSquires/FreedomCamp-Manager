import { describe, expect, it } from 'vitest'

import { buildHistoricalPatrolImportDraft, buildHistoricalPatrolPlacementReview, looksLikeHistoricalPatrolImport } from '@/lib/historicalPatrolIntelligence'

describe('historicalPatrolIntelligence', () => {
  it('builds patrol pre-review metrics from Nelson export rows', () => {
    const raw = [
      'Bureau ID\tBureau Name\tClient ID\tClient Name\tOn-site Date/Time\tOff-site Date/Time\tComments\tIs Incident Report\tPatrol Complete Status\tVisit Charge (ex. GST)\tDespatch Zone\tDespatch Date/Time\tInternal DespatchId',
      'FSG-NCC\tNELSON CITY COUNCIL SECURITY CONTRACT\tNCC200\tTHE REFINERY\t1/04/2026 8:43\t1/04/2026 8:48\tSECURE\tFALSE\tCompleted\t6.05\t585\t1/04/2026 6:00\t59199452',
      'FSGS-NSN-AR-DB\tNELSON - ALARM RESPONSE - DIRECT BILL\tNA5661\tNAYLAND COLLEGE\t\t\t\tFALSE\tMissed\t0\t584\t4/04/2026 0:00\t59233078',
      'FSGS-NSN-AR-DB\tNELSON - ALARM RESPONSE - DIRECT BILL\tNA5512\tFIRST SECURITY NN\t1/04/2026 8:57\t1/04/2026 9:04\tEND DELIVERED\tTRUE\tCompleted\t0\t585\t1/04/2026 9:00\t59199453',
    ].join('\n')

    const review = buildHistoricalPatrolPlacementReview(raw)

    expect(review.totalRows).toBe(3)
    expect(review.completedRows).toBe(2)
    expect(review.missedRows).toBe(1)
    expect(review.rowsWithInternalDespatchId).toBe(3)
    expect(review.rowsWithTimestamps).toBe(2)
    expect(review.incidentReportRows).toBe(1)
    expect(review.uniqueClientCount).toBe(3)
    expect(review.totalVisitChargeExGst).toBe(6.05)
    expect(review.averageVisitChargeExGst).toBeCloseTo(2.02, 2)
  })

  it('handles quoted multiline comment rows without losing alignment', () => {
    const raw = [
      'Bureau ID\tClient Name\tOn-site Date/Time\tOff-site Date/Time\tIs Incident Report\tPatrol Complete Status\tVisit Charge (ex. GST)\tDespatch Zone\tDespatch Date/Time\tInternal DespatchId',
      'FSGS-NSN-MPP-DB\tFULTON HOGAN NELSON\t4/04/2026 8:23\t4/04/2026 8:43\tFALSE\tCompleted\t5.8\t585\t4/04/2026 6:00\t59231396',
      'FSGS-NSN-MPP-DB\tFULTON HOGAN NELSON\t4/04/2026 8:23\t4/04/2026 8:43\tFALSE\tCompleted\t5.8\t585\t4/04/2026 6:00\t59231397\t"TRUCK FOUND UNLOCKED\nWITH EXTRA NOTE"',
    ].join('\n')

    const review = buildHistoricalPatrolPlacementReview(raw)
    expect(review.totalRows).toBe(2)
    expect(review.rowsWithInternalDespatchId).toBe(2)
  })

  it('builds normalized import draft with geofence hints and workflow actions', () => {
    const raw = [
      'Bureau ID\tClient Name\tClient Suburb\tClient Postcode\tOn-site Date/Time\tOff-site Date/Time\tComments\tIs Incident Report\tPatrol Complete Status\tVisit Charge (ex. GST)\tDespatch Zone\tDespatch Date/Time\tInternal DespatchId',
      'FSG-NCC\tTHE REFINERY\tNELSON\t7010\t1/04/2026 8:43\t1/04/2026 8:48\tSECURE\tFALSE\tCompleted\t6.05\t585\t1/04/2026 6:00\t59199452',
      'FSG-AR\tNAYLAND COLLEGE\tNELSON\t7010\t\t\t\tFALSE\tMissed\t0\t584\t4/04/2026 0:00\t59233078',
      'FSG-AR\tFULTON HOGAN\tNELSON\t7010\t3/04/2026 8:18\t3/04/2026 8:31\tUNLOCKED SHED\tTRUE\tCompleted\t5.8\t585\t3/04/2026 6:00\t59220952',
    ].join('\n')

    const draft = buildHistoricalPatrolImportDraft(raw)

    expect(draft.totalRows).toBe(3)
    expect(draft.zoneCoverage[0]).toEqual({ zoneCode: '585', count: 2 })
    expect(draft.normalizedRows[0].geofence_hint).toBe('585|NELSON|7010')
    expect(draft.normalizedRows[1].workflow_action).toBe('schedule_makeup_patrol')
    expect(draft.normalizedRows[2].workflow_action).toBe('create_incident_followup')
    expect(draft.rowsRequiringReview).toBeGreaterThan(0)
  })

  it('detects historical patrol exports and preserves source text on the normalized draft', () => {
    const raw = [
      'Bureau ID\tClient Name\tOn-site Date/Time\tOff-site Date/Time\tIs Incident Report\tPatrol Complete Status\tVisit Charge (ex. GST)\tDespatch Zone\tDespatch Date/Time\tInternal DespatchId',
      'FSG-NCC\tTHE REFINERY\t1/04/2026 8:43\t1/04/2026 8:48\tFALSE\tCompleted\t6.05\t585\t1/04/2026 6:00\t59199452',
    ].join('\n')

    expect(looksLikeHistoricalPatrolImport(raw)).toBe(true)

    const draft = buildHistoricalPatrolImportDraft(raw)
    expect(draft.sourceText).toContain('Internal DespatchId')
    expect(draft.zoneCoverage).toEqual([{ zoneCode: '585', count: 1 }])
  })

  it('routes legacy noise rows to noise_control and keeps alarm rows separate', () => {
    const raw = [
      'Bureau ID\tClient Name\tComments\tIs Incident Report\tPatrol Complete Status\tVisit Charge (ex. GST)\tDespatch Zone\tDespatch Date/Time\tInternal DespatchId',
      'FSGS-NSN-NCO\tNELSON NOISE CONTROL\tWILSAR RAPID NOISE CALL\tFALSE\tCompleted\t0\t587\t1/04/2026 22:00\t700001',
      'FSGS-NSN-AR-DB\tSCHOOL ALARM\tALARM ACTIVATION\tFALSE\tCompleted\t0\t584\t1/04/2026 23:00\t700002',
      'FSGS-NSN-MPP-DB\tCBD PATROL\tPATROL CHECK\tFALSE\tCompleted\t0\t585\t1/04/2026 23:30\t700003',
    ].join('\n')

    const draft = buildHistoricalPatrolImportDraft(raw)

    expect(draft.totalRows).toBe(3)
    expect(draft.routingCoverage).toEqual(expect.arrayContaining([
      { module: 'noise_control', count: 1 },
      { module: 'alarm_response', count: 1 },
      { module: 'patrol_response', count: 1 },
    ]))
    expect(draft.normalizedRows.find((row) => row.dispatch_id === '700001')?.routing_module).toBe('noise_control')
    expect(draft.normalizedRows.find((row) => row.dispatch_id === '700002')?.routing_module).toBe('alarm_response')
    expect(draft.siteCoverage.length).toBeGreaterThan(0)
  })

  it('builds site-resolution suggestions and zone fallback behavior from geofence hints', () => {
    const raw = [
      'Bureau ID\tClient ID\tClient Name\tClient Suburb\tClient Postcode\tOn-site Date/Time\tOff-site Date/Time\tComments\tIs Incident Report\tPatrol Complete Status\tVisit Charge (ex. GST)\tDespatch Zone\tDespatch Date/Time\tInternal DespatchId',
      'FSG-NCC\tNCC200\tTHE REFINERY\tNELSON\t7010\t1/04/2026 8:43\t1/04/2026 8:48\tSECURE\tFALSE\tCompleted\t6.05\t585\t1/04/2026 6:00\t900001',
      'FSG-NCC\tUNK999\tUNMATCHED SITE\tNELSON\t7010\t1/04/2026 9:00\t1/04/2026 9:10\tCHECK\tFALSE\tCompleted\t5.00\t587\t1/04/2026 8:30\t900002',
    ].join('\n')

    const draft = buildHistoricalPatrolImportDraft(raw)

    const matched = draft.normalizedRows.find((row) => row.dispatch_id === '900001')
    expect(matched?.resolved_client_organization_id).toBeTruthy()
    expect(matched?.site_resolution_suggestions.some((entry) => entry.source === 'template_site_code')).toBe(true)
    expect(matched?.zone_fallback_zone_id).toBeTruthy()

    const unmatched = draft.normalizedRows.find((row) => row.dispatch_id === '900002')
    expect(unmatched?.site_resolution_suggestions.some((entry) => entry.source === 'zone_fallback')).toBe(true)
    expect(unmatched?.zone_fallback_zone_id).toBe(unmatched?.resolved_zone_id)
    expect(unmatched?.zone_fallback_reason).toContain('Dispatch zone code')
  })
})
