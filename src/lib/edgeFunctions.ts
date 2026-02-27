/**
 * Edge Functions Integration Layer
 * 
 * Centralized helpers for calling all Supabase Edge Functions
 * with proper error handling, typing, and retries.
 */

import { supabase } from './supabase'
import { FunctionsHttpError } from '@supabase/supabase-js'

/**
 * Generic Edge Function caller with comprehensive error handling
 */
async function callEdgeFunction<T = any>(
  functionName: string,
  body?: any,
  options?: {
    retries?: number
    timeout?: number
  }
): Promise<{ data: T | null; error: string | null }> {
  const { retries = 0, timeout = 60000 } = options || {}

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body,
      })

      if (error) {
        let errorMessage = error.message

        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500
            const textContent = await error.context?.text()
            errorMessage = `[${statusCode}] ${textContent || error.message || 'Unknown error'}`
          } catch {
            errorMessage = error.message || 'Failed to read response'
          }
        }

        // Don't retry on client errors (4xx)
        if (error instanceof FunctionsHttpError && error.context?.status && error.context.status < 500) {
          return { data: null, error: errorMessage }
        }

        // Retry on server errors (5xx)
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
          continue
        }

        return { data: null, error: errorMessage }
      }

      return { data, error: null }
    } catch (error: any) {
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
        continue
      }
      return { data: null, error: error.message || 'Unknown error' }
    }
  }

  return { data: null, error: 'Max retries exceeded' }
}

// ============================================================================
// OBSERVATION PIPELINE
// ============================================================================

export interface VehicleIngestParams {
  plate_number: string
  photo_url: string
  latitude: number
  longitude: number
  zone_id?: string
  officer_notes?: string
  weather_conditions?: string
}

export interface VehicleIngestResult {
  observation_id: string
  vehicle_id: string
  is_compliant: boolean
  breach_detected: boolean
  breach_type?: string
}

/**
 * Main observation creation pipeline
 * Combines ALPR → vehicle enrichment → compliance check → breach detection
 */
export async function ingestVehicleObservation(params: VehicleIngestParams) {
  return callEdgeFunction<VehicleIngestResult>('vehicle-ingest', params, {
    retries: 1,
    timeout: 30000,
  })
}

// ============================================================================
// ALPR PROCESSING
// ============================================================================

export interface ALPRProcessParams {
  photo_url: string
  latitude: number
  longitude: number
}

export interface ALPRResult {
  plate_number: string
  confidence: number
  vehicle_make?: string
  vehicle_model?: string
  vehicle_color?: string
}

/**
 * Process photo through ALPR service
 */
export async function processALPR(params: ALPRProcessParams) {
  return callEdgeFunction<ALPRResult>('alpr-process', params, {
    retries: 2,
    timeout: 20000,
  })
}

// ============================================================================
// COMPLIANCE ENGINE
// ============================================================================

export interface RecalculateComplianceParams {
  scope_type: 'zone' | 'organization' | 'date_range' | 'all'
  target_zone_ids?: string[]
  target_org_ids?: string[]
  date_range_start?: string
  date_range_end?: string
}

export interface RecalculateComplianceResult {
  observations_processed: number
  compliance_changed: number
  drift_events_created: number
  breaches_detected: number
}

/**
 * Recalculate compliance for observations
 */
export async function recalculateCompliance(params: RecalculateComplianceParams) {
  return callEdgeFunction<RecalculateComplianceResult>('recalculate-compliance-v2', params, {
    timeout: 120000, // 2 minutes for large recalculations
  })
}

// ============================================================================
// BREACH DETECTION
// ============================================================================

export interface ScanBreachesParams {
  organization_id?: string
  zone_id?: string
  date_from?: string
  date_to?: string
}

export interface ScanBreachesResult {
  breaches_detected: number
  alerts_created: number
}

/**
 * Scan for new breaches and create alerts
 */
export async function scanForBreaches(params: ScanBreachesParams) {
  return callEdgeFunction<ScanBreachesResult>('scan-breaches', params)
}

// ============================================================================
// PDF GENERATION
// ============================================================================

export interface GenerateIncidentPDFParams {
  incident_id: string
}

export interface GeneratePDFResult {
  pdf_url: string
  file_name: string
}

/**
 * Generate incident report PDF
 */
export async function generateIncidentPDF(incident_id: string) {
  return callEdgeFunction<GeneratePDFResult>('generate-incident-pdf', {
    incident_id,
  })
}

/**
 * Generate notice to vacate PDF
 */
export async function generateNoticeToVacate(breach_alert_id: string) {
  return callEdgeFunction<GeneratePDFResult>('generate-notice-to-vacate', {
    breach_alert_id,
  })
}

/**
 * Generate vehicle history report PDF
 */
export async function generateVehicleReport(vehicle_id: string) {
  return callEdgeFunction<GeneratePDFResult>('generate-vehicle-report', {
    vehicle_id,
  })
}

/**
 * Generate leadership pack (dashboard summary PDF)
 */
export async function generateLeadershipPack(params: {
  organization_id?: string
  date_from: string
  date_to: string
}) {
  return callEdgeFunction<GeneratePDFResult>('generate-leadership-pack', params)
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export interface SendPushNotificationParams {
  user_id: string
  title: string
  body: string
  data?: Record<string, any>
}

/**
 * Send push notification to officer
 */
export async function sendPushNotification(params: SendPushNotificationParams) {
  return callEdgeFunction('send-push-notification', params)
}

// ============================================================================
// VEHICLE ENRICHMENT
// ============================================================================

export interface CheckNZSCVParams {
  plate_number: string
}

export interface NZSCVResult {
  is_self_contained: boolean
  warrant_type: string
  warrant_number?: string
  warrant_expiry?: string
  verified_at: string
}

/**
 * Check NZSCV warrant status via proxy server
 */
export async function checkNZSCVStatus(plate_number: string) {
  return callEdgeFunction<NZSCVResult>('check-nzscv-status', {
    plate_number,
  })
}

/**
 * Enrich vehicle from MotorWeb API
 */
export async function enrichFromMotorWeb(plate_number: string) {
  return callEdgeFunction('enrich-from-motorweb', {
    plate_number,
  })
}

// ============================================================================
// AI/ORC PROCESSING
// ============================================================================

export interface AnalyzeVehiclePhotoParams {
  photo_url: string
  analysis_type: 'detection' | 'embedding' | 'both'
}

export interface VehicleAnalysisResult {
  detected_objects: Array<{
    class: string
    confidence: number
    bbox: [number, number, number, number]
  }>
  embedding?: number[]
  vehicle_make?: string
  vehicle_model?: string
  vehicle_color?: string
}

/**
 * Analyze vehicle photo using Railway inference service
 */
export async function analyzeVehiclePhoto(params: AnalyzeVehiclePhotoParams) {
  return callEdgeFunction<VehicleAnalysisResult>('analyze-vehicle-photo', params, {
    timeout: 30000,
  })
}

/**
 * Select best profile photo for vehicle using AI
 */
export async function selectBestVehiclePhoto(vehicle_id: string) {
  return callEdgeFunction('select-best-vehicle-photo', {
    vehicle_id,
  })
}

// ============================================================================
// DATA MANAGEMENT
// ============================================================================

/**
 * Check data integrity
 */
export async function checkDataIntegrity(organization_id?: string) {
  return callEdgeFunction('check-data-integrity', {
    organization_id,
  })
}

/**
 * Detect duplicate observations
 */
export async function detectDuplicates(params: {
  date_from: string
  date_to: string
  organization_id?: string
}) {
  return callEdgeFunction('duplicate-detection', params)
}

/**
 * Correct zone assignments
 */
export async function correctZoneAssignments(params: {
  date_from: string
  date_to: string
  organization_id?: string
}) {
  return callEdgeFunction('correct-zone-assignments', params)
}

// ============================================================================
// USER MANAGEMENT
// ============================================================================

export interface CreateUserParams {
  email: string
  password: string
  first_name: string
  last_name: string
  role: string
  organization_id: string
  phone?: string
}

/**
 * Create new user account
 */
export async function createUser(params: CreateUserParams) {
  return callEdgeFunction('create-user', params)
}

/**
 * Update user password
 */
export async function updateUserPassword(user_id: string, new_password: string) {
  return callEdgeFunction('update-user-password', {
    user_id,
    new_password,
  })
}

// ============================================================================
// STATISTICS & REPORTING
// ============================================================================

/**
 * Get compliance statistics
 */
export async function getComplianceStatistics(params: {
  organization_id?: string
  zone_id?: string
  date_from: string
  date_to: string
}) {
  return callEdgeFunction('get-compliance-statistics', params)
}

/**
 * Generate dashboard report
 */
export async function generateDashboardReport(params: {
  organization_id?: string
  date_from: string
  date_to: string
}) {
  return callEdgeFunction('generate-dashboard-report', params)
}

// ============================================================================
// EXPORTS
// ============================================================================

export const edgeFunctions = {
  // Observation Pipeline
  ingestVehicleObservation,
  processALPR,
  recalculateCompliance,
  scanForBreaches,

  // PDF Generation
  generateIncidentPDF,
  generateNoticeToVacate,
  generateVehicleReport,
  generateLeadershipPack,

  // Notifications
  sendPushNotification,

  // Vehicle Enrichment
  checkNZSCVStatus,
  enrichFromMotorWeb,

  // AI/ORC
  analyzeVehiclePhoto,
  selectBestVehiclePhoto,

  // Data Management
  checkDataIntegrity,
  detectDuplicates,
  correctZoneAssignments,

  // User Management
  createUser,
  updateUserPassword,

  // Statistics
  getComplianceStatistics,
  generateDashboardReport,
}
