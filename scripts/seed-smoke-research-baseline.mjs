#!/usr/bin/env node

/**
 * Seed smoke research baseline - creates representative test cases
 * for smoke control ablation study.
 *
 * Usage:
 *   node seed-smoke-research-baseline.mjs [--count 14]
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

function uuid() {
  return crypto.getRandomValues(new Uint8Array(16))
    .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')
    .match(/.{1,8}|.{1,4}|.{1,4}|.{1,4}|.{1,12}/g)
    .join('-')
}

// Representative smoke cases
const testCases = [
  // Case 1: Light residential domestic (compliant)
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'light',
    smoke_color: 'white',
    smoke_continuous: false,
    smoke_duration_minutes: 8,
    fire_type: 'residential_domestic',
    prohibited_materials_suspected: false,
    odor_description: 'wood_smoke',
    odor_offensive: false,
    wind_speed_kmh: 5,
    smoke_affecting_neighbors: false,
    smoke_affecting_road: false,
    ai_confidence: 0.75,
    recommended_action: 'no_action',
  },
  // Case 2: Moderate burn-off (acceptable)
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'moderate',
    smoke_color: 'light_grey',
    smoke_continuous: true,
    smoke_duration_minutes: 20,
    fire_type: 'burn_off',
    prohibited_materials_suspected: false,
    odor_description: 'wood_smoke',
    odor_offensive: false,
    wind_speed_kmh: 8,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: false,
    ai_confidence: 0.82,
    recommended_action: 'verbal_warning',
  },
  // Case 3: Heavy dark smoke - prohibited materials (violation)
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'heavy',
    smoke_color: 'dark_grey',
    smoke_continuous: true,
    smoke_duration_minutes: 45,
    fire_type: 'residential_domestic',
    prohibited_materials_suspected: true,
    odor_description: 'acrid_chemical',
    odor_offensive: true,
    wind_speed_kmh: 3,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: false,
    ai_confidence: 0.91,
    recommended_action: 'abatement_notice',
  },
  // Case 4: Very heavy black smoke - road hazard
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'very_heavy',
    smoke_color: 'black',
    smoke_continuous: true,
    smoke_duration_minutes: 60,
    fire_type: 'industrial',
    prohibited_materials_suspected: false,
    odor_description: 'noxious',
    odor_offensive: true,
    wind_speed_kmh: 2,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: true,
    ai_confidence: 0.95,
    recommended_action: 'infringement_notice',
  },
  // Case 5: Dubious burn-off (looks like residential abuse)
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'heavy',
    smoke_color: 'dark_grey',
    smoke_continuous: true,
    smoke_duration_minutes: 50,
    fire_type: 'burn_off',
    prohibited_materials_suspected: true,
    odor_description: 'acrid_chemical',
    odor_offensive: true,
    wind_speed_kmh: 4,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: false,
    ai_confidence: 0.87,
    recommended_action: 'abatement_notice',
  },
  // Case 6: Open fire with prohibited materials
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'heavy',
    smoke_color: 'brown',
    smoke_continuous: false,
    smoke_duration_minutes: 25,
    fire_type: 'open_fire',
    prohibited_materials_suspected: true,
    odor_description: 'plastic_like',
    odor_offensive: true,
    wind_speed_kmh: 6,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: false,
    ai_confidence: 0.88,
    recommended_action: 'infringement_notice',
  },
  // Case 7: Light burn-off (compliant)
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'light',
    smoke_color: 'light_grey',
    smoke_continuous: true,
    smoke_duration_minutes: 12,
    fire_type: 'burn_off',
    prohibited_materials_suspected: false,
    odor_description: 'wood_smoke',
    odor_offensive: false,
    wind_speed_kmh: 7,
    smoke_affecting_neighbors: false,
    smoke_affecting_road: false,
    ai_confidence: 0.79,
    recommended_action: 'no_action',
  },
  // Case 8: Moderate domestic with drift
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'moderate',
    smoke_color: 'grey',
    smoke_continuous: false,
    smoke_duration_minutes: 18,
    fire_type: 'residential_domestic',
    prohibited_materials_suspected: false,
    odor_description: 'wood_smoke',
    odor_offensive: false,
    wind_speed_kmh: 10,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: false,
    ai_confidence: 0.76,
    recommended_action: 'verbal_warning',
  },
  // Case 9: Industrial with moderate emissions
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'moderate',
    smoke_color: 'grey',
    smoke_continuous: true,
    smoke_duration_minutes: 35,
    fire_type: 'industrial',
    prohibited_materials_suspected: false,
    odor_description: 'acrid_chemical',
    odor_offensive: true,
    wind_speed_kmh: 5,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: false,
    ai_confidence: 0.84,
    recommended_action: 'abatement_notice',
  },
  // Case 10: Barrel fire with prohibited material
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'heavy',
    smoke_color: 'black',
    smoke_continuous: true,
    smoke_duration_minutes: 30,
    fire_type: 'barrel_fire',
    prohibited_materials_suspected: true,
    odor_description: 'plastic_like',
    odor_offensive: true,
    wind_speed_kmh: 3,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: false,
    ai_confidence: 0.92,
    recommended_action: 'infringement_notice',
  },
  // Case 11: Long domestic burn (excessive)
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'moderate',
    smoke_color: 'grey',
    smoke_continuous: true,
    smoke_duration_minutes: 90,
    fire_type: 'residential_domestic',
    prohibited_materials_suspected: false,
    odor_description: 'wood_smoke',
    odor_offensive: false,
    wind_speed_kmh: 4,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: false,
    ai_confidence: 0.81,
    recommended_action: 'abatement_notice',
  },
  // Case 12: Yellow smoke (sulfur/chemicals)
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'heavy',
    smoke_color: 'yellow',
    smoke_continuous: true,
    smoke_duration_minutes: 40,
    fire_type: 'industrial',
    prohibited_materials_suspected: true,
    odor_description: 'noxious',
    odor_offensive: true,
    wind_speed_kmh: 2,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: true,
    ai_confidence: 0.94,
    recommended_action: 'prosecution_referral',
  },
  // Case 13: Moderate burn-off with neighbor impact (direction candidate)
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'moderate',
    smoke_color: 'light_grey',
    smoke_continuous: true,
    smoke_duration_minutes: 22,
    fire_type: 'burn_off',
    prohibited_materials_suspected: false,
    odor_description: 'wood_smoke',
    odor_offensive: false,
    wind_speed_kmh: 9,
    smoke_affecting_neighbors: true,
    smoke_affecting_road: false,
    ai_confidence: 0.78,
    recommended_action: 'verbal_warning',
  },
  // Case 14: Intermittent light smoke (marginal)
  {
    smoke_job_id: uuid(),
    smoke_opacity: 'light',
    smoke_color: 'white',
    smoke_continuous: false,
    smoke_duration_minutes: 5,
    fire_type: 'residential_domestic',
    prohibited_materials_suspected: false,
    odor_description: 'wood_smoke',
    odor_offensive: false,
    wind_speed_kmh: 6,
    smoke_affecting_neighbors: false,
    smoke_affecting_road: false,
    ai_confidence: 0.72,
    recommended_action: 'no_action',
  },
]

function main() {
  const count = Math.max(1, Number(getArg('count', '14')))
  const selected = testCases.slice(0, Math.min(count, testCases.length))

  // Mock into smoke_assessments format with proper schema fields
  const assessments = selected.map((tc, i) => ({
    id: `a${i}000000-0000-4000-${String(i).padStart(4, '0')}-000000000000`,
    organization_id: `org-001`,
    smoke_job_id: `b${i}000000-0000-4000-8000-000000000003`,
    assessed_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
    address: `Test Address ${i + 1}`,
    gps_lat: -41.3 + Math.random() * 0.5,
    gps_lng: 172.6 + Math.random() * 0.5,
    smoke_opacity: tc.smoke_opacity,
    smoke_color: tc.smoke_color,
    smoke_continuous: tc.smoke_continuous,
    smoke_duration_minutes: tc.smoke_duration_minutes,
    fire_type: tc.fire_type,
    prohibited_materials_suspected: tc.prohibited_materials_suspected,
    odor_description: tc.odor_description,
    odor_offensive: tc.odor_offensive,
    wind_speed_kmh: tc.wind_speed_kmh,
    smoke_affecting_neighbors: tc.smoke_affecting_neighbors,
    smoke_affecting_road: tc.smoke_affecting_road,
    ai_confidence: tc.ai_confidence,
    recommended_action: tc.recommended_action,
  }))

  // Mock smoke_jobs
  const jobs = selected.map((tc, i) => ({
    id: `b${i}000000-0000-4000-8000-000000000003`,
    organization_id: `org-001`,
    prior_notice_count: i % 3 === 0 ? 1 : 0,
    has_prior_end: false,
    has_prior_abatement: i % 5 === 0,
    responsible_person_warned: i % 4 === 0,
  }))

  const baseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321'
  const apiKey = process.env.SUPABASE_ANON_KEY || 'test-key'

  console.log(`Seeding ${assessments.length} smoke test cases`)
  console.log(`baseUrl=${baseUrl}`)

  // For now, just export the JSON to verify structure
  const exportPath = resolve(process.cwd(), 'data/smoke-research-seeded-assessments.json')
  writeFileSync(exportPath, JSON.stringify({ assessments, jobs }, null, 2))
  console.log(`Exported to ${exportPath}`)
}

main()
