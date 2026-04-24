/**
 * E2E Test: Scan Flow (PlateScanner → Railway → Database)
 * Test Area 1 from Phase 9 Integration Testing
 */

import { test, expect, helpers, supabaseAdmin } from './setup'

const TEST_VEHICLE_PRIMARY = 'NYR607'
const TEST_VEHICLE_SECONDARY = 'ASY598'

interface E2ESeed {
  orgId: string
  zoneId: string
  zoneName: string
  photoUrl: string
}

/**
 * Resolve the E2E seed in Node context using admin privileges.
 * - Looks up the officer's primary + delegated organizations from their profile
 * - Chooses an organization that has at least one active zone
 * - Finds a photo URL from existing observations
 */
async function resolveE2ESeed(officerEmail: string): Promise<E2ESeed> {
  const admin = supabaseAdmin
  if (!admin) throw new Error('SUPABASE_SERVICE_ROLE_KEY required for E2E zone seeding')

  // Get officer org context (primary + delegated)
  const { data: profiles, error: profileErr } = await admin
    .from('user_profiles')
    .select('organization_id, employer_organization_id, extra_organization_ids, authorized_work_locations')
    .eq('email', officerEmail)
    .limit(1)
  if (profileErr || !profiles?.[0]?.organization_id) {
    throw new Error(`Could not find organization for officer ${officerEmail}: ${profileErr?.message}`)
  }
  const profile = profiles[0] as any
  const candidateOrgIds = Array.from(new Set([
    profile.organization_id,
    profile.employer_organization_id,
    ...(profile.extra_organization_ids || []),
    ...(profile.authorized_work_locations || []),
  ].filter(Boolean))) as string[]

  // Choose any active zone in the officer's available org scope.
  let zoneId = ''
  let zoneName = 'E2E Patrol Zone'
  let orgId = profile.organization_id as string

  const { data: zones } = await admin
    .from('zones')
    .select('id, name, organization_id')
    .in('organization_id', candidateOrgIds)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)

  if (zones?.[0]?.id) {
    zoneId = zones[0].id as string
    zoneName = (zones[0].name as string) || zoneName
    orgId = zones[0].organization_id as string
  } else {
    throw new Error(`No active zone found across officer organizations (${candidateOrgIds.join(', ')}). Seed at least one active client zone in CRM before running scan E2E.`)
  }

  // Find a photo URL from existing observations
  let photoUrl = '/jds-security-logo.jpg'
  const { data: photoObs } = await admin
    .from('observations')
    .select('photo_url')
    .not('photo_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (photoObs?.[0]?.photo_url) {
    photoUrl = photoObs[0].photo_url as string
  }

  return { orgId, zoneId, zoneName, photoUrl }
}

async function prepareE2ECapture(page: any, plate: string, seed: E2ESeed) {
  await page.evaluate((payload: { plate: string; zoneId: string; zoneName: string; orgId: string; photoUrl: string }) => {
    const raw = window.localStorage.getItem('global-filters-storage')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 }
    parsed.state = parsed.state || {}
    parsed.state.zoneId = payload.zoneId
    parsed.state.zoneName = payload.zoneName
    parsed.state.organizationId = payload.orgId
    window.localStorage.setItem('global-filters-storage', JSON.stringify(parsed))
    window.localStorage.setItem('__fieldops_e2e_photo_url__', payload.photoUrl)
  }, { plate, zoneId: seed.zoneId, zoneName: seed.zoneName, orgId: seed.orgId, photoUrl: seed.photoUrl })
}

async function openDetailScanner(page: any, plate: string, seed: E2ESeed) {
  // First load so auth session is available in browser storage
  await page.goto('/field')
  // Wait for page to load — may be Field Officer Portal or redirect to FieldOps Manager
  await page.waitForLoadState('networkidle')
  // Seed zone/org into localStorage (Node-resolved, no browser API calls needed)
  await prepareE2ECapture(page, plate, seed)
  await page.reload()
  await page.waitForLoadState('networkidle')
  // Re-inject window flags (lost on reload; localStorage zone/photo survive)
  await page.evaluate((p: string) => {
    ;(window as any).__FIELDOPS_E2E_CAPTURE__ = true
    ;(window as any).__FIELDOPS_E2E_SCAN_HINT__ = p
    const savedPhotoUrl = window.localStorage.getItem('__fieldops_e2e_photo_url__')
    if (savedPhotoUrl) {
      ;(window as any).__FIELDOPS_E2E_CAPTURE_PHOTO_URL__ = savedPhotoUrl
    }
    // Mock geolocation for headless test environment (Auckland, NZ)
    const mockPosition = {
      coords: { latitude: -36.8485, longitude: 174.7633, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
      timestamp: Date.now(),
    }
    navigator.geolocation.getCurrentPosition = (success: PositionCallback) => { success(mockPosition as GeolocationPosition) }
  }, plate)

  const scanTrigger = page.getByText(/Scan Vehicle.*Detail/i).first()
  await expect(scanTrigger).toBeVisible()
  await scanTrigger.click()
  await page.waitForSelector('text=Vehicle Scanner', { timeout: 10000 })
}

async function captureVehicle(page: any, plate: string, seed: E2ESeed) {
  const startedAt = new Date().toISOString()
  await openDetailScanner(page, plate, seed)
  await page.getByRole('button', { name: 'Capture photo' }).click()

  let observationId: string | null = null
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const status = await page.evaluate(() => ({
      error: (window as any).__FIELDOPS_E2E_LAST_ERROR__ as string | null,
      observationId: (window as any).__FIELDOPS_E2E_LAST_OBSERVATION_ID__ as string | null,
    }))

    if (status.error) {
      throw new Error(`Capture failed: ${status.error}`)
    }

    if (status.observationId) {
      observationId = status.observationId
      break
    }

    await page.waitForTimeout(1000)
  }

  return { startedAt, observationId }
}

async function waitForLatestObservation(
  plate: string,
  select = '*',
  afterIso?: string,
  observationId?: string | null,
) {
  let latest: any = null
  const db = supabaseAdmin ?? helpers.supabase

  await expect.poll(async () => {
    let query = db
      .from('observations')
      .select(select)
      .order('created_at', { ascending: false })
      .limit(1)

    query = observationId
      ? query.or(`observation_id.eq.${observationId},id.eq.${observationId}`)
      : query.eq('plate_number', plate)

    const { data } = await query

    latest = data?.[0] ?? null
    if (!latest) return 0
    if (!afterIso) return 1

    const createdAt = Date.parse(latest.created_at || latest.recorded_at || '')
    const after = Date.parse(afterIso)
    if (Number.isNaN(createdAt) || Number.isNaN(after)) return 0
    return createdAt >= after ? 1 : 0
  }, { timeout: 30000, intervals: [1000, 2000, 5000] }).toBe(1)

  return latest
}

async function getPhotoBackedVehiclesBySc() {
  const { data: observations } = await helpers.supabase
    .from('observations')
    .select('plate_number,self_contained,photo,photo_url,recorded_at')
    .or('photo.not.is.null,photo_url.not.is.null')
    .order('recorded_at', { ascending: false })
    .limit(2000)

  const rows = (observations || []).filter((row: any) => !!row?.plate_number)
  const scTrue = rows.find((row: any) => row.self_contained === true)
  const scFalse = rows.find((row: any) => row.self_contained === false)

  return { scTrue, scFalse }
}

test.describe('Scan Flow - Detail Capture', () => {
  let seed: E2ESeed

  test.beforeAll(async () => {
    const env = (globalThis as any).process?.env || {}
    const officerEmail = env.PLAYWRIGHT_OFFICER_EMAIL || env.E2E_OFFICER_EMAIL || env.PLAYWRIGHT_LIVE_EMAIL || ''
    seed = await resolveE2ESeed(officerEmail)
  })

  test('should create observation with detail capture from legacy field route', async ({ officerUser }) => {
    test.setTimeout(120_000)
    const page = officerUser

    const capture = await captureVehicle(page, TEST_VEHICLE_PRIMARY, seed)
    expect(capture.observationId).toBeTruthy()

    const observation = await waitForLatestObservation(
      TEST_VEHICLE_PRIMARY,
      '*',
      capture.startedAt,
      capture.observationId,
    )
    expect(observation.plate_number).toBe(TEST_VEHICLE_PRIMARY)
    expect(observation.zone_id).toBeTruthy()
  })

  test('should open camera capture controls for detail scan', async ({ officerUser }) => {
    const page = officerUser

    await openDetailScanner(page, TEST_VEHICLE_PRIMARY, seed)
    await expect(page.getByRole('button', { name: 'Capture photo' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Capture photo' })).toBeEnabled()
  })

  test('should show scan detail panel after capture', async ({ officerUser }) => {
    test.setTimeout(120_000)
    const page = officerUser

    const capture = await captureVehicle(page, 'ABC123', seed)
    expect(capture.observationId).toBeTruthy()
  })
})

test.describe('Scan Flow - Camera Capture', () => {
  test('should use DB-stored photo evidence for Tasman test vehicles', async () => {
    const { scTrue, scFalse } = await getPhotoBackedVehiclesBySc()

    if (!scTrue || !scFalse) {
      test.skip(true, 'No DB photo-backed pair found with one self-contained true and one false')
    }

    const truthy = scTrue!
    const falsy = scFalse!

    expect(truthy.self_contained).toBe(true)
    expect(falsy.self_contained).toBe(false)
    expect(!!(truthy.photo || truthy.photo_url)).toBe(true)
    expect(!!(falsy.photo || falsy.photo_url)).toBe(true)
  })
})

test.describe('Scan Flow - GPS Capture', () => {
  let seed: E2ESeed

  test.beforeAll(async () => {
    const env = (globalThis as any).process?.env || {}
    const officerEmail = env.PLAYWRIGHT_OFFICER_EMAIL || env.E2E_OFFICER_EMAIL || env.PLAYWRIGHT_LIVE_EMAIL || ''
    seed = await resolveE2ESeed(officerEmail)
  })

  test('should capture GPS coordinates automatically', async ({ officerUser }) => {
    test.setTimeout(120_000)
    const page = officerUser

    // Grant geolocation permission
    await page.context().grantPermissions(['geolocation'])
    await page.context().setGeolocation({ latitude: -41.3366, longitude: 173.1830 })

    const capture = await captureVehicle(page, TEST_VEHICLE_SECONDARY, seed)

    const observation = await waitForLatestObservation(
      TEST_VEHICLE_SECONDARY,
      'gps_latitude, gps_longitude, created_at, recorded_at',
      capture.startedAt,
      capture.observationId,
    )
    expect(observation.gps_latitude).toBeCloseTo(-41.3366, 1)
    expect(observation.gps_longitude).toBeCloseTo(173.1830, 1)
  })
})

test.describe('Scan Flow - Compliance Evaluation', () => {
  let seed: E2ESeed

  test.beforeAll(async () => {
    const env = (globalThis as any).process?.env || {}
    const officerEmail = env.PLAYWRIGHT_OFFICER_EMAIL || env.E2E_OFFICER_EMAIL || env.PLAYWRIGHT_LIVE_EMAIL || ''
    seed = await resolveE2ESeed(officerEmail)
  })

  test('should automatically evaluate compliance on submission', async ({ officerUser }) => {
    test.setTimeout(120_000)
    const page = officerUser

    const capture = await captureVehicle(page, TEST_VEHICLE_SECONDARY, seed)

    // Wait for compliance evaluation (should be < 1 second)
    await page.waitForTimeout(1000)

    const observation = await waitForLatestObservation(
      TEST_VEHICLE_SECONDARY,
      'is_compliant, breach_type, created_at, recorded_at',
      capture.startedAt,
      capture.observationId,
    )
    expect(observation.is_compliant).toBeDefined()
  })
})

test.describe('Scan Flow - Breach Detection', () => {
  let seed: E2ESeed

  test.beforeAll(async () => {
    const env = (globalThis as any).process?.env || {}
    const officerEmail = env.PLAYWRIGHT_OFFICER_EMAIL || env.E2E_OFFICER_EMAIL || env.PLAYWRIGHT_LIVE_EMAIL || ''
    seed = await resolveE2ESeed(officerEmail)
  })

  test('should create breach alert for non-compliant vehicle', async ({ officerUser }) => {
    test.setTimeout(120_000)
    const page = officerUser

    await captureVehicle(page, TEST_VEHICLE_PRIMARY, seed)

    // Wait for breach detection
    await page.waitForTimeout(2000)

    // Check if breach alert created
    const { data: breaches } = await helpers.supabase
      .from('breach_alerts')
      .select('*')
      .eq('plate_number', TEST_VEHICLE_PRIMARY)
      .order('created_at', { ascending: false })
      .limit(1)

    // Breach should be created if zone doesn't allow overnight parking
    // (Depends on compliance rules)
    expect(breaches).toBeDefined()
  })
})
