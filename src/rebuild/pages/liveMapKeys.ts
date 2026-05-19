type PatrolKeyInput = { id: string }
type ObservationKeyInput = { observation_id: string; recorded_at: string }

export const getPatrolListItemKey = (patrol: PatrolKeyInput, index: number) =>
  `${patrol.id}-${index}`

export const getObservationListItemKey = (observation: ObservationKeyInput, index: number) =>
  `${observation.observation_id}-${observation.recorded_at}-${index}`
