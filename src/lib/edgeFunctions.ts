/**
 * Edge Functions Library - Type-safe wrappers for all 47 Supabase Edge Functions
 * 
 * This library provides a centralized interface for calling all Edge Functions
 * with proper error handling, type safety, and toast notifications.
 */

import { supabase } from './supabase'
import { toast } from 'sonner'
import { FunctionsHttpError } from '@supabase/supabase-js'

/**
 * Helper to extract error message from FunctionsHttpError
 */
async function getErrorMessage(error: any): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const statusCode = error.context?.status ?? 500
      const textContent = await error.context?.text()
      return `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`
    } catch {
      return error.message || 'Failed to read response'
    }
  }
  return error.message || 'Unknown error'
}

/**
 * Generic Edge Function caller with error handling
 */
async function callEdgeFunction<T = any>(
  functionName: string,
  body?: any,
  options: { showToast?: boolean } = { showToast: true }
): Promise<{ data: T | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: body || {},
    })

    if (error) {
      const errorMessage = await getErrorMessage(error)
      if (options.showToast) {
        toast.error(errorMessage)
      }
      return { data: null, error: errorMessage }
    }

    return { data, error: null }
  } catch (error: any) {
    const errorMessage = await getErrorMessage(error)
    if (options.showToast) {
      toast.error(errorMessage)
    }
    return { data: null, error: errorMessage }
  }
}

// ============================================================================
// COMPLIANCE & BREACH MANAGEMENT (8 functions)
// ============================================================================

export const edgeFunctions = {
  /**
   * Process ALPR - Plate Recognizer pipeline
   */
  processALPR: async (params: {
    photo_url: string
    latitude: number
    longitude: number
    accuracy?: number
    officer_id?: string
    organization_id?: string
    zone_id?: string
  }) => {
    return callEdgeFunction('alpr-process', params)
  },

  /**
   * Retry ALPR processing on incident evidence
   */
  retryALPR: async (params: {
    incident_id: string
  }) => {
    return callEdgeFunction('alpr-retry', params)
  },

  /**
   * Check almost breaches (predict overnight violations)
   */
  checkAlmostBreaches: async (params: {
    organization_id?: string
    zone_id?: string
  }) => {
    return callEdgeFunction('check-almost-breaches', params)
  },

  /**
   * Scan all vehicles for compliance breaches
   */
  scanBreaches: async (params: {
    organization_id?: string
    zone_id?: string
  }) => {
    return callEdgeFunction('scan-breaches', params)
  },

  /**
   * Bulk compliance recalculation with drift detection
   */
  recalculateCompliance: async (params: {
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('recalculate-compliance', params)
  },

  /**
   * Strict zone-based compliance recalculation
   */
  recalculateComplianceV2: async (params: {
    zone_id: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('recalculate-compliance-v2', params)
  },

  /**
   * 3-phase cleanup: zone correction → dedup → compliance recalc
   */
  cleanupAndRecalculate: async (params: {
    organization_id?: string
  }) => {
    return callEdgeFunction('cleanup-and-recalculate', params)
  },

  /**
   * Find and remove duplicate observations
   */
  detectDuplicates: async (params: {
    hours_window?: number
  }) => {
    return callEdgeFunction('duplicate-detection', params)
  },

  // ============================================================================
  // VEHICLE & OBSERVATION MANAGEMENT (8 functions)
  // ============================================================================

  /**
   * Production vehicle observation pipeline
   */
  ingestVehicleObservation: async (params: {
    plate_number: string
    photo_url: string
    latitude: number
    longitude: number
    accuracy?: number
    officer_id?: string
    organization_id?: string
    zone_id?: string
    officer_notes?: string
    weather_conditions?: string
  }) => {
    return callEdgeFunction('vehicle-ingest', params)
  },

  /**
   * Unified ORC/AI pipeline with fallbacks
   */
  orcIngest: async (params: {
    photo_url: string
    latitude: number
    longitude: number
    officer_id: string
    organization_id: string
    zone_id: string
  }) => {
    return callEdgeFunction('orc-ingest', params)
  },

  /**
   * List observations with filters
   */
  listObservations: async (params: {
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
    plate_number?: string
    page?: number
    limit?: number
  }) => {
    return callEdgeFunction('observations-list', params)
  },

  /**
   * Get observations within GPS bounds (for map)
   */
  observationsInBounds: async (params: {
    north: number
    south: number
    east: number
    west: number
    organization_id?: string
  }) => {
    return callEdgeFunction('observations-in-bounds', params)
  },

  /**
   * Export observations to CSV
   */
  exportObservations: async (params: {
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('observations-export', params)
  },

  /**
   * AI vehicle analysis (make/model/year/colour)
   */
  analyzeVehiclePhoto: async (params: {
    photo_url: string
  }) => {
    return callEdgeFunction('analyze-vehicle-photo', params)
  },

  /**
   * AI profile photo selection
   */
  selectBestVehiclePhoto: async (params: {
    plate_number: string
  }) => {
    return callEdgeFunction('select-best-vehicle-photo', params)
  },

  // ============================================================================
  // DATA MANAGEMENT (6 functions)
  // ============================================================================

  /**
   * Check data integrity (duplicates, orphans, invalid plates)
   */
  checkDataIntegrity: async () => {
    return callEdgeFunction('check-data-integrity')
  },

  /**
   * Validate GPS vs zone geofence
   */
  checkZoneCorrections: async (params: {
    organization_id?: string
  }) => {
    return callEdgeFunction('check-zone-corrections', params)
  },

  /**
   * Batch zone correction (GPS-based)
   */
  correctZoneAssignments: async (params: {
    organization_id?: string
    dry_run?: boolean
  }) => {
    return callEdgeFunction('correct-zone-assignments', params)
  },

  /**
   * Zone correction with "Other Location" fallback
   */
  zoneCorrection: async (params: {
    observation_id: string
  }) => {
    return callEdgeFunction('zone-correction', params)
  },

  /**
   * AI-powered file import
   */
  importData: async (params: {
    file_url: string
    file_type: string
  }) => {
    return callEdgeFunction('import-data', params)
  },

  /**
   * Excel import with zone fuzzy matching
   */
  importHistoricalData: async (params: {
    file_url: string
  }) => {
    return callEdgeFunction('import-historical-data', params)
  },

  // ============================================================================
  // REPORTING & PDF (6 functions)
  // ============================================================================

  /**
   * Generate court-ready incident PDF
   */
  generateIncidentPDF: async (params: {
    incident_id: string
  }) => {
    return callEdgeFunction('generate-incident-pdf', params)
  },

  /**
   * Generate vehicle evidence report
   */
  generateVehicleReport: async (params: {
    plate_number: string
  }) => {
    return callEdgeFunction('generate-vehicle-report', params)
  },

  /**
   * Generate dashboard statistics report
   */
  generateDashboardReport: async (params: {
    organization_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('generate-dashboard-report', params)
  },

  /**
   * Generate leadership pack (executive summary)
   */
  generateLeadershipPack: async (params: {
    organization_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('generate-leadership-pack', params)
  },

  /**
   * Generate legal Notice to Vacate
   */
  generateNoticeToVacate: async (params: {
    breach_alert_id: string
  }) => {
    return callEdgeFunction('generate-notice-to-vacate', params)
  },

  /**
   * Get real-time compliance statistics
   */
  getComplianceStatistics: async (params: {
    organization_id?: string
    zone_id?: string
  }) => {
    return callEdgeFunction('get-compliance-statistics', params)
  },

  // ============================================================================
  // LOCATION & INTEGRATIONS (7 functions)
  // ============================================================================

  /**
   * Get GPS heatmap clustering data
   */
  getHotspotData: async (params: {
    organization_id?: string
    zone_id?: string
    date_from?: string
    date_to?: string
  }) => {
    return callEdgeFunction('hotspot-data', params)
  },

  /**
   * Check NZSCV self-contained status
   */
  checkNZSCVStatus: async (params: {
    plate_number: string
  }) => {
    return callEdgeFunction('check-nzscv-status', params)
  },

  /**
   * Enrich vehicle from MotorWeb
   */
  enrichFromMotorWeb: async (params: {
    plate_number: string
  }) => {
    return callEdgeFunction('enrich-from-motorweb', params)
  },

  /**
   * Get weather at GPS coordinates
   */
  getWeather: async (params: {
    latitude: number
    longitude: number
  }) => {
    return callEdgeFunction('get-weather', params)
  },

  /**
   * Suggest new zone via Nominatim
   */
  suggestNewZone: async (params: {
    latitude: number
    longitude: number
  }) => {
    return callEdgeFunction('suggest-new-zone', params)
  },

  /**
   * Stream webhook (Plate Recognizer Stream)
   */
  streamWebhook: async (params: any) => {
    return callEdgeFunction('stream-webhook', params, { showToast: false })
  },

  // ============================================================================
  // NOTIFICATIONS (2 functions)
  // ============================================================================

  /**
   * Send push notification
   */
  sendPushNotification: async (params: {
    user_id: string
    title: string
    body: string
    data?: any
  }) => {
    return callEdgeFunction('send-push-notification', params)
  },

  /**
   * Monitor officer welfare
   */
  monitorOfficerWelfare: async (params: {
    officer_id: string
  }) => {
    return callEdgeFunction('monitor-officer-welfare', params)
  },

  // ============================================================================
  // ADMIN & USERS (3 functions)
  // ============================================================================

  /**
   * Admin incident operations (legal hold, bulk updates)
   */
  adminIncidentOps: async (params: {
    operation: string
    incident_ids?: string[]
    legal_hold?: boolean
  }) => {
    return callEdgeFunction('admin-incident-ops', params)
  },

  /**
   * Create user with profile & role
   */
  createUser: async (params: {
    email: string
    password: string
    first_name: string
    last_name: string
    role: string
    organization_id: string
  }) => {
    return callEdgeFunction('create-user', params)
  },

  /**
   * Update compliance policy
   */
  updateCompliancePolicy: async (params: {
    zone_id: string
    policy: any
  }) => {
    return callEdgeFunction('update-compliance-policy', params)
  },

  // ============================================================================
  // DOCUMENT PROCESSING (3 functions)
  // ============================================================================

  /**
   * Process credential document (COA/Warrant)
   */
  processCredentialDocument: async (params: {
    file_url: string
    document_type: 'coa' | 'warrant'
  }) => {
    return callEdgeFunction('process-credential-document', params)
  },

  /**
   * Process homeless data
   */
  processHomelessData: async (params: {
    file_url: string
  }) => {
    return callEdgeFunction('process-homeless-data', params)
  },

  /**
   * Process investigation document
   */
  processInvestigationDocument: async (params: {
    file_url: string
  }) => {
    return callEdgeFunction('process-investigation-document', params)
  },

  // ============================================================================
  // UTILITIES (2 functions)
  // ============================================================================

  /**
   * Upload file to Supabase Storage
   */
  uploadFile: async (params: {
    bucket: string
    path: string
    file: File
  }) => {
    return callEdgeFunction('upload-file', params)
  },

  /**
   * OnSpace AI chat for bug analysis
   */
  onspaceAIChat: async (params: {
    message: string
    context?: any
  }) => {
    return callEdgeFunction('onspace-ai-chat', params)
  },
}
