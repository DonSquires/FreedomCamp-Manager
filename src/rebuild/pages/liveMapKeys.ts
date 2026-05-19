type PatrolKeyInput = {
  id: string | null
  assigned_to?: string | null
  zone_id?: string | null
}

type ObservationKeyInput = {
  observation_id: string | null
  recorded_at: string | null
  plate_number?: string | null
  gps_latitude?: number | null
  gps_longitude?: number | null
}

export const getPatrolListItemKey = (patrol: PatrolKeyInput, fallbackIndex: number) => {
  const key = `${patrol.id ?? 'unknown'}-${patrol.assigned_to ?? 'unassigned'}-${patrol.zone_id ?? 'no-zone'}`
  return patrol.id || patrol.assigned_to || patrol.zone_id ? key : `${key}-${fallbackIndex}`
}

export const getObservationListItemKey = (observation: ObservationKeyInput, fallbackIndex: number) => {
  const key = `${observation.observation_id ?? 'unknown'}-${observation.recorded_at ?? 'unknown'}-${observation.plate_number ?? 'unknown'}-${observation.gps_latitude ?? 'na'}-${observation.gps_longitude ?? 'na'}`
  return observation.observation_id || observation.recorded_at || observation.plate_number || observation.gps_latitude != null || observation.gps_longitude != null
    ? key
    : `${key}-${fallbackIndex}`
}
