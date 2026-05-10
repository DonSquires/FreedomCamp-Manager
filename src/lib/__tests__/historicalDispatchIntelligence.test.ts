import { describe, expect, it } from 'vitest'

import {
  buildHistoricalDispatchPlacementReview,
  classifyHistoricalDispatchJob,
  verifyBobDispatchPlacementPlan,
  type HistoricalDispatchRow,
} from '@/lib/historicalDispatchIntelligence'

describe('historicalDispatchIntelligence', () => {
  it('classifies noise, alarm, and ATM jobs', () => {
    const noiseRow: HistoricalDispatchRow = {
      despatchNo: '1001',
      bureauName: 'NELSON CITY COUNCIL',
      clientId: 'NCCNOISE',
      clientName: 'NELSON NOISE CONTROL',
      alarmResponseAt: '1/01/2026 0:14',
      onSiteAt: '0:20',
      offSiteAt: '0:21',
      despatchComments: 'NOISE COMPLAINT',
      followUpInfo: 'NO NOISE ON ARRIVAL',
      zoneOrSubcontractor: '587',
    }

    const alarmRow: HistoricalDispatchRow = {
      ...noiseRow,
      despatchNo: '1002',
      clientId: 'GL5841',
      clientName: 'TONYS TYRE SERVICE',
      despatchComments: '*** INTRUDER ALARM *** ZONE 4',
      followUpInfo: 'EXTERNAL SECURE',
    }

    const atmRow: HistoricalDispatchRow = {
      ...noiseRow,
      despatchNo: '1003',
      clientId: 'ANUK6048',
      clientName: 'NELSON #1',
      bureauName: 'NCR ALLPOINT MAINTENANCE METRO NZ ATM SITES',
      despatchComments: 'ATM LOW CASH FISERV FLM TO ATTEND',
      followUpInfo: 'DISPENSER CHECKED, NO JAMS',
    }

    expect(classifyHistoricalDispatchJob(noiseRow).jobType).toBe('noise_control')
    expect(classifyHistoricalDispatchJob(alarmRow).jobType).toBe('alarm_activation')
    expect(classifyHistoricalDispatchJob(atmRow).jobType).toBe('atm_maintenance')
  })

  it('builds placement review from tabular alarm dispatch data', () => {
    const raw = [
      'Bureau ID\tBureau Name\tClient ID\tClient Name\tAlarm Response Date/Time\tOn-site Date/Time\tOff-site Date/Time\tDespatch Comments\tFollow-up Info.\tDespatch Zone / Subcontractor\tDespatch No.',
      '302314\tNELSON CITY COUNCIL\tNCCNOISE\tNELSON NOISE CONTROL\t1/01/2026 0:14\t0:20\t0:21\tNOISE COMPLAINT\tNO NOISE\t587\t58184481',
      '32005\tGLOBAL SECURITY\tGL5841\tTONYS TYRE\t1/01/2026 17:21\t17:29\t17:34\t*** INTRUDER ALARM ***\tEXTERNAL SECURE\t585\t58188644',
      'NCR\tNCR ALLPOINT MAINTENANCE METRO NZ ATM SITES\tANUK6048\tNELSON #1\t2/01/2026 12:54\t13:39\t14:07\tATM LOW CASH FISERV\tFLM ATTENDED\t585\t58196068',
    ].join('\n')

    const review = buildHistoricalDispatchPlacementReview(raw)

    expect(review.totalRows).toBe(3)
    expect(review.typeCounts.noise_control).toBe(1)
    expect(review.typeCounts.alarm_activation).toBe(1)
    expect(review.typeCounts.atm_maintenance).toBe(1)
  })

  it('verifies Bob placement plan and flags mismatches', () => {
    const raw = [
      'Bureau ID\tBureau Name\tClient ID\tClient Name\tAlarm Response Date/Time\tOn-site Date/Time\tOff-site Date/Time\tDespatch Comments\tFollow-up Info.\tDespatch Zone / Subcontractor\tDespatch No.',
      '302314\tNELSON CITY COUNCIL\tNCCNOISE\tNELSON NOISE CONTROL\t1/01/2026 0:14\t0:20\t0:21\tNOISE COMPLAINT\tNO NOISE\t587\t58184481',
    ].join('\n')
    const review = buildHistoricalDispatchPlacementReview(raw)

    const valid = verifyBobDispatchPlacementPlan({
      jobs: [{
        despatch_no: '58184481',
        job_type: 'noise_control',
        target_locations: ['noise_jobs', 'noise_assessments', 'dispatch_jobs'],
      }],
    }, review)

    const invalid = verifyBobDispatchPlacementPlan({
      jobs: [{
        despatch_no: '58184481',
        job_type: 'alarm_activation',
        target_locations: ['dispatch_jobs'],
      }],
    }, review)

    expect(valid.isValid).toBe(true)
    expect(invalid.isValid).toBe(false)
    expect(invalid.errors.join(' ')).toContain('expected noise_control')
  })
})
