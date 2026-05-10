export interface PatrolSetupFacility {
  name: string
  extent: string[]
  serviceCoverage: string[]
  frequencies: string[]
  setupActions: string[]
  notes: string[]
}

export interface PatrolSetupSiteSOP {
  siteName: string
  jobType: string
  steps: string[]
}

export interface PatrolShiftTemplate {
  code: string
  name: string
  startTime: string
  endTime: string
  breaks: string[]
  allBreaksPaid: boolean
  timingPolicy: 'specific' | 'recommended' | 'mixed' | 'unspecified'
  coverageAreas: string[]
  serviceCoverage: string[]
  notes: string[]
}

export interface PatrolShiftCompliance {
  shiftCode: string
  shiftName: string
  shiftMinutes: number
  taskMinutes: number
  breakMinutes: number
  travelMinutes: number
  totalRequiredMinutes: number
  isCompliant: boolean
  timingPolicy: PatrolShiftTemplate['timingPolicy']
  reasons: string[]
}

export interface HistoricalDataPlacementReview {
  detectedRows: number
  completedRows: number
  missedRows: number
  rowsWithDispatchId: number
  rowsWithTimestamps: number
  mappedFacilityCount: number
  isPlacementReady: boolean
  blockers: string[]
}

export interface HistoricalPerformanceIssue {
  category: 'officer_execution' | 'route_design' | 'onsite_time' | 'schedule_design'
  severity: 'low' | 'medium' | 'high'
  evidence: string
  likelyCause: string
  adminRecommendation: string
  requiresApproval: boolean
  discussionPath: string
}

export interface HistoricalPerformanceReview {
  detectedRows: number
  completedRows: number
  missedRows: number
  completionRate: number
  averageOnsiteMinutes: number | null
  averageDispatchToOnsiteMinutes: number | null
  issues: HistoricalPerformanceIssue[]
}

export interface PatrolSetupBlueprint {
  title: string
  organizationName: string
  summary: string
  services: string[]
  facilities: PatrolSetupFacility[]
  blockers: string[]
  nextActions: string[]
  rosterRequirements: string[]
  geofenceRequirements: string[]
  patrolRouteRequirements: string[]
  siteSops: PatrolSetupSiteSOP[]
  patrolShifts: PatrolShiftTemplate[]
  sourceText: string
}

function asTrimmedString(value: unknown): string {
  return String(value || '').trim()
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asTrimmedString(item)).filter(Boolean)
}

function toMinutes(hhmm: string): number | null {
  const match = String(hhmm).match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return (hours * 60) + minutes
}

function fromMinutes(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function extractDeclaredPatrolCode(sourceText: string): string | null {
  const declaredMatch = sourceText.match(/(?:this\s+is|patrol\s+run)\s*[:-]?\s*(\d{3})/i)
  return declaredMatch?.[1] ?? null
}

function extractObservedPatrolCodes(sourceText: string): string[] {
  const standaloneMatches = sourceText.match(/\n\s*(\d{3})\s*(?=\n|$)/g) ?? []
  const standaloneCodes = standaloneMatches
    .map((match) => {
      const codeMatch = match.match(/(\d{3})/)
      return codeMatch?.[1] ?? ''
    })
    .filter(Boolean)

  const despatchZoneCodes = extractDespatchZoneCodesFromTabularData(sourceText)
  return [...standaloneCodes, ...despatchZoneCodes]
}

function parseTabularLine(line: string): string[] {
  return line.split('\t').map((cell) => cell.trim())
}

function parseDateTimeCell(value: string): number | null {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  if ([day, month, year, hour, minute].some((v) => !Number.isFinite(v))) return null
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function extractDespatchZoneCodesFromTabularData(sourceText: string): string[] {
  const lines = sourceText.split(/\r?\n/)
  const headerLine = lines.find((line) => /despatch\s+zone/i.test(line) && line.includes('\t'))
  if (!headerLine) return []
  const headerCells = parseTabularLine(headerLine).map((cell) => cell.toLowerCase())
  const despatchZoneIndex = headerCells.findIndex((cell) => cell === 'despatch zone')
  if (despatchZoneIndex < 0) return []

  const codes: string[] = []
  for (const line of lines) {
    if (!line.includes('\t')) continue
    const cells = parseTabularLine(line)
    const zone = cells[despatchZoneIndex]
    if (/^\d{3}$/.test(zone || '')) {
      codes.push(zone)
    }
  }

  return codes
}

function extractOnsiteDurationsByPatrolCode(sourceText: string): Map<string, Array<{ minutes: number }>> {
  const lines = sourceText.split(/\r?\n/)
  const headerLine = lines.find((line) => /on-site\s+date\/time/i.test(line) && /off-site\s+date\/time/i.test(line) && line.includes('\t'))
  if (!headerLine) return new Map<string, Array<{ minutes: number }>>()

  const headerCells = parseTabularLine(headerLine).map((cell) => cell.toLowerCase())
  const onsiteIndex = headerCells.findIndex((cell) => cell === 'on-site date/time')
  const offsiteIndex = headerCells.findIndex((cell) => cell === 'off-site date/time')
  const despatchZoneIndex = headerCells.findIndex((cell) => cell === 'despatch zone')
  if (onsiteIndex < 0 || offsiteIndex < 0 || despatchZoneIndex < 0) {
    return new Map<string, Array<{ minutes: number }>>()
  }

  const byCode = new Map<string, Array<{ minutes: number }>>()

  for (const line of lines) {
    if (!line.includes('\t')) continue
    const cells = parseTabularLine(line)
    const code = cells[despatchZoneIndex]
    if (!/^\d{3}$/.test(code || '')) continue

    const onsiteRaw = cells[onsiteIndex]
    const offsiteRaw = cells[offsiteIndex]
    if (!onsiteRaw || !offsiteRaw) continue

    const onsiteMs = parseDateTimeCell(onsiteRaw)
    const offsiteMs = parseDateTimeCell(offsiteRaw)
    if (onsiteMs === null || offsiteMs === null) continue

    let diffMinutes = Math.round((offsiteMs - onsiteMs) / 60000)
    if (diffMinutes < 0) {
      diffMinutes += 24 * 60
    }
    if (diffMinutes <= 0 || diffMinutes > 12 * 60) continue

    const rows = byCode.get(code) ?? []
    rows.push({ minutes: diffMinutes })
    byCode.set(code, rows)
  }

  return byCode
}

type HistoricalRowMetrics = {
  status: string
  onsiteMinutes: number | null
  dispatchToOnsiteMinutes: number | null
  distanceMetres: number | null
  variationMinutes: number | null
}

function extractHistoricalRowMetrics(sourceText: string): HistoricalRowMetrics[] {
  const lines = sourceText.split(/\r?\n/)
  const headerLine = lines.find((line) => /despatch\s+zone/i.test(line) && line.includes('\t'))
  if (!headerLine) return []

  const headerCells = parseTabularLine(headerLine).map((cell) => cell.toLowerCase())
  const statusIndex = headerCells.findIndex((cell) => cell === 'patrol complete status')
  const onsiteIndex = headerCells.findIndex((cell) => cell === 'on-site date/time')
  const offsiteIndex = headerCells.findIndex((cell) => cell === 'off-site date/time')
  const dispatchIndex = headerCells.findIndex((cell) => cell === 'despatch date/time')
  const distanceIndex = headerCells.findIndex((cell) => cell === 'on-site distance from site')
  const variationIndex = headerCells.findIndex((cell) => cell === 'time on-site variation (mins)')
  const zoneIndex = headerCells.findIndex((cell) => cell === 'despatch zone')

  if (statusIndex < 0 || zoneIndex < 0) return []

  const rows: HistoricalRowMetrics[] = []

  for (const line of lines) {
    if (!line.includes('\t')) continue
    const cells = parseTabularLine(line)
    const zone = cells[zoneIndex]
    if (!/^\d{3}$/.test(zone || '')) continue

    const status = String(cells[statusIndex] || '').trim().toLowerCase()

    const onsiteMs = onsiteIndex >= 0 ? parseDateTimeCell(String(cells[onsiteIndex] || '').trim()) : null
    const offsiteMs = offsiteIndex >= 0 ? parseDateTimeCell(String(cells[offsiteIndex] || '').trim()) : null
    const dispatchMs = dispatchIndex >= 0 ? parseDateTimeCell(String(cells[dispatchIndex] || '').trim()) : null

    let onsiteMinutes: number | null = null
    if (onsiteMs !== null && offsiteMs !== null) {
      let diff = Math.round((offsiteMs - onsiteMs) / 60000)
      if (diff < 0) diff += 24 * 60
      if (diff > 0 && diff <= 12 * 60) onsiteMinutes = diff
    }

    let dispatchToOnsiteMinutes: number | null = null
    if (dispatchMs !== null && onsiteMs !== null) {
      let diff = Math.round((onsiteMs - dispatchMs) / 60000)
      if (diff < 0) diff += 24 * 60
      if (diff >= 0 && diff <= 12 * 60) dispatchToOnsiteMinutes = diff
    }

    const distanceRaw = distanceIndex >= 0 ? Number(String(cells[distanceIndex] || '').trim()) : NaN
    const variationRaw = variationIndex >= 0 ? Number(String(cells[variationIndex] || '').trim()) : NaN

    rows.push({
      status,
      onsiteMinutes,
      dispatchToOnsiteMinutes,
      distanceMetres: Number.isFinite(distanceRaw) ? distanceRaw : null,
      variationMinutes: Number.isFinite(variationRaw) ? variationRaw : null,
    })
  }

  return rows
}

function extractScheduleWindows(sourceText: string): Array<{ start: string; end: string }> {
  const regex = /(\d{2}:\d{2})\s+(\d{2}:\d{2})/g
  const windows: Array<{ start: string; end: string }> = []

  let match = regex.exec(sourceText)
  while (match) {
    windows.push({ start: match[1], end: match[2] })
    match = regex.exec(sourceText)
  }

  return windows
}

function derivePatrolShiftsFromSource(sourceText: string): PatrolShiftTemplate[] {
  const observedCodes = extractObservedPatrolCodes(sourceText)
  if (observedCodes.length === 0) return []

  const counts = new Map<string, number>()
  for (const code of observedCodes) {
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }

  const windows = extractScheduleWindows(sourceText)
  const startMinutes = windows.map((window) => toMinutes(window.start)).filter((v): v is number => v !== null)
  const endMinutes = windows.map((window) => toMinutes(window.end)).filter((v): v is number => v !== null)
  const derivedStart = startMinutes.length > 0 ? fromMinutes(Math.min(...startMinutes)) : ''
  const derivedEnd = endMinutes.length > 0 ? fromMinutes(Math.max(...endMinutes)) : ''

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({
      code,
      name: `${code} Patrol`,
      startTime: derivedStart,
      endTime: derivedEnd,
      breaks: [],
      allBreaksPaid: false,
      timingPolicy: 'unspecified' as const,
      coverageAreas: [],
      serviceCoverage: [],
      notes: [`Derived from raw patrol schedule paste (${count} tagged rows).`],
    }))
}

function extractPlannedDurationsByPatrolCode(sourceText: string): Map<string, Array<{ minutes: number }>> {
  const matches = Array.from(sourceText.matchAll(/(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\d{1,3})/g))
  const byCode = new Map<string, Array<{ minutes: number }>>()

  for (const match of matches) {
    const minutes = Number(match[3])
    if (!Number.isFinite(minutes) || minutes <= 0) continue

    const start = match.index ?? 0
    const trailing = sourceText.slice(start, Math.min(sourceText.length, start + 120))
    const codeMatch = trailing.match(/\b(\d{3})\b/)
    const code = codeMatch?.[1] ?? ''
    if (!code) continue

    const rows = byCode.get(code) ?? []
    rows.push({ minutes })
    byCode.set(code, rows)
  }

  const onsiteDurations = extractOnsiteDurationsByPatrolCode(sourceText)
  onsiteDurations.forEach((rows, code) => {
    const existing = byCode.get(code) ?? []
    byCode.set(code, [...existing, ...rows])
  })

  return byCode
}

function estimateBreakMinutes(shift: PatrolShiftTemplate): number {
  if (!shift.breaks.length) return 0
  return shift.breaks.reduce((sum, item) => {
    const values = Array.from(item.matchAll(/(\d{1,3})/g)).map((m) => Number(m[1])).filter((v) => Number.isFinite(v) && v > 0)
    return sum + (values[0] ?? 0)
  }, 0)
}

function shiftDurationMinutes(startTime: string, endTime: string): number {
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  if (start === null || end === null) return 0
  if (end > start) return end - start
  if (end === start) return 24 * 60
  return (24 * 60) - start + end
}

export function looksLikePatrolSetupBrief(input: string): boolean {
  const normalized = asTrimmedString(input).toLowerCase()
  if (!normalized) return false

  let score = 0
  if (/\bservices?\b/.test(normalized)) score += 1
  if (/\bfacilit(y|ies)\b/.test(normalized)) score += 1
  if (/\bsecurity patrols?\b/.test(normalized)) score += 1
  if (/\block and unlock gates\b/.test(normalized)) score += 1
  if (/\bresponse to alarm|security breach\b/.test(normalized)) score += 1
  if (/\bfrequency\s+[a-z]\b/.test(normalized)) score += 1
  if (/\bstatic security guards?\b/.test(normalized)) score += 1
  if (/\b3\.\d+\./.test(normalized)) score += 1
  if (/\bpatrol summary\b/.test(normalized)) score += 1
  if (/\bclient id\s+site\s+address\b/.test(normalized)) score += 1
  if (/\bpatrol officer declaration\b/.test(normalized)) score += 1
  if (/(?:\d{2}:\d{2}\s+\d{2}:\d{2})/.test(normalized)) score += 1
  if (/\bdespatch zone based patrols\b/.test(normalized)) score += 1
  if (/\bon-site date\/time\b/.test(normalized) && /\boff-site date\/time\b/.test(normalized)) score += 1
  if (/\bpatrol complete status\b/.test(normalized)) score += 1
  if (/\bdespatch zone\b/.test(normalized)) score += 1

  return score >= 3
}

export function coercePatrolSetupBlueprint(parsed: Record<string, any> | null, sourceText: string): PatrolSetupBlueprint {
  const facilities = Array.isArray(parsed?.facilities)
    ? parsed!.facilities.map((facility: any) => ({
        name: asTrimmedString(facility?.name) || 'Unnamed facility',
        extent: asStringArray(facility?.extent),
        serviceCoverage: asStringArray(facility?.serviceCoverage),
        frequencies: asStringArray(facility?.frequencies),
        setupActions: asStringArray(facility?.setupActions),
        notes: asStringArray(facility?.notes),
      })).filter((facility) => facility.name)
    : []

  const siteSops = Array.isArray(parsed?.siteSops)
    ? parsed!.siteSops.map((sop: any) => ({
        siteName: asTrimmedString(sop?.siteName),
        jobType: asTrimmedString(sop?.jobType),
        steps: asStringArray(sop?.steps),
      })).filter((sop) => sop.siteName && sop.steps.length > 0)
    : []

  const explicitPatrolShifts = Array.isArray(parsed?.patrolShifts)
    ? parsed!.patrolShifts.map((shift: any) => ({
        code: asTrimmedString(shift?.code),
        name: asTrimmedString(shift?.name),
        startTime: asTrimmedString(shift?.startTime),
        endTime: asTrimmedString(shift?.endTime),
        breaks: asStringArray(shift?.breaks),
        allBreaksPaid: Boolean(shift?.allBreaksPaid),
        timingPolicy: ['specific', 'recommended', 'mixed'].includes(asTrimmedString(shift?.timingPolicy).toLowerCase())
          ? asTrimmedString(shift?.timingPolicy).toLowerCase() as PatrolShiftTemplate['timingPolicy']
          : 'unspecified',
        coverageAreas: asStringArray(shift?.coverageAreas),
        serviceCoverage: asStringArray(shift?.serviceCoverage),
        notes: asStringArray(shift?.notes),
      })).filter((shift) => shift.code || shift.name)
    : []

  const derivedPatrolShifts = explicitPatrolShifts.length > 0
    ? []
    : derivePatrolShiftsFromSource(sourceText)

  const patrolShifts = explicitPatrolShifts.length > 0 ? explicitPatrolShifts : derivedPatrolShifts

  const mergedBlockers = [...asStringArray(parsed?.blockers)]
  const declaredCode = extractDeclaredPatrolCode(sourceText)
  const observedCodes = extractObservedPatrolCodes(sourceText)
  if (declaredCode && observedCodes.length > 0) {
    const counts = new Map<string, number>()
    for (const code of observedCodes) counts.set(code, (counts.get(code) ?? 0) + 1)
    const topObserved = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    if (topObserved && declaredCode !== topObserved) {
      mergedBlockers.push(`Declared patrol code ${declaredCode} conflicts with observed row code ${topObserved}. Verify source schedule before automation.`)
    }
  }

  return {
    title: asTrimmedString(parsed?.title) || 'Patrol setup blueprint',
    organizationName: asTrimmedString(parsed?.organizationName),
    summary: asTrimmedString(parsed?.summary) || 'Structured patrol setup requirements extracted from source material.',
    services: asStringArray(parsed?.services),
    facilities,
    blockers: Array.from(new Set(mergedBlockers)),
    nextActions: asStringArray(parsed?.nextActions),
    rosterRequirements: asStringArray(parsed?.rosterRequirements),
    geofenceRequirements: asStringArray(parsed?.geofenceRequirements),
    patrolRouteRequirements: asStringArray(parsed?.patrolRouteRequirements),
    siteSops,
    patrolShifts,
    sourceText: asTrimmedString(sourceText),
  }
}

export function buildPatrolSetupBlueprintDocument(blueprint: PatrolSetupBlueprint): string {
  const lines: string[] = [
    `# ${blueprint.title}`,
    '',
    blueprint.organizationName ? `Organization: ${blueprint.organizationName}` : 'Organization: Not specified',
    '',
    '## Summary',
    blueprint.summary || 'No summary provided.',
  ]

  if (blueprint.services.length > 0) {
    lines.push('', '## Service Scope', ...blueprint.services.map((item) => `- ${item}`))
  }

  if (blueprint.facilities.length > 0) {
    lines.push('', '## Facilities')
    for (const facility of blueprint.facilities) {
      lines.push('', `### ${facility.name}`)
      if (facility.extent.length > 0) lines.push('Extent:', ...facility.extent.map((item) => `- ${item}`))
      if (facility.serviceCoverage.length > 0) lines.push('Services:', ...facility.serviceCoverage.map((item) => `- ${item}`))
      if (facility.frequencies.length > 0) lines.push('Frequencies / standards:', ...facility.frequencies.map((item) => `- ${item}`))
      if (facility.setupActions.length > 0) lines.push('Required setup actions:', ...facility.setupActions.map((item) => `- ${item}`))
      if (facility.notes.length > 0) lines.push('Notes:', ...facility.notes.map((item) => `- ${item}`))
    }
  }

  if (blueprint.siteSops.length > 0) {
    lines.push('', '## Site SOPs')
    for (const sop of blueprint.siteSops) {
      lines.push('', `### ${sop.siteName}${sop.jobType ? ` (${sop.jobType})` : ''}`)
      lines.push(...sop.steps.map((step, index) => `${index + 1}. ${step}`))
    }
  }

  if (blueprint.patrolShifts.length > 0) {
    lines.push('', '## Patrol Shift Templates')
    for (const shift of blueprint.patrolShifts) {
      lines.push(
        '',
        `### ${shift.code || 'Uncoded'} ${shift.name}`.trim(),
        `Window: ${shift.startTime || 'unspecified'} -> ${shift.endTime || 'unspecified'}`,
        `Timing policy: ${shift.timingPolicy}`,
        `Paid breaks: ${shift.allBreaksPaid ? 'yes' : 'no'}`,
      )
      if (shift.breaks.length > 0) lines.push('Break plan:', ...shift.breaks.map((item) => `- ${item}`))
      if (shift.coverageAreas.length > 0) lines.push('Coverage areas:', ...shift.coverageAreas.map((item) => `- ${item}`))
      if (shift.serviceCoverage.length > 0) lines.push('Coverage services:', ...shift.serviceCoverage.map((item) => `- ${item}`))
      if (shift.notes.length > 0) lines.push('Shift notes:', ...shift.notes.map((item) => `- ${item}`))
    }
  }

  if (blueprint.geofenceRequirements.length > 0) {
    lines.push('', '## Geofence Requirements', ...blueprint.geofenceRequirements.map((item) => `- ${item}`))
  }

  if (blueprint.patrolRouteRequirements.length > 0) {
    lines.push('', '## Patrol Route Requirements', ...blueprint.patrolRouteRequirements.map((item) => `- ${item}`))
  }

  if (blueprint.rosterRequirements.length > 0) {
    lines.push('', '## Roster Requirements', ...blueprint.rosterRequirements.map((item) => `- ${item}`))
  }

  if (blueprint.blockers.length > 0) {
    lines.push('', '## Current Blockers', ...blueprint.blockers.map((item) => `- ${item}`))
  }

  if (blueprint.nextActions.length > 0) {
    lines.push('', '## Next Actions', ...blueprint.nextActions.map((item) => `- ${item}`))
  }

  lines.push('', '## Source Material', blueprint.sourceText || 'No source material captured.')
  return lines.join('\n')
}

export function formatPatrolSetupBlueprintReply(blueprint: PatrolSetupBlueprint): string {
  const facilityCount = blueprint.facilities.length
  const facilityLine = facilityCount > 0
    ? `I extracted ${facilityCount} facility setup item${facilityCount === 1 ? '' : 's'}.`
    : 'I did not find complete facility records in the source material.'
  const blockerLine = blueprint.blockers.length > 0
    ? `Current blockers: ${blueprint.blockers.slice(0, 4).join('; ')}.`
    : 'No hard blockers were identified from the text alone.'
  const nextLine = blueprint.nextActions.length > 0
    ? `Next actions: ${blueprint.nextActions.slice(0, 4).join('; ')}.`
    : 'Next actions still need confirmation.'

  const shiftLine = blueprint.patrolShifts.length > 0
    ? `Patrol shifts captured: ${blueprint.patrolShifts.map((shift) => shift.code || shift.name).filter(Boolean).join(', ')}.`
    : 'No patrol shift template was captured yet.'

  return [
    blueprint.summary,
    facilityLine,
    shiftLine,
    blockerLine,
    nextLine,
    'I prepared an autonomous draft-setup action so Bob can create site and zone records in the build once approved.',
  ].join(' ')
}

export function formatPatrolShiftComplianceSummary(compliance: PatrolShiftCompliance[]): string {
  if (!compliance.length) {
    return 'No patrol shifts were available for compliance scoring.'
  }

  const compliantCount = compliance.filter((item) => item.isCompliant).length
  const failed = compliance.filter((item) => !item.isCompliant)

  const lines = [
    `Shift templates checked: ${compliance.length}`,
    `Compliant shifts: ${compliantCount}`,
    `Non-compliant shifts: ${failed.length}`,
  ]

  if (failed.length > 0) {
    lines.push('', 'Issues:')
    failed.slice(0, 8).forEach((item) => {
      const reasons = item.reasons.join('; ') || 'Unknown compliance issue'
      lines.push(`- ${item.shiftCode || item.shiftName}: ${reasons}`)
    })
  }

  return lines.join('\n')
}

export function formatPatrolShiftComplianceConversation(compliance: PatrolShiftCompliance[]): string {
  const failed = compliance.filter((item) => !item.isCompliant)
  if (!failed.length) {
    return 'Timing and contract checks passed for the captured shift templates. If you want, I can proceed to draft the setup and schedule mapping now.'
  }

  const first = failed[0]
  const firstReason = first.reasons[0] || 'Compliance requirement failed.'
  return [
    `I found ${failed.length} shift compliance issue${failed.length === 1 ? '' : 's'} before automation.`,
    `Top issue: ${first.shiftCode || first.shiftName} - ${firstReason}`,
    'I can help resolve this now by tightening time windows, reducing stop load, or updating break assumptions. Tell me whether these times are specific contract times or recommended windows, and I will re-balance the schedule before execution.',
  ].join(' ')
}

export function evaluateHistoricalDataPlacementReadiness(blueprint: PatrolSetupBlueprint): HistoricalDataPlacementReview {
  const lines = blueprint.sourceText.split(/\r?\n/)
  const headerLine = lines.find((line) => /despatch\s+zone/i.test(line) && line.includes('\t'))

  if (!headerLine) {
    return {
      detectedRows: 0,
      completedRows: 0,
      missedRows: 0,
      rowsWithDispatchId: 0,
      rowsWithTimestamps: 0,
      mappedFacilityCount: blueprint.facilities.length,
      isPlacementReady: true,
      blockers: [],
    }
  }

  const headerCells = parseTabularLine(headerLine).map((cell) => cell.toLowerCase())
  const statusIndex = headerCells.findIndex((cell) => cell === 'patrol complete status')
  const onsiteIndex = headerCells.findIndex((cell) => cell === 'on-site date/time')
  const offsiteIndex = headerCells.findIndex((cell) => cell === 'off-site date/time')
  const dispatchIdIndex = headerCells.findIndex((cell) => cell === 'internal despatchid')

  let detectedRows = 0
  let completedRows = 0
  let missedRows = 0
  let rowsWithDispatchId = 0
  let rowsWithTimestamps = 0

  for (const line of lines) {
    if (!line.includes('\t')) continue
    const cells = parseTabularLine(line)
    const zone = cells[headerCells.findIndex((cell) => cell === 'despatch zone')]
    if (!/^\d{3}$/.test(zone || '')) continue

    detectedRows += 1
    const status = String(cells[statusIndex] || '').toLowerCase()
    if (status === 'completed') completedRows += 1
    if (status === 'missed') missedRows += 1

    if (dispatchIdIndex >= 0 && String(cells[dispatchIdIndex] || '').trim()) {
      rowsWithDispatchId += 1
    }

    const onsite = onsiteIndex >= 0 ? String(cells[onsiteIndex] || '').trim() : ''
    const offsite = offsiteIndex >= 0 ? String(cells[offsiteIndex] || '').trim() : ''
    if (onsite && offsite) {
      rowsWithTimestamps += 1
    }
  }

  const blockers: string[] = []
  if (detectedRows > 0 && blueprint.facilities.length === 0) {
    blockers.push('Historical patrol rows were detected, but no facility/site mappings were extracted for placement into client sites.')
  }
  if (detectedRows > 0 && rowsWithDispatchId === 0) {
    blockers.push('Historical rows are missing Internal DespatchId values needed for idempotent import checks.')
  }
  if (detectedRows > 0 && rowsWithTimestamps === 0 && completedRows > 0) {
    blockers.push('Completed historical rows are missing on-site/off-site timestamps, so duration and schedule quality checks cannot be verified.')
  }

  return {
    detectedRows,
    completedRows,
    missedRows,
    rowsWithDispatchId,
    rowsWithTimestamps,
    mappedFacilityCount: blueprint.facilities.length,
    isPlacementReady: blockers.length === 0,
    blockers,
  }
}

export function formatHistoricalPlacementConversation(review: HistoricalDataPlacementReview): string {
  if (review.detectedRows === 0) {
    return 'No historical patrol import table was detected in this message, so I skipped historical placement checks.'
  }

  if (review.isPlacementReady) {
    return [
      `I validated historical patrol placement readiness: ${review.detectedRows} rows detected, ${review.completedRows} completed, ${review.missedRows} missed.`,
      'The import structure is consistent enough to map into existing client sites, provider patrol templates, and schedule checks.',
    ].join(' ')
  }

  return [
    `Historical patrol data needs correction before import (${review.blockers.length} blocker${review.blockers.length === 1 ? '' : 's'}).`,
    `Key blocker: ${review.blockers[0]}`,
    'Fix path: map site names to client sites, ensure Internal DespatchId is retained per row, and include on-site/off-site timestamps for completed patrols. I can help you step through this now.',
  ].join(' ')
}

export function formatHistoricalPlacementSummary(review: HistoricalDataPlacementReview): string {
  if (review.detectedRows === 0) {
    return 'No historical patrol table rows were detected.'
  }

  const lines = [
    `Historical rows detected: ${review.detectedRows}`,
    `Completed rows: ${review.completedRows}`,
    `Missed rows: ${review.missedRows}`,
    `Rows with dispatch IDs: ${review.rowsWithDispatchId}`,
    `Rows with on/off timestamps: ${review.rowsWithTimestamps}`,
    `Mapped facilities/sites: ${review.mappedFacilityCount}`,
    `Placement readiness: ${review.isPlacementReady ? 'ready' : 'blocked'}`,
  ]

  if (!review.isPlacementReady && review.blockers.length > 0) {
    lines.push('', 'Placement blockers:')
    review.blockers.slice(0, 6).forEach((blocker) => lines.push(`- ${blocker}`))
  }

  return lines.join('\n')
}

export function reviewHistoricalPatrolPerformance(blueprint: PatrolSetupBlueprint): HistoricalPerformanceReview {
  const rows = extractHistoricalRowMetrics(blueprint.sourceText)
  const detectedRows = rows.length
  const completedRows = rows.filter((row) => row.status === 'completed').length
  const missedRows = rows.filter((row) => row.status === 'missed').length
  const completionRate = detectedRows > 0 ? completedRows / detectedRows : 0

  const onsiteDurations = rows.map((row) => row.onsiteMinutes).filter((v): v is number => v !== null)
  const dispatchLags = rows.map((row) => row.dispatchToOnsiteMinutes).filter((v): v is number => v !== null)
  const distanceValues = rows.map((row) => row.distanceMetres).filter((v): v is number => v !== null)
  const variationValues = rows.map((row) => row.variationMinutes).filter((v): v is number => v !== null)

  const averageOnsiteMinutes = onsiteDurations.length
    ? Math.round(onsiteDurations.reduce((sum, v) => sum + v, 0) / onsiteDurations.length)
    : null
  const averageDispatchToOnsiteMinutes = dispatchLags.length
    ? Math.round(dispatchLags.reduce((sum, v) => sum + v, 0) / dispatchLags.length)
    : null

  const issues: HistoricalPerformanceIssue[] = []

  if (detectedRows >= 6 && completionRate < 0.85) {
    issues.push({
      category: 'officer_execution',
      severity: completionRate < 0.7 ? 'high' : 'medium',
      evidence: `Completion rate is ${(completionRate * 100).toFixed(1)}% (${completedRows}/${detectedRows}), with ${missedRows} missed patrol rows.`,
      likelyCause: 'Execution reliability appears below expected service level for scheduled patrol commitments.',
      adminRecommendation: 'Run an officer debrief on missed jobs, verify shift handovers, and require reason codes for all missed patrols before closeout.',
      requiresApproval: true,
      discussionPath: 'Discuss misses with the officer first, then approve a corrective roster/coverage change if root cause is confirmed.',
    })
  }

  if (distanceValues.length >= 4) {
    const longDistanceRows = distanceValues.filter((v) => v > 1000).length
    const longDistanceRatio = longDistanceRows / distanceValues.length
    if (longDistanceRatio >= 0.35) {
      issues.push({
        category: 'route_design',
        severity: longDistanceRatio >= 0.6 ? 'high' : 'medium',
        evidence: `${longDistanceRows}/${distanceValues.length} visits are >1000m from expected site reference.`,
        likelyCause: 'Patrol run order or geographic grouping may be inefficient, increasing travel overhead and variability.',
        adminRecommendation: 'Approve a route redesign: regroup by proximity, rebalance stop sequence, and test revised run in draft mode for one week.',
        requiresApproval: true,
        discussionPath: 'If route redesign cannot meet client window, discuss alternative service cadence with the client.',
      })
    }
  }

  if (variationValues.length >= 4) {
    const highVariationRows = variationValues.filter((v) => Math.abs(v) >= 8).length
    const highVariationRatio = highVariationRows / variationValues.length
    if (highVariationRatio >= 0.3) {
      issues.push({
        category: 'onsite_time',
        severity: highVariationRatio >= 0.55 ? 'high' : 'medium',
        evidence: `${highVariationRows}/${variationValues.length} rows show >=8 minute on-site variance.`,
        likelyCause: 'On-site dwell time appears inconsistent with expected patrol standard (possible trimming or overrun).',
        adminRecommendation: 'Introduce minimum on-site checklist confirmation and supervise targeted spot checks on high-variance sites.',
        requiresApproval: true,
        discussionPath: 'Review individual variance cases with officers and agree either coaching actions or standard-time adjustments.',
      })
    }
  }

  if (dispatchLags.length >= 4 && averageDispatchToOnsiteMinutes !== null && averageDispatchToOnsiteMinutes > 45) {
    issues.push({
      category: 'schedule_design',
      severity: averageDispatchToOnsiteMinutes > 75 ? 'high' : 'medium',
      evidence: `Average dispatch-to-on-site lag is ${averageDispatchToOnsiteMinutes} minutes across ${dispatchLags.length} completed rows with timestamps.`,
      likelyCause: 'Schedule windows may be too tight for observed travel and workload.',
      adminRecommendation: 'Approve schedule rebalancing: adjust dispatch windows, split overloaded runs, and reserve buffer between high-distance stops.',
      requiresApproval: true,
      discussionPath: 'If rebalancing still fails contract windows, discuss formal timing adjustment options with the client.',
    })
  }

  return {
    detectedRows,
    completedRows,
    missedRows,
    completionRate,
    averageOnsiteMinutes,
    averageDispatchToOnsiteMinutes,
    issues,
  }
}

export function formatHistoricalPerformanceAdminFeedback(review: HistoricalPerformanceReview): string {
  if (review.detectedRows === 0) {
    return 'No historical patrol rows were detected, so performance feedback could not be generated.'
  }

  const lines = [
    `Historical performance review: ${review.completedRows}/${review.detectedRows} completed (${(review.completionRate * 100).toFixed(1)}%), ${review.missedRows} missed.`,
    `Average on-site minutes: ${review.averageOnsiteMinutes ?? 'n/a'}.`,
    `Average dispatch-to-on-site lag: ${review.averageDispatchToOnsiteMinutes ?? 'n/a'} minutes.`,
  ]

  if (review.issues.length === 0) {
    lines.push('No critical performance-pattern issues were detected from this sample.')
    return lines.join(' ')
  }

  lines.push('', 'Proposed admin actions (approval required before implementation):')
  review.issues.slice(0, 6).forEach((issue, index) => {
    lines.push(
      `${index + 1}. [${issue.category}] ${issue.evidence}`,
      `Likely cause: ${issue.likelyCause}`,
      `Proposed fix: ${issue.adminRecommendation}`,
      `Alternative path: ${issue.discussionPath}`,
    )
  })

  return lines.join('\n')
}

export function findSopStepsForFacility(blueprint: PatrolSetupBlueprint, facilityName: string): string[] {
  const normalizedFacilityName = asTrimmedString(facilityName).toLowerCase()
  if (!normalizedFacilityName) return []

  return blueprint.siteSops
    .filter((sop) => sop.siteName.toLowerCase().includes(normalizedFacilityName) || normalizedFacilityName.includes(sop.siteName.toLowerCase()))
    .flatMap((sop) => sop.steps)
}

export function findPrimaryShiftForCode(blueprint: PatrolSetupBlueprint, patrolCode: string | null | undefined): PatrolShiftTemplate | null {
  const normalizedCode = asTrimmedString(patrolCode)
  if (!normalizedCode) return blueprint.patrolShifts[0] ?? null
  return blueprint.patrolShifts.find((shift) => asTrimmedString(shift.code) === normalizedCode) ?? blueprint.patrolShifts[0] ?? null
}

export function evaluatePatrolShiftCompliance(
  blueprint: PatrolSetupBlueprint,
  options?: { defaultTravelMinutesBetweenStops?: number },
): PatrolShiftCompliance[] {
  const defaultTravelMinutesBetweenStops = options?.defaultTravelMinutesBetweenStops ?? 8
  const durationByCode = extractPlannedDurationsByPatrolCode(blueprint.sourceText)

  return blueprint.patrolShifts.map((shift) => {
    const rows = durationByCode.get(asTrimmedString(shift.code)) ?? []
    const taskMinutes = rows.reduce((sum, row) => sum + row.minutes, 0)
    const breakMinutes = estimateBreakMinutes(shift)
    const stopCount = rows.length
    const travelMinutes = stopCount > 1 ? (stopCount - 1) * defaultTravelMinutesBetweenStops : 0
    const shiftMinutes = shiftDurationMinutes(shift.startTime, shift.endTime)
    const totalRequiredMinutes = taskMinutes + breakMinutes + travelMinutes
    const reasons: string[] = []

    if (shiftMinutes <= 0) {
      reasons.push('Shift start/end window is missing or invalid.')
    }

    if (shift.timingPolicy === 'specific' && rows.length === 0) {
      reasons.push('Timing policy is specific but no specific run durations were parsed from source.')
    }

    if (shiftMinutes > 0 && totalRequiredMinutes > shiftMinutes) {
      reasons.push(`Required minutes (${totalRequiredMinutes}) exceed shift window (${shiftMinutes}).`)
    }

    if (!shift.allBreaksPaid && breakMinutes > 0) {
      reasons.push('Breaks are not marked as fully paid; contract compliance needs confirmation.')
    }

    return {
      shiftCode: shift.code,
      shiftName: shift.name,
      shiftMinutes,
      taskMinutes,
      breakMinutes,
      travelMinutes,
      totalRequiredMinutes,
      isCompliant: reasons.length === 0,
      timingPolicy: shift.timingPolicy,
      reasons,
    }
  })
}

export function inferSiteType(serviceCoverage: string[]): string {
  const joined = serviceCoverage.join(' ').toLowerCase()
  if (joined.includes('noise')) return 'noise_control'
  if (joined.includes('parking')) return 'parking'
  if (joined.includes('guard')) return 'guarding'
  if (joined.includes('freedom')) return 'freedom_camping'
  return 'general'
}