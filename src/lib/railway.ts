/**
 * Railway Services Integration
 * 
 * This module provides typed clients for interacting with Railway-deployed services:
 * 1. Proxy Server - NZSCV/MotorWeb API gateway
 * 2. Inference Service - Vehicle photo analysis (YOLOv8n + MobileNetV3 embeddings)
 */

import { supabase } from './supabase'
import { edgeFunctions } from './edgeFunctions'

// Railway service endpoints (set via Supabase Edge Function secrets)
// These are NOT exposed to the frontend - only Edge Functions can access them
const PROXY_SERVER_URL = import.meta.env.VITE_PROXY_SERVER_URL
const INFERENCE_SERVICE_URL = import.meta.env.VITE_INFERENCE_SERVICE_URL

/**
 * Check NZSCV (Self-Contained Vehicle) status via proxy server
 * 
 * @param plateNumber - Vehicle registration plate
 * @returns NZSCV warrant details if found
 */
export async function checkNZSCVStatus(plateNumber: string) {
  const { data, error } = await edgeFunctions.checkNZSCVStatus({
    plate_number: plateNumber,
  })

  if (error) throw error
  return data
}

/**
 * Enrich vehicle data from MotorWeb via proxy server
 * 
 * @param plateNumber - Vehicle registration plate
 * @returns Vehicle details (make, model, year, etc.)
 */
export async function enrichFromMotorWeb(plateNumber: string) {
  const { data, error } = await edgeFunctions.enrichFromMotorWeb({
    plate_number: plateNumber,
  })

  if (error) throw error
  return data
}

/**
 * Analyze vehicle photo using inference service
 * 
 * @param photoUrl - Public URL of the vehicle photo
 * @returns Vehicle detection results + 384-D embedding
 */
export async function analyzeVehiclePhoto(photoUrl: string) {
  const { data, error } = await edgeFunctions.analyzeVehiclePhoto({
    photoUrl,
  })

  if (error) throw error
  return data
}

/**
 * Select best vehicle photo from multiple candidates
 * 
 * @param photoUrls - Array of photo URLs to compare
 * @returns Best photo URL + quality score
 */
export async function selectBestVehiclePhoto(photoUrls: string[]) {
  const { data, error } = await edgeFunctions.selectBestVehiclePhoto({
    photoUrls,
  })

  if (error) throw error
  return data
}

/**
 * Health check for Railway services
 * Note: Calls Edge Function which has access to service URLs
 */
export async function checkRailwayServicesHealth() {
  try {
    const { data, error } = await edgeFunctions.checkRailwayHealth()
    
    if (error) {
      console.error('Railway health check failed:', error)
      return { proxy: false, inference: false }
    }

    // Proxy returns { status: 'ok' }; inference returns { status: 'healthy' }.
    // Accept either value so both display as online.
    const proxyOk = data?.proxy?.status === 'ok' || data?.proxy?.status === 'healthy'
    const inferenceOk = data?.inference?.status === 'ok' || data?.inference?.status === 'healthy'
    return {
      proxy: proxyOk,
      inference: inferenceOk,
    }
  } catch (error) {
    console.error('Railway health check error:', error)
    return { proxy: false, inference: false }
  }
}
