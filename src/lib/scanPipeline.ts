/**
 * scanPipeline.ts
 *
 * Shared capture pipeline used by both Detail Scan and Bulk Scan modes.
 *
 * Steps:
 *   1. GPS fix  (records to man-down detection via onGPSFix callback)
 *   2. Weather  (Open-Meteo, non-blocking)
 *   2.5 Evidence watermark  (timestamp + GPS + officer name baked into photo)
 *   3. SHA-256 hash + upload to `scans` storage bucket
 *   4. Resolve zone  (preferred → other-location fallback)
 *   5. fast INSERT via safe_insert_observation RPC  (plate = 'PROCESSING...')
 *   6. Fire-and-forget process-officer-scan enrichment
 *
 * Returns initial result immediately; enrichment completes asynchronously.
 */

import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { resolveObservationZoneForOrg } from '@/lib/zoneResolution'
import { fetchWeatherOnDevice } from '@/lib/weather'
import { applyEvidenceWatermark } from '@/lib/imageWatermarking'

export interface ScanSaveResult {
  observationId: string
  photoUrl: string
  photoHash: string
  zoneId: string
  recordedAt: string
  /** Weather string captured at scan time, stored in officer_notes */
  weather: string
}

/**
 * Run the full capture pipeline for a single vehicle photo.
 *
 * @param file             - JPEG file from SplitScanCamera
 * @param user             - Authenticated user (id + organization_id required)
 * @param preferredZoneId  - Officer's current patrol zone (may be null → falls back)
 * @param onGPSFix         - Called with (lat, lon) so man-down timer resets
 */
export async function captureAndSave(
  file: File,
  user: { id: string; organization_id: string; full_name?: string | null },
  preferredZoneId: string | null,
  onGPSFix?: (lat: number, lon: number) => void,
): Promise<ScanSaveResult> {
  // ── Step 1: GPS ───────────────────────────────────────────────────────────
  const position = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
    })
  )
  const { latitude, longitude, accuracy } = position.coords
  onGPSFix?.(latitude, longitude)

  // ── Step 2: Weather (non-blocking) ────────────────────────────────────────
  let weather = 'Unknown'
  try {
    const w = await fetchWeatherOnDevice(latitude, longitude)
    if (w) weather = w
  } catch { /* non-critical */ }

  // ── Step 2.5: Apply evidence watermark ────────────────────────────────────
  // Watermark is baked into the uploaded photo for legal evidence requirements.
  // Falls back to original file if Canvas is unavailable (e.g. non-browser env).
  let uploadFile: Blob = file
  try {
    const captureTimeNZ = new Date().toLocaleString('en-NZ', {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone: 'Pacific/Auckland',
    })
    uploadFile = await applyEvidenceWatermark(file, {
      timestamp: captureTimeNZ,
      gpsCoordinates: `${latitude.toFixed(6)}°, ${longitude.toFixed(6)}°`,
      userName: user.full_name || undefined,
    })
  } catch (err) {
    // Watermarking failed — upload the original photo without a watermark
    console.warn('⚠️ Watermarking failed — uploading original photo:', err)
    uploadFile = file
  }

  // ── Step 3: Hash + upload ─────────────────────────────────────────────────
  const timestamp  = Date.now()
  const randomHex  = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const filePath   = `${user.id}/${timestamp}-${randomHex}.jpg`
  const idempKey   = `scan-${user.id}-${timestamp}`

  // Compute SHA-256 before upload (File.arrayBuffer() does NOT consume the blob)
  let photoHash = `sha256:${randomHex}`
  try {
    const buf    = await uploadFile.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    photoHash    = 'sha256:' + Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0')).join('')
  } catch { /* fallback already set */ }

  const { error: uploadErr } = await supabase.storage
    .from('scans')
    .upload(filePath, uploadFile, { contentType: 'image/jpeg', upsert: false })
  if (uploadErr) throw new Error(`Photo upload failed: ${uploadErr.message}`)

  const { data: urlData } = supabase.storage.from('scans').getPublicUrl(filePath)
  const photoUrl = urlData.publicUrl

  // ── Step 4: Resolve zone ──────────────────────────────────────────────────
  const { zoneId: finalZoneId } = await resolveObservationZoneForOrg(
    user.organization_id,
    preferredZoneId,
  )
  if (!finalZoneId) throw new Error('Could not resolve patrol zone')

    // ── Step 5: Canonical ingest via vehicle-ingest edge function ────────────
    // This is the single source of truth for observation creation and enrichment.
  const nowIso = new Date().toISOString()
    const { data: ingestData, error: ingestError } = await edgeFunctions.ingestVehicleObservation({
      photo_url: photoUrl,
      photo_hash: photoHash,
      gpsLatitude: latitude,
      gpsLongitude: longitude,
      gpsAccuracy: accuracy,
      recordedAt: nowIso,
      officerId: user.id,
      organizationId: user.organization_id,
      zoneId: finalZoneId,
      idempotencyKey: idempKey,
      officer_notes: weather !== 'Unknown' ? `Weather: ${weather}` : null,
    })

    if (ingestError) throw new Error(`Save failed: ${ingestError}`)

    const observationId = (ingestData as any)?.observation_id ?? null

  if (!observationId) throw new Error('Observation saved but ID not returned')

  return { observationId, photoUrl, photoHash, zoneId: finalZoneId, recordedAt: nowIso, weather }
}
