export type HistoricalDispatchJobType =
  | 'noise_control'
  | 'alarm_activation'
  | 'fire_alarm'
  | 'late_to_close'
  | 'atm_maintenance'
  | 'other_dispatch'

export interface HistoricalDispatchRow {
  despatchNo: string
  bureauName: string
  clientId: string
  clientName: string
  alarmResponseAt: string
  onSiteAt: string
  offSiteAt: string
  despatchComments: string
  followUpInfo: string
  zoneOrSubcontractor: string
}

export interface HistoricalDispatchClassification {
  despatchNo: string
  jobType: HistoricalDispatchJobType
  confidence: number
  targetLocations: string[]
  rationale: string
}

export interface HistoricalDispatchPlacementReview {
  totalRows: number
  classifiedRows: number
  rowsMissingDespatchNo: number
  rowsMissingTimestamps: number
  typeCounts: Record<HistoricalDispatchJobType, number>
  classifications: HistoricalDispatchClassification[]
  trainingTips: string[]
}

export interface HistoricalDispatchPlacementVerification {
  isValid: boolean
  errors: string[]
}

const HEADER_ALIASES: Record<string, string[]> = {
  despatchNo: ['despatch no.', 'despatch no', 'dispatch no', 'dispatch number', 'alarm docket no.', 'alarm docket no'],
  bureauName: ['bureau name'],
  clientId: ['client id'],
  clientName: ['client name'],
  alarmResponseAt: ['alarm response date/time', 'alarm response datetime'],
  onSiteAt: ['on-site date/time', 'onsite date/time'],
  offSiteAt: ['off-site date/time', 'offsite date/time'],
  despatchComments: ['despatch comments', 'dispatch comments'],
  followUpInfo: ['follow-up info.', 'follow-up info', 'follow up info'],
  zoneOrSubcontractor: ['despatch zone / subcontractor', 'dispatch zone / subcontractor', 'despatch zone', 'dispatch zone', 'subcontractor'],
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
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

      if (row.some((value) => value.length > 0)) {
        records.push(row)
      }
      row = []
      continue
    }

    cell += char
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    if (row.some((value) => value.length > 0)) {
      records.push(row)
    }
  }

  return records
}

function detectDelimiter(raw: string): '\t' | ',' {
  const sample = raw.slice(0, 6000)
  const tabCount = (sample.match(/\t/g) || []).length
  const commaCount = (sample.match(/,/g) || []).length
  return tabCount >= commaCount ? '\t' : ','
}

function findHeaderIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header))
}

function toRow(cells: string[], indexes: Record<string, number>): HistoricalDispatchRow {
  const pick = (key: keyof typeof indexes): string => {
    const index = indexes[key]
    return index >= 0 ? String(cells[index] || '').trim() : ''
  }

  return {
    despatchNo: pick('despatchNo'),
    bureauName: pick('bureauName'),
    clientId: pick('clientId'),
    clientName: pick('clientName'),
    alarmResponseAt: pick('alarmResponseAt'),
    onSiteAt: pick('onSiteAt'),
    offSiteAt: pick('offSiteAt'),
    despatchComments: pick('despatchComments'),
    followUpInfo: pick('followUpInfo'),
    zoneOrSubcontractor: pick('zoneOrSubcontractor'),
  }
}

function defaultTypeCounts(): Record<HistoricalDispatchJobType, number> {
  return {
    noise_control: 0,
    alarm_activation: 0,
    fire_alarm: 0,
    late_to_close: 0,
    atm_maintenance: 0,
    other_dispatch: 0,
  }
}

function placementTargetsForType(jobType: HistoricalDispatchJobType): string[] {
  switch (jobType) {
    case 'noise_control':
      return ['noise_jobs', 'noise_assessments', 'dispatch_jobs']
    case 'atm_maintenance':
      return ['dispatch_jobs', 'operational_cases']
    case 'fire_alarm':
    case 'alarm_activation':
    case 'late_to_close':
      return ['alarm_events', 'dispatch_jobs', 'incidents']
    default:
      return ['dispatch_jobs']
  }
}

export function classifyHistoricalDispatchJob(row: HistoricalDispatchRow): HistoricalDispatchClassification {
  const corpus = [
    row.clientId,
    row.clientName,
    row.bureauName,
    row.despatchComments,
    row.followUpInfo,
    row.zoneOrSubcontractor,
  ].join(' ').toLowerCase()

  let jobType: HistoricalDispatchJobType = 'other_dispatch'
  let confidence = 0.6
  let rationale = 'No strong type markers found; classify as generic dispatch job.'

  if (
    corpus.includes('nccnoise') ||
    corpus.includes('noise control') ||
    corpus.includes('noise complaint') ||
    corpus.includes('magiq sr') ||
    corpus.includes('volume')
  ) {
    jobType = 'noise_control'
    confidence = 0.95
    rationale = 'Matched noise-control markers (NCCNOISE / noise complaint context).'
  } else if (corpus.includes('allpoint') || corpus.includes('atm') || corpus.includes('fiserv') || corpus.includes('cencon')) {
    jobType = 'atm_maintenance'
    confidence = 0.92
    rationale = 'Matched ATM maintenance markers (NCR/ATM/Fiserv/Cencon context).'
  } else if (corpus.includes('*** fire ***') || corpus.includes('fire alarm') || corpus.includes('smoke detector')) {
    jobType = 'fire_alarm'
    confidence = 0.9
    rationale = 'Matched fire-alarm markers in dispatch comments.'
  } else if (corpus.includes('*** fts ***') || corpus.includes('late to close')) {
    jobType = 'late_to_close'
    confidence = 0.88
    rationale = 'Matched late-to-close markers (FTS / late close).'
  } else if (
    corpus.includes('*** intruder alarm ***') ||
    corpus.includes(' alarm ') ||
    corpus.includes('activation') ||
    corpus.includes('zone ') ||
    corpus.includes(' pir') ||
    corpus.includes('external check')
  ) {
    jobType = 'alarm_activation'
    confidence = 0.8
    rationale = 'Matched alarm/activation markers.'
  }

  return {
    despatchNo: row.despatchNo,
    jobType,
    confidence,
    targetLocations: placementTargetsForType(jobType),
    rationale,
  }
}

export function buildHistoricalDispatchPlacementReview(raw: string): HistoricalDispatchPlacementReview {
  const delimiter = detectDelimiter(raw)
  const records = parseDelimitedRecords(raw, delimiter)
  const headerIndex = records.findIndex((cells) => {
    const normalized = cells.map(normalizeHeader)
    return normalized.some((header) => HEADER_ALIASES.despatchNo.includes(header))
  })

  if (headerIndex < 0) {
    return {
      totalRows: 0,
      classifiedRows: 0,
      rowsMissingDespatchNo: 0,
      rowsMissingTimestamps: 0,
      typeCounts: defaultTypeCounts(),
      classifications: [],
      trainingTips: ['No dispatch header detected. Paste tabular data including a Despatch No. column.'],
    }
  }

  const headers = records[headerIndex].map(normalizeHeader)
  const indexes = {
    despatchNo: findHeaderIndex(headers, HEADER_ALIASES.despatchNo),
    bureauName: findHeaderIndex(headers, HEADER_ALIASES.bureauName),
    clientId: findHeaderIndex(headers, HEADER_ALIASES.clientId),
    clientName: findHeaderIndex(headers, HEADER_ALIASES.clientName),
    alarmResponseAt: findHeaderIndex(headers, HEADER_ALIASES.alarmResponseAt),
    onSiteAt: findHeaderIndex(headers, HEADER_ALIASES.onSiteAt),
    offSiteAt: findHeaderIndex(headers, HEADER_ALIASES.offSiteAt),
    despatchComments: findHeaderIndex(headers, HEADER_ALIASES.despatchComments),
    followUpInfo: findHeaderIndex(headers, HEADER_ALIASES.followUpInfo),
    zoneOrSubcontractor: findHeaderIndex(headers, HEADER_ALIASES.zoneOrSubcontractor),
  }

  const classifications: HistoricalDispatchClassification[] = []
  let rowsMissingDespatchNo = 0
  let rowsMissingTimestamps = 0
  const typeCounts = defaultTypeCounts()

  for (let i = headerIndex + 1; i < records.length; i += 1) {
    const cells = records[i]
    const row = toRow(cells, indexes)
    const hasSignal = row.despatchNo || row.clientName || row.despatchComments
    if (!hasSignal) continue

    if (!row.despatchNo) rowsMissingDespatchNo += 1
    if (!row.onSiteAt || !row.offSiteAt) rowsMissingTimestamps += 1

    const classified = classifyHistoricalDispatchJob(row)
    classifications.push(classified)
    typeCounts[classified.jobType] += 1
  }

  const trainingTips: string[] = []
  if (rowsMissingDespatchNo > 0) {
    trainingTips.push('Keep Despatch No. for each row so imports can remain idempotent and traceable.')
  }
  if (rowsMissingTimestamps > 0) {
    trainingTips.push('Capture On-site and Off-site timestamps to support response-time and on-site-duration auditing.')
  }
  if (typeCounts.other_dispatch > 0) {
    trainingTips.push('Rows classified as other_dispatch should be reviewed by admin and assigned an explicit job type before import.')
  }

  return {
    totalRows: classifications.length,
    classifiedRows: classifications.length,
    rowsMissingDespatchNo,
    rowsMissingTimestamps,
    typeCounts,
    classifications,
    trainingTips,
  }
}

export function verifyBobDispatchPlacementPlan(
  bobPlan: unknown,
  review: HistoricalDispatchPlacementReview,
): HistoricalDispatchPlacementVerification {
  const errors: string[] = []
  const plan = bobPlan as { jobs?: Array<{ despatch_no?: string; job_type?: string; target_locations?: string[] }> }
  const jobs = Array.isArray(plan?.jobs) ? plan.jobs : []

  if (jobs.length === 0) {
    return {
      isValid: false,
      errors: ['Bob plan has no jobs array to validate.'],
    }
  }

  const expectedByDispatch = new Map<string, HistoricalDispatchClassification>()
  review.classifications.forEach((item) => {
    if (item.despatchNo) expectedByDispatch.set(item.despatchNo, item)
  })

  for (const item of jobs) {
    const dispatchNo = String(item.despatch_no || '').trim()
    if (!dispatchNo) {
      errors.push('A job is missing despatch_no.')
      continue
    }

    const expected = expectedByDispatch.get(dispatchNo)
    if (!expected) {
      continue
    }

    const mappedType = String(item.job_type || '').trim()
    if (!mappedType) {
      errors.push(`Dispatch ${dispatchNo} is missing job_type.`)
    } else if (mappedType !== expected.jobType) {
      errors.push(`Dispatch ${dispatchNo} mapped as ${mappedType}, expected ${expected.jobType}.`)
    }

    const targets = Array.isArray(item.target_locations)
      ? item.target_locations.map((v) => String(v).trim()).filter(Boolean)
      : []

    if (targets.length === 0) {
      errors.push(`Dispatch ${dispatchNo} is missing target_locations.`)
      continue
    }

    const missingTargets = expected.targetLocations.filter((target) => !targets.includes(target))
    if (missingTargets.length > 0) {
      errors.push(`Dispatch ${dispatchNo} missing expected target locations: ${missingTargets.join(', ')}.`)
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
