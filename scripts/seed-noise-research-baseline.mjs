#!/usr/bin/env node

import { loadLocalEnv } from './load-local-env.mjs'

function apiBaseUrl() {
  const raw = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  return raw.replace(/\/+$/, '')
}

function apiKey() {
  return String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      '',
  ).trim()
}

async function restGet(baseUrl, key, table, params) {
  const qs = new URLSearchParams(params)
  const res = await fetch(`${baseUrl}/rest/v1/${table}?${qs.toString()}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  })
  if (!res.ok) {
    throw new Error(`GET ${table} failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function restUpsert(baseUrl, key, table, rows, onConflict = 'id') {
  const qs = new URLSearchParams({ on_conflict: onConflict })
  const res = await fetch(`${baseUrl}/rest/v1/${table}?${qs.toString()}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  })

  if (!res.ok) {
    throw new Error(`UPSERT ${table} failed: ${res.status} ${await res.text()}`)
  }

  return res.json()
}

async function pickOrgAndOfficer(baseUrl, key) {
  const orgs = await restGet(baseUrl, key, 'organizations', {
    select: 'id,name,organization_type',
    order: 'name.asc',
  })

  const serviceProvider = orgs.find((o) => String(o.organization_type) === 'service_provider')
  const client = orgs.find((o) => String(o.organization_type) === 'client')
  if (!serviceProvider || !client) {
    throw new Error('Need at least one service_provider org and one client org to seed baseline sample.')
  }

  const [providerUsers, clientUsers] = await Promise.all([
    restGet(baseUrl, key, 'user_profiles', {
      select: 'id,organization_id,role,is_active',
      organization_id: `eq.${serviceProvider.id}`,
      is_active: 'eq.true',
      limit: '1',
    }),
    restGet(baseUrl, key, 'user_profiles', {
      select: 'id,organization_id,role,is_active',
      organization_id: `eq.${client.id}`,
      is_active: 'eq.true',
      limit: '1',
    }),
  ])

  let providerOfficerId = providerUsers?.[0]?.id || null
  let clientOfficerId = clientUsers?.[0]?.id || null

  if (!providerOfficerId || !clientOfficerId) {
    const fallbackUsers = await restGet(baseUrl, key, 'user_profiles', {
      select: 'id,is_active',
      is_active: 'eq.true',
      limit: '2',
    })

    if (!providerOfficerId) providerOfficerId = fallbackUsers?.[0]?.id || null
    if (!clientOfficerId) clientOfficerId = fallbackUsers?.[1]?.id || fallbackUsers?.[0]?.id || null
  }

  if (!providerOfficerId || !clientOfficerId) {
    throw new Error('Need at least one active user_profile in the project to seed noise_assessments.')
  }

  return {
    serviceProvider,
    client,
    providerOfficerId,
    clientOfficerId,
  }
}

function nowIso() {
  return new Date().toISOString()
}

function minutesAgoIso(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

async function main() {
  loadLocalEnv()

  const baseUrl = apiBaseUrl()
  const key = apiKey()
  if (!baseUrl || !key) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY.')
  }

  const ctx = await pickOrgAndOfficer(baseUrl, key)

  const seededBy = 'copilot-noise-baseline'

  const jobs = [
    {
      id: 'b1000000-0000-4000-8000-000000000001',
      organization_id: ctx.serviceProvider.id,
      job_number: 'NOISE-BASE-001',
      title: 'Baseline patrol route dispatch A',
      address: '1 Trafalgar St, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Loud music after 10pm',
      complaint_source: 'council_referral',
      priority: 'high',
      status: 'completed',
      assigned_to: null,
      dispatch_target_type: 'patrol_route',
      dispatch_target_id: 'c1000000-0000-4000-8000-000000000001',
      dispatch_target_label: 'Night Patrol Route Alpha',
      created_at: minutesAgoIso(240),
      updated_at: minutesAgoIso(150),
      completed_at: minutesAgoIso(150),
      dispatched_by: ctx.providerOfficerId,
    },
    {
      id: 'b1000000-0000-4000-8000-000000000002',
      organization_id: ctx.serviceProvider.id,
      job_number: 'NOISE-BASE-002',
      title: 'Baseline patrol route dispatch B',
      address: '22 Nile St, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Repeated party noise',
      complaint_source: 'public',
      priority: 'normal',
      status: 'on_scene',
      assigned_to: null,
      dispatch_target_type: 'patrol_route',
      dispatch_target_id: 'c1000000-0000-4000-8000-000000000002',
      dispatch_target_label: 'Night Patrol Route Bravo',
      created_at: minutesAgoIso(120),
      updated_at: minutesAgoIso(45),
      completed_at: null,
      dispatched_by: ctx.providerOfficerId,
    },
    {
      id: 'b2000000-0000-4000-8000-000000000001',
      organization_id: ctx.client.id,
      job_number: 'NOISE-BASE-101',
      title: 'Baseline client user dispatch A',
      address: '35 Halifax St, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Vehicle subwoofer disturbance',
      complaint_source: 'officer_initiated',
      priority: 'high',
      status: 'completed',
      assigned_to: ctx.clientOfficerId,
      dispatch_target_type: 'user',
      dispatch_target_id: ctx.clientOfficerId,
      dispatch_target_label: 'Assigned client officer',
      created_at: minutesAgoIso(360),
      updated_at: minutesAgoIso(280),
      completed_at: minutesAgoIso(280),
      dispatched_by: ctx.clientOfficerId,
    },
    {
      id: 'b2000000-0000-4000-8000-000000000002',
      organization_id: ctx.client.id,
      job_number: 'NOISE-BASE-102',
      title: 'Baseline client location dispatch B',
      address: '97 Vanguard St, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Construction noise complaint',
      complaint_source: 'council_referral',
      priority: 'normal',
      status: 'referred',
      assigned_to: null,
      dispatch_target_type: 'location',
      dispatch_target_id: 'd2000000-0000-4000-8000-000000000002',
      dispatch_target_label: 'LOI - Vanguard Industrial Block',
      created_at: minutesAgoIso(300),
      updated_at: minutesAgoIso(210),
      completed_at: minutesAgoIso(210),
      dispatched_by: ctx.clientOfficerId,
    },
    {
      id: 'b2000000-0000-4000-8000-000000000003',
      organization_id: ctx.client.id,
      job_number: 'NOISE-BASE-103',
      title: 'Baseline client user dispatch C',
      address: '14 Bridge St, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Party spilling into street',
      complaint_source: 'repeat_trigger',
      priority: 'urgent',
      status: 'completed',
      assigned_to: ctx.clientOfficerId,
      dispatch_target_type: 'user',
      dispatch_target_id: ctx.clientOfficerId,
      dispatch_target_label: 'Assigned client officer',
      created_at: minutesAgoIso(190),
      updated_at: minutesAgoIso(100),
      completed_at: minutesAgoIso(100),
      dispatched_by: ctx.clientOfficerId,
    },
    {
      id: 'b2000000-0000-4000-8000-000000000004',
      organization_id: ctx.client.id,
      job_number: 'NOISE-BASE-104',
      title: 'Baseline client location dispatch D',
      address: '5 Wakefield Quay, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Music from waterfront venue',
      complaint_source: 'public',
      priority: 'low',
      status: 'assigned',
      assigned_to: null,
      dispatch_target_type: 'location',
      dispatch_target_id: 'd2000000-0000-4000-8000-000000000004',
      dispatch_target_label: 'LOI - Waterfront Zone',
      created_at: minutesAgoIso(70),
      updated_at: minutesAgoIso(20),
      completed_at: null,
      dispatched_by: ctx.clientOfficerId,
    },
    // ── Engine / vehicle noise ────────────────────────────────────────────
    {
      id: 'b3000000-0000-4000-8000-000000000001',
      organization_id: ctx.client.id,
      job_number: 'NOISE-BASE-201',
      title: 'Motorbike exhaust revving at night',
      address: '62 Rutherford St, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Motorbike with modified exhaust revving repeatedly after midnight',
      complaint_source: 'public',
      priority: 'high',
      status: 'completed',
      assigned_to: ctx.clientOfficerId,
      dispatch_target_type: 'user',
      dispatch_target_id: ctx.clientOfficerId,
      dispatch_target_label: 'Assigned client officer',
      prior_notice_count: 0,
      has_prior_end: false,
      has_permanent_end: false,
      created_at: minutesAgoIso(500),
      updated_at: minutesAgoIso(440),
      completed_at: minutesAgoIso(440),
      dispatched_by: ctx.clientOfficerId,
    },
    {
      id: 'b3000000-0000-4000-8000-000000000002',
      organization_id: ctx.client.id,
      job_number: 'NOISE-BASE-202',
      title: 'Freedom camping diesel generator at night',
      address: 'Maitai Valley Rd, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Campervan running diesel generator through the night in freedom camping zone',
      complaint_source: 'public',
      priority: 'normal',
      status: 'completed',
      assigned_to: ctx.clientOfficerId,
      dispatch_target_type: 'user',
      dispatch_target_id: ctx.clientOfficerId,
      dispatch_target_label: 'Assigned client officer',
      prior_notice_count: 0,
      has_prior_end: false,
      has_permanent_end: false,
      created_at: minutesAgoIso(420),
      updated_at: minutesAgoIso(360),
      completed_at: minutesAgoIso(360),
      dispatched_by: ctx.clientOfficerId,
    },
    // ── Animal noise ─────────────────────────────────────────────────────
    {
      id: 'b3000000-0000-4000-8000-000000000003',
      organization_id: ctx.client.id,
      job_number: 'NOISE-BASE-203',
      title: 'Barking dog continuous at night',
      address: '18 Tasman St, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Dog barking continuously for hours, no owner present',
      complaint_source: 'public',
      priority: 'normal',
      status: 'referred',
      assigned_to: null,
      dispatch_target_type: 'location',
      dispatch_target_id: 'd3000000-0000-4000-8000-000000000003',
      dispatch_target_label: 'LOI - Tasman St Residential',
      prior_notice_count: 0,
      has_prior_end: false,
      has_permanent_end: false,
      created_at: minutesAgoIso(350),
      updated_at: minutesAgoIso(300),
      completed_at: minutesAgoIso(300),
      dispatched_by: ctx.clientOfficerId,
    },
    // ── Construction: permitted hours ─────────────────────────────────────
    {
      id: 'b3000000-0000-4000-8000-000000000004',
      organization_id: ctx.serviceProvider.id,
      job_number: 'NOISE-BASE-204',
      title: 'Construction site daytime permitted hours',
      address: '120 Hardy St, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Drilling and hammering from construction site during business hours',
      complaint_source: 'public',
      priority: 'low',
      status: 'completed',
      assigned_to: ctx.providerOfficerId,
      dispatch_target_type: 'user',
      dispatch_target_id: ctx.providerOfficerId,
      dispatch_target_label: 'Assigned provider officer',
      prior_notice_count: 0,
      has_prior_end: false,
      has_permanent_end: false,
      created_at: minutesAgoIso(600),
      updated_at: minutesAgoIso(540),
      completed_at: minutesAgoIso(540),
      dispatched_by: ctx.providerOfficerId,
    },
    // ── Construction: after hours ─────────────────────────────────────────
    {
      id: 'b3000000-0000-4000-8000-000000000005',
      organization_id: ctx.serviceProvider.id,
      job_number: 'NOISE-BASE-205',
      title: 'Construction machinery operating after midnight',
      address: '44 Collingwood St, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Excavator and concrete machinery running after 11pm — repeat complaint at this site',
      complaint_source: 'repeat_trigger',
      priority: 'urgent',
      status: 'completed',
      assigned_to: ctx.providerOfficerId,
      dispatch_target_type: 'user',
      dispatch_target_id: ctx.providerOfficerId,
      dispatch_target_label: 'Assigned provider officer',
      prior_notice_count: 2,
      has_prior_end: true,
      has_permanent_end: false,
      created_at: minutesAgoIso(280),
      updated_at: minutesAgoIso(220),
      completed_at: minutesAgoIso(220),
      dispatched_by: ctx.providerOfficerId,
    },
    // ── Alarm / siren ─────────────────────────────────────────────────────
    {
      id: 'b3000000-0000-4000-8000-000000000006',
      organization_id: ctx.client.id,
      job_number: 'NOISE-BASE-206',
      title: 'Car alarm siren continuous overnight',
      address: '7 Montgomery Sq, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Car alarm has been going off for 40 minutes, unattended vehicle',
      complaint_source: 'public',
      priority: 'normal',
      status: 'referred',
      assigned_to: null,
      dispatch_target_type: 'location',
      dispatch_target_id: 'd3000000-0000-4000-8000-000000000006',
      dispatch_target_label: 'LOI - Montgomery Sq Parking',
      prior_notice_count: 0,
      has_prior_end: false,
      has_permanent_end: false,
      created_at: minutesAgoIso(160),
      updated_at: minutesAgoIso(120),
      completed_at: minutesAgoIso(120),
      dispatched_by: ctx.clientOfficerId,
    },
    // ── HVAC within limits ────────────────────────────────────────────────
    {
      id: 'b3000000-0000-4000-8000-000000000007',
      organization_id: ctx.client.id,
      job_number: 'NOISE-BASE-207',
      title: 'HVAC heat pump unit complaint',
      address: '9 Ajax Ave, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Heat pump / air conditioning unit running during day, neighbour complains',
      complaint_source: 'public',
      priority: 'low',
      status: 'completed',
      assigned_to: ctx.clientOfficerId,
      dispatch_target_type: 'user',
      dispatch_target_id: ctx.clientOfficerId,
      dispatch_target_label: 'Assigned client officer',
      prior_notice_count: 0,
      has_prior_end: false,
      has_permanent_end: false,
      created_at: minutesAgoIso(400),
      updated_at: minutesAgoIso(330),
      completed_at: minutesAgoIso(330),
      dispatched_by: ctx.clientOfficerId,
    },
    // ── Ambient road traffic ──────────────────────────────────────────────
    {
      id: 'b3000000-0000-4000-8000-000000000008',
      organization_id: ctx.serviceProvider.id,
      job_number: 'NOISE-BASE-208',
      title: 'Ambient road traffic background noise',
      address: '3 Haven Rd, Nelson',
      suburb: 'Nelson',
      complaint_description: 'Resident complains of ambient road traffic noise from main highway, no specific source',
      complaint_source: 'public',
      priority: 'low',
      status: 'completed',
      assigned_to: ctx.providerOfficerId,
      dispatch_target_type: 'user',
      dispatch_target_id: ctx.providerOfficerId,
      dispatch_target_label: 'Assigned provider officer',
      prior_notice_count: 0,
      has_prior_end: false,
      has_permanent_end: false,
      created_at: minutesAgoIso(700),
      updated_at: minutesAgoIso(640),
      completed_at: minutesAgoIso(640),
      dispatched_by: ctx.providerOfficerId,
    },
  ].map((j) => ({
    ...j,
    prior_notice_count: j.prior_notice_count ?? 0,
    has_prior_end: j.has_prior_end ?? false,
    has_permanent_end: j.has_permanent_end ?? false,
    safety_notes: seededBy,
    outcome_notes: seededBy,
  }))

  const assessments = [
    // ── Original 6 baseline assessments ────────────────────────────────────
    {
      id: 'a1000000-0000-4000-8000-000000000001',
      organization_id: ctx.serviceProvider.id,
      noise_job_id: 'b1000000-0000-4000-8000-000000000001',
      officer_id: ctx.providerOfficerId,
      address: '1 Trafalgar St, Nelson',
      assessed_at: minutesAgoIso(200),
      recommended_action: 'direction_notice',
      exceeds_district_plan: true,
      noise_level_db: 78,
      district_plan_limit_db: 55,
      time_category: 'night',
      persons_present: 15,
      noise_type: 'music',
      noise_source: 'residential DJ system with heavy bass and speaker stack',
      created_at: nowIso(),
    },
    {
      id: 'a1000000-0000-4000-8000-000000000002',
      organization_id: ctx.serviceProvider.id,
      noise_job_id: 'b1000000-0000-4000-8000-000000000002',
      officer_id: ctx.providerOfficerId,
      address: '22 Nile St, Nelson',
      assessed_at: minutesAgoIso(80),
      recommended_action: 'no_action',
      exceeds_district_plan: false,
      noise_level_db: 59,
      district_plan_limit_db: 55,
      time_category: 'evening',
      persons_present: 6,
      noise_type: 'party',
      noise_source: 'background music and voices from gathering',
      created_at: nowIso(),
    },
    {
      id: 'a2000000-0000-4000-8000-000000000001',
      organization_id: ctx.client.id,
      noise_job_id: 'b2000000-0000-4000-8000-000000000001',
      officer_id: ctx.clientOfficerId,
      address: '35 Halifax St, Nelson',
      assessed_at: minutesAgoIso(300),
      recommended_action: 'abatement_notice',
      exceeds_district_plan: true,
      noise_level_db: 82,
      district_plan_limit_db: 55,
      time_category: 'night',
      persons_present: 25,
      noise_type: 'vehicle',
      noise_source: 'vehicle bass subwoofer system, thump and kick bass at high volume',
      created_at: nowIso(),
    },
    {
      id: 'a2000000-0000-4000-8000-000000000002',
      organization_id: ctx.client.id,
      noise_job_id: 'b2000000-0000-4000-8000-000000000002',
      officer_id: ctx.clientOfficerId,
      address: '97 Vanguard St, Nelson',
      assessed_at: minutesAgoIso(240),
      recommended_action: 'no_action',
      exceeds_district_plan: false,
      noise_level_db: 49,
      district_plan_limit_db: 55,
      time_category: 'day',
      persons_present: 1,
      noise_type: 'construction',
      noise_source: 'construction site machinery during permitted hours',
      created_at: nowIso(),
    },
    {
      id: 'a2000000-0000-4000-8000-000000000003',
      organization_id: ctx.client.id,
      noise_job_id: 'b2000000-0000-4000-8000-000000000003',
      officer_id: ctx.clientOfficerId,
      address: '14 Bridge St, Nelson',
      assessed_at: minutesAgoIso(130),
      recommended_action: 'abatement_notice',
      exceeds_district_plan: true,
      noise_level_db: 74,
      district_plan_limit_db: 55,
      time_category: 'night',
      persons_present: 12,
      noise_type: 'party',
      noise_source: 'crowd shouting and music from party speakers on street',
      created_at: nowIso(),
    },
    {
      id: 'a2000000-0000-4000-8000-000000000004',
      organization_id: ctx.client.id,
      noise_job_id: 'b2000000-0000-4000-8000-000000000004',
      officer_id: ctx.clientOfficerId,
      address: '5 Wakefield Quay, Nelson',
      assessed_at: minutesAgoIso(35),
      recommended_action: 'verbal_warning',
      exceeds_district_plan: false,
      noise_level_db: 57,
      district_plan_limit_db: 55,
      time_category: 'evening',
      persons_present: 4,
      noise_type: 'music',
      noise_source: 'outdoor venue speaker music, low-mid volume',
      created_at: nowIso(),
    },
    // ── Engine / vehicle noise ────────────────────────────────────────────
    {
      id: 'a3000000-0000-4000-8000-000000000001',
      organization_id: ctx.client.id,
      noise_job_id: 'b3000000-0000-4000-8000-000000000001',
      officer_id: ctx.clientOfficerId,
      address: '62 Rutherford St, Nelson',
      assessed_at: minutesAgoIso(460),
      recommended_action: 'direction_notice',
      exceeds_district_plan: true,
      noise_level_db: 68,
      district_plan_limit_db: 45,
      time_category: 'night',
      persons_present: 2,
      noise_type: 'vehicle',
      noise_source: 'motorbike with modified exhaust revving and engine idling repeatedly',
      created_at: nowIso(),
    },
    // ── Generator (freedom camping) ───────────────────────────────────────
    {
      id: 'a3000000-0000-4000-8000-000000000002',
      organization_id: ctx.client.id,
      noise_job_id: 'b3000000-0000-4000-8000-000000000002',
      officer_id: ctx.clientOfficerId,
      address: 'Maitai Valley Rd, Nelson',
      assessed_at: minutesAgoIso(380),
      recommended_action: 'abatement_notice',
      exceeds_district_plan: true,
      noise_level_db: 62,
      district_plan_limit_db: 45,
      time_category: 'night',
      persons_present: 3,
      noise_type: 'machinery',
      noise_source: 'portable diesel generator running from freedom camping vehicle, motor idling',
      created_at: nowIso(),
    },
    // ── Animal noise ─────────────────────────────────────────────────────
    {
      id: 'a3000000-0000-4000-8000-000000000003',
      organization_id: ctx.client.id,
      noise_job_id: 'b3000000-0000-4000-8000-000000000003',
      officer_id: ctx.clientOfficerId,
      address: '18 Tasman St, Nelson',
      assessed_at: minutesAgoIso(320),
      recommended_action: 'police_referral',
      exceeds_district_plan: true,
      noise_level_db: 58,
      district_plan_limit_db: 55,
      time_category: 'night',
      persons_present: 0,
      noise_type: 'animal',
      noise_source: 'dog barking continuously, no owner present, animal control required',
      created_at: nowIso(),
    },
    // ── Construction: permitted hours ─────────────────────────────────────
    {
      id: 'a3000000-0000-4000-8000-000000000004',
      organization_id: ctx.serviceProvider.id,
      noise_job_id: 'b3000000-0000-4000-8000-000000000004',
      officer_id: ctx.providerOfficerId,
      address: '120 Hardy St, Nelson',
      assessed_at: minutesAgoIso(560),
      recommended_action: 'no_action',
      exceeds_district_plan: false,
      noise_level_db: 70,
      district_plan_limit_db: 65,
      time_category: 'day',
      persons_present: 6,
      noise_type: 'construction',
      noise_source: 'construction site drilling and hammer during permitted hours, building work',
      created_at: nowIso(),
    },
    // ── Construction: after hours ─────────────────────────────────────────
    {
      id: 'a3000000-0000-4000-8000-000000000005',
      organization_id: ctx.serviceProvider.id,
      noise_job_id: 'b3000000-0000-4000-8000-000000000005',
      officer_id: ctx.providerOfficerId,
      address: '44 Collingwood St, Nelson',
      assessed_at: minutesAgoIso(250),
      recommended_action: 'enforcement_notice',
      exceeds_district_plan: true,
      noise_level_db: 80,
      district_plan_limit_db: 55,
      time_category: 'night',
      persons_present: 4,
      noise_type: 'construction',
      noise_source: 'excavator and concrete machinery operating after midnight, repeat breach',
      created_at: nowIso(),
    },
    // ── Alarm / siren ─────────────────────────────────────────────────────
    {
      id: 'a3000000-0000-4000-8000-000000000006',
      organization_id: ctx.client.id,
      noise_job_id: 'b3000000-0000-4000-8000-000000000006',
      officer_id: ctx.clientOfficerId,
      address: '7 Montgomery Sq, Nelson',
      assessed_at: minutesAgoIso(140),
      recommended_action: 'police_referral',
      exceeds_district_plan: true,
      noise_level_db: 72,
      district_plan_limit_db: 55,
      time_category: 'night',
      persons_present: 0,
      noise_type: 'alarm',
      noise_source: 'car alarm siren beeping continuously, unattended vehicle',
      created_at: nowIso(),
    },
    // ── HVAC within limits ────────────────────────────────────────────────
    {
      id: 'a3000000-0000-4000-8000-000000000007',
      organization_id: ctx.client.id,
      noise_job_id: 'b3000000-0000-4000-8000-000000000007',
      officer_id: ctx.clientOfficerId,
      address: '9 Ajax Ave, Nelson',
      assessed_at: minutesAgoIso(350),
      recommended_action: 'no_action',
      exceeds_district_plan: false,
      noise_level_db: 48,
      district_plan_limit_db: 55,
      time_category: 'day',
      persons_present: 1,
      noise_type: 'machinery',
      noise_source: 'heat pump air conditioning hvac unit, cooling fan operating normally',
      created_at: nowIso(),
    },
    // ── Ambient road traffic ──────────────────────────────────────────────
    {
      id: 'a3000000-0000-4000-8000-000000000008',
      organization_id: ctx.serviceProvider.id,
      noise_job_id: 'b3000000-0000-4000-8000-000000000008',
      officer_id: ctx.providerOfficerId,
      address: '3 Haven Rd, Nelson',
      assessed_at: minutesAgoIso(660),
      recommended_action: 'no_action',
      exceeds_district_plan: false,
      noise_level_db: 52,
      district_plan_limit_db: 55,
      time_category: 'day',
      persons_present: 0,
      noise_type: 'other',
      noise_source: 'ambient road traffic highway background noise, distant motorway',
      created_at: nowIso(),
    },
  ]

  const seededJobs = await restUpsert(baseUrl, key, 'noise_jobs', jobs, 'id')
  const seededAssessments = await restUpsert(baseUrl, key, 'noise_assessments', assessments, 'id')

  console.log(`seeded_provider_org=${ctx.serviceProvider.id}`)
  console.log(`seeded_client_org=${ctx.client.id}`)
  console.log(`seeded_jobs=${seededJobs.length}`)
  console.log(`seeded_assessments=${seededAssessments.length}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
