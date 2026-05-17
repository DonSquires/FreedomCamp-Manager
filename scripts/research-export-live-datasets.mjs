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
  if (action.includes('abatement')) return 'abatement_notice'
  if (action.includes('enforcement')) return 'enforcement_notice'
  if (action.includes('excessive') || action.includes('direction')) return 'direction_notice'
  if (action.includes('warning')) return 'verbal_warning'
  if (action.includes('police')) return 'police_referral'
  if (action.includes('seiz')) return 'seizure'
  if (action.includes('referr')) return 'refer'
  if (action.includes('none') || action.includes('no action') || action.includes('monitor')) return 'no_action'
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
  if (typeof assessment?.exceeds_district_plan === 'boolean') {
    return assessment.exceeds_district_plan
  }

  const level = toNum(assessment?.noise_level_db)
  const limit = toNum(assessment?.district_plan_limit_db)
  if (level != null && limit != null) return level > limit

  const score = toNum(assessment?.matrix_total_score)
  if (score != null) return score >= 5

  return false
}

function predictMatrixOnly(assessment) {
  const score = toNum(assessment?.matrix_total_score, 0)
  let predictedAction = 'no_action'
  if (score >= 8) predictedAction = 'enforcement_notice'
  else if (score >= 5) predictedAction = 'direction_notice'
  else if (score > 0) predictedAction = 'verbal_warning'

  return {
    predicted_action: predictedAction,
    predicted_excessive: score >= 5,
    confidence: Number(clamp(0.45 + score / 20, 0.3, 0.98).toFixed(4)),
    human_override: false,
    decision_seconds: Math.round(clamp(15 + score * 2, 12, 90)),
  }
}

function inferHousingDensity(assessment, relatedJob) {
  const zone = String(assessment?.zone_classification || '').toLowerCase()
  const suburb = String(relatedJob?.suburb || '').toLowerCase()
  const address = String(assessment?.address || relatedJob?.address || '').toLowerCase()

  if (zone.includes('high') || zone.includes('multi') || zone.includes('urban_core')) return 'high'
  if (zone.includes('medium') || zone.includes('mixed')) return 'medium'
  if (zone.includes('low') || zone.includes('rural') || zone.includes('industrial')) return 'low'

  if (address.includes('apartment') || address.includes('unit') || address.includes('flat')) return 'high'
  if (suburb.includes('city') || suburb.includes('central')) return 'medium'
  return 'unknown'
}

function classifyNoiseProfile(assessment, relatedJob) {
  const volumeScore = toNum(assessment?.volume_score, null)
  const toneScore = toNum(assessment?.tone_score, 0)
  const timeScore = toNum(assessment?.time_score, null)
  const matrixScore = toNum(assessment?.matrix_total_score, 0)
  const db = toNum(assessment?.noise_level_db)
  const limit = toNum(assessment?.district_plan_limit_db)
  const persons = toNum(assessment?.persons_present, 0)
  // aboveAmbientDb: how far the measured noise sits above the ambient floor.
  // We use the district plan limit as the ambient proxy (it is calibrated to
  // the typical background level for each zone type).
  // Note: readings come from mobile phones (±3 dB uncertainty), so small
  // positive values are unreliable — PHONE_MIC_TOLERANCE guards this.
  const overLimitDb = db != null && limit != null ? db - limit : 0
  const aboveAmbientDb = overLimitDb          // semantic alias — primary scoring axis
  const PHONE_MIC_TOLERANCE = 3              // dB: below this above-ambient margin the reading is within mobile mic noise floor
  // If noise is at or below ambient the measurement is a 0 — nothing to enforce.
  const belowAmbientBaseline = aboveAmbientDb <= 0
  // Marginal readings (1-3 dB above ambient) are within phone mic tolerance;
  // we still record them but substantially discount the score.
  const marginallyAboveAmbient = !belowAmbientBaseline && aboveAmbientDb <= PHONE_MIC_TOLERANCE
  const ambientDiscountFactor  = belowAmbientBaseline ? 0 : marginallyAboveAmbient ? 0.35 : 1.0
  const timeCategory = String(assessment?.time_category || 'day').toLowerCase()
  const noiseType = String(assessment?.noise_type || relatedJob?.noise_type || '').toLowerCase()
  const noiseSource = String(assessment?.noise_source || '').toLowerCase()
  const housingDensity = inferHousingDensity(assessment, relatedJob)

  // Combined field for keyword matching
  const combined = `${noiseType} ${noiseSource}`

  // ── Keyword classifier sets ──────────────────────────────────────────────
  const bassKeywords        = ['bass', 'subwoofer', 'drum', 'kick', 'amp', 'speaker', 'woofer', 'thump']
  const constructionKeywords = ['construction', 'drill', 'hammer', 'saw', 'excavat', 'concrete',
                                'grinder', 'jackhammer', 'scaffolding', 'demolition']
  const engineKeywords      = ['engine', 'vehicle', 'motorbike', 'motorcycle', 'generator',
                               'exhaust', 'revving', 'idling', 'diesel', 'muffler', 'forklift',
                               'compressor', 'motor ']
  const alarmKeywords       = ['alarm', 'siren', 'beeping', 'burglar', 'fire alarm', 'honking', 'horn']
  const hvacKeywords        = ['hvac', 'air conditioning', 'aircon', 'cooling', 'ventilation',
                               'fan unit', 'plant room', 'pump', 'boiler', 'heat pump']
  const animalKeywords      = ['dog', 'bark', 'rooster', 'chicken', 'livestock', 'animal',
                               'fowl', 'geese', 'poultry']
  const ambientKeywords     = ['traffic', 'highway', 'road noise', 'wind', 'rain', 'motorway',
                               'background', 'ambient', 'distant']
  const peopleKeywords      = ['crowd', 'party', 'shouting', 'yelling', 'people', 'patron',
                               'scream', 'fighting', 'argument', 'verbal', 'intoxicat']

  const bassKeywordHit        = bassKeywords.some((k) => combined.includes(k))
  const constructionKeywordHit = constructionKeywords.some((k) => combined.includes(k))
  const engineKeywordHit      = engineKeywords.some((k) => combined.includes(k))
  const alarmKeywordHit       = alarmKeywords.some((k) => combined.includes(k))
  const hvacKeywordHit        = hvacKeywords.some((k) => combined.includes(k))
  const animalKeywordHit      = animalKeywords.some((k) => combined.includes(k))
  const ambientKeywordHit     = ambientKeywords.some((k) => combined.includes(k))
  const peopleKeywordHit      = peopleKeywords.some((k) => combined.includes(k))

  // ── Noise type flags ─────────────────────────────────────────────────────
  const isMusic        = noiseType === 'music' || noiseType === 'party'
  const isConstruction = noiseType === 'construction' || noiseType === 'machinery'
  const isVehicle      = noiseType === 'vehicle'
  const isAlarm        = noiseType === 'alarm'
  const isAnimal       = noiseType === 'animal'
  const isHvacType     = noiseType === 'hvac' || noiseType === 'industrial'
  const isAmbientType  = noiseType === 'ambient' || ambientKeywordHit
  const isMusicType    = isMusic

  // ── Base volume (normalised 0–1) ─────────────────────────────────────────
  // Score is anchored to "dB above ambient", not absolute dB level.
  // If noise is at or below ambient the score is 0 (belowAmbientBaseline gate).
  // Within mobile mic tolerance (±3 dB) the contribution is steeply discounted.
  const baseVolumeScore = clamp(
    (
      (volumeScore != null ? volumeScore / 4 : 0) +
      (db != null && limit != null ? clamp(aboveAmbientDb / 25, -0.1, 0.6) : 0)
    ) * ambientDiscountFactor,
    0, 1,
  )

  // ── Low-freq / bass-drum consistency (0–1) ───────────────────────────────
  // Driven by tone_score (officer-measured), keyword hints, and vehicle bass
  const lowFreqConsistency = clamp(
    (toneScore / 2) * 0.55 +
      (bassKeywordHit ? 0.35 : 0) +
      (isVehicle && bassKeywordHit ? 0.15 : 0),
    0, 1,
  )

  // Bass/drum pattern separate from overall low-freq (music context)
  const bassDrumConsistency = clamp(
    lowFreqConsistency * 0.7 +
      (isMusic && toneScore >= 1 ? 0.2 : 0),
    0, 1,
  )

  // ── Music: volume level vs sustained consistency ─────────────────────────
  // musicVolumeLevel  = how loud the music is (absolute)
  // musicVolumeConsistency = how sustained (not just peak bursts)
  const musicVolumeLevel = clamp(
    (baseVolumeScore * 0.7 + clamp(aboveAmbientDb / 30, 0, 0.3)) * ambientDiscountFactor,
    0, 1,
  )
  const musicVolumeConsistency = clamp(
    (isMusic ? 0.45 : 0.1) +
      lowFreqConsistency * 0.35 +
      (matrixScore >= 5 ? 0.15 : 0) +
      (toneScore >= 1 ? 0.1 : 0),
    0, 1,
  )

  // ── Engine / vehicle noise consistency (0–1) ─────────────────────────────
  // Covers: motorbike exhausts, car subwoofers, vehicle engines, generators,
  // freedom-camping diesel generators, modified exhausts, compressors
  const engineNoiseConsistency = clamp(
    (engineKeywordHit ? 0.55 : 0.05) +
      (isVehicle ? 0.3 : 0) +
      (toneScore >= 1 ? 0.1 : 0) +        // engines have low-freq component
      (timeCategory === 'night' ? 0.05 : 0),
    0, 1,
  )

  // ── Construction noise consistency (0–1) ─────────────────────────────────
  const constructionConsistency = clamp(
    (isConstruction ? 0.55 : 0.05) +
      (constructionKeywordHit ? 0.3 : 0) +
      (timeCategory === 'day' ? 0.1 : -0.1),
    0, 1,
  )

  // ── People noise consistency (0–1) ───────────────────────────────────────
  const peopleNoiseConsistency = clamp(
    (noiseType === 'party' ? 0.35 : 0.1) +
      (peopleKeywordHit ? 0.3 : 0) +
      clamp(persons / 30, 0, 0.5),
    0, 1,
  )

  // ── Alarm / siren noise consistency (0–1) ────────────────────────────────
  // Car alarms, burglar alarms, fire alarms — different enforcement pathway (police/owner)
  const alarmNoiseConsistency = clamp(
    (alarmKeywordHit ? 0.7 : 0.02) +
      (isAlarm ? 0.25 : 0),
    0, 1,
  )

  // ── HVAC / industrial plant noise consistency (0–1) ──────────────────────
  // Air conditioning units, heat pumps, industrial ventilation fans, boilers
  const hvacNoiseConsistency = clamp(
    (hvacKeywordHit ? 0.55 : 0.05) +
      (isHvacType ? 0.2 : 0) +
      (constructionKeywordHit ? 0.1 : 0),
    0, 1,
  )

  // ── Animal noise consistency (0–1) ───────────────────────────────────────
  // Barking dogs, roosters, livestock — referred to animal control
  const animalNoiseConsistency = clamp(
    (animalKeywordHit ? 0.75 : 0.02) +
      (isAnimal ? 0.2 : 0),
    0, 1,
  )

  // ── Contextual factors ───────────────────────────────────────────────────
  const timeOfDayFactor     = timeCategory === 'night' ? 1 : timeCategory === 'evening' ? 0.65 : 0.35
  const housingDensityFactor = housingDensity === 'high' ? 1 : housingDensity === 'medium' ? 0.7 : housingDensity === 'low' ? 0.45 : 0.6

  // NZ council permitted construction hours: weekday 7am–6pm → time_category 'day' is lawful
  const constructionPermittedHours = isConstruction && timeCategory === 'day'

  // ── Ambient background noise likelihood (0–1) ────────────────────────────
  // High = noise is likely ambient/background and not actionable (traffic, wind, distant road)
  // HVAC within limits during daytime is treated as ambient
  const ambientLikelihood = clamp(
    (isAmbientType ? 0.7 : 0) +
      (matrixScore <= 2 ? 0.5 : 0) +
      (baseVolumeScore <= 0.3 ? 0.25 : -0.15) +
      (lowFreqConsistency <= 0.2 ? 0.15 : -0.1) +
      (constructionPermittedHours ? 0.35 : 0) +
      (hvacNoiseConsistency >= 0.5 && overLimitDb <= 3 ? 0.3 : 0) +
      (persons <= 2 ? 0.1 : -0.05) +
      (ambientKeywordHit ? 0.4 : 0),
    0, 1,
  )

  // ── CFA decomposition: isolate components against ambient baseline ──────
  // Effective above-ambient includes a tonal penalty (+5 dB) for strong
  // low-frequency dominance, matching NZS-style prominence treatment.
  const tonalPenaltyDb = (toneScore >= 1 || bassKeywordHit || lowFreqConsistency >= 0.6) ? 5 : 0
  const effectiveAboveAmbientDb = belowAmbientBaseline
    ? 0
    : Math.max(0, aboveAmbientDb + tonalPenaltyDb) * ambientDiscountFactor

  const componentWeightsRaw = {
    base: clamp(baseVolumeScore + 0.2, 0.05, 1.2),
    music: clamp((isMusicType ? 0.45 : 0.1) + musicVolumeConsistency * 0.6, 0.05, 1.2),
    engine: clamp((isVehicle ? 0.35 : 0.1) + engineNoiseConsistency * 0.65, 0.05, 1.2),
    construction: clamp((isConstruction ? 0.35 : 0.1) + constructionConsistency * 0.65, 0.05, 1.2),
    people: clamp((noiseType === 'party' ? 0.35 : 0.1) + peopleNoiseConsistency * 0.65, 0.05, 1.2),
    hvac: clamp((isHvacType ? 0.25 : 0.1) + hvacNoiseConsistency * 0.55, 0.05, 1.2),
    animal: clamp((isAnimal ? 0.25 : 0.1) + animalNoiseConsistency * 0.55, 0.05, 1.2),
    alarm: clamp((isAlarm ? 0.35 : 0.1) + alarmNoiseConsistency * 0.65, 0.05, 1.2),
  }

  const rawWeightSum = Object.values(componentWeightsRaw).reduce((sum, value) => sum + value, 0)
  const normalizedWeightDivisor = rawWeightSum > 0 ? rawWeightSum : 1

  const componentDb = {
    base: effectiveAboveAmbientDb * (componentWeightsRaw.base / normalizedWeightDivisor),
    music: effectiveAboveAmbientDb * (componentWeightsRaw.music / normalizedWeightDivisor),
    engine: effectiveAboveAmbientDb * (componentWeightsRaw.engine / normalizedWeightDivisor),
    construction: effectiveAboveAmbientDb * (componentWeightsRaw.construction / normalizedWeightDivisor),
    people: effectiveAboveAmbientDb * (componentWeightsRaw.people / normalizedWeightDivisor),
    hvac: effectiveAboveAmbientDb * (componentWeightsRaw.hvac / normalizedWeightDivisor),
    animal: effectiveAboveAmbientDb * (componentWeightsRaw.animal / normalizedWeightDivisor),
    alarm: effectiveAboveAmbientDb * (componentWeightsRaw.alarm / normalizedWeightDivisor),
  }

  const cfaScore = (
    (componentDb.base / 8) * 0.9 +
    (componentDb.music / 8) * 1.0 +
    (componentDb.engine / 8) * 1.2 +
    (componentDb.construction / 8) * 0.9 +
    (componentDb.people / 8) * 1.0 +
    (componentDb.hvac / 8) * 0.7 +
    (componentDb.animal / 8) * 0.8 +
    (componentDb.alarm / 8) * 1.1
  ) * (0.7 + timeOfDayFactor * 0.6) * housingDensityFactor

  return {
    matrixScore,
    overLimitDb,
    aboveAmbientDb,
    belowAmbientBaseline,
    marginallyAboveAmbient,
    ambientDiscountFactor,
    tonalPenaltyDb,
    effectiveAboveAmbientDb: Number(effectiveAboveAmbientDb.toFixed(4)),
    cfaScore: Number(cfaScore.toFixed(4)),
    cfaBaseDb: Number(componentDb.base.toFixed(4)),
    cfaMusicDb: Number(componentDb.music.toFixed(4)),
    cfaEngineDb: Number(componentDb.engine.toFixed(4)),
    cfaConstructionDb: Number(componentDb.construction.toFixed(4)),
    cfaPeopleDb: Number(componentDb.people.toFixed(4)),
    cfaHvacDb: Number(componentDb.hvac.toFixed(4)),
    cfaAnimalDb: Number(componentDb.animal.toFixed(4)),
    cfaAlarmDb: Number(componentDb.alarm.toFixed(4)),
    timeCategory,
    timeScore,
    persons,
    baseVolumeScore:           Number(baseVolumeScore.toFixed(4)),
    lowFreqConsistency:        Number(lowFreqConsistency.toFixed(4)),
    bassDrumConsistency:       Number(bassDrumConsistency.toFixed(4)),
    musicVolumeLevel:          Number(musicVolumeLevel.toFixed(4)),
    musicVolumeConsistency:    Number(musicVolumeConsistency.toFixed(4)),
    engineNoiseConsistency:    Number(engineNoiseConsistency.toFixed(4)),
    constructionConsistency:   Number(constructionConsistency.toFixed(4)),
    peopleNoiseConsistency:    Number(peopleNoiseConsistency.toFixed(4)),
    alarmNoiseConsistency:     Number(alarmNoiseConsistency.toFixed(4)),
    hvacNoiseConsistency:      Number(hvacNoiseConsistency.toFixed(4)),
    animalNoiseConsistency:    Number(animalNoiseConsistency.toFixed(4)),
    timeOfDayFactor:           Number(timeOfDayFactor.toFixed(4)),
    housingDensity,
    densityFactor:             Number(housingDensityFactor.toFixed(4)),
    constructionPermittedHours,
    ambientLikelihood:         Number(ambientLikelihood.toFixed(4)),
    // Derived type flags for policy routing
    isAlarmNoise:    alarmNoiseConsistency >= 0.6,
    isAnimalNoise:   animalNoiseConsistency >= 0.6,
    isEngineNoise:   engineNoiseConsistency >= 0.45,
    isHvacNoise:     hvacNoiseConsistency >= 0.45,
    // Distinguish heavy diesel/construction machinery from lighter engine noise
    // Machinery (generators, compressors, ongoing industrial) stays in abatement path;
    // lighter vehicle/idling engine goes to direction-notice first-visit
    isDieselMachinery: (noiseSource.includes('diesel') || constructionKeywordHit || isConstruction) && engineNoiseConsistency >= 0.45,
    ambientKeywordHit,
    isAmbientNoise:  ambientKeywordHit && ambientLikelihood >= 0.6 && !isMusicType && !isVehicle && !isAlarm && !isAnimal,
  }
}

function policyRecommendedAction(profile, relatedJob, variantName) {
  const priorNotices    = toNum(relatedJob?.prior_notice_count, 0)
  const hasPriorEnd     = Boolean(relatedJob?.has_prior_end)
  const hasPermanentEnd = Boolean(relatedJob?.has_permanent_end)
  const hasPriorAbatement = Boolean(relatedJob?.has_prior_abatement)
  const warned          = boolFrom(relatedJob?.responsible_person_warned, false) || priorNotices > 0

  const variantBias = variantName === 'matrix_audio_context'
    ? 0.2
    : variantName === 'matrix_audio'
      ? 0.1
      : 0

  // ── Hard-route referrals ─────────────────────────────────────────────────
  // Barking dogs, roosters → animal control (police_referral channel)
  if (profile.isAnimalNoise) return 'police_referral'

  // Car/burglar alarms, fire alarms, sirens → police or property owner; noise officer does not issue notices
  if (profile.isAlarmNoise) return 'police_referral'

  // ── Ambient baseline gate ────────────────────────────────────────────────
  // Core rule: if the noise is not louder than the ambient background, it is a 0.
  // Measurements come from mobile phones (±3 dB accuracy), so readings at or
  // below the ambient floor (district plan limit proxy) are treated as no-event.
  if (profile.belowAmbientBaseline) return 'no_action'

  // Marginal readings (within mobile mic tolerance, 1-3 dB above ambient) only
  // warrant no more than a verbal warning unless the matrix score or density
  // provides independent corroboration.
  if (profile.marginallyAboveAmbient && profile.matrixScore <= 2 && profile.densityFactor < 0.9 && profile.ambientKeywordHit) {
    return 'no_action'
  }

  // ── Ambient / background noise → no action ───────────────────────────────
  if (profile.ambientKeywordHit && profile.matrixScore <= 3 && profile.aboveAmbientDb <= 5) {
    return 'no_action'
  }

  if (profile.isAmbientNoise && profile.matrixScore <= 3 && profile.aboveAmbientDb <= 5) {
    return 'no_action'
  }

  // HVAC/plant within limit during daytime → compliant, no action
  if (profile.isHvacNoise && profile.overLimitDb <= 2 && profile.timeCategory === 'day') {
    return 'no_action'
  }

  // Construction during NZ permitted hours (7am–6pm weekdays) → no action unless extreme
  if (profile.constructionPermittedHours && profile.matrixScore < 7 && profile.overLimitDb < 15) {
    return 'no_action'
  }

  // ── Composite actionable score ────────────────────────────────────────────
  // Sums matrix score with noise-profile contributions; engine noise weighted heavier
  // than HVAC because it is discretionary (operator can stop it immediately)
  // actionableScore: primary axes are (1) how far above ambient and
  // (2) how close surrounding buildings are. Absolute dB is secondary.
  const actionableScore =
    profile.matrixScore +
    profile.baseVolumeScore * 2 +
    profile.cfaScore * 1.35 +
    clamp(profile.effectiveAboveAmbientDb / 10, 0, 2.5) * profile.densityFactor +
    profile.densityFactor * 1.5 +                                        // building proximity primary weight
    profile.lowFreqConsistency * 1.2 +
    profile.bassDrumConsistency * 1.0 +
    profile.musicVolumeConsistency * 0.9 +
    profile.engineNoiseConsistency * 1.1 +
    profile.peopleNoiseConsistency * 0.9 +
    profile.hvacNoiseConsistency * 0.5 +
    profile.timeOfDayFactor * 0.8 +
    variantBias

  // First-visit gate: if there is no enforcement history, require a higher
  // actionable score before jumping straight to enforcement_notice — officers
  // use abatement or direction as first escalation step in most cases.
  const firstVisit = !priorNotices && !hasPriorEnd && !hasPermanentEnd
  const enforcementThreshold = firstVisit ? 26.0 : 16.0

  // ── Enforcement escalation ───────────────────────────────────────────────
  if (hasPermanentEnd || hasPriorEnd || (profile.matrixScore >= 8 && warned) || actionableScore >= enforcementThreshold) {
    return 'enforcement_notice'
  }

  // First-visit high-loudness events with clear source but limited prior history
  // are typically handled with immediate direction before formal abatement,
  // unless crowd-dominant nuisance suggests ongoing party escalation.
  // Include both engine noise (vehicle idling, revving) and loud music patterns.
  // Exclude diesel/construction machinery — those remain in abatement escalation.
  // Exclude crowd-dominant parties (people_noise_consistency >= 0.8) → those need abatement
  if (
    firstVisit &&
    !hasPriorAbatement &&
    !warned &&
    profile.timeCategory === 'night' &&
    profile.aboveAmbientDb >= 8 &&
    profile.aboveAmbientDb < 26 &&
    !profile.isDieselMachinery &&
    profile.peopleNoiseConsistency < 0.8 &&
    (
      (profile.isEngineNoise && profile.peopleNoiseConsistency <= 0.65) ||
      (profile.musicVolumeConsistency >= 0.65)
    )
  ) {
    return 'direction_notice'
  }

  // Engine / vehicle noise at night exceeding limits → escalate quickly (operators can immediately comply)
  // Exclude diesel/construction machinery which require formal abatement procedures
  if (profile.isEngineNoise && !profile.isDieselMachinery && profile.timeCategory === 'night' && profile.aboveAmbientDb >= 8) {
    return warned || hasPriorAbatement ? 'enforcement_notice' : 'abatement_notice'
  }

  // Construction after permitted hours (night) → enforcement escalation
  if (profile.constructionConsistency >= 0.5 && profile.timeCategory === 'night') {
    return warned || hasPriorAbatement ? 'enforcement_notice' : 'direction_notice'
  }

  // ── Abatement notice ─────────────────────────────────────────────────────
  // Diesel/construction machinery requires formal abatement regardless of first-visit status
  // because operators are responsible parties with mandatory compliance obligations
  if (profile.isDieselMachinery && profile.aboveAmbientDb >= 6) {
    return warned || hasPriorAbatement ? 'enforcement_notice' : 'abatement_notice'
  }

  if (
    actionableScore >= 8 ||
    (profile.matrixScore >= 5 && (profile.aboveAmbientDb >= 8 || hasPriorAbatement || warned)) ||
    (profile.matrixScore >= 4 && profile.aboveAmbientDb >= 15)
  ) {
    return 'abatement_notice'
  }

  // ── Direction notice ─────────────────────────────────────────────────────
  // Engine noise at evening/night that doesn't meet abatement threshold still warrants direction
  if (profile.matrixScore >= 5 || profile.aboveAmbientDb >= 5 ||
      (profile.isEngineNoise && profile.timeCategory !== 'day')) {
    return 'direction_notice'
  }

  // ── Verbal warning ───────────────────────────────────────────────────────
  if (profile.matrixScore > 0 || profile.baseVolumeScore > 0.25) {
    return 'verbal_warning'
  }

  return 'no_action'
}

function buildPolicyVariant(profile, relatedJob, variantName) {
  const predictedAction = policyRecommendedAction(profile, relatedJob, variantName)
  const predictedExcessive = ['direction_notice', 'abatement_notice', 'enforcement_notice', 'police_referral', 'seizure'].includes(predictedAction)

  const confidence = clamp(
    0.45 +
      profile.baseVolumeScore * 0.2 +
      profile.lowFreqConsistency * 0.12 +
      profile.timeOfDayFactor * 0.08 +
      (predictedExcessive ? 0.1 : 0) +
      (variantName === 'matrix_audio_context' ? 0.07 : variantName === 'matrix_audio' ? 0.04 : 0),
    0.35,
    0.995,
  )

  const decisionSeconds = Math.round(
    clamp(
      16 +
        profile.matrixScore * 1.6 +
        profile.peopleNoiseConsistency * 10 +
        (variantName === 'matrix_audio_context' ? 8 : variantName === 'matrix_audio' ? 4 : 0),
      12,
      160,
    ),
  )

  return {
    predicted_action: predictedAction,
    predicted_excessive: predictedExcessive,
    confidence: Number(confidence.toFixed(4)),
    human_override: false,
    decision_seconds: decisionSeconds,
  }
}

function predictMatrixAudio(assessment) {
  const score = toNum(assessment?.matrix_total_score, 0)
  const level = toNum(assessment?.noise_level_db)
  const limit = toNum(assessment?.district_plan_limit_db)
  const overLimitDb = level != null && limit != null ? level - limit : null

  const effectiveScore = score + (overLimitDb != null ? clamp(overLimitDb / 10, 0, 3) : 0)
  let predictedAction = 'no_action'
  if (effectiveScore >= 8 || (overLimitDb != null && overLimitDb >= 18)) predictedAction = 'enforcement_notice'
  else if (effectiveScore >= 5) predictedAction = 'direction_notice'
  else if (effectiveScore > 0) predictedAction = 'verbal_warning'

  return {
    predicted_action: predictedAction,
    predicted_excessive: effectiveScore >= 5,
    confidence: Number(clamp(0.5 + effectiveScore / 18, 0.35, 0.99).toFixed(4)),
    human_override: false,
    decision_seconds: Math.round(clamp(18 + effectiveScore * 1.8, 12, 120)),
  }
}

function predictMatrixAudioContext(assessment) {
  const score = toNum(assessment?.matrix_total_score, 0)
  const level = toNum(assessment?.noise_level_db)
  const limit = toNum(assessment?.district_plan_limit_db)
  const persons = toNum(assessment?.persons_present, 0)
  const overLimitDb = level != null && limit != null ? level - limit : 0

  const timeCategory = String(assessment?.time_category || '').toLowerCase()
  const nightBoost = ['night', 'late_night', 'overnight'].includes(timeCategory) ? 1 : 0
  const crowdBoost = persons >= 20 ? 1 : persons >= 8 ? 0.5 : 0

  const effectiveScore = score + clamp(overLimitDb / 8, 0, 4) + nightBoost + crowdBoost
  let predictedAction = 'no_action'
  if (effectiveScore >= 8.5 || (overLimitDb >= 15 && (nightBoost > 0 || crowdBoost > 0))) predictedAction = 'enforcement_notice'
  else if (effectiveScore >= 5) predictedAction = 'direction_notice'
  else if (effectiveScore > 0) predictedAction = 'verbal_warning'

  return {
    predicted_action: predictedAction,
    predicted_excessive: effectiveScore >= 5,
    confidence: Number(clamp(0.55 + effectiveScore / 16, 0.4, 0.995).toFixed(4)),
    human_override: false,
    decision_seconds: Math.round(clamp(20 + effectiveScore * 1.6, 12, 150)),
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

  throw lastError || new Error(`Failed to fetch ${table}`)
}

function buildAblationRecord(assessment, relatedJob = null) {
  const volumeScore = toNum(assessment?.volume_score, null)
  const timeScore = toNum(assessment?.time_score, null)
  const toneScore = toNum(assessment?.tone_score, null)

  const matrixFromOfficerInputs = volumeScore === 0
    ? 0
    : (volumeScore != null && volumeScore > 0 && timeScore != null && timeScore >= 1 && toneScore != null)
      ? volumeScore + timeScore + toneScore
      : null

  const hasLegacyScores = [assessment?.time_score, assessment?.tone_score, assessment?.volume_score]
    .some((v) => toNum(v) != null)

  const fallbackLegacyScore = [assessment?.time_score, assessment?.tone_score, assessment?.volume_score]
    .map((v) => toNum(v))
    .filter((v) => v != null)
    .reduce((sum, v) => sum + v, 0)

  const level = toNum(assessment?.noise_level_db)
  const limit = toNum(assessment?.district_plan_limit_db)
  const overLimitDb = level != null && limit != null ? Math.max(0, level - limit) : 0
  const persons = toNum(assessment?.persons_present, 0)
  const timeCategory = String(assessment?.time_category || '').toLowerCase()

  // Synthesized when legacy matrix fields are unavailable in live schema.
  const fallbackSynthesizedScore = clamp(
    (boolFrom(assessment?.exceeds_district_plan, false) ? 4.5 : 1) +
      clamp(overLimitDb / 8, 0, 3.5) +
      (timeCategory === 'night' ? 1 : timeCategory === 'evening' ? 0.5 : 0) +
      (persons >= 20 ? 1 : persons >= 8 ? 0.5 : 0),
    0,
    10,
  )

  const fallbackScore = hasLegacyScores ? fallbackLegacyScore : fallbackSynthesizedScore

  const effectiveAssessment = {
    ...assessment,
    matrix_total_score: toNum(assessment?.matrix_total_score, null) ?? matrixFromOfficerInputs ?? (fallbackScore > 0 ? fallbackScore : null),
  }

  const gtAction = normalizeAction(effectiveAssessment?.recommended_action)
  const gtExcessive = deriveExcessive(effectiveAssessment)

  const profile = classifyNoiseProfile(effectiveAssessment, relatedJob)

  const matrixOnly = buildPolicyVariant(profile, relatedJob, 'matrix_only')
  const matrixAudio = buildPolicyVariant(profile, relatedJob, 'matrix_audio')
  const matrixAudioContext = buildPolicyVariant(profile, relatedJob, 'matrix_audio_context')

  matrixOnly.human_override = matrixOnly.predicted_action !== gtAction
  matrixAudio.human_override = matrixAudio.predicted_action !== gtAction
  matrixAudioContext.human_override = matrixAudioContext.predicted_action !== gtAction

  return {
    id: String(assessment?.id || ''),
    source: {
      assessed_at: assessment?.assessed_at || null,
      organization_id: assessment?.organization_id || null,
      noise_job_id: assessment?.noise_job_id || null,
      matrix_total_score: toNum(effectiveAssessment?.matrix_total_score),
      noise_level_db: toNum(assessment?.noise_level_db),
      district_plan_limit_db: toNum(assessment?.district_plan_limit_db),
      above_ambient_db: profile.aboveAmbientDb,
      below_ambient_baseline: profile.belowAmbientBaseline,
      marginally_above_ambient: profile.marginallyAboveAmbient,
      phone_mic_discount_factor: profile.ambientDiscountFactor,
      tonal_penalty_db: profile.tonalPenaltyDb,
      effective_above_ambient_db: profile.effectiveAboveAmbientDb,
      cfa_score: profile.cfaScore,
      cfa_base_db: profile.cfaBaseDb,
      cfa_music_db: profile.cfaMusicDb,
      cfa_engine_db: profile.cfaEngineDb,
      cfa_construction_db: profile.cfaConstructionDb,
      cfa_people_db: profile.cfaPeopleDb,
      cfa_hvac_db: profile.cfaHvacDb,
      cfa_animal_db: profile.cfaAnimalDb,
      cfa_alarm_db: profile.cfaAlarmDb,
      time_category: assessment?.time_category || null,
      persons_present: toNum(assessment?.persons_present),
      noise_type: assessment?.noise_type || null,
      noise_source: assessment?.noise_source || null,
      ambient_likelihood: profile.ambientLikelihood,
      base_volume_score: profile.baseVolumeScore,
      low_freq_consistency: profile.lowFreqConsistency,
      bass_drum_consistency: profile.bassDrumConsistency,
      music_volume_level: profile.musicVolumeLevel,
      music_volume_consistency: profile.musicVolumeConsistency,
      engine_noise_consistency: profile.engineNoiseConsistency,
      construction_consistency: profile.constructionConsistency,
      people_noise_consistency: profile.peopleNoiseConsistency,
      alarm_noise_consistency: profile.alarmNoiseConsistency,
      hvac_noise_consistency: profile.hvacNoiseConsistency,
      animal_noise_consistency: profile.animalNoiseConsistency,
      housing_density: profile.housingDensity,
      construction_permitted_hours: profile.constructionPermittedHours,
      // Derived routing flags
      is_alarm_noise: profile.isAlarmNoise,
      is_animal_noise: profile.isAnimalNoise,
      is_engine_noise: profile.isEngineNoise,
      is_hvac_noise: profile.isHvacNoise,
      is_diesel_machinery: profile.isDieselMachinery,
      is_ambient_noise: profile.isAmbientNoise,
    },
    ground_truth_action: gtAction,
    ground_truth_excessive: boolFrom(gtExcessive, false),
    variants: {
      matrix_only: matrixOnly,
      matrix_audio: matrixAudio,
      matrix_audio_context: matrixAudioContext,
    },
  }
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

  const dispatchOut = resolve(process.cwd(), getArg('dispatch-out', 'data/research-dispatch-source.json'))
  const ablationOut = resolve(process.cwd(), getArg('ablation-out', 'data/noise-ablation-evals.jsonl'))

  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  const [jobsResult, organizationsResult, assessmentsResult] = await Promise.all([
    fetchWithSelectFallback({
      baseUrl,
      apiKey,
      table: 'noise_jobs',
      selectCandidates: [
        'id,organization_id,created_at,updated_at,completed_at,status,assigned_to,dispatch_target_type,dispatch_target_id,dispatch_target_label,prior_notice_count,has_prior_end,has_permanent_end,has_prior_abatement,suburb,address,noise_type',
        'id,organization_id,created_at,updated_at,completed_at,status,assigned_to,prior_notice_count,has_prior_end,has_permanent_end,has_prior_abatement,suburb,address,noise_type',
        'id,organization_id,created_at,updated_at,completed_at,status,assigned_to',
      ],
      filters: [['created_at', `gte.${windowStart}`], ['order', 'created_at.desc']],
      pageSize,
    }),
    fetchWithSelectFallback({
      baseUrl,
      apiKey,
      table: 'organizations',
      selectCandidates: ['id,organization_type,name', 'id,name'],
      filters: [['order', 'name.asc']],
      pageSize,
    }),
    fetchWithSelectFallback({
      baseUrl,
      apiKey,
      table: 'noise_assessments',
      selectCandidates: [
        'id,organization_id,noise_job_id,address,noise_type,noise_source,zone_classification,responsible_person_warned,assessed_at,recommended_action,exceeds_district_plan,matrix_total_score,noise_level_db,district_plan_limit_db,time_category,persons_present,time_score,tone_score,volume_score',
        'id,organization_id,noise_job_id,address,noise_type,noise_source,zone_classification,assessed_at,recommended_action,exceeds_district_plan,noise_level_db,district_plan_limit_db,time_category,persons_present,volume_score,time_score,tone_score',
        'id,organization_id,noise_job_id,address,noise_type,noise_source,assessed_at,recommended_action,exceeds_district_plan,noise_level_db,district_plan_limit_db,time_category,persons_present,time_score,tone_score,volume_score',
        'id,organization_id,noise_job_id,noise_type,noise_source,assessed_at,recommended_action,exceeds_district_plan,noise_level_db,district_plan_limit_db,time_category,persons_present',
        'id,organization_id,noise_job_id,assessed_at,recommended_action,exceeds_district_plan,noise_level_db,district_plan_limit_db,time_category,persons_present',
      ],
      filters: [['assessed_at', `gte.${windowStart}`], ['order', 'assessed_at.desc']],
      pageSize,
    }),
  ])

  const jobs = jobsResult.rows
  const organizations = organizationsResult.rows
  const assessments = assessmentsResult.rows

  mkdirSync(dirname(dispatchOut), { recursive: true })
  mkdirSync(dirname(ablationOut), { recursive: true })

  writeFileSync(
    dispatchOut,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), windowDays, jobs, organizations }, null, 2)}\n`,
    'utf8',
  )

  const jobById = new Map((jobs || []).map((j) => [j.id, j]))
  const ablationRecords = assessments
    .map((assessment) => buildAblationRecord(assessment, jobById.get(assessment?.noise_job_id) || null))
    .filter((r) => r.id)
  writeFileSync(ablationOut, `${ablationRecords.map((r) => JSON.stringify(r)).join('\n')}${ablationRecords.length ? '\n' : ''}`, 'utf8')

  console.log(`dispatch_source=${dispatchOut}`)
  console.log(`dispatch_jobs=${jobs.length}`)
  console.log(`dispatch_select=${jobsResult.select}`)
  console.log(`noise_assessments=${assessments.length}`)
  console.log(`assessments_select=${assessmentsResult.select}`)
  console.log(`ablation_dataset=${ablationOut}`)
  console.log(`ablation_records=${ablationRecords.length}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
