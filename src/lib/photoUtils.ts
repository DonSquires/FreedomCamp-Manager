/**
 * Photo URL utility functions for vehicle and observation photos
 * 
 * Handles:
 * - Supabase Storage signed URLs detection
 * - Public URLs from evidence/scans buckets
 * - Fallback to null for missing/invalid URLs
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''

interface ObservationLike {
  photo?: string | null     // primary column in live schema
  photo_url?: string | null
  image_url?: string | null
}

interface VehicleLike {
  profile_photo?: string | null
  profile_photo_url?: string | null  // live schema secondary column
}

function resolvePhotoReference(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null
  const value = input.trim()
  if (!value) return null

  if (isValidStorageUrl(value)) {
    return value
  }

  // Relative storage endpoint path: /storage/v1/object/...
  if (value.startsWith('/storage/v1/object/')) {
    if (!SUPABASE_URL) return null
    return `${SUPABASE_URL}${value}`
  }

  // Canonical bucket/path reference used by ingest updates.
  const bucketPath = value.match(/^(scans|evidence|incident-evidence)\/(.+)$/)
  if (bucketPath) {
    const [, bucket, path] = bucketPath
    return getPublicStorageUrl(bucket, path)
  }

  return null
}

/**
 * Check if a URL is a valid photo URL (Supabase Storage or any https endpoint)
 */
function isValidStorageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false
  
  const hasValidScheme = url.startsWith('http://') || url.startsWith('https://')
  if (!hasValidScheme) return false

  // Validate URL structure
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Get the photo URL from an observation record
 * Prioritizes photo_url over image_url
 * Returns null if no valid photo URL is found
 */
export function getObservationPhotoUrl(observation: ObservationLike | null | undefined): string | null {
  if (!observation) return null

  const fromPhoto = resolvePhotoReference(observation.photo)
  if (fromPhoto) return fromPhoto

  const fromPhotoUrl = resolvePhotoReference(observation.photo_url)
  if (fromPhotoUrl) return fromPhotoUrl

  const fromImageUrl = resolvePhotoReference(observation.image_url)
  if (fromImageUrl) return fromImageUrl

  return null
}

/**
 * Get the profile photo URL from a vehicle record
 * If fallbackPhotoUrl is provided and vehicle has no profile_photo, use the fallback
 */
export function getVehiclePhotoUrl(
  vehicle: VehicleLike | null | undefined,
  fallbackPhotoUrl?: string | null
): string | null {
  if (!vehicle) return null

  const fromProfilePhoto = resolvePhotoReference(vehicle.profile_photo)
  if (fromProfilePhoto) return fromProfilePhoto

  const fromProfilePhotoUrl = resolvePhotoReference(vehicle.profile_photo_url)
  if (fromProfilePhotoUrl) return fromProfilePhotoUrl

  const fromFallback = resolvePhotoReference(fallbackPhotoUrl)
  if (fromFallback) return fromFallback

  return null
}

/**
 * Get public URL for a storage object
 * This creates a public URL from a storage path (bucket/path format)
 */
export function getPublicStorageUrl(bucket: string, path: string): string {
  if (!SUPABASE_URL) {
    console.warn('VITE_SUPABASE_URL not configured')
    return ''
  }
  
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

/**
 * Extract bucket and path from a full Supabase Storage URL
 * Returns null if the URL is not a valid storage URL
 */
export function parseStorageUrl(url: string | null | undefined): { bucket: string; path: string } | null {
  if (!url || typeof url !== 'string') return null
  
  try {
    // Match pattern: /storage/v1/object/{public|sign|authenticated}/{bucket}/{path}
    const parsed = new URL(url, SUPABASE_URL || 'http://localhost')
    const decodedPath = decodeURIComponent(parsed.pathname)
    const match = decodedPath.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/)
    if (!match) return null

    return {
      bucket: match[1],
      path: match[2].replace(/^\/+/, ''),
    }
  } catch {
    return null
  }
}

/**
 * Check if a photo URL is expired (for signed URLs)
 * Returns true if the URL contains an 'exp' parameter that has passed
 */
export function isPhotoUrlExpired(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return true
  
  try {
    const urlObj = new URL(url)
    const expParam = urlObj.searchParams.get('exp')
    
    if (!expParam) {
      // No expiry parameter means it's a public URL (never expires)
      return false
    }
    
    const expiryTimestamp = parseInt(expParam, 10)
    const now = Math.floor(Date.now() / 1000)
    
    return now >= expiryTimestamp
  } catch {
    return true
  }
}
