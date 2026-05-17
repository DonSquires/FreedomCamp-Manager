#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

const HELP_TEXT = `
Monitor service-agreement legacy gaps and compute closure eligibility.

Rule:
- A gap can be considered closed only when:
  1) a signed active service agreement exists, and
  2) a service-agreement document has been loaded and passes basic validation.

Usage:
  node scripts/bob-monitor-service-agreement-gaps.mjs [--organization <name>] [--outDir <path>]

Options:
  --organization <name>   Restrict to one organization name.
  --outDir <path>         Output directory. Default: tmp/docs/storage-review/onboarding-readiness
  --help                  Show help.
`

function parseArgs(argv) {
  const getArg = (flag) => {
    const idx = argv.indexOf(flag)
    if (idx === -1) return ''
    return String(argv[idx + 1] || '').trim()
  }

  return {
    help: argv.includes('--help') || argv.includes('-h'),
    organization: getArg('--organization'),
    outDir: getArg('--outDir') || 'tmp/docs/storage-review/onboarding-readiness',
  }
}

function normalizeOrgType(value) {
  return String(value || '').trim().toLowerCase()
}

function isClientLikeOrg(org) {
  const type = normalizeOrgType(org.organization_type)
  return type === 'client' || type === 'operator'
}

function isValidAgreementDocument(doc) {
  const docType = String(doc.document_type || '').trim().toLowerCase()
  const name = String(doc.document_name || '').trim().toLowerCase()
  const mime = String(doc.mime_type || '').trim().toLowerCase()
  const url = String(doc.document_url || '').trim()

  const typeLooksRight =
    docType.includes('service_agreement') ||
    docType.includes('agreement') ||
    docType.includes('contract') ||
    name.includes('agreement') ||
    name.includes('contract')

  const mimeLooksRight = !mime || mime.includes('pdf') || mime.includes('msword') || mime.includes('officedocument')

  return Boolean(url && typeLooksRight && mimeLooksRight && doc.is_current === true)
}

function activeSignedAgreementExists(agreements) {
  return agreements.some((a) => {
    const statusActive = String(a.status || '').toLowerCase() === 'active' || a.is_active === true
    const signed = a.is_signed === true
    const notExpired = !a.active_to || String(a.active_to) >= new Date().toISOString().slice(0, 10)
    return statusActive && signed && notExpired
  })
}

function activeAgreementExistsLegacy(agreements) {
  return agreements.some((a) => {
    const statusActive = String(a.status || '').toLowerCase() === 'active' || a.is_active === true
    const notExpired = !a.active_to || String(a.active_to) >= new Date().toISOString().slice(0, 10)
    return statusActive && notExpired
  })
}

function parseIsoDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function daysBetween(fromDate, toDate) {
  const ms = toDate.getTime() - fromDate.getTime()
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

function startOfNextMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
}

function agreementLifecycle(agreement) {
  const now = new Date()
  const start = parseIsoDate(agreement.active_from) || parseIsoDate(agreement.start_date) || parseIsoDate(agreement.created_at)
  const end = parseIsoDate(agreement.active_to) || parseIsoDate(agreement.end_date)
  const autoRenew = agreement.auto_renew === true
  const renewalNoticeDays = Number.isFinite(Number(agreement.renewal_notice_days))
    ? Number(agreement.renewal_notice_days)
    : 90

  const durationDays = start && end ? Math.max(1, daysBetween(start, end)) : null
  const isShortTerm = durationDays != null && durationDays <= 183
  const termBand = durationDays == null ? 'open_ended_or_unknown' : isShortTerm ? 'short_term_1_to_6_months' : 'long_running_over_6_months'

  const daysToExpiry = end ? daysBetween(now, end) : null
  const weeksToExpiry = daysToExpiry == null ? null : Math.ceil(daysToExpiry / 7)

  let countdownMode = 'none'
  let countdownValue = null
  let countdownUnit = null
  let countdownNote = 'No fixed expiry date available.'

  if (end) {
    if (isShortTerm) {
      countdownMode = 'short_term_weekly'
      countdownValue = weeksToExpiry
      countdownUnit = 'weeks'
      countdownNote = daysToExpiry < 0
        ? `Expired ${Math.abs(daysToExpiry)} day(s) ago.`
        : `${weeksToExpiry} week(s) remaining until expiry.`
    } else {
      countdownMode = 'long_term_3_month_window'
      countdownValue = daysToExpiry
      countdownUnit = 'days'
      if (daysToExpiry > 90) {
        countdownNote = `Outside 3-month window; window starts in ${daysToExpiry - 90} day(s).`
      } else if (daysToExpiry >= 0) {
        countdownNote = `${daysToExpiry} day(s) remaining in 3-month countdown window.`
      } else {
        countdownNote = `Expired ${Math.abs(daysToExpiry)} day(s) ago.`
      }
    }
  }

  const nextMonthlyReview = startOfNextMonth(now).toISOString().slice(0, 10)
  let monthlyRolloverStatus = 'monitor'
  if (end && daysToExpiry < 0) monthlyRolloverStatus = 'expired'
  else if (end && daysToExpiry <= 30) monthlyRolloverStatus = 'due_this_month'
  else if (autoRenew) monthlyRolloverStatus = 'auto_renew_monitor'

  const renewalDueDate = end
    ? new Date(end.getTime() - renewalNoticeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : null

  return {
    term_band: termBand,
    duration_days: durationDays,
    agreement_end_date: end ? end.toISOString().slice(0, 10) : null,
    days_to_expiry: daysToExpiry,
    weeks_to_expiry: weeksToExpiry,
    countdown_mode: countdownMode,
    countdown_value: countdownValue,
    countdown_unit: countdownUnit,
    countdown_note: countdownNote,
    monthly_rollover_status: monthlyRolloverStatus,
    next_monthly_review_date: nextMonthlyReview,
    auto_renew: autoRenew,
    renewal_notice_days: renewalNoticeDays,
    renewal_due_date: renewalDueDate,
  }
}

function computeExpirySlaAlert(lifecycle) {
  const termBand = lifecycle.term_band
  const days = lifecycle.days_to_expiry
  const weeks = lifecycle.weeks_to_expiry

  if (termBand === 'no_active_agreement') {
    return {
      level: 'warning',
      reason: 'No active agreement available for expiry SLA monitoring.',
    }
  }

  if (days != null && days < 0) {
    return {
      level: 'critical',
      reason: `Agreement expired ${Math.abs(days)} day(s) ago.`,
    }
  }

  if (termBand === 'long_running_over_6_months') {
    if (days == null) {
      return {
        level: 'warning',
        reason: 'Long-running agreement missing end date; cannot start 3-month countdown window.',
      }
    }
    if (days <= 30) {
      return {
        level: 'critical',
        reason: `Long-running agreement inside 30-day critical window (${days} day(s) left).`,
      }
    }
    if (days <= 90) {
      return {
        level: 'warning',
        reason: `Long-running agreement inside 3-month warning window (${days} day(s) left).`,
      }
    }
    return {
      level: 'ok',
      reason: `Long-running agreement outside warning window (${days} day(s) left).`,
    }
  }

  if (termBand === 'short_term_1_to_6_months') {
    if (weeks == null) {
      return {
        level: 'warning',
        reason: 'Short-term agreement missing end date; cannot compute weekly countdown.',
      }
    }
    if (weeks <= 2) {
      return {
        level: 'critical',
        reason: `Short-term agreement inside 2-week critical window (${weeks} week(s) left).`,
      }
    }
    if (weeks <= 4) {
      return {
        level: 'warning',
        reason: `Short-term agreement inside 4-week warning window (${weeks} week(s) left).`,
      }
    }
    return {
      level: 'ok',
      reason: `Short-term agreement outside warning window (${weeks} week(s) left).`,
    }
  }

  return {
    level: 'warning',
    reason: 'Agreement term is open-ended/unknown; month-by-month rollover monitoring required.',
  }
}

function selectBestAgreementForLifecycle(agreements) {
  const active = agreements.filter((a) => String(a.status || '').toLowerCase() === 'active' || a.is_active === true)
  if (!active.length) return null
  const withEnd = active.filter((a) => a.active_to || a.end_date)
  const candidatePool = withEnd.length ? withEnd : active
  return [...candidatePool].sort((a, b) => {
    const aEnd = String(a.active_to || a.end_date || '')
    const bEnd = String(b.active_to || b.end_date || '')
    if (aEnd !== bEnd) return aEnd.localeCompare(bEnd)
    const aCreated = String(a.created_at || '')
    const bCreated = String(b.created_at || '')
    return bCreated.localeCompare(aCreated)
  })[0]
}

async function loadAgreements(supabase) {
  const attempts = [
    {
      select: 'id,organization_id,client_org_id,name,status,is_active,active_from,active_to,start_date,end_date,created_at,is_signed,signed_at,auto_renew,renewal_notice_days',
      supportsSignedAgreement: true,
    },
    {
      select: 'id,organization_id,client_org_id,name,status,is_active,active_from,active_to,start_date,end_date,created_at,auto_renew,renewal_notice_days',
      supportsSignedAgreement: false,
    },
    {
      select: 'id,organization_id,client_org_id,name,status,is_active,active_to,created_at',
      supportsSignedAgreement: false,
    },
  ]

  for (const attempt of attempts) {
    const query = await supabase.from('service_agreements').select(attempt.select)
    if (!query.error) {
      return { rows: query.data || [], supportsSignedAgreement: attempt.supportsSignedAgreement }
    }
  }

  const fallback = await supabase.from('service_agreements').select('id')
  throw new Error(`Failed loading service_agreements: ${fallback.error?.message || 'Unknown error'}`)
}

function toMarkdown(report) {
  const lines = []
  lines.push('# Bob Service Agreement Gap Monitor')
  lines.push('')
  lines.push(`- generated_at: ${report.generated_at}`)
  lines.push(`- organization_filter: ${report.organization_filter || '(none)'}`)
  lines.push(`- signed_schema_supported: ${report.signed_schema_supported}`)
  lines.push(`- open_gaps: ${report.summary.open_gaps}`)
  lines.push(`- closable_gaps: ${report.summary.closable_gaps}`)
  lines.push(`- long_term_agreements: ${report.summary.long_term_agreements}`)
  lines.push(`- short_term_agreements: ${report.summary.short_term_agreements}`)
  lines.push(`- expiry_sla_critical: ${report.summary.expiry_sla_critical}`)
  lines.push(`- expiry_sla_warning: ${report.summary.expiry_sla_warning}`)
  lines.push(`- expiry_sla_ok: ${report.summary.expiry_sla_ok}`)
  lines.push('')
  lines.push('## Gap Status')
  lines.push('')

  if (!report.rows.length) {
    lines.push('- No client/operator organizations found.')
    lines.push('')
    return `${lines.join('\n')}\n`
  }

  for (const row of report.rows) {
    lines.push(`- ${row.organization_name} (${row.organization_id})`)
    lines.push(`  - gap_status: ${row.gap_status}`)
    lines.push(`  - closure_eligible: ${row.closure_eligible}`)
    lines.push(`  - signed_agreement_present: ${row.signed_agreement_present}`)
    lines.push(`  - valid_agreement_document_loaded: ${row.valid_agreement_document_loaded}`)
    lines.push(`  - term_band: ${row.term_band}`)
    lines.push(`  - agreement_end_date: ${row.agreement_end_date || 'n/a'}`)
    lines.push(`  - countdown: ${row.countdown_value == null ? 'n/a' : `${row.countdown_value} ${row.countdown_unit || ''}`.trim()}`)
    lines.push(`  - countdown_note: ${row.countdown_note}`)
    lines.push(`  - monthly_rollover_status: ${row.monthly_rollover_status}`)
    lines.push(`  - next_monthly_review_date: ${row.next_monthly_review_date}`)
    lines.push(`  - expiry_sla_alert_level: ${row.expiry_sla_alert_level}`)
    lines.push(`  - expiry_sla_alert_reason: ${row.expiry_sla_alert_reason}`)
    lines.push(`  - bob_validation_note: ${row.bob_validation_note}`)
  }

  lines.push('')
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  loadLocalEnv()
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let orgQuery = supabase
    .from('organizations')
    .select('id,name,organization_type,is_active')
    .eq('is_active', true)

  if (args.organization) orgQuery = orgQuery.eq('name', args.organization)

  const { data: organizations, error: orgError } = await orgQuery.order('name', { ascending: true })
  if (orgError) throw new Error(`Failed loading organizations: ${orgError.message}`)

  const agreementLoad = await loadAgreements(supabase)
  const agreements = agreementLoad.rows

  const { data: docs, error: docsError } = await supabase
    .from('contractor_documents')
    .select('id,organization_id,document_name,document_type,document_url,mime_type,is_current,created_at,expiry_date')
    .eq('is_current', true)

  if (docsError) throw new Error(`Failed loading contractor_documents: ${docsError.message}`)

  const agreementsByOrg = new Map()
  for (const a of agreements) {
    for (const key of [a.organization_id, a.client_org_id].filter(Boolean)) {
      if (!agreementsByOrg.has(key)) agreementsByOrg.set(key, [])
      agreementsByOrg.get(key).push(a)
    }
  }

  const docsByOrg = new Map()
  for (const d of docs || []) {
    if (!docsByOrg.has(d.organization_id)) docsByOrg.set(d.organization_id, [])
    docsByOrg.get(d.organization_id).push(d)
  }

  const rows = []
  for (const org of (organizations || []).filter(isClientLikeOrg)) {
    const orgAgreements = agreementsByOrg.get(org.id) || []
    const orgDocs = docsByOrg.get(org.id) || []
    const bestAgreement = selectBestAgreementForLifecycle(orgAgreements)
    const lifecycle = bestAgreement ? agreementLifecycle(bestAgreement) : {
      term_band: 'no_active_agreement',
      duration_days: null,
      agreement_end_date: null,
      days_to_expiry: null,
      weeks_to_expiry: null,
      countdown_mode: 'none',
      countdown_value: null,
      countdown_unit: null,
      countdown_note: 'No active agreement available for countdown.',
      monthly_rollover_status: 'monitor',
      next_monthly_review_date: startOfNextMonth(new Date()).toISOString().slice(0, 10),
      auto_renew: false,
      renewal_notice_days: null,
      renewal_due_date: null,
    }
    const expirySla = computeExpirySlaAlert(lifecycle)

    const signedAgreementPresent = agreementLoad.supportsSignedAgreement
      ? activeSignedAgreementExists(orgAgreements)
      : activeAgreementExistsLegacy(orgAgreements)

    const validDocs = orgDocs.filter(isValidAgreementDocument)
    const validDocLoaded = validDocs.length > 0

    const closureEligible = signedAgreementPresent && validDocLoaded
    const gapStatus = closureEligible ? 'closed' : 'open'

    let validationNote = ''
    if (!signedAgreementPresent && !validDocLoaded) {
      validationNote = 'Missing signed active agreement and validated agreement document.'
    } else if (!signedAgreementPresent) {
      validationNote = 'Agreement document loaded, but signed active agreement record is missing.'
    } else if (!validDocLoaded) {
      validationNote = 'Signed active agreement exists, but no validated agreement document is loaded.'
    } else {
      validationNote = 'Closure conditions satisfied.'
    }

    rows.push({
      organization_id: org.id,
      organization_name: org.name,
      gap_status: gapStatus,
      closure_eligible: closureEligible,
      closure_rule: 'Requires signed active agreement record and validated loaded service agreement document.',
      signed_agreement_present: signedAgreementPresent,
      valid_agreement_document_loaded: validDocLoaded,
      supporting_document_count: validDocs.length,
      agreement_id_for_countdown: bestAgreement?.id || null,
      term_band: lifecycle.term_band,
      duration_days: lifecycle.duration_days,
      agreement_end_date: lifecycle.agreement_end_date,
      days_to_expiry: lifecycle.days_to_expiry,
      weeks_to_expiry: lifecycle.weeks_to_expiry,
      countdown_mode: lifecycle.countdown_mode,
      countdown_value: lifecycle.countdown_value,
      countdown_unit: lifecycle.countdown_unit,
      countdown_note: lifecycle.countdown_note,
      monthly_rollover_status: lifecycle.monthly_rollover_status,
      next_monthly_review_date: lifecycle.next_monthly_review_date,
      auto_renew: lifecycle.auto_renew,
      renewal_notice_days: lifecycle.renewal_notice_days,
      renewal_due_date: lifecycle.renewal_due_date,
      expiry_sla_alert_level: expirySla.level,
      expiry_sla_alert_reason: expirySla.reason,
      signed_schema_supported: agreementLoad.supportsSignedAgreement,
      bob_validation_note: validationNote,
      recommended_action: closureEligible
        ? 'Close gap and archive monitoring item.'
        : 'Keep open; Bob must request/upload and validate signed service agreement document.',
    })
  }

  rows.sort((a, b) => {
    if (a.gap_status !== b.gap_status) return a.gap_status === 'open' ? -1 : 1
    return a.organization_name.localeCompare(b.organization_name)
  })

  const summary = {
    organizations_monitored: rows.length,
    open_gaps: rows.filter((r) => r.gap_status === 'open').length,
    closable_gaps: rows.filter((r) => r.closure_eligible).length,
    long_term_agreements: rows.filter((r) => r.term_band === 'long_running_over_6_months').length,
    short_term_agreements: rows.filter((r) => r.term_band === 'short_term_1_to_6_months').length,
    expiry_sla_critical: rows.filter((r) => r.expiry_sla_alert_level === 'critical').length,
    expiry_sla_warning: rows.filter((r) => r.expiry_sla_alert_level === 'warning').length,
    expiry_sla_ok: rows.filter((r) => r.expiry_sla_alert_level === 'ok').length,
  }

  const report = {
    generated_at: new Date().toISOString(),
    organization_filter: args.organization || null,
    signed_schema_supported: agreementLoad.supportsSignedAgreement,
    summary,
    rows,
  }

  await fs.mkdir(args.outDir, { recursive: true })
  const jsonPath = path.join(args.outDir, 'bob-service-agreement-gap-monitor.json')
  const mdPath = path.join(args.outDir, 'bob-service-agreement-gap-monitor.md')

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2))
  await fs.writeFile(mdPath, toMarkdown(report))

  console.log(`Bob gap monitor report written: ${jsonPath}`)
  console.log(`Bob gap monitor report written: ${mdPath}`)
  console.log(`Open gaps: ${summary.open_gaps}, Closable gaps: ${summary.closable_gaps}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
