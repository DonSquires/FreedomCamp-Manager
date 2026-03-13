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
  
  // Try primary 'photo' column first (live schema)
  if (isValidStorageUrl(observation.photo)) {
    return observation.photo!
  }

  // Fall back to photo_url
  if (isValidStorageUrl(observation.photo_url)) {
    return observation.photo_url!
  }
  
  // Fall back to image_url (legacy)
  if (isValidStorageUrl(observation.image_url)) {
    return observation.image_url!
  }
  
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
  
  // Use profile_photo if available
  if (isValidStorageUrl(vehicle.profile_photo)) {
    return vehicle.profile_photo!
  }
  
  // Use fallback if provided and valid
  if (isValidStorageUrl(fallbackPhotoUrl)) {
    return fallbackPhotoUrl!
  }
  
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
    // Match pattern: /storage/v1/object/{public|sign}/{bucket}/{path}
    const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)/)
    if (!match) return null
    
    return {
      bucket: match[1],
      path: match[2],
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
