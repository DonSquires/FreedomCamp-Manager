/**
 * Shared SCV (Self-Contained Vehicle) list parsing utilities.
 *
 * Both DataManagementHub and NZSCVMonitor need to download and parse the NZSCV
 * Excel spreadsheet from Supabase Storage before passing entries to the
 * sync-scv-list edge function.  Centralising these helpers avoids duplication
 * and ensures both pages stay in sync with any format changes.
 */

import readXlsxFile from 'read-excel-file'

export interface ScvCurrentEntry {
  plate_number: string
  expiry: string | null
}

export interface ScvSyncResult {
  total_in_scv_list: number
  canonical_vehicles_checked: number
  set_to_current: number
  set_to_not_current: number
  expiry_corrected: number
  unchanged: number
  observations_updated: number
  breach_alerts_resolved: number
  canonical_scv_enriched: number
  errors: string[]
}

export interface ScvSyncBatch {
  offset: number
  batch_size: number
  processed: number
  total_canonical_vehicles: number | null
  next_offset: number | null
  has_more: boolean
  batch_number: number
  total_batches: number | null
}

export interface ScvSyncResponse {
  result: ScvSyncResult
  batch: ScvSyncBatch
}

export interface ScvSyncProgress {
  processed: number
  total: number | null
  batchNumber: number
  totalBatches: number | null
}

export const SCV_BATCH_SIZE = 50

export const EMPTY_SCV_RESULT: ScvSyncResult = {
  total_in_scv_list: 0,
  canonical_vehicles_checked: 0,
  set_to_current: 0,
  set_to_not_current: 0,
  expiry_corrected: 0,
  unchanged: 0,
  observations_updated: 0,
  breach_alerts_resolved: 0,
  canonical_scv_enriched: 0,
  errors: [],
}

function rowsToRecords(matrix: unknown[][]): Record<string, string>[] {
  if (!matrix.length) return []

  const headers = matrix[0]
    .map((value) => String(value ?? '').trim())

  const rows: Record<string, string>[] = []
  matrix.slice(1).forEach((row) => {
    const record: Record<string, string> = {}
    headers.forEach((header, idx) => {
      if (!header) return
      const cellValue = row[idx]
      record[header] = String(cellValue ?? '').trim()
    })
    rows.push(record)
  })

  return rows
}

export function mergeScvResults(
  current: ScvSyncResult,
  incoming: ScvSyncResult,
): ScvSyncResult {
  return {
    total_in_scv_list: incoming.total_in_scv_list || current.total_in_scv_list,
    canonical_vehicles_checked:
      current.canonical_vehicles_checked + incoming.canonical_vehicles_checked,
    set_to_current: current.set_to_current + incoming.set_to_current,
    set_to_not_current: current.set_to_not_current + incoming.set_to_not_current,
    expiry_corrected: current.expiry_corrected + incoming.expiry_corrected,
    unchanged: current.unchanged + incoming.unchanged,
    observations_updated: current.observations_updated + incoming.observations_updated,
    breach_alerts_resolved: current.breach_alerts_resolved + incoming.breach_alerts_resolved,
    canonical_scv_enriched: current.canonical_scv_enriched + incoming.canonical_scv_enriched,
    errors: [...current.errors, ...incoming.errors],
  }
}

function parseNZDateToISO(s: string): string | null {
  if (!s) return null
  const parts = s.trim().split('/')
  if (parts.length !== 3) return null
  const [dd, mm, yyyy] = parts
  if (!dd || !mm || !yyyy || yyyy.length !== 4) return null
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function calculateScvExpiry(issueDateStr: string): string | null {
  const iso = parseNZDateToISO(issueDateStr)
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + 4)
  d.setUTCDate(d.getUTCDate() - 1)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Fetches and parses the published SCV Excel file from Supabase Storage,
 * returning only the "Current" status entries with their computed expiry dates.
 *
 * Throws on network or parse failures so the caller can surface the error.
 */
export async function loadScvCurrentEntries(): Promise<ScvCurrentEntry[]> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!supabaseUrl) {
    throw new Error('Missing VITE_SUPABASE_URL')
  }

  const scvUrl = `${supabaseUrl}/storage/v1/object/public/Scv%20list/Vehicle%20List%20-%2017022026.xlsx`
  const response = await fetch(scvUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch SCV list: HTTP ${response.status}`)
  }

  const blob = await response.blob()
  const matrix = await readXlsxFile(blob)
  const rows = rowsToRecords(matrix)

  const entries: ScvCurrentEntry[] = []
  for (const row of rows) {
    const plate = (row['Vehicle Registration'] ?? '').trim().toUpperCase()
    const status = (row['Certificate Status'] ?? '').trim()
    const issueDateRaw = (row['Certificate Issue Date'] ?? '').trim()
    if (!plate || status !== 'Current') continue
    entries.push({ plate_number: plate, expiry: calculateScvExpiry(issueDateRaw) })
  }

  return entries
}
