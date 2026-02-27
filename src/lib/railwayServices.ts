/**
 * Railway Services Integration
 * 
 * Direct client-side access to Railway-deployed services:
 * 1. Proxy Server (NZSCV/MotorWeb API gateway)
 * 2. Inference Service (ORC/AI vehicle detection)
 */

import { supabase } from './supabase'

/**
 * Get Railway service URLs from Supabase secrets
 */
async function getRailwayServiceURLs(): Promise<{
  proxyUrl: string | null
  inferenceUrl: string | null
  error: string | null
}> {
  try {
    // Call Edge Function to retrieve Railway URLs from backend secrets
    const { data, error } = await supabase.functions.invoke('check-railway-health')

    if (error) {
      return {
        proxyUrl: null,
        inferenceUrl: null,
        error: error.message || 'Failed to get Railway service URLs',
      }
    }

    return {
      proxyUrl: data?.proxy_url || null,
      inferenceUrl: data?.inference_url || null,
      error: null,
    }
  } catch (error: any) {
    return {
      proxyUrl: null,
      inferenceUrl: null,
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
// ============================================================================

export interface VehicleDetectionResult {
  detected: boolean
  objects: Array<{
    class: string
    confidence: number
    bbox: [number, number, number, number]
  }>
  vehicle_count: number
}

export interface VehicleEmbeddingResult {
  embedding: number[]
  embedding_quality: number
  model_version: string
}

export interface OCRResult {
  plate_number: string
  confidence: number
  bounding_box: [number, number, number, number]
}

/**
 * Detect vehicles in photo using YOLO model
 */
export async function detectVehicles(
  photoUrl: string
): Promise<{ data: VehicleDetectionResult | null; error: string | null }> {
  const { inferenceUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !inferenceUrl) {
    return {
      data: null,
      error: urlError || 'Inference service URL not configured',
    }
  }

  try {
    const response = await fetch(`${inferenceUrl}/detect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image_url: photoUrl }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        data: null,
        error: `Vehicle detection failed: ${response.status} - ${errorText}`,
      }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (error: any) {
    return {
      data: null,
      error: error.message || 'Network error contacting inference service',
    }
  }
}

/**
 * Generate 384-D embedding for vehicle photo
 */
export async function generateVehicleEmbedding(
  photoUrl: string
): Promise<{ data: VehicleEmbeddingResult | null; error: string | null }> {
  const { inferenceUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !inferenceUrl) {
    return {
      data: null,
      error: urlError || 'Inference service URL not configured',
    }
  }

  try {
    const response = await fetch(`${inferenceUrl}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image_url: photoUrl }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        data: null,
        error: `Embedding generation failed: ${response.status} - ${errorText}`,
      }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (error: any) {
    return {
      data: null,
      error: error.message || 'Network error contacting inference service',
    }
  }
}

/**
 * Perform OCR on vehicle photo to extract plate number
 */
export async function performOCR(
  photoUrl: string
): Promise<{ data: OCRResult | null; error: string | null }> {
  const { inferenceUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !inferenceUrl) {
    return {
      data: null,
      error: urlError || 'Inference service URL not configured',
    }
  }

  try {
    const response = await fetch(`${inferenceUrl}/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image_url: photoUrl }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        data: null,
        error: `OCR failed: ${response.status} - ${errorText}`,
      }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (error: any) {
    return {
      data: null,
      error: error.message || 'Network error contacting inference service',
    }
  }
}

/**
 * Analyze vehicle photo with full AI pipeline
 * Returns detection + embedding + OCR
 */
export async function analyzeVehiclePhoto(photoUrl: string): Promise<{
  data: {
    detection: VehicleDetectionResult
    embedding: VehicleEmbeddingResult
    ocr?: OCRResult
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
    const response = await fetch(`${inferenceUrl}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image_url: photoUrl }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        data: null,
        error: `Analysis failed: ${response.status} - ${errorText}`,
      }
    }

    const data = await response.json()
    return { data, error: null }
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
 * Check proxy server health
 */
export async function checkProxyHealth(): Promise<ServiceHealthStatus> {
  const { proxyUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !proxyUrl) {
    return {
      status: 'offline',
      error: urlError || 'Service URL not configured',
    }
  }

  const startTime = Date.now()
  try {
    const response = await fetch(`${proxyUrl}/health`, {
      method: 'GET',
    })

    const latency = Date.now() - startTime

    if (!response.ok) {
      return {
        status: 'degraded',
        latency_ms: latency,
        error: `HTTP ${response.status}`,
      }
    }

    return {
      status: 'online',
      latency_ms: latency,
    }
  } catch (error: any) {
    return {
      status: 'offline',
      error: error.message || 'Connection failed',
    }
  }
}

/**
 * Check inference service health
 */
export async function checkInferenceHealth(): Promise<ServiceHealthStatus> {
  const { inferenceUrl, error: urlError } = await getRailwayServiceURLs()

  if (urlError || !inferenceUrl) {
    return {
      status: 'offline',
      error: urlError || 'Service URL not configured',
    }
  }

  const startTime = Date.now()
  try {
    const response = await fetch(`${inferenceUrl}/health`, {
      method: 'GET',
    })

    const latency = Date.now() - startTime

    if (!response.ok) {
      return {
        status: 'degraded',
        latency_ms: latency,
        error: `HTTP ${response.status}`,
      }
    }

    return {
      status: 'online',
      latency_ms: latency,
    }
  } catch (error: any) {
    return {
      status: 'offline',
      error: error.message || 'Connection failed',
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const railwayServices = {
  // NZSCV/MotorWeb
  checkNZSCVCertification,
  enrichVehicleFromMotorWeb,

  // Inference
  detectVehicles,
  generateVehicleEmbedding,
  performOCR,
  analyzeVehiclePhoto,

  // Health
  checkProxyHealth,
  checkInferenceHealth,
}
