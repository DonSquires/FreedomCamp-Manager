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
  /** GPS latitude captured at scan time (null if unavailable) */
  gpsLatitude: number | null
  /** GPS longitude captured at scan time (null if unavailable) */
  gpsLongitude: number | null
}

type CaptureAndSaveOptions = {
  plateHint?: string | null
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
  options?: CaptureAndSaveOptions,
): Promise<ScanSaveResult> {
  // ── Step 1: GPS ───────────────────────────────────────────────────────────
  // Try high-accuracy first, fall back to low-accuracy, then proceed with null coords.
  // GPS failure must never abort the scan entirely — the record can be created
  // without coordinates and the officer can annotate location in notes.
  emitScanProgress(onStageChange, 'gps')
  let latitude: number | null = null
  let longitude: number | null = null
  let accuracy: number | null = null

  const gpsOpts = [
    { enableHighAccuracy: true,  timeout: 10_000 },
    { enableHighAccuracy: false, timeout: 8_000  },
  ]
  for (const opts of gpsOpts) {
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, opts)
      )
      latitude  = position.coords.latitude
      longitude = position.coords.longitude
      accuracy  = position.coords.accuracy
      break
    } catch {
      // try next option
    }
  }

  if (latitude !== null && longitude !== null) {
    onGPSFix?.(latitude, longitude)
  }

  // ── Step 2: Weather (non-blocking) ────────────────────────────────────────
  let weather = 'Unknown'
  try {
    emitScanProgress(onStageChange, 'weather')
    if (latitude !== null && longitude !== null) {
      const w = await withTimeout(fetchWeatherOnDevice(latitude, longitude), WEATHER_TIMEOUT_MS, 'weather lookup')
      if (w) weather = w
    }
  } catch { /* non-critical */ }

  // ── Step 2.5: Apply evidence watermark ────────────────────────────────────
  // Watermark is mandatory for officer-captured evidence photos.
  // If watermarking fails, abort capture instead of uploading an unwatermarked file.
  let uploadFile: Blob = file
  emitScanProgress(onStageChange, 'watermark')
  const captureTimeNZ = new Date().toLocaleString('en-NZ', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Pacific/Auckland',
  })
  uploadFile = await withTimeout(
    applyEvidenceWatermark(file, {
      timestamp: captureTimeNZ,
      gpsCoordinates: latitude !== null && longitude !== null
        ? `${latitude.toFixed(6)}°, ${longitude.toFixed(6)}°`
        : 'GPS unavailable',
      userName: user.full_name || undefined,
    }),
    WATERMARK_TIMEOUT_MS,
    'evidence watermarking',
  )

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
      latitude,
      longitude,
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
          plate: options?.plateHint ?? undefined,
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

  // Kick off officer enrichment in the background. Do not block the save UX on
  // plate recognition, NZSCV lookups, movement checks, or discrepancy analysis.
  // The detail panel / recent scans UI already polls the observation row for the
  // eventual result.
  void edgeFunctions.processOfficerScan({
    observation_id: observationId,
    photo_url: photoUrl,
    photo_hash: photoHash,
  }).then(({ error }) => {
    if (error) {
      console.warn('⚠️ Background process-officer-scan failed:', error)
    }
  })

  emitScanProgress(onStageChange, 'complete')

  return {
    observationId,
    photoUrl,
    photoHash,
    zoneId: finalZoneId,
    recordedAt: nowIso,
    weather,
    gpsLatitude: latitude,
    gpsLongitude: longitude,
  }
}
