/**
 * deputy-roster-import
 *
 * Parses a Deputy schedule/timesheet TSV or CSV export and upserts the data
 * into the following tables:
 *   - deputy_locations   (area/location lookup)
 *   - roster_shifts      (planned schedule rows)
 *   - leave_requests     (is-leave rows)
 *   - officer_shifts     (timesheet rows)
 *
 * Deputy exports a single flat file with one row per schedule entry.
 * The header row names the columns — this function is column-order agnostic.
 *
 * Supported Deputy columns (all optional except Employee):
 *   Employee, Employee Display Name, Employee Export Code,
 *   Area, Location, Location Code, Area Export Code,
 *   Pay Period,
 *   Schedule Start, Schedule Finish, Schedule Duration (Hours), Schedule Cost,
 *   Approved (schedule), Schedule Warning,
 *   Is Leave, Leave Type, Leave Export Code, Is Leave Paid,
 *   Timesheet Start, Timesheet Finish, Timesheet Duration (Hours), Timesheet Cost,
 *   Employee Comment, Is In Progress, Auto-Rounded, Discarded
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.3'
import { corsHeaders } from '../_shared/cors.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function bool(v: string | undefined): boolean {
  if (!v) return false
  return ['true', '1', 'yes', 'y'].includes(v.trim().toLowerCase())
}

function num(v: string | undefined): number | null {
  if (!v || v.trim() === '') return null
  const n = parseFloat(v.replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}

/** Parse a Deputy datetime string like "11/05/2026 07:00" → ISO string or null */
function parseDeputyDatetime(v: string | undefined): string | null {
  if (!v || v.trim() === '') return null
  const raw = v.trim()
  // Try DD/MM/YYYY HH:mm
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const [, dd, MM, yyyy, HH, mm, ss = '00'] = m
    return `${yyyy}-${MM.padStart(2, '0')}-${dd.padStart(2, '0')}T${HH.padStart(2, '0')}:${mm}:${ss}+12:00`
  }
  // Fallback: ISO parse
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/** Parse a Deputy date-only string "11/05/2026" → "yyyy-MM-dd" or null */
function parseDeputyDate(v: string | undefined): string | null {
  if (!v || v.trim() === '') return null
  const raw = v.trim()
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const [, dd, MM, yyyy] = m
    return `${yyyy}-${MM.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  // Try ISO date
  const m2 = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m2) return raw.slice(0, 10)
  return null
}

/** Parse Deputy TSV/CSV into an array of header-keyed objects */
function parseDeputyExport(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n')
  if (lines.length < 2) return []

  // Auto-detect delimiter: tab wins if first line has more tabs than commas
  const firstLine = lines[0]
  const tabCount = (firstLine.match(/\t/g) || []).length
  const commaCount = (firstLine.match(/,/g) || []).length
  const delim = tabCount >= commaCount ? '\t' : ','

  function splitRow(line: string): string[] {
    if (delim === '\t') return line.split('\t').map((c) => c.trim())
    // Simple CSV split respecting double-quoted fields
    const cols: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++ }
        else inQuote = !inQuote
      } else if (ch === ',' && !inQuote) {
        cols.push(cur.trim())
        cur = ''
      } else {
        cur += ch
      }
    }
    cols.push(cur.trim())
    return cols
  }

  const headers = splitRow(lines[0])
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitRow(lines[i])
    if (cols.every((c) => c === '')) continue
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? ''
    })
    rows.push(row)
  }
  return rows
}

/** Normalise a Deputy column name to a stable key (lowercase, trim, collapse spaces) */
function col(row: Record<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const k = Object.keys(row).find(
      (h) => h.trim().toLowerCase() === name.toLowerCase()
    )
    if (k !== undefined) return row[k]
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(supabaseUrl, serviceKey)

    const { data: { user }, error: authErr } = await sb.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: responseHeaders })
    }

    // ── Resolve org ───────────────────────────────────────────────────────────
    const { data: profile } = await sb
      .from('user_profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.organization_id) {
      return new Response(JSON.stringify({ error: 'No organization found' }), { status: 400, headers: responseHeaders })
    }

    const orgId: string = profile.organization_id

    const allowedRoles = ['admin', 'admin_officer', 'master']
    if (!allowedRoles.includes(profile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden — admin role required' }), { status: 403, headers: responseHeaders })
    }

    // ── Body ──────────────────────────────────────────────────────────────────
    const ct = req.headers.get('content-type') ?? ''
    let fileText = ''

    if (ct.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file') as File | null
      if (!file) {
        return new Response(JSON.stringify({ error: 'Missing "file" field in multipart form' }), { status: 400, headers: responseHeaders })
      }
      fileText = await file.text()
    } else {
      const body = await req.json()
      fileText = body.fileContent ?? body.content ?? ''
    }

    if (!fileText.trim()) {
      return new Response(JSON.stringify({ error: 'Empty file content' }), { status: 400, headers: responseHeaders })
    }

    // ── Parse ─────────────────────────────────────────────────────────────────
    const rows = parseDeputyExport(fileText)
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: 'No data rows found in file' }), { status: 400, headers: responseHeaders })
    }

    // ── Summary counters ──────────────────────────────────────────────────────
    let employeesMatched = 0
    let locationsEnsured = 0
    let schedulesImported = 0
    let leavesImported = 0
    let timesheetsImported = 0
    const warnings: string[] = []

    // ── Cache maps (per-request) ───────────────────────────────────────────────
    const employeeCache = new Map<string, string>()   // exportCode → user_profiles.id
    const locationCache = new Map<string, string>()   // areaExportCode → deputy_locations.id

    // ── Helper: resolve officer  ──────────────────────────────────────────────
    async function resolveOfficer(exportCode: string | undefined, displayName: string | undefined): Promise<string | null> {
      if (!exportCode && !displayName) return null

      const cacheKey = exportCode ?? displayName!
      if (employeeCache.has(cacheKey)) return employeeCache.get(cacheKey)!

      // Try by deputy_employee_id first
      if (exportCode) {
        const { data } = await sb
          .from('user_profiles')
          .select('id')
          .eq('organization_id', orgId)
          .eq('deputy_employee_id', exportCode)
          .maybeSingle()
        if (data?.id) {
          employeeCache.set(cacheKey, data.id)
          employeesMatched++
          return data.id
        }
      }

      // Fallback: extract [exportCode] from display name and match by name
      if (displayName) {
        // e.g. "(N)CAS - Angel Moerua [512060]" → first/last name extraction
        const namePart = displayName.replace(/\[.*?\]/g, '').replace(/^\(.*?\)\s*-\s*/, '').trim()
        const parts = namePart.split(/\s+/)
        if (parts.length >= 2) {
          const firstName = parts[0]
          const lastName = parts.slice(1).join(' ')
          const { data } = await sb
            .from('user_profiles')
            .select('id')
            .eq('organization_id', orgId)
            .ilike('first_name', firstName)
            .ilike('last_name', lastName)
            .maybeSingle()
          if (data?.id) {
            // Persist the deputy_employee_id so future imports match faster
            if (exportCode) {
              await sb.from('user_profiles').update({ deputy_employee_id: exportCode, deputy_display_name: displayName }).eq('id', data.id)
            }
            employeeCache.set(cacheKey, data.id)
            employeesMatched++
            return data.id
          }
        }
      }

      warnings.push(`Officer not found: export_code=${exportCode ?? 'n/a'} display="${displayName ?? 'n/a'}"`)
      return null
    }

    // ── Helper: ensure deputy_location  ──────────────────────────────────────
    async function ensureLocation(
      areaName: string,
      locationName: string,
      locationCode: string | undefined,
      areaExportCode: string | undefined,
    ): Promise<string | null> {
      const cacheKey = areaExportCode ?? `${areaName}||${locationName}`
      if (locationCache.has(cacheKey)) return locationCache.get(cacheKey)!

      if (areaExportCode) {
        const { data: existing } = await sb
          .from('deputy_locations')
          .select('id')
          .eq('organization_id', orgId)
          .eq('area_export_code', areaExportCode)
          .maybeSingle()
        if (existing?.id) {
          locationCache.set(cacheKey, existing.id)
          return existing.id
        }
      }

      // Create
      const { data: created, error } = await sb
        .from('deputy_locations')
        .insert({
          organization_id: orgId,
          area_name: areaName,
          location_name: locationName,
          location_code: locationCode ?? null,
          area_export_code: areaExportCode ?? null,
        })
        .select('id')
        .single()

      if (error || !created) {
        warnings.push(`Could not create deputy_location: ${areaName} / ${locationName} — ${error?.message}`)
        return null
      }

      locationsEnsured++
      locationCache.set(cacheKey, created.id)
      return created.id
    }

    // ── Process rows ──────────────────────────────────────────────────────────
    for (const row of rows) {
      const exportCode    = col(row, 'Employee Export Code', 'EmployeeExportCode')
      const displayName   = col(row, 'Employee Display Name', 'Employee Display Name', 'EmployeeDisplayName')
      const areaName      = col(row, 'Area') ?? ''
      const locationName  = col(row, 'Location') ?? ''
      const locationCode  = col(row, 'Location Code', 'LocationCode')
      const areaExportCode = col(row, 'Area Export Code', 'AreaExportCode')
      const payPeriod     = col(row, 'Pay Period', 'PayPeriod')
      const isLeave       = bool(col(row, 'Is Leave', 'IsLeave'))

      // Schedule columns
      const schedStart    = col(row, 'Schedule Start', 'ScheduleStart', 'Start')
      const schedFinish   = col(row, 'Schedule Finish', 'ScheduleFinish', 'Schedule End', 'End')
      const schedDuration = col(row, 'Schedule Duration (Hours)', 'Schedule Duration', 'ScheduleDuration')
      const schedCost     = col(row, 'Schedule Cost', 'ScheduleCost')
      const schedWarning  = col(row, 'Schedule Warning', 'ScheduleWarning', 'Stress')
      const schedApproved = col(row, 'Approved', 'Schedule Approved', 'ScheduleApproved')

      // Leave columns
      const leaveType     = col(row, 'Leave Type', 'LeaveType')
      const leaveCode     = col(row, 'Leave Export Code', 'LeaveExportCode')
      const leavePaid     = col(row, 'Is Leave Paid', 'IsLeavePaid', 'Paid')

      // Timesheet columns
      const tsStart       = col(row, 'Timesheet Start', 'TimesheetStart')
      const tsFinish      = col(row, 'Timesheet Finish', 'Timesheet End', 'TimesheetEnd')
      const tsDuration    = col(row, 'Timesheet Duration (Hours)', 'Timesheet Duration', 'TimesheetDuration')
      const tsCost        = col(row, 'Timesheet Cost', 'TimesheetCost')
      const empComment    = col(row, 'Employee Comment', 'EmployeeComment', 'Comment')
      const isInProgress  = col(row, 'Is In Progress', 'IsInProgress')
      const autoRounded   = col(row, 'Auto-Rounded', 'AutoRounded')
      const discarded     = col(row, 'Discarded')

      // Resolve officer
      const officerId = await resolveOfficer(exportCode, displayName)

      // Ensure location record
      let _locationId: string | null = null
      if (areaName || locationName) {
        _locationId = await ensureLocation(areaName, locationName, locationCode, areaExportCode)
      }

      const schedStartIso = parseDeputyDatetime(schedStart)

      // ── Leave request  ────────────────────────────────────────────────────
      if (isLeave && leaveType) {
        const dateStartStr = schedStartIso ? schedStartIso.slice(0, 10) : parseDeputyDate(schedStart)
        const dateEndStr   = parseDeputyDatetime(schedFinish)?.slice(0, 10) ?? dateStartStr
        if (!dateStartStr) {
          warnings.push(`Leave row skipped — cannot parse date for ${displayName ?? exportCode ?? 'unknown'}`)
          continue
        }

        const leavePayload = {
          organization_id:  orgId,
          officer_id:       officerId,
          leave_type_name:  leaveType,
          leave_export_code: leaveCode ?? null,
          is_paid:          leavePaid !== undefined ? bool(leavePaid) : true,
          date_start:       dateStartStr,
          date_end:         dateEndStr!,
          total_hours:      num(schedDuration),
          status:           bool(schedApproved) ? 'approved' : 'pending',
          deputy_imported_at: new Date().toISOString(),
        }

        const { error: leaveErr } = await sb
          .from('leave_requests')
          .upsert(leavePayload, { onConflict: 'organization_id,deputy_leave_id', ignoreDuplicates: false })

        if (leaveErr) {
          warnings.push(`Leave upsert error: ${leaveErr.message}`)
        } else {
          leavesImported++
        }
        continue // leave rows don't also create a shift
      }

      // ── Roster shift (planned schedule)  ─────────────────────────────────
      if (schedStartIso) {
        const shiftDate = schedStartIso.slice(0, 10)

        const shiftPayload: Record<string, unknown> = {
          organization_id:       orgId,
          officer_id:            officerId,
          shift_date:            shiftDate,
          start_time:            schedStartIso,
          end_time:              parseDeputyDatetime(schedFinish),
          break_minutes:         0,
          status:                bool(schedApproved) ? 'confirmed' : 'published',
          deputy_area_name:      areaName || null,
          deputy_location_name:  locationName || null,
          location_code:         locationCode ?? null,
          area_export_code:      areaExportCode ?? null,
          schedule_cost:         num(schedCost),
          schedule_warning:      schedWarning?.trim() || null,
          pay_period_name:       payPeriod ?? null,
          deputy_approved:       bool(schedApproved),
          deputy_imported_at:    new Date().toISOString(),
        }

        const { error: shiftErr } = await sb
          .from('roster_shifts')
          .upsert(shiftPayload, { onConflict: 'organization_id,deputy_schedule_id', ignoreDuplicates: false })

        if (shiftErr) {
          warnings.push(`Roster shift upsert error: ${shiftErr.message}`)
        } else {
          schedulesImported++
        }
      }

      // ── Timesheet (officer_shifts)  ───────────────────────────────────────
      const tsStartIso = parseDeputyDatetime(tsStart)
      if (tsStartIso && officerId) {
        const tsPayload: Record<string, unknown> = {
          organization_id:    orgId,
          officer_id:         officerId,
          started_at:         tsStartIso,
          ended_at:           parseDeputyDatetime(tsFinish),
          employee_comment:   empComment ?? null,
          timesheet_cost:     num(tsCost),
          is_in_progress:     bool(isInProgress),
          auto_rounded:       bool(autoRounded),
          discarded:          bool(discarded),
          deputy_imported_at: new Date().toISOString(),
        }

        const { error: tsErr } = await sb
          .from('officer_shifts')
          .upsert(tsPayload, { onConflict: 'organization_id,deputy_timesheet_id', ignoreDuplicates: false })

        if (tsErr) {
          warnings.push(`Timesheet upsert error: ${tsErr.message}`)
        } else {
          timesheetsImported++
        }
      }
    }

    // ── Response ──────────────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        rows_processed:      rows.length,
        employees_matched:   employeesMatched,
        locations_ensured:   locationsEnsured,
        schedules_imported:  schedulesImported,
        leaves_imported:     leavesImported,
        timesheets_imported: timesheetsImported,
        warnings,
      }),
      { headers: responseHeaders },
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('deputy-roster-import error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: responseHeaders })
  }
})
