#!/usr/bin/env node

/**
 * Generate mock smoke ablation dataset for policy testing
 * Directly creates JSONL with all necessary fields
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function toNum(v, fallback = null) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function boolFrom(v, fallback = false) {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return fallback
}

function classifySmokeProfile(assessment) {
  const opacity = String(assessment?.smoke_opacity || 'light').toLowerCase()
  const color = String(assessment?.smoke_color || 'white').toLowerCase()
  const continuous = boolFrom(assessment?.smoke_continuous, false)
  const duration = toNum(assessment?.smoke_duration_minutes, 5)
  const fireType = String(assessment?.fire_type || 'unknown').toLowerCase()
  const prohibited = boolFrom(assessment?.prohibited_materials_suspected, false)
  const drifting = boolFrom(assessment?.smoke_affecting_neighbors, false)
  const affectingRoad = boolFrom(assessment?.smoke_affecting_road, false)
  const offensiveOdor = boolFrom(assessment?.odor_offensive, false)

  // Opacity scoring
  const opacityScore = opacity === 'black' ? 1.0 : opacity === 'very_heavy' ? 0.85 : opacity === 'heavy' ? 0.7 : opacity === 'moderate' ? 0.4 : 0.1

  // Color toxicity
  const colorToxicity = ['black', 'dark_grey', 'brown', 'yellow'].includes(color) ? 0.7 : ['grey'].includes(color) ? 0.4 : 0.1

  // Prohibited materials
  const prohibitedScore = prohibited ? 1.0 : 0.0

  // Duration
  const durationScore = duration > 60 ? 1.0 : duration > 30 ? 0.85 : duration > 15 ? 0.6 : duration > 5 ? 0.3 : 0.1

  // Continuity
  const continuityPenalty = continuous ? 0.3 : 0.0

  // Drifting
  const driftingScore = affectingRoad ? 1.0 : drifting ? 0.7 : 0.0

  // Odor
  const odorScore = offensiveOdor ? 0.6 : 0.0

  // SFA Score
  const sfaScore =
    opacityScore * 2.5 +
    colorToxicity * 1.5 +
    prohibitedScore * 2.0 +
    durationScore * 2.0 +
    continuityPenalty * 1.0 +
    driftingScore * 1.0 +
    odorScore * 0.5

  const isBurnOff = fireType === 'burn_off'
  const isNaiveBurnOff = isBurnOff && !prohibited && opacityScore < 0.7 && duration < 30
  const isDubiousBurnOff = isBurnOff && (prohibited || opacityScore >= 0.7 || duration > 30)

  return {
    sfaScore: Number(sfaScore.toFixed(4)),
    opacityScore: Number(opacityScore.toFixed(4)),
    colorToxicity: Number(colorToxicity.toFixed(4)),
    isNaiveBurnOff,
    isDubiousBurnOff,
  }
}

function policyRecommendedAction(assessment, profile, relatedJob, variantName) {
  const continuous = boolFrom(assessment?.smoke_continuous, false)
  const duration = toNum(assessment?.smoke_duration_minutes, 5)
  const fireType = String(assessment?.fire_type || 'unknown').toLowerCase()
  const color = String(assessment?.smoke_color || 'white').toLowerCase()
  const prohibited = boolFrom(assessment?.prohibited_materials_suspected, false)
  const affectingRoad = boolFrom(assessment?.smoke_affecting_road, false)

  const priorNotices = toNum(relatedJob?.prior_notice_count, 0)
  const hasPriorAbatement = boolFrom(relatedJob?.has_prior_abatement, false)
  const warned = boolFrom(relatedJob?.responsible_person_warned, false) || priorNotices > 0
  const hasPriorEnd = boolFrom(relatedJob?.has_prior_end, false)

  const variantBias = variantName === 'sfa_contextual' ? 0.15 : variantName === 'sfa_with_duration' ? 0.08 : 0

  // ── Prosecution-level offences ────────────────────────────────
  // Yellow/black industrial + prohibited + high SFA → prosecution
  if (['yellow', 'black'].includes(color) && fireType === 'industrial' && prohibited && profile.sfaScore >= 7) {
    return 'prosecution_referral'
  }

  // Industrial + very heavy (SFA >= 8) → escalate to infringement
  if (fireType === 'industrial' && profile.sfaScore >= 8) {
    return warned || hasPriorAbatement ? 'prosecution_referral' : 'infringement_notice'
  }

  // Prohibited materials + heavy + road hazard → infringement/prosecution
  if (prohibited && affectingRoad && profile.sfaScore >= 7) {
    return warned ? 'prosecution_referral' : 'infringement_notice'
  }

  // ── Commercial/industrial/barrel abuse gates ─────────────────
  // Open fire, barrel fire, industrial with prohibited + heavy → infringement
  if (['open_fire', 'barrel_fire', 'industrial'].includes(fireType) && prohibited && profile.sfaScore >= 6.5) {
    return warned ? 'prosecution_referral' : 'infringement_notice'
  }

  // ── Road hazard escalation ───────────────────────────────────
  // Industrial with very heavy smoke + road impact → escalate to infringement (public hazard)
  if (fireType === 'industrial' && affectingRoad && profile.sfaScore >= 6.2) {
    return warned ? 'prosecution_referral' : 'infringement_notice'
  }

  // Road obstruction (visibility hazard) with duration > 20 → escalate
  if (affectingRoad && duration > 20) {
    return warned || hasPriorAbatement ? 'infringement_notice' : 'abatement_notice'
  }

  // ── Prohibited materials gate (other cases) ──────────────────
  if (prohibited && profile.sfaScore >= 6) {
    return warned ? 'infringement_notice' : 'abatement_notice'
  }

  // ── Dubious burn-off (abuse disguised as burn-off) ──────────
  if (profile.isDubiousBurnOff && profile.sfaScore >= 5.5) {
    return warned ? 'infringement_notice' : 'abatement_notice'
  }

  // ── Industrial with toxicity signals ──────────────────────────
  if (fireType === 'industrial' && profile.colorToxicity >= 0.4 && profile.sfaScore >= 4.5) {
    return warned || hasPriorAbatement ? 'infringement_notice' : 'abatement_notice'
  }

  // ── Long-running residential fires ───────────────────────────
  if (fireType === 'residential_domestic' && duration > 60 && profile.sfaScore >= 4) {
    return warned || hasPriorAbatement ? 'infringement_notice' : 'abatement_notice'
  }

  // ── Naive burn-off first-visit (compliant cases) ─────────────
  // Only escalate to verbal if SFA >= 2.5 (not just any burn-off)
  if (profile.isNaiveBurnOff && !warned && !hasPriorAbatement && profile.sfaScore >= 2.5 && profile.sfaScore < 3.5 && duration < 20) {
    return 'verbal_warning'
  }

  // ── Very light smoke → no_action ────────────────────────────
  if (profile.sfaScore < 2 && duration < 15 && !prohibited && !affectingRoad) {
    return 'no_action'
  }

  // ── SFA score escalation ────────────────────────────────────
  const adjustedScore = profile.sfaScore + variantBias + (warned ? 1.0 : 0)

  if (adjustedScore >= 9 || (hasPriorEnd && profile.sfaScore >= 7.5)) {
    return 'prosecution_referral'
  }

  if (adjustedScore >= 7.5 || (hasPriorAbatement && profile.sfaScore >= 6.5)) {
    return 'infringement_notice'
  }

  if (adjustedScore >= 5 || (warned && profile.sfaScore >= 4.5)) {
    return 'abatement_notice'
  }

  if (adjustedScore >= 2.5 || (profile.sfaScore >= 1.5 && duration > 15)) {
    return 'verbal_warning'
  }

  return 'no_action'
}

function deriveExcessive(assessment, profile) {
  return profile.sfaScore >= 5
}

// Test cases
const testCases = [
  { smoke_opacity: 'light', smoke_color: 'white', smoke_continuous: false, smoke_duration_minutes: 8, fire_type: 'residential_domestic', prohibited_materials_suspected: false, odor_offensive: false, smoke_affecting_neighbors: false, smoke_affecting_road: false, recommended_action: 'no_action', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'moderate', smoke_color: 'light_grey', smoke_continuous: true, smoke_duration_minutes: 20, fire_type: 'burn_off', prohibited_materials_suspected: false, odor_offensive: false, smoke_affecting_neighbors: true, smoke_affecting_road: false, recommended_action: 'verbal_warning', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'heavy', smoke_color: 'dark_grey', smoke_continuous: true, smoke_duration_minutes: 45, fire_type: 'residential_domestic', prohibited_materials_suspected: true, odor_offensive: true, smoke_affecting_neighbors: true, smoke_affecting_road: false, recommended_action: 'abatement_notice', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'very_heavy', smoke_color: 'black', smoke_continuous: true, smoke_duration_minutes: 60, fire_type: 'industrial', prohibited_materials_suspected: false, odor_offensive: true, smoke_affecting_neighbors: true, smoke_affecting_road: true, recommended_action: 'infringement_notice', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'heavy', smoke_color: 'dark_grey', smoke_continuous: true, smoke_duration_minutes: 50, fire_type: 'burn_off', prohibited_materials_suspected: true, odor_offensive: true, smoke_affecting_neighbors: true, smoke_affecting_road: false, recommended_action: 'abatement_notice', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'heavy', smoke_color: 'brown', smoke_continuous: false, smoke_duration_minutes: 25, fire_type: 'open_fire', prohibited_materials_suspected: true, odor_offensive: true, smoke_affecting_neighbors: true, smoke_affecting_road: false, recommended_action: 'infringement_notice', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'light', smoke_color: 'light_grey', smoke_continuous: true, smoke_duration_minutes: 12, fire_type: 'burn_off', prohibited_materials_suspected: false, odor_offensive: false, smoke_affecting_neighbors: false, smoke_affecting_road: false, recommended_action: 'no_action', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'moderate', smoke_color: 'grey', smoke_continuous: false, smoke_duration_minutes: 18, fire_type: 'residential_domestic', prohibited_materials_suspected: false, odor_offensive: false, smoke_affecting_neighbors: true, smoke_affecting_road: false, recommended_action: 'verbal_warning', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'moderate', smoke_color: 'grey', smoke_continuous: true, smoke_duration_minutes: 35, fire_type: 'industrial', prohibited_materials_suspected: false, odor_offensive: true, smoke_affecting_neighbors: true, smoke_affecting_road: false, recommended_action: 'abatement_notice', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'heavy', smoke_color: 'black', smoke_continuous: true, smoke_duration_minutes: 30, fire_type: 'barrel_fire', prohibited_materials_suspected: true, odor_offensive: true, smoke_affecting_neighbors: true, smoke_affecting_road: false, recommended_action: 'infringement_notice', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'moderate', smoke_color: 'grey', smoke_continuous: true, smoke_duration_minutes: 90, fire_type: 'residential_domestic', prohibited_materials_suspected: false, odor_offensive: false, smoke_affecting_neighbors: true, smoke_affecting_road: false, recommended_action: 'abatement_notice', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'heavy', smoke_color: 'yellow', smoke_continuous: true, smoke_duration_minutes: 40, fire_type: 'industrial', prohibited_materials_suspected: true, odor_offensive: true, smoke_affecting_neighbors: true, smoke_affecting_road: true, recommended_action: 'prosecution_referral', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'moderate', smoke_color: 'light_grey', smoke_continuous: true, smoke_duration_minutes: 22, fire_type: 'burn_off', prohibited_materials_suspected: false, odor_offensive: false, smoke_affecting_neighbors: true, smoke_affecting_road: false, recommended_action: 'verbal_warning', prior_notice_count: 0, has_prior_abatement: false },
  { smoke_opacity: 'light', smoke_color: 'white', smoke_continuous: false, smoke_duration_minutes: 5, fire_type: 'residential_domestic', prohibited_materials_suspected: false, odor_offensive: false, smoke_affecting_neighbors: false, smoke_affecting_road: false, recommended_action: 'no_action', prior_notice_count: 0, has_prior_abatement: false },
]

const records = testCases.map((tc, i) => {
  const assessment = tc
  const relatedJob = { prior_notice_count: tc.prior_notice_count, has_prior_abatement: tc.has_prior_abatement, has_prior_end: false, responsible_person_warned: false }
  const profile = classifySmokeProfile(assessment)

  const sfa_only = {
    predicted_action: policyRecommendedAction(assessment, profile, relatedJob, 'sfa_only'),
    predicted_excessive: deriveExcessive(assessment, profile),
    confidence: Number((0.4 + profile.sfaScore / 15).toFixed(4)),
    human_override: false,
    decision_seconds: Math.round(30 + profile.sfaScore * 5),
  }
  const sfa_with_duration = {
    predicted_action: policyRecommendedAction(assessment, profile, relatedJob, 'sfa_with_duration'),
    predicted_excessive: profile.sfaScore >= 4.5,
    confidence: Number((0.45 + profile.sfaScore / 14).toFixed(4)),
    human_override: false,
    decision_seconds: Math.round(28 + profile.sfaScore * 4.5),
  }
  const sfa_contextual = {
    predicted_action: policyRecommendedAction(assessment, profile, relatedJob, 'sfa_contextual'),
    predicted_excessive: profile.sfaScore >= 4.8,
    confidence: Number((0.5 + profile.sfaScore / 13).toFixed(4)),
    human_override: false,
    decision_seconds: Math.round(32 + profile.sfaScore * 4.8),
  }

  return {
    id: `a${i}000000-0000-4000-${String(i).padStart(4, '0')}-000000000000`,
    source: {
      opacity: assessment.smoke_opacity,
      color: assessment.smoke_color,
      continuous: assessment.smoke_continuous,
      duration_minutes: assessment.smoke_duration_minutes,
      fire_type: assessment.fire_type,
      prohibited_materials_suspected: assessment.prohibited_materials_suspected,
      odor_offensive: assessment.odor_offensive,
      smoke_drifting: assessment.smoke_affecting_neighbors,
      smoke_affecting_road: assessment.smoke_affecting_road,
      sfa_score: profile.sfaScore,
      opacity_score: profile.opacityScore,
      color_toxicity: profile.colorToxicity,
      is_naive_burn_off: profile.isNaiveBurnOff,
      is_dubious_burn_off: profile.isDubiousBurnOff,
    },
    ground_truth_action: tc.recommended_action,
    ground_truth_excessive: deriveExcessive(assessment, profile),
    variants: {
      sfa_only,
      sfa_with_duration,
      sfa_contextual,
    },
  }
})

const out = resolve(process.cwd(), 'data/smoke-ablation-evals.jsonl')
writeFileSync(out, records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8')

console.log(`Generated ${records.length} smoke ablation records`)
console.log(`Output: ${out}`)
