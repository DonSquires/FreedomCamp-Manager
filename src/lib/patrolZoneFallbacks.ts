import type { PatrolSetupBlueprint } from '@/lib/bobSetupBlueprint'

export interface PatrolZoneFallback {
  zoneName: string
  description: string
  boundarySource: string
  geometry: {
    type: 'Polygon'
    coordinates: number[][][]
  }
  radiusMetres: number
}

const NELSON_PATROL_FALLBACK: PatrolZoneFallback = {
  zoneName: '587 Nelson patrol',
  description: 'Nelson City boundary area fallback patrol zone derived from the repo jurisdiction map definitions.',
  boundarySource: 'repo_fallback_nelson_city_boundary',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [173.1, -41.15],
      [173.4, -41.15],
      [173.4, -41.4],
      [173.1, -41.4],
      [173.1, -41.15],
    ]],
  },
  radiusMetres: 250,
}

const RICHMOND_PATROL_FALLBACK: PatrolZoneFallback = {
  zoneName: '586 Richmond patrol',
  description: 'Richmond/Tasman fallback patrol zone for service-provider operations.',
  boundarySource: 'repo_fallback_richmond_patrol_boundary',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [173.14, -41.30],
      [173.24, -41.30],
      [173.24, -41.38],
      [173.14, -41.38],
      [173.14, -41.30],
    ]],
  },
  radiusMetres: 250,
}

const MOTUEKA_PATROL_FALLBACK: PatrolZoneFallback = {
  zoneName: '583 Motueka patrol',
  description: 'Motueka/Tasman fallback patrol zone for service-provider operations.',
  boundarySource: 'repo_fallback_motueka_patrol_boundary',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [172.98, -41.09],
      [173.06, -41.09],
      [173.06, -41.16],
      [172.98, -41.16],
      [172.98, -41.09],
    ]],
  },
  radiusMetres: 250,
}

const DAY_SHIFT_MULTI_AREA_FALLBACK: PatrolZoneFallback = {
  zoneName: '585 Day shift patrol',
  description: 'Day-shift multi-area fallback patrol zone covering Nelson, Richmond, and Motueka operational areas.',
  boundarySource: 'repo_fallback_day_shift_multi_area_boundary',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [172.95, -41.05],
      [173.42, -41.05],
      [173.42, -41.42],
      [172.95, -41.42],
      [172.95, -41.05],
    ]],
  },
  radiusMetres: 300,
}

function hasShiftCode(blueprint: PatrolSetupBlueprint, code: string): boolean {
  const normalizedCode = String(code).trim().toLowerCase()
  return blueprint.patrolShifts.some((shift) => String(shift.code || '').trim().toLowerCase() === normalizedCode)
}

export function resolvePatrolZoneFallback(blueprint: PatrolSetupBlueprint): PatrolZoneFallback | null {
  const corpus = [
    blueprint.title,
    blueprint.organizationName,
    blueprint.summary,
    blueprint.sourceText,
    ...blueprint.services,
    ...blueprint.facilities.flatMap((facility) => [
      facility.name,
      ...facility.extent,
      ...facility.serviceCoverage,
      ...facility.frequencies,
      ...facility.setupActions,
      ...facility.notes,
    ]),
  ].join(' ').toLowerCase()

  if (hasShiftCode(blueprint, '585') || (corpus.includes('day shift') && corpus.includes('covers all areas'))) {
    return DAY_SHIFT_MULTI_AREA_FALLBACK
  }

  if (hasShiftCode(blueprint, '586') || corpus.includes('richmond')) {
    return RICHMOND_PATROL_FALLBACK
  }

  if (hasShiftCode(blueprint, '583') || corpus.includes('motueka') || corpus.includes('motuek')) {
    return MOTUEKA_PATROL_FALLBACK
  }

  if (hasShiftCode(blueprint, '587') || corpus.includes('nelson')) {
    return NELSON_PATROL_FALLBACK
  }

  return null
}