export interface ObservationPhotoLike {
  photo_url?: string | null
  photo?: string | null
}

export interface VehiclePhotoLike {
  profile_photo?: string | null
  photo_url?: string | null
  photo?: string | null
}

function cleanPhotoUrl(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null
  return trimmed
}

export function getObservationPhotoUrl(observation?: ObservationPhotoLike | null): string | null {
  if (!observation) return null
  return cleanPhotoUrl(observation.photo_url) || cleanPhotoUrl(observation.photo)
}

export function getVehiclePhotoUrl(
  vehicle?: VehiclePhotoLike | null,
  fallbackObservationPhoto?: string | null
): string | null {
  if (!vehicle) return cleanPhotoUrl(fallbackObservationPhoto)
  return (
    cleanPhotoUrl(vehicle.profile_photo) ||
    cleanPhotoUrl(vehicle.photo_url) ||
    cleanPhotoUrl(vehicle.photo) ||
    cleanPhotoUrl(fallbackObservationPhoto)
  )
}
