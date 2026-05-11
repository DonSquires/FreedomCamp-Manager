export interface DeputyParsedRow {
  externalId: string
  employeeName: string
  employeeDisplayName: string
  employeeExportCode: string | null
  areaName: string | null
  locationName: string | null
  locationCode: string | null
  areaExportCode: string | null
  payPeriodName: string | null
  isLeave: boolean
  leaveTypeName: string | null
  leaveExportCode: string | null
  isLeavePaid: boolean
  scheduleStart: string | null
  scheduleEnd: string | null
  scheduleDurationHours: number | null
  scheduleCost: number | null
  scheduleWarning: string | null
  approved: boolean
  timesheetStart: string | null
  timesheetEnd: string | null
  timesheetDurationHours: number | null
  timesheetCost: number | null
  employeeComment: string | null
  isInProgress: boolean
  autoRounded: boolean
  discarded: boolean
}

export interface DeputyPreviewRow {
  employee: string
  location: string
  schedule: string
  leave: string
  warning: string
}

export interface DeputyImportParseResult {
  rows: DeputyParsedRow[]
  previewRows: DeputyPreviewRow[]
  scheduleCount: number
  leaveCount: number
  timesheetCount: number
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function toBool(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase())
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function pad(value: string): string {
  return value.padStart(2, '0')
}

function parseDeputyDateTime(value: string | undefined): string | null {
  if (!value?.trim()) return null
  const raw = value.trim()

  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (dmy) {
    const [, day, month, year, hours = '00', minutes = '00', seconds = '00'] = dmy
    return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }

  const isoLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (isoLike) {
    const [, year, month, day, hours = '00', minutes = '00', seconds = '00'] = isoLike
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 19)
}

function splitDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  if (delimiter === '\t') return line.split('\t').map((part) => part.trim())

  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  cells.push(current.trim())
  return cells
}

function getColumn(row: Record<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const target = normalizeHeader(name)
    const match = Object.keys(row).find((header) => normalizeHeader(header) === target)
    if (match) return row[match]
  }
  return undefined
}

function toExternalId(prefix: string, parts: Array<string | null | undefined>): string {
  const normalized = parts.map((part) => (part ?? '').trim() || '-').join('|')
  return `${prefix}:${normalized}`
}

export function parseDeputyImportText(text: string): DeputyImportParseResult {
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!normalizedText) {
    return { rows: [], previewRows: [], scheduleCount: 0, leaveCount: 0, timesheetCount: 0 }
  }

  const lines = normalizedText.split('\n').filter(Boolean)
  const delimiter: ',' | '\t' =
    ((lines[0].match(/\t/g) || []).length >= (lines[0].match(/,/g) || []).length) ? '\t' : ','

  const headers = splitDelimitedLine(lines[0], delimiter)
  const records = lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line, delimiter)
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {})
  })

  const rows = records.map<DeputyParsedRow>((row) => {
    const employeeDisplayName = getColumn(row, 'Employee Display Name', 'Employee')?.trim() || ''
    const employeeName = getColumn(row, 'Employee', 'Employee Name')?.trim() || employeeDisplayName
    const employeeExportCode = getColumn(row, 'Employee Export Code', 'Employee Code')?.trim() || null
    const scheduleStart = parseDeputyDateTime(getColumn(row, 'Schedule Start', 'ScheduleStart', 'Start'))
    const scheduleEnd = parseDeputyDateTime(getColumn(row, 'Schedule End', 'Schedule Finish', 'ScheduleEnd', 'Finish', 'End'))
    const timesheetStart = parseDeputyDateTime(getColumn(row, 'Timesheet Start', 'TimesheetStart'))
    const timesheetEnd = parseDeputyDateTime(getColumn(row, 'Timesheet End', 'Timesheet Finish', 'TimesheetEnd'))
    const areaName = getColumn(row, 'Area')?.trim() || null
    const locationName = getColumn(row, 'Location')?.trim() || null
    const locationCode = getColumn(row, 'Location Code', 'LocationCode')?.trim() || null
    const areaExportCode = getColumn(row, 'Area Export Code', 'AreaExportCode')?.trim() || null
    const isLeave = toBool(getColumn(row, 'Is Leave', 'IsLeave'))
    const leaveTypeName = getColumn(row, 'Leave Type', 'LeaveType')?.trim() || null

    const externalId = isLeave
      ? toExternalId('leave', [employeeExportCode, leaveTypeName, scheduleStart, scheduleEnd, locationCode])
      : timesheetStart
      ? toExternalId('timesheet', [employeeExportCode, timesheetStart, timesheetEnd, locationCode])
      : toExternalId('schedule', [employeeExportCode, scheduleStart, scheduleEnd, locationCode, areaExportCode])

    return {
      externalId,
      employeeName,
      employeeDisplayName,
      employeeExportCode,
      areaName,
      locationName,
      locationCode,
      areaExportCode,
      payPeriodName: getColumn(row, 'Pay Period', 'PayPeriod')?.trim() || null,
      isLeave,
      leaveTypeName,
      leaveExportCode: getColumn(row, 'Leave Export Code', 'LeaveExportCode')?.trim() || null,
      isLeavePaid: getColumn(row, 'Is Leave Paid', 'IsLeavePaid') ? toBool(getColumn(row, 'Is Leave Paid', 'IsLeavePaid')) : true,
      scheduleStart,
      scheduleEnd,
      scheduleDurationHours: toNumber(getColumn(row, 'Schedule Duration (Hours)', 'Schedule Duration', 'ScheduleDuration')),
      scheduleCost: toNumber(getColumn(row, 'Schedule Cost', 'ScheduleCost')),
      scheduleWarning: getColumn(row, 'Schedule Warning', 'ScheduleWarning', 'Stress')?.trim() || null,
      approved: toBool(getColumn(row, 'Approved', 'Schedule Approved', 'Approved?')),
      timesheetStart,
      timesheetEnd,
      timesheetDurationHours: toNumber(getColumn(row, 'Timesheet Duration (Hours)', 'Timesheet Duration', 'TimesheetDuration')),
      timesheetCost: toNumber(getColumn(row, 'Timesheet Cost', 'TimesheetCost')),
      employeeComment: getColumn(row, 'Employee Comment', 'Comment')?.trim() || null,
      isInProgress: toBool(getColumn(row, 'Is In Progress', 'IsInProgress')),
      autoRounded: toBool(getColumn(row, 'Auto-Rounded', 'AutoRounded')),
      discarded: toBool(getColumn(row, 'Discarded')),
    }
  })

  return {
    rows,
    previewRows: rows.slice(0, 5).map((row) => ({
      employee: row.employeeName || row.employeeDisplayName || 'Unknown',
      location: row.locationName || row.areaName || '—',
      schedule: row.scheduleStart ? `${row.scheduleStart.slice(0, 16)} → ${row.scheduleEnd?.slice(11, 16) ?? '—'}` : '—',
      leave: row.isLeave ? row.leaveTypeName || 'Leave' : '—',
      warning: row.scheduleWarning || '—',
    })),
    scheduleCount: rows.filter((row) => !row.isLeave && row.scheduleStart).length,
    leaveCount: rows.filter((row) => row.isLeave).length,
    timesheetCount: rows.filter((row) => row.timesheetStart).length,
  }
}
