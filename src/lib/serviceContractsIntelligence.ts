export interface ServiceContractMatchContext {
  bucketName: string
  scannedFileCount: number
  matchedFileCount: number
  matchedPaths: string[]
  topRankedPaths: string[]
  matchedKeywords: string[]
  contentScannedFileCount: number
  contentMatchedFileCount: number
  contentMatchedPaths: string[]
  topContentRankedPaths: string[]
  contentEvidence: string[]
  instructionLines: string[]
  trainingChecklist: string[]
  conflictWarnings: string[]
  comparisonSummary: ServiceContractComparisonItem[]
  blenheimMatchCount: number
  marlboroughMatchCount: number
  parkingMatchCount: number
}

export type ServiceContractChangeImpact = 'increase' | 'decrease' | 'same' | 'other' | 'unknown'

export interface ServiceContractComparisonItem {
  category: 'service' | 'times' | 'cost' | 'impact'
  summary: string
  impact: ServiceContractChangeImpact
  primarySource: string
  secondarySource: string
  primaryEvidence: string
  secondaryEvidence: string
}

export interface ServiceContractFileRecord {
  path: string
  updatedAt?: string | null
  sizeBytes?: number | null
}

export interface ServiceContractDocumentSource {
  path: string
  content: string
  updatedAt?: string | null
}

const BUCKET_NAME = 'service-contracts'
const MATCH_KEYWORDS = ['blenheim', 'marlborough', 'parking', 'geofence', 'zone', 'patrol', 'warden'] as const
const PARKING_DETAIL_PATTERNS: RegExp[] = [
  /kinross\s+street/i,
  /seymour\s+street/i,
  /wynen\s+street/i,
  /alfred\s+street/i,
  /blenheim\s+enforcement\s+area/i,
  /time\s+restricted\s+parking/i,
  /loading\s+zone/i,
  /mobility\s+permit/i,
  /parking\s+officer/i,
  /marlborough\s+district\s+council/i,
]
const READABLE_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm']
const EXTRACTABLE_EXTENSIONS = [...READABLE_EXTENSIONS, '.pdf', '.docx']
const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bmust\b/i,
  /\bshall\b/i,
  /\brequired\b/i,
  /\bcheck\b/i,
  /\binspect\b/i,
  /\breport\b/i,
  /\bnotify\b/i,
  /\brecord\b/i,
  /\bpatrol\b/i,
  /\bloading zone\b/i,
  /\bmobility\b/i,
  /\btime restricted\b/i,
  /\bno parking\b/i,
]
const CONFLICT_TOPICS = [
  { label: 'loading zone rules', pattern: /loading\s+zone/i },
  { label: 'mobility parking rules', pattern: /mobility/i },
  { label: 'time restriction rules', pattern: /time\s+restricted|time\s+limit/i },
  { label: 'patrol reporting rules', pattern: /report|record|notify/i },
  { label: 'patrol check steps', pattern: /check|inspect|patrol/i },
] as const
const COMPARISON_FIELDS = [
  {
    category: 'service' as const,
    label: 'Service scope',
    patterns: [/\b(service|coverage|scope|patrol|inspection|deliverable|roster|staffing)\b/i],
  },
  {
    category: 'times' as const,
    label: 'Service times',
    patterns: [/\b(hourly|daily|weekly|shift|window|start|end|every\s+\d+|\d{1,2}:\d{2}|minute)\b/i],
  },
  {
    category: 'cost' as const,
    label: 'Cost profile',
    patterns: [/\b(cost|price|fee|rate|nzd|invoice|billing|\$|per\s+hour|per\s+patrol)\b/i],
  },
  {
    category: 'impact' as const,
    label: 'Impact on current service',
    patterns: [/\b(increase|decrease|reduc|same|unchanged|no\s+change|additional|more|less|maintain)\b/i],
  },
] as const
const AUTHORITY_MARKERS = [
  { pattern: /\b(contract|agreement|scope|statement[-\s]?of[-\s]?work|specification)\b/i, score: 8 },
  { pattern: /\b(schedule|appendix|annex|instruction|training|sop|procedure)\b/i, score: 5 },
  { pattern: /\b(final|signed|approved|current|latest)\b/i, score: 6 },
  { pattern: /\b(draft|old|archive|superseded|obsolete)\b/i, score: -5 },
] as const
const KEYWORD_SCORES: Record<(typeof MATCH_KEYWORDS)[number], number> = {
  blenheim: 8,
  marlborough: 7,
  parking: 7,
  geofence: 4,
  zone: 4,
  patrol: 4,
  warden: 4,
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

function normalizeFileRecords(records: Array<string | ServiceContractFileRecord>): ServiceContractFileRecord[] {
  return records
    .map((record) => typeof record === 'string'
      ? { path: record, updatedAt: null, sizeBytes: null }
      : {
          path: String(record.path || '').trim(),
          updatedAt: record.updatedAt ?? null,
          sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : null,
        })
    .filter((record) => record.path)
}

function getPathExtensionScore(path: string): number {
  const normalized = path.toLowerCase()
  if (normalized.endsWith('.pdf') || normalized.endsWith('.docx')) return 4
  if (normalized.endsWith('.md') || normalized.endsWith('.txt')) return 3
  if (normalized.endsWith('.csv') || normalized.endsWith('.json')) return 2
  return 0
}

function getRecencyScore(updatedAt?: string | null): number {
  if (!updatedAt) return 0
  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) return 0
  const ageDays = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24))
  if (ageDays <= 14) return 6
  if (ageDays <= 45) return 4
  if (ageDays <= 120) return 2
  return 0
}

export function scoreServiceContractRecord(record: ServiceContractFileRecord): number {
  const sample = record.path.toLowerCase()
  let score = getPathExtensionScore(record.path) + getRecencyScore(record.updatedAt)

  for (const keyword of MATCH_KEYWORDS) {
    if (sample.includes(keyword)) score += KEYWORD_SCORES[keyword]
  }

  for (const marker of AUTHORITY_MARKERS) {
    if (marker.pattern.test(record.path)) score += marker.score
  }

  return score
}

function rankServiceContractRecords(records: ServiceContractFileRecord[]): ServiceContractFileRecord[] {
  return [...records].sort((left, right) => {
    const scoreDelta = scoreServiceContractRecord(right) - scoreServiceContractRecord(left)
    if (scoreDelta !== 0) return scoreDelta

    const rightUpdated = Date.parse(String(right.updatedAt || '')) || 0
    const leftUpdated = Date.parse(String(left.updatedAt || '')) || 0
    if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated

    return left.path.localeCompare(right.path)
  })
}

function collectMatchingLines(content: string, patterns: RegExp[], limit = 8): string[] {
  const lines = String(content || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return uniqueNonEmpty(lines.filter((line) => patterns.some((pattern) => pattern.test(line))).slice(0, limit))
}

export function isReadableServiceContractPath(path: string): boolean {
  const normalized = String(path || '').trim().toLowerCase()
  return READABLE_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

export function isContentScanCandidatePath(path: string): boolean {
  const normalized = String(path || '').trim().toLowerCase()
  return EXTRACTABLE_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

function matchesContractSignals(sample: string): boolean {
  const normalized = String(sample || '').toLowerCase()
  return MATCH_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function normalizeConflictLine(line: string): string {
  return String(line || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.;:]+$/g, '')
    .trim()
}

function firstMatchingLine(content: string, patterns: readonly RegExp[]): string {
  const lines = String(content || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)

  return lines.find((line) => patterns.some((pattern) => pattern.test(line))) || ''
}

function classifyChangeImpact(primaryEvidence: string, secondaryEvidence: string): ServiceContractChangeImpact {
  const primary = primaryEvidence.toLowerCase()
  const secondary = secondaryEvidence.toLowerCase()
  const primaryNormalized = normalizeConflictLine(primaryEvidence)
  const secondaryNormalized = normalizeConflictLine(secondaryEvidence)

  if (!primaryEvidence && !secondaryEvidence) return 'unknown'
  if (primaryEvidence && secondaryEvidence && primaryNormalized === secondaryNormalized) return 'same'

  const hasIncrease = /\b(increase|additional|more|extended|higher|extra|expand)\b/.test(primary)
  const hasDecrease = /\b(decrease|reduce|less|lower|removed|cut|fewer|shorter)\b/.test(primary)
  const hasSame = /\b(same|unchanged|no\s+change|maintain)\b/.test(primary)

  if (hasIncrease && !hasDecrease) return 'increase'
  if (hasDecrease && !hasIncrease) return 'decrease'
  if (hasSame) return 'same'

  if (secondaryEvidence) return 'other'
  return 'unknown'
}

export function buildServiceContractMatchContext(
  paths: Array<string | ServiceContractFileRecord>,
  readableDocuments: ServiceContractDocumentSource[] = [],
): ServiceContractMatchContext {
  const normalizedRecords = normalizeFileRecords(paths)
  const normalizedPaths = normalizedRecords.map((record) => record.path)
  const matchedRecords = rankServiceContractRecords(
    normalizedRecords.filter((record) => MATCH_KEYWORDS.some((keyword) => record.path.toLowerCase().includes(keyword))),
  )
  const matchedPaths = matchedRecords.map((record) => record.path)

  const matchedKeywords = MATCH_KEYWORDS.filter((keyword) =>
    matchedPaths.some((path) => path.toLowerCase().includes(keyword)),
  )

  const normalizedDocuments = readableDocuments
    .map((document) => ({
      path: String(document.path || '').trim(),
      content: String(document.content || ''),
      updatedAt: document.updatedAt ?? null,
    }))
    .filter((document) => document.path)

  const contentMatched = normalizedDocuments
    .map((document) => {
      const sample = `${document.path}\n${document.content}`
      if (!matchesContractSignals(sample)) return null

      const evidenceLines = collectMatchingLines(document.content, [
        ...PARKING_DETAIL_PATTERNS,
        ...MATCH_KEYWORDS.map((keyword) => new RegExp(keyword, 'i')),
      ], 3)

      return {
        path: document.path,
        updatedAt: document.updatedAt,
        evidence: evidenceLines,
      }
    })
    .filter(Boolean) as Array<{ path: string; updatedAt?: string | null; evidence: string[] }>

  const rankedContentMatched = [...contentMatched].sort((left, right) => {
    const scoreDelta = scoreServiceContractRecord({ path: right.path, updatedAt: right.updatedAt ?? null })
      - scoreServiceContractRecord({ path: left.path, updatedAt: left.updatedAt ?? null })
    if (scoreDelta !== 0) return scoreDelta
    return left.path.localeCompare(right.path)
  })

  const contentEvidence = uniqueNonEmpty(
    rankedContentMatched.flatMap((entry) => {
      if (entry.evidence.length === 0) return [entry.path]
      return entry.evidence.map((line) => `${entry.path}: ${line}`)
    }),
  ).slice(0, 12)

  const instructionLines = uniqueNonEmpty(
    normalizedDocuments.flatMap((document) => {
      const lines = String(document.content || '')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length >= 10)

      return lines
        .filter((line) => INSTRUCTION_PATTERNS.some((pattern) => pattern.test(line)))
        .slice(0, 4)
        .map((line) => line.replace(/\s+/g, ' '))
    }),
  ).slice(0, 12)

  const trainingChecklist = uniqueNonEmpty(
    instructionLines.map((line) => {
      const sanitized = line.replace(/[.;:]+$/g, '').trim()
      if (!sanitized) return ''
      return `Officer action: ${sanitized}`
    }),
  ).slice(0, 8)

  const conflictWarnings = uniqueNonEmpty(
    CONFLICT_TOPICS.flatMap((topic) => {
      const topicMatches = rankedContentMatched
        .map((entry) => {
          const source = normalizedDocuments.find((document) => document.path === entry.path)
          if (!source) return null

          const lines = String(source.content || '')
            .replace(/\r/g, '\n')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length >= 8 && topic.pattern.test(line))
            .slice(0, 2)

          if (lines.length === 0) return null

          return {
            path: entry.path,
            lines,
          }
        })
        .filter(Boolean) as Array<{ path: string; lines: string[] }>

      if (topicMatches.length < 2) return []

      const distinct = new Map<string, string>()
      for (const match of topicMatches) {
        for (const line of match.lines) {
          const normalized = normalizeConflictLine(line)
          if (!distinct.has(normalized)) {
            distinct.set(normalized, `${match.path}: ${line}`)
          }
        }
      }

      if (distinct.size < 2) return []

      const topSources = topicMatches.slice(0, 2).map((match) => match.path).join(' vs ')
      return [`Potential conflict in ${topic.label}: compare ${topSources}.`] 
    }),
  ).slice(0, 6)

  const comparisonSummary: ServiceContractComparisonItem[] = (() => {
    const primaryPath = rankedContentMatched[0]?.path || ''
    const secondaryPath = rankedContentMatched[1]?.path || ''
    if (!primaryPath || !secondaryPath) return []

    const primaryDocument = normalizedDocuments.find((document) => document.path === primaryPath)
    const secondaryDocument = normalizedDocuments.find((document) => document.path === secondaryPath)
    if (!primaryDocument || !secondaryDocument) return []

    return COMPARISON_FIELDS.map((field) => {
      const primaryEvidence = firstMatchingLine(primaryDocument.content, field.patterns)
      const secondaryEvidence = firstMatchingLine(secondaryDocument.content, field.patterns)
      const impact = classifyChangeImpact(primaryEvidence, secondaryEvidence)
      const summary = `${field.label}: ${impact === 'unknown' ? 'not clearly stated' : impact}`

      return {
        category: field.category,
        summary,
        impact,
        primarySource: primaryPath,
        secondarySource: secondaryPath,
        primaryEvidence: primaryEvidence || 'No clear line found in primary source.',
        secondaryEvidence: secondaryEvidence || 'No clear line found in comparison source.',
      }
    })
  })()

  return {
    bucketName: BUCKET_NAME,
    scannedFileCount: normalizedPaths.length,
    matchedFileCount: matchedPaths.length,
    matchedPaths: matchedPaths.slice(0, 12),
    topRankedPaths: matchedPaths.slice(0, 5),
    matchedKeywords,
    contentScannedFileCount: normalizedDocuments.length,
    contentMatchedFileCount: rankedContentMatched.length,
    contentMatchedPaths: rankedContentMatched.map((entry) => entry.path).slice(0, 12),
    topContentRankedPaths: rankedContentMatched.map((entry) => entry.path).slice(0, 5),
    contentEvidence,
    instructionLines,
    trainingChecklist,
    conflictWarnings,
    comparisonSummary,
    blenheimMatchCount: matchedPaths.filter((path) => path.toLowerCase().includes('blenheim')).length,
    marlboroughMatchCount: matchedPaths.filter((path) => path.toLowerCase().includes('marlborough')).length,
    parkingMatchCount: matchedPaths.filter((path) => path.toLowerCase().includes('parking')).length,
  }
}

export function formatServiceContractPromptSupplement(context: ServiceContractMatchContext | null): string {
  if (!context) {
    return 'Service contract bucket scan is unavailable in this run; ask for explicit contract filenames if details are required.'
  }

  const lines: string[] = [
    `Service contract source: ${context.bucketName}.`,
    `Scanned files: ${context.scannedFileCount}.`,
    `Matched Blenheim/Marlborough parking-related files: ${context.matchedFileCount}.`,
    `Readable files scanned for content: ${context.contentScannedFileCount}.`,
    `Content-matched files: ${context.contentMatchedFileCount}.`,
  ]

  if (context.matchedKeywords.length > 0) {
    lines.push(`Matched keywords: ${context.matchedKeywords.join(', ')}.`)
  }

  lines.push(`Blenheim matches: ${context.blenheimMatchCount}.`)
  lines.push(`Marlborough matches: ${context.marlboroughMatchCount}.`)
  lines.push(`Parking matches: ${context.parkingMatchCount}.`)

  if (context.matchedPaths.length > 0) {
    lines.push(`Matched contract files/folders: ${context.matchedPaths.join('; ')}.`)
  }

  if (context.topRankedPaths.length > 0) {
    lines.push(`Priority-ranked contract files: ${context.topRankedPaths.join('; ')}.`)
  }

  if (context.contentMatchedPaths.length > 0) {
    lines.push(`Content-matched contract files: ${context.contentMatchedPaths.join('; ')}.`)
  }

  if (context.topContentRankedPaths.length > 0) {
    lines.push(`Priority-ranked content files: ${context.topContentRankedPaths.join('; ')}.`)
  }

  if (context.contentEvidence.length > 0) {
    lines.push(`Contract evidence lines: ${context.contentEvidence.join(' | ')}.`)
    lines.push('Use these content-derived contract details when drafting client sites, zones, geofences, patrol routes, and parking setup details for Blenheim.')
  } else {
    lines.push('No matched service-contract content lines were found yet; ask the user for exact folder/file names in the bucket before finalizing setup.')
  }

  if (context.instructionLines.length > 0) {
    lines.push(`Operational instructions extracted: ${context.instructionLines.join(' | ')}.`)
  }

  if (context.trainingChecklist.length > 0) {
    lines.push(`Training checklist extracted: ${context.trainingChecklist.join(' | ')}.`)
  }

  if (context.conflictWarnings.length > 0) {
    lines.push(`Contract conflicts to resolve: ${context.conflictWarnings.join(' | ')}.`)
    lines.push('If two contract sources disagree, prefer the higher-ranked signed/current contract and flag the conflict to the user.')
  }

  if (context.comparisonSummary.length > 0) {
    lines.push(`Contract comparison: ${context.comparisonSummary.map((item) => `${item.summary}`).join(' | ')}.`)
    lines.push('When presenting these differences, use natural conversational language and clearly explain service, timing, cost, and operational impact changes.')
  }

  return lines.join('\n')
}
