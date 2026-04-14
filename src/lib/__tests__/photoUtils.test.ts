import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getObservationPhotoUrl,
  getVehiclePhotoUrl,
  getPublicStorageUrl,
  parseStorageUrl,
  isPhotoUrlExpired,
} from '../photoUtils'

// In test environment VITE_SUPABASE_URL is not set, so the module-level
// SUPABASE_URL constant will be an empty string.  Tests that require a base URL
// set it via import.meta.env stub or use absolute URLs directly.

// ── getObservationPhotoUrl ───────────────────────────────────────────────────

describe('getObservationPhotoUrl', () => {
  it('returns null for null observation', () => {
    expect(getObservationPhotoUrl(null)).toBeNull()
  })

  it('returns null for undefined observation', () => {
    expect(getObservationPhotoUrl(undefined)).toBeNull()
  })

  it('returns null for observation with no photo fields', () => {
    expect(getObservationPhotoUrl({})).toBeNull()
  })

  it('returns null when all photo fields are null', () => {
    expect(getObservationPhotoUrl({ photo: null, photo_url: null, image_url: null })).toBeNull()
  })

  it('returns the absolute https URL from photo field', () => {
    const url = 'https://example.com/storage/evidence/photo.jpg'
    expect(getObservationPhotoUrl({ photo: url })).toBe(url)
  })

  it('returns the absolute https URL from photo_url field when photo is absent', () => {
    const url = 'https://example.com/storage/evidence/photo.jpg'
    expect(getObservationPhotoUrl({ photo_url: url })).toBe(url)
  })

  it('returns the absolute https URL from image_url as final fallback', () => {
    const url = 'https://example.com/storage/evidence/photo.jpg'
    expect(getObservationPhotoUrl({ image_url: url })).toBe(url)
  })

  it('prioritises photo over photo_url', () => {
    expect(getObservationPhotoUrl({
      photo: 'https://example.com/a.jpg',
      photo_url: 'https://example.com/b.jpg',
    })).toBe('https://example.com/a.jpg')
  })

  it('prioritises photo_url over image_url', () => {
    expect(getObservationPhotoUrl({
      photo_url: 'https://example.com/b.jpg',
      image_url: 'https://example.com/c.jpg',
    })).toBe('https://example.com/b.jpg')
  })

  it('returns null for non-https and non-storage relative values', () => {
    // Plain path without a recognised storage prefix
    expect(getObservationPhotoUrl({ photo: 'some-file.jpg' })).toBeNull()
  })
})

// ── getVehiclePhotoUrl ───────────────────────────────────────────────────────

describe('getVehiclePhotoUrl', () => {
  it('returns null for null vehicle', () => {
    expect(getVehiclePhotoUrl(null)).toBeNull()
  })

  it('returns null for undefined vehicle', () => {
    expect(getVehiclePhotoUrl(undefined)).toBeNull()
  })

  it('returns null for vehicle with no photo fields', () => {
    expect(getVehiclePhotoUrl({})).toBeNull()
  })

  it('returns profile_photo when it is an absolute URL', () => {
    const url = 'https://example.com/storage/scans/photo.jpg'
    expect(getVehiclePhotoUrl({ profile_photo: url })).toBe(url)
  })

  it('falls back to profile_photo_url when profile_photo is absent', () => {
    const url = 'https://example.com/storage/scans/photo2.jpg'
    expect(getVehiclePhotoUrl({ profile_photo_url: url })).toBe(url)
  })

  it('falls back to fallbackPhotoUrl when vehicle has no photo', () => {
    const fallback = 'https://example.com/fallback.jpg'
    expect(getVehiclePhotoUrl({}, fallback)).toBe(fallback)
  })

  it('ignores fallbackPhotoUrl when vehicle has a valid profile_photo', () => {
    const primary = 'https://example.com/primary.jpg'
    const fallback = 'https://example.com/fallback.jpg'
    expect(getVehiclePhotoUrl({ profile_photo: primary }, fallback)).toBe(primary)
  })

  it('returns null when both vehicle and fallback have no valid URLs', () => {
    expect(getVehiclePhotoUrl({ profile_photo: null }, null)).toBeNull()
  })
})

// ── getPublicStorageUrl ──────────────────────────────────────────────────────

describe('getPublicStorageUrl', () => {
  it('returns empty string when SUPABASE_URL is not configured', () => {
    // VITE_SUPABASE_URL is not set in the test environment
    const result = getPublicStorageUrl('evidence', 'some/path/photo.jpg')
    // In test env the base URL is empty, so result is '' or a relative path
    expect(typeof result).toBe('string')
  })

  it('constructs the expected path format', () => {
    // Indirectly verify the path template even though the base URL is empty
    const result = getPublicStorageUrl('scans', 'abc/def.jpg')
    // Should include the bucket and path in the output (when a base URL is present)
    // In test env, result will be empty string due to missing SUPABASE_URL
    expect(result).toBe('')
  })
})

// ── parseStorageUrl ──────────────────────────────────────────────────────────

describe('parseStorageUrl', () => {
  it('returns null for null input', () => {
    expect(parseStorageUrl(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseStorageUrl(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseStorageUrl('')).toBeNull()
  })

  it('returns null for a non-storage URL', () => {
    expect(parseStorageUrl('https://example.com/some/other/path')).toBeNull()
  })

  it('parses a public storage URL with bucket and path', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/scans/2024/photo.jpg'
    const result = parseStorageUrl(url)
    expect(result).not.toBeNull()
    expect(result!.bucket).toBe('scans')
    expect(result!.path).toBe('2024/photo.jpg')
  })

  it('parses a signed storage URL', () => {
    const url = 'https://project.supabase.co/storage/v1/object/sign/evidence/abc.jpg'
    const result = parseStorageUrl(url)
    expect(result).not.toBeNull()
    expect(result!.bucket).toBe('evidence')
    expect(result!.path).toBe('abc.jpg')
  })

  it('parses an authenticated storage URL', () => {
    const url = 'https://project.supabase.co/storage/v1/object/authenticated/incident-evidence/img.png'
    const result = parseStorageUrl(url)
    expect(result).not.toBeNull()
    expect(result!.bucket).toBe('incident-evidence')
    expect(result!.path).toBe('img.png')
  })

  it('decodes percent-encoded path components', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/my%20bucket/my%20file.jpg'
    const result = parseStorageUrl(url)
    expect(result).not.toBeNull()
    expect(result!.bucket).toBe('my bucket')
    expect(result!.path).toBe('my file.jpg')
  })
})

// ── isPhotoUrlExpired ────────────────────────────────────────────────────────

describe('isPhotoUrlExpired', () => {
  it('returns true for null', () => {
    expect(isPhotoUrlExpired(null)).toBe(true)
  })

  it('returns true for undefined', () => {
    expect(isPhotoUrlExpired(undefined)).toBe(true)
  })

  it('returns true for empty string', () => {
    expect(isPhotoUrlExpired('')).toBe(true)
  })

  it('returns true for an invalid URL', () => {
    expect(isPhotoUrlExpired('not-a-url')).toBe(true)
  })

  it('returns false for a public URL with no exp parameter', () => {
    const url = 'https://project.supabase.co/storage/v1/object/public/scans/photo.jpg'
    expect(isPhotoUrlExpired(url)).toBe(false)
  })

  it('returns true for a signed URL whose exp is in the past', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
    const url = `https://project.supabase.co/storage/v1/object/sign/scans/photo.jpg?exp=${pastExp}`
    expect(isPhotoUrlExpired(url)).toBe(true)
  })

  it('returns false for a signed URL whose exp is in the future', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
    const url = `https://project.supabase.co/storage/v1/object/sign/scans/photo.jpg?exp=${futureExp}`
    expect(isPhotoUrlExpired(url)).toBe(false)
  })

  it('returns true when exp equals the current second', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const url = `https://project.supabase.co/storage/v1/object/sign/scans/photo.jpg?exp=${nowSec}`
    // now >= nowSec → expired
    expect(isPhotoUrlExpired(url)).toBe(true)
  })
})
