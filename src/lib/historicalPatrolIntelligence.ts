import {
  BUREAU_PREFIX_TO_CLIENT,
  BUREAU_PREFIX_TO_BRANCH,
  DISPATCH_CODE_TO_ZONE_ID,
  FIRST_SECURITY_ORG_TEMPLATE,
} from '@/lib/orgClientTemplate'
import {
  buildNormalizedImportStagingContract,
  type NormalizedImportStagingContract,
} from '@/lib/importStagingContract'

export interface HistoricalPatrolRow {
  bureauId: string
  internalDespatchId: string
  internalClientId: string
  clientId: string
  clientName: string
  clientAddress: string
  clientSuburb: string
  clientPostcode: string
  onSiteAt: string
  offSiteAt: string
  comments: string
  patrolCompleteStatus: string
  isIncidentReport: boolean
  visitChargeExGst: number | null
  despatchZone: string
  despatchAt: string
}

export type HistoricalRoutingModule = 'noise_control' | 'alarm_response' | 'patrol_response'

export interface HistoricalRoutingSummary {
  module: HistoricalRoutingModule
  count: number
}

export interface HistoricalSiteCoverage {
  siteName: string
  rowCount: number
  modules: HistoricalRoutingSummary[]
}

export interface HistoricalPatrolNormalizedRow {
  dispatch_id: string
  client_name: string
  site_name: string
  site_address: string | null
  site_suburb: string | null
  site_postcode: string | null
  zone_code: string | null
  status: 'completed' | 'missed' | 'unknown'
  on_site_at_nz: string | null
  off_site_at_nz: string | null
  duration_minutes: number | null
  visit_charge_nzd: number | null
  source_quality_flags: string[]
  geofence_hint: string | null
  site_resolution_suggestions: HistoricalSiteResolutionSuggestion[]
  zone_fallback_zone_id: string | null
  zone_fallback_reason: string | null
  workflow_action: 'archive_completed_patrol' | 'schedule_makeup_patrol' | 'create_incident_followup'
  routing_module: HistoricalRoutingModule
  routing_reason: string
  /** Resolved branch org UUID (from BUREAU_PREFIX_TO_BRANCH) or null when unknown */
  resolved_organization_id: string | null
  /** Resolved client org UUID (from BUREAU_PREFIX_TO_CLIENT) or null when unknown */
  resolved_client_organization_id: string | null
  /** Resolved zone UUID (from DISPATCH_CODE_TO_ZONE_ID) or null when unknown */
  resolved_zone_id: string | null
}

export interface HistoricalSiteResolutionSuggestion {
  source: 'template_site_code' | 'template_site_name' | 'zone_fallback'
  suggested_site_name: string
  suggested_site_code: string | null
  suggested_zone_id: string | null
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export interface HistoricalPatrolImportDraft {
  normalizedRows: HistoricalPatrolNormalizedRow[]
  totalRows: number
  rowsRequiringReview: number
  zoneCoverage: Array<{ zoneCode: string; count: number }>
  routingCoverage: HistoricalRoutingSummary[]
  siteCoverage: HistoricalSiteCoverage[]
  stagingContract: NormalizedImportStagingContract
  sourceText: string
}

export interface HistoricalPatrolPlacementReview {
  totalRows: number
  completedRows: number
  missedRows: number
  rowsWithInternalDespatchId: number
  rowsWithTimestamps: number
  incidentReportRows: number
  uniqueClientCount: number
  totalVisitChargeExGst: number
  averageVisitChargeExGst: number | null
  trainingTips: string[]
}

const HEADER_ALIASES: Record<string, string[]> = {
  bureauId: ['bureau id'],
  internalDespatchId: ['internal despatchid', 'internal dispatchid', 'internal despatch id', 'internal dispatch id'],
  internalClientId: ['internal clientid', 'internal client id'],
  clientId: ['client id'],
  clientName: ['client name'],
  clientAddress: ['client address', 'address'],
  clientSuburb: ['client suburb', 'suburb'],
  clientPostcode: ['client postcode', 'postcode'],
  onSiteAt: ['on-site date/time', 'onsite date/time'],
  offSiteAt: ['off-site date/time', 'offsite date/time'],
  comments: ['comments'],
  patrolCompleteStatus: ['patrol complete status'],
  isIncidentReport: ['is incident report'],
  visitChargeExGst: ['visit charge (ex. gst)', 'visit charge ex gst', 'visit charge'],
  despatchZone: ['despatch zone', 'dispatch zone'],
  despatchAt: ['despatch date/time', 'dispatch date/time'],
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function detectDelimiter(raw: string): '\t' | ',' {
  const sample = raw.slice(0, 6000)
  const tabCount = (sample.match(/\t/g) || []).length
  const commaCount = (sample.match(/,/g) || []).length
  return tabCount >= commaCount ? '\t' : ','
}

function parseDelimitedRecords(raw: string, delimiter: '\t' | ','): string[][] {
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]

    if (char === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell.trim())
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && raw[i + 1] === '\n') i += 1
      row.push(cell.trim())
      cell = ''
      if (row.some((v) => v.length > 0)) records.push(row)
      row = []
      continue
    }

    cell += char
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    if (row.some((v) => v.length > 0)) records.push(row)
  }

  return records
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header))
}

function toBool(value: string): boolean {
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase())
}

function toNumber(value: string): number | null {
  if (!value?.trim()) return null
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeStatus(value: string): 'completed' | 'missed' | 'unknown' {
  if (value === 'completed') return 'completed'
  if (value === 'missed') return 'missed'
  return 'unknown'
}

function parseNzDateTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/)
  if (!match) return null

  const [, day, month, year, hour, minute] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00`
}

function computeDurationMinutes(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null

  let diff = Math.round((end - start) / 60000)
  if (diff < 0) diff += 24 * 60
  if (diff < 0 || diff > 12 * 60) return null
  return diff
}

function buildGeofenceHint(row: HistoricalPatrolRow): string | null {
  const parts = [row.despatchZone, row.clientSuburb, row.clientPostcode].map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 ? parts.join('|') : null
}

function normalizeSiteToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}

function buildSiteResolutionSuggestions(
  row: HistoricalPatrolRow,
  resolvedZoneId: string | null,
): {
  suggestions: HistoricalSiteResolutionSuggestion[]
  zoneFallbackZoneId: string | null
  zoneFallbackReason: string | null
} {
  const suggestions: HistoricalSiteResolutionSuggestion[] = []
  const templateSites = FIRST_SECURITY_ORG_TEMPLATE.nccSites

  const siteCode = row.clientId.trim()
  if (siteCode) {
    const byCode = templateSites.find((site) => site.siteCode && site.siteCode.toLowerCase() === siteCode.toLowerCase())
    if (byCode) {
      suggestions.push({
        source: 'template_site_code',
        suggested_site_name: byCode.name,
        suggested_site_code: byCode.siteCode,
        suggested_zone_id: byCode.zoneId,
        confidence: 'high',
        reason: `Matched client ID ${siteCode} to template site code ${byCode.siteCode}`,
      })
    }
  }

  const normalizedClientName = normalizeSiteToken(row.clientName)
  if (normalizedClientName) {
    const byName = templateSites.find((site) => normalizeSiteToken(site.name) === normalizedClientName)
    if (byName && !suggestions.some((entry) => entry.suggested_site_name === byName.name)) {
      suggestions.push({
        source: 'template_site_name',
        suggested_site_name: byName.name,
        suggested_site_code: byName.siteCode,
        suggested_zone_id: byName.zoneId,
        confidence: 'medium',
        reason: `Matched site name ${row.clientName} to template site ${byName.name}`,
      })
    }
  }

  let zoneFallbackZoneId: string | null = null
  let zoneFallbackReason: string | null = null
  const suggestionWithZone = suggestions.find((entry) => entry.suggested_zone_id)
  if (suggestionWithZone?.suggested_zone_id) {
    zoneFallbackZoneId = suggestionWithZone.suggested_zone_id
    zoneFallbackReason = `Template site suggestion provides zone fallback (${suggestionWithZone.suggested_zone_id})`
  } else if (resolvedZoneId) {
    zoneFallbackZoneId = resolvedZoneId
    zoneFallbackReason = `Dispatch zone code ${row.despatchZone || 'n/a'} mapped to fallback zone ${resolvedZoneId}`
    suggestions.push({
      source: 'zone_fallback',
      suggested_site_name: row.clientName || 'Unmatched site',
      suggested_site_code: row.clientId || null,
      suggested_zone_id: resolvedZoneId,
      confidence: 'low',
      reason: `No template site match found; falling back to zone mapping ${row.despatchZone || 'n/a'}`,
    })
  }

  return {
    suggestions,
    zoneFallbackZoneId,
    zoneFallbackReason,
  }
}

function buildSourceQualityFlags(row: HistoricalPatrolRow, normalizedStatus: 'completed' | 'missed' | 'unknown'): string[] {
  const flags: string[] = []
  if (!row.internalDespatchId) flags.push('missing_dispatch_id')
  if (normalizedStatus === 'completed' && (!row.onSiteAt || !row.offSiteAt)) {
    flags.push('missing_timestamps_completed')
  }
  if (normalizedStatus === 'missed' && !row.comments) {
    flags.push('missed_without_comment')
  }
  if (!row.despatchZone) flags.push('missing_zone_code')
  return flags
}

function classifyRoutingModule(row: HistoricalPatrolRow): { module: HistoricalRoutingModule; reason: string } {
  const sample = [row.bureauId, row.clientName, row.comments, row.internalClientId].join(' ').toLowerCase()

  // WILSAR/Rapid noise work should always assort into the noise module.
  if (/\b(noise|wilsar|rapid|nco|noise control|noise complaint)\b/.test(sample)) {
    return { module: 'noise_control', reason: 'noise markers in source row (wilsar/rapid/noise)' }
  }

  if (/\b(alarm|ar-db|alarm response|intruder|false alarm)\b/.test(sample)) {
    return { module: 'alarm_response', reason: 'alarm-response markers in source row' }
  }

  return { module: 'patrol_response', reason: 'default patrol-response assortment' }
}

function parseHistoricalPatrolRows(raw: string): HistoricalPatrolRow[] {
  const delimiter = detectDelimiter(raw)
  const records = parseDelimitedRecords(raw, delimiter)
  const headerIndex = records.findIndex((cells) => {
    const normalized = cells.map(normalizeHeader)
    return normalized.some((header) => HEADER_ALIASES.internalDespatchId.includes(header))
  })

  if (headerIndex < 0) return []

  const headers = records[headerIndex].map(normalizeHeader)
  const indexes = {
    bureauId: findHeaderIndex(headers, HEADER_ALIASES.bureauId),
    internalDespatchId: findHeaderIndex(headers, HEADER_ALIASES.internalDespatchId),
    internalClientId: findHeaderIndex(headers, HEADER_ALIASES.internalClientId),
    clientId: findHeaderIndex(headers, HEADER_ALIASES.clientId),
    clientName: findHeaderIndex(headers, HEADER_ALIASES.clientName),
    clientAddress: findHeaderIndex(headers, HEADER_ALIASES.clientAddress),
    clientSuburb: findHeaderIndex(headers, HEADER_ALIASES.clientSuburb),
    clientPostcode: findHeaderIndex(headers, HEADER_ALIASES.clientPostcode),
    onSiteAt: findHeaderIndex(headers, HEADER_ALIASES.onSiteAt),
    offSiteAt: findHeaderIndex(headers, HEADER_ALIASES.offSiteAt),
    comments: findHeaderIndex(headers, HEADER_ALIASES.comments),
    patrolCompleteStatus: findHeaderIndex(headers, HEADER_ALIASES.patrolCompleteStatus),
    isIncidentReport: findHeaderIndex(headers, HEADER_ALIASES.isIncidentReport),
    visitChargeExGst: findHeaderIndex(headers, HEADER_ALIASES.visitChargeExGst),
    despatchZone: findHeaderIndex(headers, HEADER_ALIASES.despatchZone),
    despatchAt: findHeaderIndex(headers, HEADER_ALIASES.despatchAt),
  }

  const rows: HistoricalPatrolRow[] = []
  for (let i = headerIndex + 1; i < records.length; i += 1) {
    const row = toRow(records[i], indexes)
    const hasSignal = row.internalDespatchId || row.clientName || row.despatchAt
    if (!hasSignal) continue
    rows.push(row)
  }

  return rows
}

export function looksLikeHistoricalPatrolImport(raw: string): boolean {
  return parseHistoricalPatrolRows(raw).length > 0
}

function toRow(cells: string[], indexes: Record<string, number>): HistoricalPatrolRow {
  const pick = (key: keyof typeof indexes): string => {
    const index = indexes[key]
    return index >= 0 ? String(cells[index] || '').trim() : ''
  }

  return {
    bureauId: pick('bureauId'),
    internalDespatchId: pick('internalDespatchId'),
    internalClientId: pick('internalClientId'),
    clientId: pick('clientId'),
    clientName: pick('clientName'),
    clientAddress: pick('clientAddress'),
    clientSuburb: pick('clientSuburb'),
    clientPostcode: pick('clientPostcode'),
    onSiteAt: pick('onSiteAt'),
    offSiteAt: pick('offSiteAt'),
    comments: pick('comments'),
    patrolCompleteStatus: pick('patrolCompleteStatus').toLowerCase(),
    isIncidentReport: toBool(pick('isIncidentReport')),
    visitChargeExGst: toNumber(pick('visitChargeExGst')),
    despatchZone: pick('despatchZone'),
    despatchAt: pick('despatchAt'),
  }
}

export function buildHistoricalPatrolPlacementReview(raw: string): HistoricalPatrolPlacementReview {
  const rows = parseHistoricalPatrolRows(raw)
  if (rows.length === 0) {
    return {
      totalRows: 0,
      completedRows: 0,
      missedRows: 0,
      rowsWithInternalDespatchId: 0,
      rowsWithTimestamps: 0,
      incidentReportRows: 0,
      uniqueClientCount: 0,
      totalVisitChargeExGst: 0,
      averageVisitChargeExGst: null,
      trainingTips: ['No historical patrol header detected. Paste tabular rows including Internal DespatchId.'],
    }
  }

  const totalRows = rows.length
  let completedRows = 0
  let missedRows = 0
  let rowsWithInternalDespatchId = 0
  let rowsWithTimestamps = 0
  let incidentReportRows = 0
  let totalVisitChargeExGst = 0
  let chargedRows = 0
  const uniqueClients = new Set<string>()

  for (const row of rows) {
    if (row.clientName) uniqueClients.add(row.clientName)
    if (row.internalDespatchId) rowsWithInternalDespatchId += 1
    if (row.onSiteAt && row.offSiteAt) rowsWithTimestamps += 1
    if (row.isIncidentReport) incidentReportRows += 1
    if (row.visitChargeExGst !== null) {
      totalVisitChargeExGst += row.visitChargeExGst
      chargedRows += 1
    }

    if (row.patrolCompleteStatus === 'completed') completedRows += 1
    if (row.patrolCompleteStatus === 'missed') missedRows += 1
  }

  const trainingTips: string[] = []
  if (totalRows > 0 && rowsWithInternalDespatchId === 0) {
    trainingTips.push('Keep Internal DespatchId values so imports remain idempotent and traceable.')
  }
  if (totalRows > 0 && completedRows > 0 && rowsWithTimestamps === 0) {
    trainingTips.push('Completed patrols need On-site and Off-site timestamps for duration and SLA analytics.')
  }
  if (totalRows > 0 && missedRows > 0) {
    trainingTips.push('Missed patrol rows should include reason codes before final compliance and client reporting.')
  }

  return {
    totalRows,
    completedRows,
    missedRows,
    rowsWithInternalDespatchId,
    rowsWithTimestamps,
    incidentReportRows,
    uniqueClientCount: uniqueClients.size,
    totalVisitChargeExGst: Number(totalVisitChargeExGst.toFixed(2)),
    averageVisitChargeExGst: chargedRows > 0 ? Number((totalVisitChargeExGst / chargedRows).toFixed(2)) : null,
    trainingTips,
  }
}

export function buildHistoricalPatrolImportDraft(raw: string): HistoricalPatrolImportDraft {
  const rows = parseHistoricalPatrolRows(raw)
  const zoneCounter = new Map<string, number>()
  const routingCounter = new Map<HistoricalRoutingModule, number>()
  const siteCounter = new Map<string, { total: number; byModule: Map<HistoricalRoutingModule, number> }>()

  const normalizedRows = rows.map<HistoricalPatrolNormalizedRow>((row, index) => {
    const status = normalizeStatus(row.patrolCompleteStatus)
    const onSiteAtNz = parseNzDateTime(row.onSiteAt)
    const offSiteAtNz = parseNzDateTime(row.offSiteAt)
    const durationMinutes = computeDurationMinutes(onSiteAtNz, offSiteAtNz)
    const sourceQualityFlags = buildSourceQualityFlags(row, status)
    const routing = classifyRoutingModule(row)

    if (row.despatchZone) {
      zoneCounter.set(row.despatchZone, (zoneCounter.get(row.despatchZone) ?? 0) + 1)
    }

    routingCounter.set(routing.module, (routingCounter.get(routing.module) ?? 0) + 1)

    const siteName = row.clientName || `Unknown site ${index + 1}`
    const siteState = siteCounter.get(siteName) ?? { total: 0, byModule: new Map<HistoricalRoutingModule, number>() }
    siteState.total += 1
    siteState.byModule.set(routing.module, (siteState.byModule.get(routing.module) ?? 0) + 1)
    siteCounter.set(siteName, siteState)

    const workflowAction: HistoricalPatrolNormalizedRow['workflow_action'] = row.isIncidentReport
      ? 'create_incident_followup'
      : status === 'missed'
      ? 'schedule_makeup_patrol'
      : 'archive_completed_patrol'

    // Resolve branch org + zone from the known template maps
    const resolvedOrganizationId = row.bureauId
      ? (BUREAU_PREFIX_TO_BRANCH[row.bureauId] ?? null)
      : null
    const resolvedClientOrganizationId = row.bureauId
      ? (BUREAU_PREFIX_TO_CLIENT[row.bureauId] ?? null)
      : null
    const resolvedZoneId = row.despatchZone
      ? (DISPATCH_CODE_TO_ZONE_ID[row.despatchZone] ?? null)
      : null
    const siteResolution = buildSiteResolutionSuggestions(row, resolvedZoneId)

    return {
      dispatch_id: row.internalDespatchId || `synthetic:${index + 1}`,
      client_name: row.clientName,
      site_name: row.clientName,
      site_address: row.clientAddress || null,
      site_suburb: row.clientSuburb || null,
      site_postcode: row.clientPostcode || null,
      zone_code: row.despatchZone || null,
      status,
      on_site_at_nz: onSiteAtNz,
      off_site_at_nz: offSiteAtNz,
      duration_minutes: durationMinutes,
      visit_charge_nzd: row.visitChargeExGst,
      source_quality_flags: sourceQualityFlags,
      geofence_hint: buildGeofenceHint(row),
      site_resolution_suggestions: siteResolution.suggestions,
      zone_fallback_zone_id: siteResolution.zoneFallbackZoneId,
      zone_fallback_reason: siteResolution.zoneFallbackReason,
      workflow_action: workflowAction,
      routing_module: routing.module,
      routing_reason: routing.reason,
      resolved_organization_id: resolvedOrganizationId,
      resolved_client_organization_id: resolvedClientOrganizationId,
      resolved_zone_id: resolvedZoneId,
    }
  })

  const zoneCoverage = Array.from(zoneCounter.entries())
    .map(([zoneCode, count]) => ({ zoneCode, count }))
    .sort((a, b) => b.count - a.count)

  const routingCoverage: HistoricalRoutingSummary[] = Array.from(routingCounter.entries())
    .map(([module, count]) => ({ module, count }))
    .sort((a, b) => b.count - a.count)

  const siteCoverage: HistoricalSiteCoverage[] = Array.from(siteCounter.entries())
    .map(([siteName, value]) => ({
      siteName,
      rowCount: value.total,
      modules: Array.from(value.byModule.entries())
        .map(([module, count]) => ({ module, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.rowCount - a.rowCount)

  return {
    normalizedRows,
    totalRows: normalizedRows.length,
    rowsRequiringReview: normalizedRows.filter((row) => row.source_quality_flags.length > 0).length,
    zoneCoverage,
    routingCoverage,
    siteCoverage,
    stagingContract: buildNormalizedImportStagingContract({
      sourceKind: 'historical_patrol',
      sourceSystem: 'historical_patrol_export',
      actionType: 'import_historical_patrol_data',
      sourceRecordTable: 'historical_patrol_exports',
      sourceRecordIds: normalizedRows.map((row) => row.dispatch_id),
      rowCount: normalizedRows.length,
      rowsRequiringReview: normalizedRows.filter((row) => row.source_quality_flags.length > 0).length,
      summaryParts: [
        `Historical patrol import draft with ${normalizedRows.length} normalized row(s)`,
        `${normalizedRows.filter((row) => row.source_quality_flags.length > 0).length} row(s) require review`,
        `Routing coverage: ${routingCoverage.map((entry) => `${entry.module}:${entry.count}`).join(', ') || 'n/a'}`,
      ],
      qualitySignals: Array.from(new Set(normalizedRows.flatMap((row) => row.source_quality_flags))),
    }),
    sourceText: raw,
  }
}

export function formatHistoricalPatrolImportSummary(
  draft: HistoricalPatrolImportDraft,
  review: HistoricalPatrolPlacementReview,
): string {
  if (draft.totalRows === 0) {
    return 'No historical patrol rows were detected.'
  }

  const zoneSummary = draft.zoneCoverage
    .slice(0, 5)
    .map((entry) => `${entry.zoneCode} (${entry.count})`)
    .join(', ')

  const lines = [
    `Historical patrol rows detected: ${draft.totalRows}`,
    `Rows requiring review: ${draft.rowsRequiringReview}`,
    `Zone coverage: ${zoneSummary || 'n/a'}`,
    `Completed rows: ${review.completedRows}`,
    `Missed rows: ${review.missedRows}`,
    `Incident report rows: ${review.incidentReportRows}`,
  ]

  const routingSummary = draft.routingCoverage
    .map((entry) => `${entry.module} (${entry.count})`)
    .join(', ')
  lines.push(`Routing coverage: ${routingSummary || 'n/a'}`)

  const siteSummary = draft.siteCoverage
    .slice(0, 5)
    .map((entry) => {
      const moduleMix = entry.modules.map((moduleEntry) => `${moduleEntry.module}:${moduleEntry.count}`).join('/')
      return `${entry.siteName} (${entry.rowCount}; ${moduleMix})`
    })
    .join(', ')
  lines.push(`Top site coverage: ${siteSummary || 'n/a'}`)

  if (review.trainingTips.length > 0) {
    lines.push('', 'Training tips:')
    review.trainingTips.slice(0, 4).forEach((tip) => {
      lines.push(`- ${tip}`)
    })
  }

  return lines.join('\n')
}