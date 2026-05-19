import { describe, expect, it } from 'vitest'
import { getObservationListItemKey, getPatrolListItemKey } from './liveMapKeys'

describe('LiveMap list keys', () => {
  it('keeps patrol item keys unique when duplicate patrol IDs are present', () => {
    const duplicatePatrolId = 'patrol-1'
    const patrol = {
      id: duplicatePatrolId,
    } satisfies Parameters<typeof getPatrolListItemKey>[0]

    const keys = [
      getPatrolListItemKey(patrol, 0),
      getPatrolListItemKey(patrol, 1),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps observation keys unique when observation IDs repeat', () => {
    const duplicateObservationId = 'obs-1'
    const recordedAt = '2026-05-19T20:09:14.000Z'
    const observation = {
      observation_id: duplicateObservationId,
      recorded_at: recordedAt,
    } satisfies Parameters<typeof getObservationListItemKey>[0]

    const keys = [
      getObservationListItemKey(observation, 0),
      getObservationListItemKey(observation, 1),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })
})
