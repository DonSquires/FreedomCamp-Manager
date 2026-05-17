#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadLocalEnv } from './load-local-env.mjs'

loadLocalEnv()

const HELP_TEXT = `
Import service-provider contract profile seeds into runtime tables.

Usage:
  node scripts/import-service-provider-profile.mjs [--file <seed.json>] [--organization <org name>] [--apply]

Options:
  --file           Path to seed JSON file. Defaults to Nelson profile seed.
  --organization   Override organization name from the seed file.
  --apply          Perform inserts/updates. Omit for dry-run.
  --help           Show this help text.
`

const DEFAULT_SEED = 'data/service-provider-profiles/nelson-city-council.contract-profile.seed.json'

function parseArgs(argv) {
  const getArgValue = (flag) => {
    const index = argv.indexOf(flag)
    if (index === -1) return ''
    return String(argv[index + 1] || '').trim()
  }

  const file = getArgValue('--file') || DEFAULT_SEED
  const organization = getArgValue('--organization')

  return {
    help: argv.includes('--help') || argv.includes('-h'),
    apply: argv.includes('--apply'),
    file,
    organization,
  }
}

function toAbsoluteFilePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath
  return path.join(process.cwd(), filePath)
}

function readSeed(seedPath) {
  const absolutePath = toAbsoluteFilePath(seedPath)
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Seed file not found: ${absolutePath}`)
  }

  const raw = fs.readFileSync(absolutePath, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in seed file ${absolutePath}: ${error?.message || String(error)}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Seed file must contain a JSON object.')
  }

  if (!String(parsed.organization || '').trim()) {
    throw new Error('Seed file must include organization.')
  }

  if (!String(parsed.profileCode || '').trim()) {
    throw new Error('Seed file must include profileCode.')
  }

  if (!Array.isArray(parsed.serviceAgreements) || parsed.serviceAgreements.length === 0) {
    throw new Error('Seed file must include a non-empty serviceAgreements array.')
  }

  return { parsed, absolutePath }
}

function normalizeAgreementType(value) {
  return String(value || '').trim() || 'other'
}

function normalizeLegacyServiceType(value) {
  const agreementType = normalizeAgreementType(value)
  const allowed = new Set([
    'guarding',
    'patrol',
    'freedom_camping',
    'parking',
    'noise_control',
    'biosecurity',
    'ems',
    'event_security',
    'access_control',
    'other',
  ])
  return allowed.has(agreementType) ? agreementType : 'other'
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

function normalizeText(value) {
  const text = String(value || '').trim()
  return text || null
}

async function findOrganizationByName(supabase, organizationName) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('name', organizationName)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to find organization ${organizationName}: ${error.message}`)
  }

  return data || null
}

async function upsertOrgModuleSubscription({
  supabase,
  organizationId,
  moduleKey,
  configPatch,
  dryRun,
}) {
  const { data: existing, error: lookupError } = await supabase
    .from('org_module_subscriptions')
    .select('id, config, is_active')
    .eq('organization_id', organizationId)
    .eq('module_key', moduleKey)
    .maybeSingle()

  if (lookupError) {
    throw new Error(`Failed loading module subscription (${moduleKey}): ${lookupError.message}`)
  }

  const mergedConfig = {
    ...(existing?.config && typeof existing.config === 'object' ? existing.config : {}),
    ...configPatch,
  }

  if (dryRun) {
    return { action: existing?.id ? 'update' : 'insert', id: existing?.id || '', config: mergedConfig }
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('org_module_subscriptions')
      .update({ config: mergedConfig, is_active: true, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (updateError) {
      throw new Error(`Failed updating module subscription (${moduleKey}): ${updateError.message}`)
    }
    return { action: 'update', id: existing.id, config: mergedConfig }
  }

  const { data: created, error: insertError } = await supabase
    .from('org_module_subscriptions')
    .insert({
      organization_id: organizationId,
      module_key: moduleKey,
      is_active: true,
      config: mergedConfig,
    })
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed inserting module subscription (${moduleKey}): ${insertError?.message || 'Unknown error'}`)
  }

  return { action: 'insert', id: created.id, config: mergedConfig }
}

async function findExistingAgreement(supabase, organizationId, name, referenceNumber) {
  let query = supabase
    .from('service_agreements')
    .select('id, name, reference_number')
    .eq('organization_id', organizationId)
    .eq('name', name)

  if (referenceNumber) {
    query = query.eq('reference_number', referenceNumber)
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(1)
  if (error) {
    throw new Error(`Failed finding service agreement ${name}: ${error.message}`)
  }

  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

async function upsertServiceAgreement({
  supabase,
  organizationId,
  clientOrgId,
  seed,
  agreement,
  dryRun,
}) {
  const referenceNumber = normalizeText(agreement.referenceNumber)
  const existing = await findExistingAgreement(supabase, organizationId, agreement.name, referenceNumber)
  const legacyServiceType = normalizeLegacyServiceType(agreement.agreementType)
  const derivedStartDate = normalizeText(agreement.startDate) || normalizeText(seed.sourceDate) || new Date().toISOString().slice(0, 10)
  const derivedEndDate = normalizeText(agreement.endDate)
  const agreementNumber = referenceNumber || `${String(seed.profileCode || 'profile').trim()}-${String(agreement.name || 'agreement').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
  const responseTimeMinutes = Array.isArray(agreement.obligations)
    ? agreement.obligations
        .map((obligation) => Number(obligation?.targetMinutes))
        .find((value) => Number.isFinite(value)) ?? null
    : null

  const payload = {
    organization_id: organizationId,
    client_org_id: clientOrgId,
    agreement_number: agreementNumber,
    service_type: legacyServiceType,
    start_date: derivedStartDate,
    end_date: derivedEndDate,
    status: 'active',
    response_time_minutes: responseTimeMinutes,
    name: String(agreement.name || '').trim(),
    reference_number: referenceNumber,
    agreement_type: normalizeAgreementType(agreement.agreementType),
    allows_client_submission: false,
    allows_auto_dispatch: false,
    default_sla_minutes: Number.isFinite(agreement.defaultSlaMinutes) ? Number(agreement.defaultSlaMinutes) : 60,
    default_priority: normalizeText(agreement.defaultPriority) || 'normal',
    client_portal_access_mode: normalizeText(seed.clientPortal?.accessMode) || 'transparency_only',
    client_portal_reports_enabled: normalizeBoolean(seed.clientPortal?.reportsEnabled, true),
    client_portal_finance_enabled: normalizeBoolean(seed.clientPortal?.financeEnabled, false),
    contract_profile_code: normalizeText(seed.profileCode),
    monthly_report_template_code: normalizeText(agreement.monthlyReportTemplateCode) || normalizeText(seed.monthlyReportTemplateCode),
    is_active: true,
  }

  if (!payload.name) {
    throw new Error('Agreement name is required in seed data.')
  }

  if (dryRun) {
    return { action: existing?.id ? 'update' : 'insert', id: existing?.id || '', payload }
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from('service_agreements')
      .update(payload)
      .eq('id', existing.id)
    if (updateError) {
      throw new Error(`Failed updating service agreement ${payload.name}: ${updateError.message}`)
    }
    return { action: 'update', id: existing.id, payload }
  }

  const { data: created, error: insertError } = await supabase
    .from('service_agreements')
    .insert(payload)
    .select('id')
    .single()

  if (insertError || !created?.id) {
    throw new Error(`Failed inserting service agreement ${payload.name}: ${insertError?.message || 'Unknown error'}`)
  }

  return { action: 'insert', id: created.id, payload }
}

async function upsertObligation({
  supabase,
  organizationId,
  clientOrgId,
  serviceAgreementId,
  obligation,
  defaultTemplateCode,
  dryRun,
}) {
  const obligationCode = String(obligation.obligationCode || '').trim()
  if (!obligationCode) {
    throw new Error('Each obligation must include obligationCode.')
  }

  const payload = {
    organization_id: organizationId,
    service_agreement_id: serviceAgreementId,
    client_org_id: clientOrgId,
    obligation_code: obligationCode,
    obligation_kind: normalizeText(obligation.obligationKind) || 'other',
    target_minutes: Number.isFinite(obligation.targetMinutes) ? Number(obligation.targetMinutes) : null,
    escalation_minutes: Number.isFinite(obligation.escalationMinutes) ? Number(obligation.escalationMinutes) : null,
    proof_artifact_types: Array.isArray(obligation.proofArtifactTypes)
      ? obligation.proofArtifactTypes.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
    report_template_code: normalizeText(obligation.reportTemplateCode) || normalizeText(defaultTemplateCode),
    rule_payload:
      obligation.rulePayload && typeof obligation.rulePayload === 'object'
        ? obligation.rulePayload
        : {},
    notes: normalizeText(obligation.notes),
    is_active: normalizeBoolean(obligation.isActive, true),
  }

  if (dryRun) {
    return { action: 'upsert', code: obligationCode }
  }

  const { error } = await supabase
    .from('service_agreement_obligations')
    .upsert(payload, { onConflict: 'service_agreement_id,obligation_code' })

  if (error) {
    throw new Error(`Failed upserting obligation ${obligationCode}: ${error.message}`)
  }

  return { action: 'upsert', code: obligationCode }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(HELP_TEXT.trim())
    return
  }

  const { parsed: seed, absolutePath } = readSeed(args.file)
  const organizationName = args.organization || String(seed.organization).trim()

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const dryRun = !args.apply
  const org = await findOrganizationByName(supabase, organizationName)
  if (!org?.id) {
    throw new Error(`Organization not found: ${organizationName}`)
  }

  console.log(`[${dryRun ? 'Dry run' : 'Apply'}] importing profile seed from ${absolutePath}`)
  console.log(`[${dryRun ? 'Dry run' : 'Apply'}] target organization: ${org.name} (${org.id})`)

  const reportingModuleResult = await upsertOrgModuleSubscription({
    supabase,
    organizationId: org.id,
    moduleKey: 'reporting',
    configPatch: {
      client_portal_reports_enabled: normalizeBoolean(seed.clientPortal?.reportsEnabled, true),
      contract_profile_code: normalizeText(seed.profileCode),
      monthly_report_template_code: normalizeText(seed.monthlyReportTemplateCode),
      profile_seed_source_date: normalizeText(seed.sourceDate),
    },
    dryRun,
  })

  const crmModuleResult = await upsertOrgModuleSubscription({
    supabase,
    organizationId: org.id,
    moduleKey: 'crm',
    configPatch: {
      client_portal_access_mode: normalizeText(seed.clientPortal?.accessMode) || 'transparency_only',
      client_portal_finance_enabled: normalizeBoolean(seed.clientPortal?.financeEnabled, false),
      contract_profile_code: normalizeText(seed.profileCode),
      profile_seed_source_date: normalizeText(seed.sourceDate),
    },
    dryRun,
  })

  console.log(`[${dryRun ? 'Plan' : 'Done'}] module reporting: ${reportingModuleResult.action}`)
  console.log(`[${dryRun ? 'Plan' : 'Done'}] module crm: ${crmModuleResult.action}`)

  const summary = {
    agreementsInserted: 0,
    agreementsUpdated: 0,
    obligationsUpserted: 0,
  }

  for (const agreement of seed.serviceAgreements) {
    const agreementResult = await upsertServiceAgreement({
      supabase,
      organizationId: org.id,
      clientOrgId: org.id,
      seed,
      agreement,
      dryRun,
    })

    if (agreementResult.action === 'insert') summary.agreementsInserted += 1
    if (agreementResult.action === 'update') summary.agreementsUpdated += 1

    const effectiveAgreementId = agreementResult.id
    console.log(`[${dryRun ? 'Plan' : 'Done'}] agreement ${agreement.name}: ${agreementResult.action}`)

    const obligations = Array.isArray(agreement.obligations) ? agreement.obligations : []
    for (const obligation of obligations) {
      if (dryRun && !effectiveAgreementId) {
        summary.obligationsUpserted += 1
        console.log(`[Plan] obligation ${obligation.obligationCode}: upsert`)
        continue
      }

      await upsertObligation({
        supabase,
        organizationId: org.id,
        clientOrgId: org.id,
        serviceAgreementId: effectiveAgreementId,
        obligation,
        defaultTemplateCode: agreement.monthlyReportTemplateCode || seed.monthlyReportTemplateCode,
        dryRun,
      })
      summary.obligationsUpserted += 1
      console.log(`[${dryRun ? 'Plan' : 'Done'}] obligation ${obligation.obligationCode}: upsert`)
    }
  }

  console.log('---')
  console.log(`[${dryRun ? 'Dry run summary' : 'Import summary'}] agreements inserted=${summary.agreementsInserted} updated=${summary.agreementsUpdated} obligations upserted=${summary.obligationsUpserted}`)
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})