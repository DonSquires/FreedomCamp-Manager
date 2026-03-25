/**
 * Railway Services Integration
 * 
 * Direct client-side access to Railway-deployed services:
 * 1. Proxy Server (NZSCV/MotorWeb API gateway)
 * 2. Inference Service (ORC/AI vehicle detection)
 */

import { supabase } from './supabase'

/**
 * Response type from the check-railway-health Edge Function.
 */
interface RailwayHealthResponse {
  proxy: { status: string; error?: string; [key: string]: unknown }
  proxy_url: string | null
  inference: { status: string; error?: string; [key: string]: unknown }
  inference_url: string | null
  checked_at: string
}

/**
 * Get Railway service URLs and health status from the check-railway-health Edge Function.
 */
async function getRailwayServiceURLs(): Promise<{
  proxyUrl: string | null
  inferenceUrl: string | null
  proxyHealth: RailwayHealthResponse['proxy'] | null
  inferenceHealth: RailwayHealthResponse['inference'] | null
  error: string | null
}> {
  try {
    // Call Edge Function to retrieve Railway URLs and health from backend secrets
    const { data, error } = await supabase.functions.invoke('check-railway-health')

    if (error) {
      return {
        proxyUrl: null,
        inferenceUrl: null,
        proxyHealth: null,
        inferenceHealth: null,
        error: error.message || 'Failed to get Railway service URLs',
      }
    }

    const response = data as RailwayHealthResponse | null
    return {
      proxyUrl: response?.proxy_url || null,
      inferenceUrl: response?.inference_url || null,
      proxyHealth: response?.proxy || null,
      inferenceHealth: response?.inference || null,
      error: null,
    }
  } catch (error: any) {
    return {
      proxyUrl: null,
      inferenceUrl: null,
      proxyHealth: null,
      inferenceHealth: null,
      error: error.message || 'Unknown error',
    }
  }
}

// ============================================================================
// PROXY SERVER (NZSCV/MotorWeb)
// ============================================================================

export interface NZSCVCheckResult {
  plate_number: string
  is_certified: boolean
  warrant_type?: 'green' | 'blue' | 'none'
  warrant_number?: string
  issued_date?: string
  expires_on?: string
  issuer?: string
  source?: string
}

/**
 * Check NZSCV self-contained certification via proxy server
 */
export async function checkNZSCVCertification(
  plateNumber: string
): Promise<{ data: NZSCVCheckResult | null; error: string | null }> {
  const { proxyUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !proxyUrl) {
    return {
      data: null,
      error: urlError || 'Proxy server URL not configured',
    }
  }

  try {
    const response = await fetch(`${proxyUrl}/api/nzscv/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plate_number: plateNumber }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        data: null,
        error: `NZSCV check failed: ${response.status} - ${errorText}`,
      }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (error: any) {
    return {
      data: null,
      error: error.message || 'Network error contacting proxy server',
    }
  }
}

export interface MotorWebResult {
  plate_number: string
  make: string
  model: string
  year: number
  colour: string
  body_style?: string
  engine_size?: string
  fuel_type?: string
  transmission?: string
  owner_name?: string
  owner_address?: string
}

/**
 * Enrich vehicle data from MotorWeb API
 */
export async function enrichVehicleFromMotorWeb(
  plateNumber: string
): Promise<{ data: MotorWebResult | null; error: string | null }> {
  const { proxyUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !proxyUrl) {
    return {
      data: null,
      error: urlError || 'Proxy server URL not configured',
    }
  }

  try {
    const response = await fetch(`${proxyUrl}/api/motorweb/lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plate_number: plateNumber }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        data: null,
        error: `MotorWeb lookup failed: ${response.status} - ${errorText}`,
      }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (error: any) {
    return {
      data: null,
      error: error.message || 'Network error contacting proxy server',
    }
  }
}

// ============================================================================
// INFERENCE SERVICE (ORC/AI)
// The inference service exposes a single POST /infer endpoint that accepts a
// multipart photo and returns vehicle detection + 384-D embedding.
// Plate extraction is available only when OPENAI_API_KEY is set on Railway.
// ============================================================================

export interface InferResult {
  /** 384-D MobileNetV3 embedding vector */
  embedding: number[]
  embedding_quality: number
  embedding_model_version: string
  detection: {
    confidence: number
    bbox: [number, number, number, number]
    class: string
  }
  /** Only present when OPENAI_API_KEY is set on the Railway service */
  plate_number?: string
  vehicle_make?: string
  vehicle_model?: string
  vehicle_colour?: string
  vehicle_make_confidence?: number
  vehicle_model_confidence?: number
  vehicle_colour_confidence?: number
  /** Sticker detection (v1 self-contained) — null presence = inconclusive */
  sticker?: {
    presence: boolean | null
    color: 'blue' | 'green' | 'unknown'
    bbox?: { x: number; y: number; width: number; height: number }
    detection_confidence?: number
    color_confidence?: number
  }
  /** Movement comparison against a previous observation in the same incident */
  movement?: {
    moved: boolean | null
    background_similarity?: number
    vehicle_bbox_iou?: number
    decision?: string
  }
}

// Legacy type aliases kept for backwards-compatibility
export type VehicleDetectionResult = {
  detected: boolean
  objects: Array<{ class: string; confidence: number; bbox: [number, number, number, number] }>
  vehicle_count: number
}

export type VehicleEmbeddingResult = {
  embedding: number[]
  embedding_quality: number
  model_version: string
}

export type OCRResult = {
  plate_number: string
  confidence: number
  bounding_box: [number, number, number, number]
}

/**
 * Core inference call – sends a photo URL to the /infer endpoint.
 * Downloads the photo, then uploads it as multipart/form-data to Railway.
 */
export async function inferVehicle(
  photoUrl: string
): Promise<{ data: InferResult | null; error: string | null }> {
  const { inferenceUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !inferenceUrl) {
    return {
      data: null,
      error: urlError || 'Inference service URL not configured',
    }
  }

  try {
    // Download the photo from storage so we can send it as a file
    const photoResponse = await fetch(photoUrl)
    if (!photoResponse.ok) {
      return { data: null, error: `Failed to download photo: ${photoResponse.status}` }
    }
    const photoBlob = await photoResponse.blob()

    const form = new FormData()
    form.append('photo', photoBlob, 'photo.jpg')

    const response = await fetch(`${inferenceUrl}/infer`, {
      method: 'POST',
      body: form,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        data: null,
        error: `Inference failed: ${response.status} - ${errorText}`,
      }
    }

    const json = await response.json()
    if (!json.success || !json.data) {
      return { data: null, error: 'No vehicle detected in photo' }
    }

    const d = json.data
    return {
      data: {
        embedding:               d.embedding,
        embedding_quality:       d.embedding_quality,
        embedding_model_version: d.embedding_model_version ?? 'yolov8n_mobilenetv3_v1.0',
        detection: {
          confidence: d.detection?.confidence ?? 0,
          bbox:       d.detection?.bbox       ?? [0, 0, 0, 0],
          class:      d.detection?.class      ?? 'vehicle',
        },
        plate_number:  d.plate_number  ?? undefined,
        vehicle_make:  d.vehicle_make  ?? undefined,
        vehicle_model: d.vehicle_model ?? undefined,
        vehicle_colour:d.vehicle_colour ?? undefined,
        vehicle_make_confidence:  d.vehicle_make_confidence  ?? undefined,
        vehicle_model_confidence: d.vehicle_model_confidence ?? undefined,
        vehicle_colour_confidence:d.vehicle_colour_confidence ?? undefined,
        sticker:  d.sticker  ?? undefined,
        movement: d.movement ?? undefined,
      },
      error: null,
    }
  } catch (error: any) {
    return {
      data: null,
      error: error.message || 'Network error contacting inference service',
    }
  }
}

/**
 * Detect vehicles in photo using YOLO model.
 * @deprecated Use inferVehicle() – maps to the same /infer endpoint.
 */
export async function detectVehicles(
  photoUrl: string
): Promise<{ data: VehicleDetectionResult | null; error: string | null }> {
  const { data, error } = await inferVehicle(photoUrl)
  if (error || !data) return { data: null, error }
  return {
    data: {
      detected: true,
      objects: [{ class: data.detection.class, confidence: data.detection.confidence, bbox: data.detection.bbox }],
      vehicle_count: 1,
    },
    error: null,
  }
}

/**
 * Generate 384-D embedding for vehicle photo.
 * @deprecated Use inferVehicle() – maps to the same /infer endpoint.
 */
export async function generateVehicleEmbedding(
  photoUrl: string
): Promise<{ data: VehicleEmbeddingResult | null; error: string | null }> {
  const { data, error } = await inferVehicle(photoUrl)
  if (error || !data) return { data: null, error }
  return {
    data: {
      embedding:       data.embedding,
      embedding_quality: data.embedding_quality,
      model_version:   data.embedding_model_version,
    },
    error: null,
  }
}

/**
 * Perform OCR on vehicle photo to extract plate number.
 * Plate extraction requires OPENAI_API_KEY on the Railway inference service.
 * @deprecated Use inferVehicle() – maps to the same /infer endpoint.
 */
export async function performOCR(
  photoUrl: string
): Promise<{ data: OCRResult | null; error: string | null }> {
  const { data, error } = await inferVehicle(photoUrl)
  if (error || !data) return { data: null, error }
  if (!data.plate_number) {
    return { data: null, error: 'No plate number detected (OPENAI_API_KEY not set on inference service)' }
  }
  return {
    data: {
      plate_number: data.plate_number,
      confidence:   data.detection.confidence,
      bounding_box: data.detection.bbox,
    },
    error: null,
  }
}

/**
 * Analyze vehicle photo with full AI pipeline.
 * @deprecated Use inferVehicle() – maps to the same /infer endpoint.
 */
export async function analyzeVehiclePhoto(photoUrl: string): Promise<{
  data: {
    detection: VehicleDetectionResult
    embedding: VehicleEmbeddingResult
    ocr?: OCRResult
  } | null
  error: string | null
}> {
  const { data, error } = await inferVehicle(photoUrl)
  if (error || !data) return { data: null, error }
  return {
    data: {
      detection: {
        detected: true,
        objects: [{ class: data.detection.class, confidence: data.detection.confidence, bbox: data.detection.bbox }],
        vehicle_count: 1,
      },
      embedding: {
        embedding:       data.embedding,
        embedding_quality: data.embedding_quality,
        model_version:   data.embedding_model_version,
      },
      ...(data.plate_number ? {
        ocr: {
          plate_number: data.plate_number,
          confidence: data.detection.confidence,
          bounding_box: data.detection.bbox,
        }
      } : {}),
    },
    error: null,
  }
}

// ============================================================================
// FACE DETECTION + RECOGNITION
// The inference service exposes POST /infer/face which accepts a photo and
// returns face detection results + 384-D embedding for comparison.
// ============================================================================

export interface FaceDetectionResult {
  /** Number of faces detected in the image */
  face_count: number
  /** Array of detected faces with details */
  faces: Array<{
    bbox: { x: number; y: number; width: number; height: number } | null
    confidence: number
    approximate_age: string
    gender: string
    description: string | null
  }>
  /** 384-D MobileNetV3 embedding of the primary (highest-confidence) face */
  embedding: number[] | null
  embedding_quality: number | null
  metadata: {
    detection_method: string
    processing_time_ms: number
    onnx_available: boolean
    openai_available: boolean
    embedding_available: boolean
  }
}

/**
 * Detect faces in a photo via the inference service /infer/face endpoint.
 * Returns face bounding boxes, descriptions, and an embedding for the
 * primary face (for comparison/matching).
 */
export async function inferFace(
  photoUrl: string
): Promise<{ data: FaceDetectionResult | null; error: string | null }> {
  const { inferenceUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !inferenceUrl) {
    return {
      data: null,
      error: urlError || 'Inference service URL not configured',
    }
  }

  try {
    // Download the photo from storage so we can send it as a file
    const photoResponse = await fetch(photoUrl)
    if (!photoResponse.ok) {
      return { data: null, error: `Failed to download photo: ${photoResponse.status}` }
    }
    const photoBlob = await photoResponse.blob()

    const form = new FormData()
    form.append('photo', photoBlob, 'photo.jpg')

    const response = await fetch(`${inferenceUrl}/infer/face`, {
      method: 'POST',
      body: form,
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        data: null,
        error: `Face detection failed: ${response.status} - ${errorText}`,
      }
    }

    const json = await response.json()
    if (!json.success) {
      return { data: null, error: 'Face detection returned no results' }
    }

    return {
      data: {
        face_count:        json.face_count ?? 0,
        faces:             json.faces ?? [],
        embedding:         json.embedding ?? null,
        embedding_quality: json.embedding_quality ?? null,
        metadata:          json.metadata ?? {
          detection_method: 'unknown',
          processing_time_ms: 0,
          onnx_available: false,
          openai_available: false,
          embedding_available: false,
        },
      },
      error: null,
    }
  } catch (error: any) {
    return {
      data: null,
      error: error.message || 'Network error contacting inference service',
    }
  }
}

/**
 * Compare two face embeddings using the inference service /infer/compare
 * endpoint (same cosine similarity engine used for vehicle embeddings).
 */
export async function compareFaceEmbeddings(
  embedding1: number[],
  embedding2: number[]
): Promise<{
  data: {
    similarity: number
    same_person: boolean
    confidence: string
    interpretation: string
  } | null
  error: string | null
}> {
  const { inferenceUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !inferenceUrl) {
    return {
      data: null,
      error: urlError || 'Inference service URL not configured',
    }
  }

  try {
    const response = await fetch(`${inferenceUrl}/infer/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedding1, embedding2 }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        data: null,
        error: `Face comparison failed: ${response.status} - ${errorText}`,
      }
    }

    const json = await response.json()
    return {
      data: {
        similarity:     json.similarity,
        same_person:    json.same_vehicle ?? json.similarity >= 0.80,
        confidence:     json.confidence,
        interpretation: json.interpretation?.replace(/vehicle/gi, 'person') ?? '',
      },
      error: null,
    }
  } catch (error: any) {
    return {
      data: null,
      error: error.message || 'Network error contacting inference service',
    }
  }
}

// ============================================================================
// HEALTH CHECKS
// ============================================================================

export interface ServiceHealthStatus {
  status: 'online' | 'offline' | 'degraded'
  latency_ms?: number
  error?: string
}

/**
 * Check proxy server health.
 *
 * Health is determined by the check-railway-health Edge Function rather than a
 * direct browser-to-Railway fetch.  Direct fetches would fail with CORS errors
 * because the Railway services whitelist only the Supabase project origin.
 */
export async function checkProxyHealth(): Promise<ServiceHealthStatus> {
  const { proxyUrl, proxyHealth, error: urlError } = await getRailwayServiceURLs()

  if (urlError) {
    return { status: 'offline', error: urlError }
  }

  if (!proxyUrl) {
    return { status: 'offline', error: 'PROXY_SERVER_URL secret not configured in Supabase' }
  }

  // The edge function already pinged the service and returned a health object.
  // Map its status to our ServiceHealthStatus type.
  const rawStatus = proxyHealth?.status as string | undefined
  const isOnline = rawStatus === 'ok' || rawStatus === 'healthy'
  const isOffline = !rawStatus || rawStatus === 'offline'

  return {
    status: isOnline ? 'online' : isOffline ? 'offline' : 'degraded',
    error: proxyHealth?.error as string | undefined,
  }
}

/**
 * Check inference service health.
 *
 * Health is determined by the check-railway-health Edge Function rather than a
 * direct browser-to-Railway fetch (CORS would block that).
 */
export async function checkInferenceHealth(): Promise<ServiceHealthStatus> {
  const { inferenceUrl, inferenceHealth, error: urlError } = await getRailwayServiceURLs()

  if (urlError) {
    return { status: 'offline', error: urlError }
  }

  if (!inferenceUrl) {
    return { status: 'offline', error: 'INFERENCE_SERVICE_URL secret not configured in Supabase' }
  }

  const rawStatus = inferenceHealth?.status as string | undefined
  const isOnline = rawStatus === 'ok' || rawStatus === 'healthy'
  const isOffline = !rawStatus || rawStatus === 'offline'

  return {
    status: isOnline ? 'online' : isOffline ? 'offline' : 'degraded',
    error: inferenceHealth?.error as string | undefined,
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const railwayServices = {
  // NZSCV/MotorWeb
  checkNZSCVCertification,
  enrichVehicleFromMotorWeb,

  // Inference (use inferVehicle for new code; others are compatibility wrappers)
  inferVehicle,
  detectVehicles,
  generateVehicleEmbedding,
  performOCR,
  analyzeVehiclePhoto,

  // Health
  checkProxyHealth,
  checkInferenceHealth,
}
