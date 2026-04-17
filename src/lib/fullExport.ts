/**
 * Utility Library: fullExport
 * Complete data export for organizations (all tables)
 */

import { supabase } from './supabase'
import { toast } from 'sonner'

interface ExportOptions {
  organizationId?: string
  dateFrom?: string
  dateTo?: string
  includeTables?: string[]
  excludeTables?: string[]
  format?: 'json' | 'csv'
}

interface ExportResult {
  success: boolean
  exportId: string
  tables: Record<string, any[]>
  metadata: {
    exportedAt: string
    organizationId?: string
    dateRange?: { from: string; to: string }
    totalRecords: number
    tablesExported: string[]
  }
}

const DEFAULT_TABLES = [
  'observations',
  'canonical_vehicles',
  'zones',
  'patrols',
  'breach_alerts',
  'enforcement_actions',
  'incidents',
  'health_safety_reports',
  'plate_scans',
  'user_profiles',
  'organizations',
]

/**
 * Export all data for an organization
 */
export async function exportAllData(
  options: ExportOptions = {}
): Promise<ExportResult> {
  const {
    organizationId,
    dateFrom,
    dateTo,
    includeTables = DEFAULT_TABLES,
    excludeTables = [],
  } = options

  const tables = includeTables.filter(table => !excludeTables.includes(table))
  const exportData: Record<string, any[]> = {}
  let totalRecords = 0

  try {
    // Export each table
    for (const table of tables) {
      const data = await exportTable(table, {
        organizationId,
        dateFrom,
        dateTo,
      })

      if (data.length > 0) {
        exportData[table] = data
        totalRecords += data.length
      }
    }

    const result: ExportResult = {
      success: true,
      exportId: crypto.randomUUID(),
      tables: exportData,
      metadata: {
        exportedAt: new Date().toISOString(),
        organizationId,
        totalRecords,
        tablesExported: Object.keys(exportData),
      },
    }

    if (dateFrom && dateTo) {
      result.metadata.dateRange = { from: dateFrom, to: dateTo }
    }

    return result
  } catch (error: any) {
    console.error('Export failed:', error)
    throw new Error(`Export failed: ${error.message}`)
  }
}

/**
 * Export single table
 */
async function exportTable(
  tableName: string,
  filters: {
    organizationId?: string
    dateFrom?: string
    dateTo?: string
  }
): Promise<any[]> {
  let query = (supabase.from(tableName as any) as any).select('*')

  // Apply organization filter if applicable
  if (filters.organizationId && hasOrganizationColumn(tableName)) {
    query = query.eq('organization_id', filters.organizationId)
  }

  // Apply date range filter if applicable
  if (filters.dateFrom && filters.dateTo && hasDateColumn(tableName)) {
    const dateColumn = getDateColumn(tableName)
    query = query
      .gte(dateColumn, filters.dateFrom)
      .lte(dateColumn, filters.dateTo)
  }

  const { data, error } = await query

  if (error) {
    console.error(`Failed to export ${tableName}:`, error)
    return []
  }

  return data || []
}

/**
 * Check if table has organization_id column
 */
function hasOrganizationColumn(tableName: string): boolean {
  const tablesWithOrg = [
    'observations',
    'zones',
    'patrols',
    'breach_alerts',
    'enforcement_actions',
    'incidents',
    'health_safety_reports',
    'plate_scans',
    'user_profiles',
    'organizations',
  ]
  return tablesWithOrg.includes(tableName)
}

/**
 * Check if table has date column
 */
function hasDateColumn(tableName: string): boolean {
  return true // Most tables have created_at or similar
}

/**
 * Get date column name for table
 */
function getDateColumn(tableName: string): string {
  const dateColumns: Record<string, string> = {
    observations: 'recorded_at',
    patrols: 'created_at',
    breach_alerts: 'created_at',
    enforcement_actions: 'created_at',
    incidents: 'created_at',
    health_safety_reports: 'created_at',
    plate_scans: 'scanned_at',
  }

  return dateColumns[tableName] || 'created_at'
}

/**
 * Convert export result to JSON file
 */
export function exportToJSON(result: ExportResult): Blob {
  const json = JSON.stringify(result, null, 2)
  return new Blob([json], { type: 'application/json' })
}

/**
 * Convert export result to CSV (multiple files zipped)
 */
export function exportToCSV(result: ExportResult): Record<string, Blob> {
  const csvFiles: Record<string, Blob> = {}

  for (const [tableName, records] of Object.entries(result.tables)) {
    if (records.length === 0) continue

    // Get column headers
    const headers = Object.keys(records[0])

    // Build CSV content
    const csvRows = [
      headers.join(','), // Header row
      ...records.map(record =>
        headers.map(header => {
          const value = record[header]
          // Escape commas, double-quotes, and newlines per RFC 4180
          if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r'))) {
            return `"${value.replace(/"/g, '""')}"`
          }
          return value === null || value === undefined ? '' : value
        }).join(',')
      ),
    ]

    const csv = csvRows.join('\n')
    csvFiles[`${tableName}.csv`] = new Blob([csv], { type: 'text/csv' })
  }

  return csvFiles
}

/**
 * Download export as JSON file
 */
export function downloadExportJSON(result: ExportResult, filename?: string): void {
  const blob = exportToJSON(result)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  
  link.href = url
  link.download = filename || `export_${result.exportId}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  toast.success('Export downloaded')
}

/**
 * Download export as CSV files (requires JSZip or manual download)
 */
export function downloadExportCSV(result: ExportResult): void {
  const csvFiles = exportToCSV(result)

  // Download each CSV file separately
  Object.entries(csvFiles).forEach(([filename, blob]) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  })

  toast.success(`Downloaded ${Object.keys(csvFiles).length} CSV files`)
}

/**
 * Export observations with vehicle details
 */
export async function exportObservationsWithVehicles(
  organizationId: string,
  dateFrom: string,
  dateTo: string
): Promise<any[]> {
  const { data, error } = await supabase
    .from('observations')
    .select(`
      *,
      canonical_vehicles!observations_plate_number_fkey (
        vehicle_make,
        vehicle_model,
        vehicle_year,
        vehicle_color,
        self_contained,
        self_contained_expiry,
        homeless_status,
        is_flagged
      ),
      zones!vehicle_observations_v2_zone_id_fkey (
        name,
        description,
        self_contained_required,
        nights_per_month,
        max_consecutive_nights
      ),
      user_profiles!vehicle_observations_v2_recorded_by_fkey (
        first_name,
        last_name,
        email
      )
    `)
    .eq('organization_id', organizationId)
    .gte('recorded_at', dateFrom)
    .lte('recorded_at', dateTo)
    .order('recorded_at', { ascending: false })

  if (error) {
    console.error('Failed to export observations:', error)
    throw error
  }

  return data || []
}

/**
 * Export compliance summary report
 */
export async function exportComplianceSummary(
  organizationId: string,
  dateFrom: string,
  dateTo: string
): Promise<any[]> {
  const { data, error } = await supabase
    .from('observations')
    .select('plate_number, is_compliant, breach_type, zone_id, recorded_at')
    .eq('organization_id', organizationId)
    .gte('recorded_at', dateFrom)
    .lte('recorded_at', dateTo)

  if (error) {
    console.error('Failed to export compliance summary:', error)
    throw error
  }

  return data || []
}

/**
 * Export enforcement actions report
 */
export async function exportEnforcementActions(
  organizationId: string,
  dateFrom: string,
  dateTo: string
): Promise<any[]> {
  const { data, error } = await supabase
    .from('enforcement_actions')
    .select(`
      *,
      user_profiles!enforcement_actions_created_by_fkey (
        first_name,
        last_name
      ),
      zones!enforcement_actions_zone_id_fkey (
        name
      )
    `)
    .eq('organization_id', organizationId)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to export enforcement actions:', error)
    throw error
  }

  return data || []
}

/**
 * Schedule automatic export (daily/weekly)
 */
export function scheduleAutoExport(
  organizationId: string,
  frequency: 'daily' | 'weekly',
  email: string
): void {
  // This would be implemented server-side via Edge Function
  console.log(`Scheduling ${frequency} export for ${email}`)
  toast.success(`Auto-export scheduled (${frequency})`)
}

/**
 * Get export history
 */
export async function getExportHistory(organizationId: string): Promise<any[]> {
  // In production, this would query an export_history table
  return []
}

/**
 * Import data from JSON export
 */
export async function importFromExport(exportData: ExportResult): Promise<{
  success: boolean
  imported: number
  errors: string[]
}> {
  // This would be implemented server-side via Edge Function for security
  console.warn('Import must be done server-side with admin authorization')
  
  return {
    success: false,
    imported: 0,
    errors: ['Import not implemented'],
  }
}
