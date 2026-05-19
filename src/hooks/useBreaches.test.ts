import { describe, expect, it } from 'vitest'
import { getBreachEvidencePhotoRowId } from './useBreaches'

describe('getBreachEvidencePhotoRowId', () => {
  it('prefers database row id when both id fields are present', () => {
    expect(
      getBreachEvidencePhotoRowId({
        id: 'row-1',
        observation_id: 'obs-1',
      }),
    ).toBe('row-1')
  })

  it('falls back to observation_id when row id is missing', () => {
    expect(
      getBreachEvidencePhotoRowId({
        observation_id: 'obs-2',
      }),
    ).toBe('obs-2')
  })

  it('returns null when neither id is available', () => {
    expect(getBreachEvidencePhotoRowId({})).toBeNull()
  })
})
