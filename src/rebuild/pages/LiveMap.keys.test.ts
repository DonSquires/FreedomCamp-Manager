import { describe, expect, it } from 'vitest'
import { getObservationListItemKey, getPatrolListItemKey } from './liveMapKeys'

describe('LiveMap list keys', () => {
  it('keeps patrol item keys unique when duplicate patrol IDs are present', () => {
    const duplicatePatrolId = 'patrol-1'
    const patrolA = {
      id: duplicatePatrolId,
      assigned_to: 'officer-a',
      zone_id: 'zone-a',
    } satisfies Parameters<typeof getPatrolListItemKey>[0]
    const patrolB = {
      id: duplicatePatrolId,
      assigned_to: 'officer-b',
      zone_id: 'zone-b',
    } satisfies Parameters<typeof getPatrolListItemKey>[0]

    const keys = [
      getPatrolListItemKey(patrolA, 0),
      getPatrolListItemKey(patrolB, 1),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps observation keys unique when observation IDs repeat', () => {
    const duplicateObservationId = 'obs-1'
    const recordedAt = '2026-05-19T20:09:14.000Z'
    const firstObservation = {
      observation_id: duplicateObservationId,
      recorded_at: recordedAt,
      plate_number: 'ABC123',
      gps_latitude: -41.2866,
      gps_longitude: 174.7756,
    } satisfies Parameters<typeof getObservationListItemKey>[0]
    const secondObservation = {
      observation_id: duplicateObservationId,
      recorded_at: '2026-05-19T20:10:14.000Z',
      plate_number: 'XYZ789',
      gps_latitude: -41.287,
      gps_longitude: 174.776,
    } satisfies Parameters<typeof getObservationListItemKey>[0]

    const keys = [
      getObservationListItemKey(firstObservation, 0),
      getObservationListItemKey(secondObservation, 1),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses fallback index only when all observation identifiers are missing', () => {
    const blankObservation = {
      observation_id: null,
      recorded_at: null,
      plate_number: null,
      gps_latitude: null,
      gps_longitude: null,
    } satisfies Parameters<typeof getObservationListItemKey>[0]

    const first = getObservationListItemKey(blankObservation, 0)
    const second = getObservationListItemKey(blankObservation, 1)

    expect(first).not.toBe(second)
  })
})
