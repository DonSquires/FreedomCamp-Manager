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
 *   5. Canonical ingest via vehicle-ingest edge function
 *      (with idempotency-based recovery if response is delayed)
 *
 * Returns initial result immediately; enrichment completes asynchronously.
 */

import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { resolveObservationZoneForOrg } from '@/lib/zoneResolution'
import { fetchWeatherOnDevice } from '@/lib/weather'
import { applyEvidenceWatermark } from '@/lib/imageWatermarking'

const WEATHER_TIMEOUT_MS = 4_000
const WATERMARK_TIMEOUT_MS = 8_000
const UPLOAD_TIMEOUT_MS = 30_000
const ZONE_RESOLUTION_TIMEOUT_MS = 10_000
const INGEST_TIMEOUT_MS = 45_000
const RECOVERY_LOOKUP_TIMEOUT_MS = 20_000
const RECOVERY_LOOKUP_POLL_MS = 2_000

export type ScanProgressStage =
  | 'gps'
  | 'weather'
  | 'watermark'
  | 'hash'
  | 'upload'
  | 'zone'
  | 'saving'
  | 'recovery'
  | 'complete'

export const SCAN_PROGRESS_LABELS: Record<ScanProgressStage, string> = {
  gps: 'Getting GPS location…',
  weather: 'Checking weather…',
  watermark: 'Preparing evidence photo…',
  hash: 'Securing photo fingerprint…',
  upload: 'Uploading photo evidence…',
  zone: 'Resolving patrol zone…',
  saving: 'Saving observation…',
  recovery: 'Recovering saved observation…',
  complete: 'Observation saved',
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
    })
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

async function recoverObservationByIdempotency(idempotencyKey: string): Promise<string | null> {
  const deadline = Date.now() + RECOVERY_LOOKUP_TIMEOUT_MS

  while (Date.now() < deadline) {
    const { data, error } = await (supabase.from('observations') as any)
      .select('observation_id, id')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (!error && data) {
      return (data as any).observation_id ?? (data as any).id ?? null
    }

    // If the row isn't visible yet, allow the ingest function to finish and retry.
    await new Promise((resolve) => setTimeout(resolve, RECOVERY_LOOKUP_POLL_MS))
  }

  return null
}

export interface ScanSaveResult {
  observationId: string
  photoUrl: string
  photoHash: string
  zoneId: string
  recordedAt: string
  /** Weather string captured at scan time, stored in officer_notes */
  weather: string
}

type ScanProgressHandler = (stage: ScanProgressStage, label: string) => void

function emitScanProgress(onStageChange: ScanProgressHandler | undefined, stage: ScanProgressStage) {
  onStageChange?.(stage, SCAN_PROGRESS_LABELS[stage])
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
  onStageChange?: ScanProgressHandler,
): Promise<ScanSaveResult> {
  // ── Step 1: GPS ───────────────────────────────────────────────────────────
  emitScanProgress(onStageChange, 'gps')
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
    emitScanProgress(onStageChange, 'weather')
    const w = await withTimeout(fetchWeatherOnDevice(latitude, longitude), WEATHER_TIMEOUT_MS, 'weather lookup')
    if (w) weather = w
  } catch { /* non-critical */ }

  // ── Step 2.5: Apply evidence watermark ────────────────────────────────────
  // Watermark is baked into the uploaded photo for legal evidence requirements.
  // Falls back to original file if Canvas is unavailable (e.g. non-browser env).
  let uploadFile: Blob = file
  try {
    emitScanProgress(onStageChange, 'watermark')
    const captureTimeNZ = new Date().toLocaleString('en-NZ', {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone: 'Pacific/Auckland',
    })
    uploadFile = await withTimeout(
      applyEvidenceWatermark(file, {
        timestamp: captureTimeNZ,
        gpsCoordinates: `${latitude.toFixed(6)}°, ${longitude.toFixed(6)}°`,
        userName: user.full_name || undefined,
      }),
      WATERMARK_TIMEOUT_MS,
      'evidence watermarking',
    )
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
  emitScanProgress(onStageChange, 'hash')
  let photoHash = `sha256:${randomHex}`
  try {
    const buf    = await uploadFile.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    photoHash    = 'sha256:' + Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0')).join('')
  } catch { /* fallback already set */ }

  emitScanProgress(onStageChange, 'upload')
  const { error: uploadErr } = await withTimeout(
    supabase.storage
      .from('scans')
      .upload(filePath, uploadFile, { contentType: 'image/jpeg', upsert: false }),
    UPLOAD_TIMEOUT_MS,
    'photo upload',
  )
  if (uploadErr) throw new Error(`Photo upload failed: ${uploadErr.message}`)

  const { data: urlData } = supabase.storage.from('scans').getPublicUrl(filePath)
  const photoUrl = urlData.publicUrl

  // ── Step 4: Resolve zone ──────────────────────────────────────────────────
  emitScanProgress(onStageChange, 'zone')
  const { zoneId: finalZoneId } = await withTimeout(
    resolveObservationZoneForOrg(
      user.organization_id,
      preferredZoneId,
    ),
    ZONE_RESOLUTION_TIMEOUT_MS,
    'zone resolution',
  )
  if (!finalZoneId) throw new Error('Could not resolve patrol zone')

    // ── Step 5: Canonical ingest via vehicle-ingest edge function ────────────
    // This is the single source of truth for observation creation and enrichment.
  const nowIso = new Date().toISOString()
    let observationId: string | null = null

    try {
      emitScanProgress(onStageChange, 'saving')
      const ingestResult = await withTimeout(
        edgeFunctions.ingestVehicleObservation({
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
        }),
        INGEST_TIMEOUT_MS,
        'vehicle-ingest request',
      )

      if (ingestResult.error) {
        throw new Error(String(ingestResult.error))
      }

      observationId = (ingestResult.data as any)?.observation_id ?? null
    } catch (err: any) {
      // If the request timed out or the network dropped after the backend started,
      // recover using idempotency key so the UI can still complete.
      emitScanProgress(onStageChange, 'recovery')
      const recoveredId = await recoverObservationByIdempotency(idempKey)
      if (recoveredId) {
        observationId = recoveredId
      } else {
        throw new Error(`Save failed: ${err?.message ?? 'vehicle-ingest request failed'}`)
      }
    }

  if (!observationId) throw new Error('Observation saved but ID not returned')

  emitScanProgress(onStageChange, 'complete')

  return { observationId, photoUrl, photoHash, zoneId: finalZoneId, recordedAt: nowIso, weather }
}
