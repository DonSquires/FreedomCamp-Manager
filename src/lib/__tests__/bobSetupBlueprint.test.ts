import { describe, expect, it } from 'vitest'

import {
  buildPatrolSetupBlueprintDocument,
  coercePatrolSetupBlueprint,
  evaluateHistoricalDataPlacementReadiness,
  evaluatePatrolShiftCompliance,
  findPrimaryShiftForCode,
  formatHistoricalPerformanceAdminFeedback,
  formatHistoricalPlacementConversation,
  formatHistoricalPlacementSummary,
  formatPatrolShiftComplianceConversation,
  formatPatrolShiftComplianceSummary,
  findSopStepsForFacility,
  formatPatrolSetupBlueprintReply,
  inferSiteType,
  looksLikePatrolSetupBrief,
  reviewHistoricalPatrolPerformance,
} from '@/lib/bobSetupBlueprint'

describe('bobSetupBlueprint', () => {
  it('detects patrol setup briefs from contract-style input', () => {
    const input = [
      '1.1 Security Patrols',
      '2.1.4 Frequency D (7days x2)',
      '3.1 Civic House',
      '3.1.2 Which services to which standard:',
      'Service 1.3 Response to Alarm or Security Breach',
    ].join('\n')

    expect(looksLikePatrolSetupBrief(input)).toBe(true)
  })

  it('coerces parsed blueprint data into stable structure', () => {
    const blueprint = coercePatrolSetupBlueprint({
      title: 'Nelson Council Security Setup',
      services: ['Security patrols', 'Lock and unlock gates'],
      facilities: [
        {
          name: 'Civic House',
          extent: ['Building'],
          serviceCoverage: ['Security patrols', 'Alarm response'],
          frequencies: ['Frequency D'],
          setupActions: ['Create client site', 'Create linked zone geofence'],
          notes: ['Requires late-close coordination'],
        },
      ],
      blockers: ['Missing site coordinates'],
      nextActions: ['Create organization', 'Seed first patrol route'],
      patrolShifts: [{ code: '587', name: 'Nelson patrol', startTime: '18:00', endTime: '06:00', breaks: ['30 min dinner'], allBreaksPaid: true, coverageAreas: ['Nelson'], serviceCoverage: ['Noise control'], notes: [] }],
    }, 'source text')

    expect(blueprint.facilities).toHaveLength(1)
    expect(blueprint.facilities[0].name).toBe('Civic House')
    expect(blueprint.blockers).toContain('Missing site coordinates')
    expect(blueprint.patrolShifts[0].code).toBe('587')
  })

  it('formats a readable reply and plan document', () => {
    const blueprint = coercePatrolSetupBlueprint({
      summary: 'Structured setup extracted for patrol onboarding.',
      facilities: [
        { name: 'Saxton Field', extent: ['Stadium'], serviceCoverage: ['Security patrols'], frequencies: ['Frequency G'], setupActions: ['Create zone'], notes: [] },
      ],
      siteSops: [
        { siteName: 'Saxton Field', jobType: 'lockup', steps: ['Check no vehicles onsite', 'Ask persons to leave', 'Close and lock gate'] },
      ],
      patrolShifts: [
        { code: '585', name: 'Day shift', startTime: '06:00', endTime: '18:00', breaks: ['30 min break', '15 min break', '15 min break'], allBreaksPaid: true, coverageAreas: ['Nelson', 'Richmond', 'Motueka'], serviceCoverage: ['EMS', 'Noise', 'Freedom camping'], notes: [] },
      ],
      blockers: ['Need GPS coordinates for geofence'],
      nextActions: ['Create client site and link geofence'],
    }, 'raw source')

    expect(formatPatrolSetupBlueprintReply(blueprint)).toContain('Current blockers: Need GPS coordinates for geofence.')
    expect(formatPatrolSetupBlueprintReply(blueprint)).toContain('Patrol shifts captured: 585')
    expect(buildPatrolSetupBlueprintDocument(blueprint)).toContain('## Facilities')
    expect(buildPatrolSetupBlueprintDocument(blueprint)).toContain('## Site SOPs')
    expect(buildPatrolSetupBlueprintDocument(blueprint)).toContain('## Patrol Shift Templates')
    expect(buildPatrolSetupBlueprintDocument(blueprint)).toContain('Saxton Field')
    expect(findSopStepsForFacility(blueprint, 'Saxton Field')).toContain('Close and lock gate')
  })

  it('infers site types from service text', () => {
    expect(inferSiteType(['Noise control patrol'])).toBe('noise_control')
    expect(inferSiteType(['Night patrol route checks'])).toBe('patrol')
    expect(inferSiteType(['Static security guards'])).toBe('guarding')
  })

  it('derives patrol shifts and flags code mismatch from raw pasted schedule text', () => {
    const raw = [
      'this is 586 :',
      'Patrol Summary',
      'Client Id Site Address',
      'NELSON 22:00 00:00',
      '587',
      'NELSON 01:00 06:00',
      '587',
      'Patrol Officer Declaration',
    ].join('\n')

    const blueprint = coercePatrolSetupBlueprint({}, raw)

    expect(looksLikePatrolSetupBrief(raw)).toBe(true)
    expect(blueprint.patrolShifts.length).toBeGreaterThan(0)
    expect(blueprint.patrolShifts[0].code).toBe('587')
    expect(blueprint.blockers.join(' ')).toContain('Declared patrol code 586 conflicts with observed row code 587')
  })

  it('evaluates compliant shifts when task, travel, and breaks fit shift window', () => {
    const source = [
      '22:00 22:40 40',
      '587',
      '23:10 23:50 40',
      '587',
    ].join('\n')

    const blueprint = coercePatrolSetupBlueprint({
      patrolShifts: [
        {
          code: '587',
          name: 'Nelson patrol',
          startTime: '22:00',
          endTime: '06:00',
          breaks: ['30 min paid break'],
          allBreaksPaid: true,
          timingPolicy: 'specific',
          coverageAreas: ['Nelson'],
          serviceCoverage: ['Noise control'],
          notes: [],
        },
      ],
    }, source)

    const [result] = evaluatePatrolShiftCompliance(blueprint, { defaultTravelMinutesBetweenStops: 10 })
    expect(result.shiftMinutes).toBe(480)
    expect(result.totalRequiredMinutes).toBe(120)
    expect(result.isCompliant).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('flags non-compliant specific timing shifts when source durations are missing', () => {
    const blueprint = coercePatrolSetupBlueprint({
      patrolShifts: [
        {
          code: '586',
          name: 'Richmond patrol',
          startTime: '22:00',
          endTime: '02:00',
          breaks: ['30 min meal break'],
          allBreaksPaid: false,
          timingPolicy: 'specific',
          coverageAreas: ['Richmond'],
          serviceCoverage: ['Freedom camping'],
          notes: [],
        },
      ],
    }, 'no parsed duration rows present in this text')

    const [result] = evaluatePatrolShiftCompliance(blueprint)
    expect(result.isCompliant).toBe(false)
    expect(result.reasons.join(' ')).toContain('no specific run durations were parsed')
    expect(result.reasons.join(' ')).toContain('Breaks are not marked as fully paid')
  })

  it('prefers exact patrol code when selecting primary shift', () => {
    const blueprint = coercePatrolSetupBlueprint({
      patrolShifts: [
        { code: '587', name: 'Nelson', startTime: '18:00', endTime: '06:00', breaks: [], allBreaksPaid: true, timingPolicy: 'recommended', coverageAreas: [], serviceCoverage: [], notes: [] },
        { code: '586', name: 'Richmond', startTime: '18:00', endTime: '05:00', breaks: [], allBreaksPaid: true, timingPolicy: 'recommended', coverageAreas: [], serviceCoverage: [], notes: [] },
      ],
    }, 'source')

    const primary = findPrimaryShiftForCode(blueprint, '586')
    const fallback = findPrimaryShiftForCode(blueprint, '999')

    expect(primary?.code).toBe('586')
    expect(fallback?.code).toBe('587')
  })

  it('formats user-facing compliance summary and conversation text', () => {
    const compliant = [{
      shiftCode: '585',
      shiftName: 'Day shift',
      shiftMinutes: 720,
      taskMinutes: 210,
      breakMinutes: 60,
      travelMinutes: 40,
      totalRequiredMinutes: 310,
      isCompliant: true,
      timingPolicy: 'recommended' as const,
      reasons: [],
    }]

    const failed = [{
      shiftCode: '587',
      shiftName: 'Nelson patrol',
      shiftMinutes: 180,
      taskMinutes: 220,
      breakMinutes: 30,
      travelMinutes: 16,
      totalRequiredMinutes: 266,
      isCompliant: false,
      timingPolicy: 'specific' as const,
      reasons: ['Required minutes (266) exceed shift window (180).'],
    }]

    expect(formatPatrolShiftComplianceSummary(compliant)).toContain('Non-compliant shifts: 0')
    expect(formatPatrolShiftComplianceConversation(compliant)).toContain('checks passed')

    expect(formatPatrolShiftComplianceSummary(failed)).toContain('Issues:')
    expect(formatPatrolShiftComplianceConversation(failed)).toContain('Top issue: 587')
    expect(formatPatrolShiftComplianceConversation(failed)).toContain('specific contract times or recommended windows')
  })

  it('detects and derives from historical despatch zone patrol table data', () => {
    const raw = [
      'Bureau ID\tBureau Name\tClient ID\tClient Name\tOn-site Date/Time\tOff-site Date/Time\tPatrol Complete Status\tDespatch Zone',
      'FSG-NCC\tNELSON CITY COUNCIL SECURITY CONTRACT\tNCC200\tTHE REFINERY\t3/04/2026 9:15\t3/04/2026 9:27\tCompleted\t585',
      'FSG-NCC\tNELSON CITY COUNCIL SECURITY CONTRACT\tNCC400\tEX 4 SEASONS\t3/04/2026 8:44\t3/04/2026 8:46\tCompleted\t585',
      'FSGS-NSN-AR-DB\tNELSON - ALARM RESPONSE - DIRECT BILL\tNA5661\tNAYLAND COLLEGE\t\t\tMissed\t584',
    ].join('\n')

    expect(looksLikePatrolSetupBrief(raw)).toBe(true)

    const blueprint = coercePatrolSetupBlueprint({}, raw)
    expect(blueprint.patrolShifts.length).toBeGreaterThan(0)
    expect(blueprint.patrolShifts[0].code).toBe('585')

    const results = evaluatePatrolShiftCompliance(blueprint)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].taskMinutes).toBeGreaterThan(0)

    const review = evaluateHistoricalDataPlacementReadiness(blueprint)
    expect(review.detectedRows).toBe(3)
    expect(review.completedRows).toBe(2)
    expect(review.missedRows).toBe(1)
    expect(review.isPlacementReady).toBe(false)
    expect(formatHistoricalPlacementSummary(review)).toContain('Placement readiness: blocked')
    expect(formatHistoricalPlacementConversation(review)).toContain('needs correction before import')

    const perf = reviewHistoricalPatrolPerformance(blueprint)
    expect(perf.detectedRows).toBe(3)
    expect(perf.issues.length).toBeGreaterThanOrEqual(0)
  })

  it('provides admin feedback for historical performance failure patterns', () => {
    const rows: string[] = [
      'Bureau ID\tClient Name\tOn-site Date/Time\tOff-site Date/Time\tPatrol Complete Status\tOn-site Distance from Site\tTime On-site Variation (mins)\tDespatch Date/Time\tDespatch Zone',
    ]

    for (let i = 1; i <= 8; i += 1) {
      const day = String(i).padStart(2, '0')
      const status = i <= 4 ? 'Missed' : 'Completed'
      const onsite = status === 'Completed' ? `${day}/04/2026 08:00` : ''
      const offsite = status === 'Completed' ? `${day}/04/2026 08:03` : ''
      const despatch = `${day}/04/2026 06:00`
      rows.push([
        'FSG-NCC',
        'Test Site',
        onsite,
        offsite,
        status,
        '1800',
        '12',
        despatch,
        '585',
      ].join('\t'))
    }

    const blueprint = coercePatrolSetupBlueprint({ facilities: [{ name: 'Test Site', extent: [], serviceCoverage: [], frequencies: [], setupActions: [], notes: [] }] }, rows.join('\n'))
    const perf = reviewHistoricalPatrolPerformance(blueprint)
    const adminFeedback = formatHistoricalPerformanceAdminFeedback(perf)

    expect(perf.detectedRows).toBe(8)
    expect(perf.issues.length).toBeGreaterThan(0)
    expect(adminFeedback).toContain('Proposed admin actions')
    expect(adminFeedback).toContain('approval required')
  })
})