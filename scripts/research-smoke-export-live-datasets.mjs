#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadLocalEnv } from './load-local-env.mjs'

function getArg(name, fallback = '') {
  const key = `--${name}`
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '')
    if (token === key) return String(argv[i + 1] || fallback)
    if (token.startsWith(`${key}=`)) return token.slice(key.length + 1)
  }
  return fallback
}

function parseNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeAction(value) {
  const action = String(value || '').trim().toLowerCase()
  if (!action) return 'unknown'
  if (action.includes('no action')) return 'no_action'
  if (action.includes('verbal')) return 'verbal_warning'
  if (action.includes('abatement')) return 'abatement_notice'
  if (action.includes('infringement')) return 'infringement_notice'
  if (action.includes('prosec')) return 'prosecution_referral'
  return action.replace(/\s+/g, '_')
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function toNum(value, fallback = null) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function boolFrom(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function deriveExcessive(assessment) {
  if (typeof assessment?.exceeds_limit === 'boolean') {
    return assessment.exceeds_limit
  }

  const opacity = String(assessment?.smoke_opacity || '').toLowerCase()
  const continuous = boolFrom(assessment?.smoke_continuous, false)
  const duration = toNum(assessment?.smoke_duration_minutes, 0)
  const prohibited = boolFrom(assessment?.prohibited_materials_suspected, false)
  const drifting = boolFrom(assessment?.smoke_affecting_neighbors, false)

  // Excessive if: heavy/very_heavy/black opacity, continuous, long duration, prohibited materials, or affecting neighbors
  const isExcessive =
    ['heavy', 'very_heavy', 'black'].includes(opacity) ||
    (continuous && duration > 30) ||
    prohibited ||
    (drifting && duration > 15)

  return isExcessive
}

function classifySmokeProfile(assessment, relatedJob) {
  const opacity = String(assessment?.smoke_opacity || 'light').toLowerCase()
  const color = String(assessment?.smoke_color || 'white').toLowerCase()
  const continuous = boolFrom(assessment?.smoke_continuous, false)
  const duration = toNum(assessment?.smoke_duration_minutes, 5)
  const fireType = String(assessment?.fire_type || 'unknown').toLowerCase()
  const prohibited = boolFrom(assessment?.prohibited_materials_suspected, false)
  const drifting = boolFrom(assessment?.smoke_affecting_neighbors, false)
  const affectingRoad = boolFrom(assessment?.smoke_affecting_road, false)
  const odor = String(assessment?.odor_description || 'none').toLowerCase()
  const offensiveOdor = boolFrom(assessment?.odor_offensive, false)
  const windSpeed = toNum(assessment?.wind_speed_kmh, 0)

  const priorNotices = toNum(relatedJob?.prior_notice_count, 0)
  const hasPriorAbatement = boolFrom(relatedJob?.has_prior_abatement, false)
  const warned = boolFrom(relatedJob?.responsible_person_warned, false) || priorNotices > 0

  // ── Opacity scoring (0–1) ─────────────────────────────────────────
  // light=0.1, moderate=0.4, heavy=0.7, very_heavy=0.85, black=1.0
  const opacityScore = opacity === 'black' ? 1.0 : opacity === 'very_heavy' ? 0.85 : opacity === 'heavy' ? 0.7 : opacity === 'moderate' ? 0.4 : 0.1

  // ── Color toxicity signal (0–1) ──────────────────────────────────
  // black/dark grey = high toxicity, white/light grey = benign (wood smoke)
  const colorToxicity = ['black', 'dark_grey', 'brown', 'yellow'].includes(color) ? 0.7 : ['grey'].includes(color) ? 0.4 : 0.1

  // ── Prohibited materials flag ────────────────────────────────────
  // Burning treated timber, plastics, rubber → non-compliant regardless of smoke appearance
  const prohibitedScore = prohibited ? 1.0 : 0.0

  // ── Duration baseline (0–1) ──────────────────────────────────────
  // <5min smoke = 0.1, 5-15min = 0.3, 15-30min = 0.6, 30-60min = 0.85, >60min = 1.0
  const durationScore = duration > 60 ? 1.0 : duration > 30 ? 0.85 : duration > 15 ? 0.6 : duration > 5 ? 0.3 : 0.1

  // ── Continuity penalty ───────────────────────────────────────────
  // Continuous smoke is worse than intermittent; compounds enforcement urgency
  const continuityPenalty = continuous ? 0.3 : 0.0

  // ── Neighbor impact (0–1) ────────────────────────────────────────
  // Drifting smoke affecting neighbors or road visibility = public nuisance
  const driftingScore = affectingRoad ? 1.0 : drifting ? 0.7 : 0.0

  // ── Odor offensiveness (0–1) ────────────────────────────────────
  // Chemical/noxious smells indicate non-compliant burning
  const odorScore = offensiveOdor ? (odor.includes('chem') || odor.includes('noxious') ? 1.0 : 0.6) : 0.0

  // ── Composite "SFA" (Smoke Force Assessment) score ────────────────
  // Combines opacity, toxicity, prohibited materials, duration, drifting, odor
  // Range 0–10 maps to: no_action [0-2], verbal_warning [2-5], abatement [5-7.5], infringement [7.5-9], prosecution [9+]
  const sfaScore =
    opacityScore * 2.5 + // Base smoke visibility (0–2.5)
    colorToxicity * 1.5 + // Color toxicity signal (0–1.5)
    prohibitedScore * 2.0 + // Prohibited materials (0–2.0)
    durationScore * 2.0 + // Duration baseline (0–2.0)
    continuityPenalty * 1.0 + // Continuous penalty (0–1.0)
    driftingScore * 1.0 + // Neighbor drift impact (0–1.0)
    odorScore * 0.5 // Odor offensiveness (0–0.5)

  // ── Fire type classification ─────────────────────────────────────
  const isResidentialDomestic = fireType === 'residential_domestic'
  const isBurnOff = fireType === 'burn_off'
  const isIndustrial = fireType === 'industrial'
  const isOpenFire = fireType === 'open_fire'

  // ── Derived flags for policy routing ──────────────────────────────
  const isNaiveBurnOff = isBurnOff && !prohibited && opacityScore < 0.7 && duration < 30
  const isDubiousBurnOff = isBurnOff && (prohibited || opacityScore >= 0.7 || duration > 30)
  const isResidentialAbuse = (isResidentialDomestic || isOpenFire) && prohibited
  const isIndustrialViolation = isIndustrial && (colorToxicity >= 0.4 || driftingScore > 0)

  return {
    sfaScore: Number(sfaScore.toFixed(4)),
    opacityScore: Number(opacityScore.toFixed(4)),
    colorToxicity: Number(colorToxicity.toFixed(4)),
    prohibitedScore: Number(prohibitedScore.toFixed(4)),
    durationScore: Number(durationScore.toFixed(4)),
    continuityPenalty: Number(continuityPenalty.toFixed(4)),
    driftingScore: Number(driftingScore.toFixed(4)),
    odorScore: Number(odorScore.toFixed(4)),
    // Derived routing flags
    isNaiveBurnOff,
    isDubiousBurnOff,
    isResidentialAbuse,
    isIndustrialViolation,
  }
}

function policyRecommendedAction(assessment, profile, relatedJob, variantName) {
  const opacity = String(assessment?.smoke_opacity || 'light').toLowerCase()
  const continuous = boolFrom(assessment?.smoke_continuous, false)
  const duration = toNum(assessment?.smoke_duration_minutes, 5)
  const fireType = String(assessment?.fire_type || 'unknown').toLowerCase()
  const prohibited = boolFrom(assessment?.prohibited_materials_suspected, false)
  const drifting = boolFrom(assessment?.smoke_affecting_neighbors, false)
  const affectingRoad = boolFrom(assessment?.smoke_affecting_road, false)

  const priorNotices = toNum(relatedJob?.prior_notice_count, 0)
  const hasPriorAbatement = boolFrom(relatedJob?.has_prior_abatement, false)
  const warned = boolFrom(relatedJob?.responsible_person_warned, false) || priorNotices > 0
  const hasPriorEnd = boolFrom(relatedJob?.has_prior_end, false)

  const variantBias = variantName === 'sfa_contextual' ? 0.15 : variantName === 'sfa_with_duration' ? 0.08 : 0

  // ── Hard gates ─────────────────────────────────────────────────────
  // Prohibited materials (treated timber, plastic, rubber, chemicals) → infringement/prosecution regardless of other factors
  if (prohibited && profile.sfaScore >= 6) {
    return warned || hasPriorAbatement ? 'prosecution_referral' : 'infringement_notice'
  }

  // Road obstruction (visibility hazard) → escalate quickly
  if (affectingRoad && duration > 10) {
    return warned || hasPriorAbatement ? 'infringement_notice' : 'abatement_notice'
  }

  // ── Residential abuse gate ──────────────────────────────────────────
  // Residential/open fire with prohibited materials → infringement
  if (profile.isResidentialAbuse) {
    return warned ? 'infringement_notice' : 'abatement_notice'
  }

  // ── Industrial violation gate ──────────────────────────────────────
  // Industrial with significant color toxicity or neighbor drift → abatement/infringement
  if (profile.isIndustrialViolation && profile.sfaScore >= 5) {
    return warned ? 'infringement_notice' : 'abatement_notice'
  }

  // ── Dubious burn-off gate ──────────────────────────────────────────
  // Burn-off that's too dark/long/prohibited → escalate from direction to abatement
  if (profile.isDubiousBurnOff) {
    return warned || hasPriorAbatement ? 'infringement_notice' : 'abatement_notice'
  }

  // ── Naive burn-off first-visit direction ──────────────────────────
  // Light-to-moderate smoke, short burn, compliant materials → direction_notice (first visit)
  if (
    profile.isNaiveBurnOff &&
    !warned &&
    !hasPriorAbatement &&
    profile.sfaScore < 5 &&
    duration < 25
  ) {
    return 'verbal_warning'
  }

  // ── SFA score escalation ─────────────────────────────────────────
  const adjustedScore = profile.sfaScore + variantBias + (warned ? 1.0 : 0)

  if (adjustedScore >= 9 || (hasPriorEnd && profile.sfaScore >= 7)) {
    return 'prosecution_referral'
  }

  if (adjustedScore >= 7.5 || (hasPriorAbatement && profile.sfaScore >= 6)) {
    return 'infringement_notice'
  }

  if (adjustedScore >= 5 || (warned && profile.sfaScore >= 4)) {
    return 'abatement_notice'
  }

  if (adjustedScore >= 2 || (profile.sfaScore >= 1 && duration > 15)) {
    return 'verbal_warning'
  }

  return 'no_action'
}

function buildAblationRecord(assessment, relatedJob) {
  const gtAction = normalizeAction(assessment?.recommended_action || '')
  const gtExcessive = deriveExcessive(assessment)

  const profile = classifySmokeProfile(assessment, relatedJob)

  const sfaOnly = {
    predicted_action: policyRecommendedAction(assessment, profile, relatedJob, 'sfa_only'),
    predicted_excessive: profile.sfaScore >= 5,
    confidence: Number(clamp(0.4 + profile.sfaScore / 15, 0.3, 0.95).toFixed(4)),
    human_override: false,
    decision_seconds: Math.round(clamp(30 + profile.sfaScore * 5, 20, 120)),
  }
  const sfaWithDuration = {
    predicted_action: policyRecommendedAction(assessment, profile, relatedJob, 'sfa_with_duration'),
    predicted_excessive: profile.sfaScore >= 4.5,
    confidence: Number(clamp(0.45 + profile.sfaScore / 14, 0.32, 0.96).toFixed(4)),
    human_override: false,
    decision_seconds: Math.round(clamp(28 + profile.sfaScore * 4.5, 18, 110)),
  }
  const sfaContextual = {
    predicted_action: policyRecommendedAction(assessment, profile, relatedJob, 'sfa_contextual'),
    predicted_excessive: profile.sfaScore >= 4.8,
    confidence: Number(clamp(0.5 + profile.sfaScore / 13, 0.35, 0.97).toFixed(4)),
    human_override: false,
    decision_seconds: Math.round(clamp(32 + profile.sfaScore * 4.8, 22, 125)),
  }

  sfaOnly.human_override = sfaOnly.predicted_action !== gtAction
  sfaWithDuration.human_override = sfaWithDuration.predicted_action !== gtAction
  sfaContextual.human_override = sfaContextual.predicted_action !== gtAction

  return {
    id: String(assessment?.id || ''),
    source: {
      assessed_at: assessment?.assessed_at || null,
      organization_id: assessment?.organization_id || null,
      smoke_job_id: assessment?.smoke_job_id || null,
      opacity: assessment?.smoke_opacity || null,
      color: assessment?.smoke_color || null,
      continuous: boolFrom(assessment?.smoke_continuous),
      duration_minutes: toNum(assessment?.smoke_duration_minutes),
      fire_type: assessment?.fire_type || null,
      prohibited_materials_suspected: boolFrom(assessment?.prohibited_materials_suspected),
      odor_description: assessment?.odor_description || null,
      odor_offensive: boolFrom(assessment?.odor_offensive),
      wind_speed_kmh: toNum(assessment?.wind_speed_kmh),
      smoke_drifting: boolFrom(assessment?.smoke_affecting_neighbors),
      smoke_affecting_road: boolFrom(assessment?.smoke_affecting_road),
      ai_confidence: toNum(assessment?.ai_confidence),
      sfa_score: profile.sfaScore,
      opacity_score: profile.opacityScore,
      color_toxicity: profile.colorToxicity,
      prohibited_score: profile.prohibitedScore,
      duration_score: profile.durationScore,
      continuity_penalty: profile.continuityPenalty,
      drifting_score: profile.driftingScore,
      odor_score: profile.odorScore,
      // Derived flags
      is_naive_burn_off: profile.isNaiveBurnOff,
      is_dubious_burn_off: profile.isDubiousBurnOff,
      is_residential_abuse: profile.isResidentialAbuse,
      is_industrial_violation: profile.isIndustrialViolation,
    },
    ground_truth_action: gtAction,
    ground_truth_excessive: gtExcessive,
    variants: {
      sfa_only: sfaOnly,
      sfa_with_duration: sfaWithDuration,
      sfa_contextual: sfaContextual,
    },
  }
}

async function fetchPagedRows({ baseUrl, apiKey, table, select, filters, pageSize }) {
  const all = []
  let offset = 0

  while (true) {
    const qs = new URLSearchParams({ select })
    qs.set('limit', String(pageSize))
    qs.set('offset', String(offset))

    for (const f of filters || []) {
      const [k, v] = f
      qs.set(k, v)
    }

    const endpoint = `${baseUrl}/rest/v1/${table}?${qs.toString()}`
    const res = await fetch(endpoint, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Failed to fetch ${table}: ${res.status} ${body}`)
    }

    const rows = await res.json()
    if (!Array.isArray(rows) || rows.length === 0) break

    all.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }

  return all
}

async function fetchWithSelectFallback({ baseUrl, apiKey, table, selectCandidates, filters, pageSize }) {
  let lastError = null

  for (const select of selectCandidates) {
    try {
      const rows = await fetchPagedRows({ baseUrl, apiKey, table, select, filters, pageSize })
      return { rows, select }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

async function main() {
  loadLocalEnv()

  const baseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const apiKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      '',
  ).trim()

  if (!baseUrl || !apiKey) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY.')
  }

  const windowDays = Math.max(1, parseNumber(getArg('window-days', '90'), 90))
  const pageSize = Math.max(100, parseNumber(getArg('page-size', '1000'), 1000))

  const ablationOut = resolve(process.cwd(), getArg('ablation-out', 'data/smoke-ablation-evals.jsonl'))

  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  const [jobsResult, assessmentsResult] = await Promise.all([
    fetchWithSelectFallback({
      baseUrl,
      apiKey,
      table: 'smoke_jobs',
      selectCandidates: [
        'id,organization_id,created_at,updated_at,completed_at,status,assigned_to,prior_notice_count,has_prior_end,has_prior_abatement,responsible_person_warned',
        'id,organization_id,created_at,updated_at,completed_at,status,assigned_to,prior_notice_count,has_prior_end,has_prior_abatement',
        'id,organization_id,created_at,updated_at,completed_at,status,assigned_to',
      ],
      filters: [['created_at', `gte.${windowStart}`], ['order', 'created_at.desc']],
      pageSize,
    }),
    fetchWithSelectFallback({
      baseUrl,
      apiKey,
      table: 'smoke_assessments',
      selectCandidates: [
        'id,organization_id,smoke_job_id,assessed_at,address,smoke_opacity,smoke_color,smoke_continuous,smoke_duration_minutes,fire_type,prohibited_materials_suspected,odor_description,odor_offensive,wind_speed_kmh,smoke_affecting_neighbors,smoke_affecting_road,ai_confidence,recommended_action',
        'id,organization_id,smoke_job_id,assessed_at,smoke_opacity,smoke_color,smoke_continuous,smoke_duration_minutes,fire_type,prohibited_materials_suspected,odor_description,odor_offensive,wind_speed_kmh,smoke_affecting_neighbors,smoke_affecting_road,ai_confidence,recommended_action',
        'id,organization_id,smoke_job_id,assessed_at,smoke_opacity,smoke_continuous,smoke_duration_minutes,fire_type,prohibited_materials_suspected,ai_confidence,recommended_action',
      ],
      filters: [['assessed_at', `gte.${windowStart}`], ['order', 'assessed_at.desc']],
      pageSize,
    }),
  ])

  const jobs = jobsResult.rows
  const assessments = assessmentsResult.rows

  mkdirSync(dirname(ablationOut), { recursive: true })

  const jobById = new Map((jobs || []).map((j) => [j.id, j]))
  const ablationRecords = assessments
    .map((assessment) => buildAblationRecord(assessment, jobById.get(assessment?.smoke_job_id) || null))
    .filter((r) => r.id)
  writeFileSync(ablationOut, `${ablationRecords.map((r) => JSON.stringify(r)).join('\n')}${ablationRecords.length ? '\n' : ''}`, 'utf8')

  console.log(`smoke_assessments=${assessments.length}`)
  console.log(`smoke_jobs=${jobs.length}`)
  console.log(`ablation_dataset=${ablationOut}`)
  console.log(`ablation_records=${ablationRecords.length}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
