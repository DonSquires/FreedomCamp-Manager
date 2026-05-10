import { describe, expect, it } from 'vitest'

import { coercePatrolSetupBlueprint } from '@/lib/bobSetupBlueprint'
import { resolvePatrolZoneFallback } from '@/lib/patrolZoneFallbacks'

describe('patrolZoneFallbacks', () => {
  it('returns the Nelson fallback patrol zone when the brief targets Nelson', () => {
    const blueprint = coercePatrolSetupBlueprint({
      title: 'Nelson City Council Patrol Setup',
      facilities: [{ name: 'Trafalgar Centre', extent: [], serviceCoverage: ['Security patrols'], frequencies: [], setupActions: [], notes: [] }],
    }, 'Nelson City patrol brief')

    const fallback = resolvePatrolZoneFallback(blueprint)

    expect(fallback?.zoneName).toBe('587 Nelson patrol')
    expect(fallback?.geometry.type).toBe('Polygon')
  })

  it('prefers shift code fallback mappings when supplied', () => {
    const richmondBlueprint = coercePatrolSetupBlueprint({
      title: 'Provider roster setup',
      patrolShifts: [{ code: '586', name: 'Richmond patrol', startTime: '18:00', endTime: '06:00', breaks: [], allBreaksPaid: true, coverageAreas: ['Richmond'], serviceCoverage: [], notes: [] }],
      facilities: [],
    }, 'Shift code coverage')

    const dayShiftBlueprint = coercePatrolSetupBlueprint({
      title: 'Day shift setup',
      patrolShifts: [{ code: '585', name: 'Day shift', startTime: '06:00', endTime: '18:00', breaks: [], allBreaksPaid: true, coverageAreas: ['Nelson', 'Richmond', 'Motueka'], serviceCoverage: [], notes: [] }],
      facilities: [],
    }, 'Shift code coverage')

    expect(resolvePatrolZoneFallback(richmondBlueprint)?.zoneName).toBe('586 Richmond patrol')
    expect(resolvePatrolZoneFallback(dayShiftBlueprint)?.zoneName).toBe('585 Day shift patrol')
  })
})