/**
 * Synthetic Org Fixture — Zero Cross-Contamination Multi-Tenant Testing
 *
 * Implements the "Synthetic Data Injection" pattern:
 * Creates a brand-new, uniquely-named test organization in Supabase before
 * each test that uses this fixture, runs the test, and then garbage-collects
 * the test org (and all its data) after the test completes.
 *
 * Why: In a multi-tenant system you cannot clone the production database for
 * tests. Dirty data from previous failed test runs causes cascading false
 * failures. Synthetic orgs give each test a clean, isolated data context.
 *
 * Usage:
 *   import { test } from '../fixtures/synth-org'
 *   test('roster planner shows zones for new org', async ({ page, synthOrg }) => {
 *     console.log(synthOrg.id, synthOrg.name)
 *     await page.goto('/roster')
 *     ...
 *   })
 *
 * Requires: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the test env.
 * The service role key is needed to bypass RLS during setup/teardown.
 */

import { test as base } from '@playwright/test'

export interface SynthOrg {
  /** UUID of the newly created test org */
  id: string
  /** Human-readable unique name (includes test run timestamp + random suffix) */
  name: string
  /** Unix timestamp (ms) when the org was created */
  createdAt: number
}

async function createTestOrg(supabaseUrl: string, serviceRoleKey: string): Promise<SynthOrg> {
  const ts = Date.now()
  const suffix = Math.random().toString(36).slice(2, 7)
  const name = `[TEST-AUTO] E2E Org ${ts}-${suffix}`

  const resp = await fetch(`${supabaseUrl}/rest/v1/organizations`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      name,
      slug: `test-auto-${suffix}`,
      is_active: true,
      contact_email: `e2e-${suffix}@test.invalid`,
    }),
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`synth-org: failed to create test org (HTTP ${resp.status}): ${body.slice(0, 300)}`)
  }

  const rows = await resp.json()
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row?.id) throw new Error(`synth-org: unexpected response shape: ${JSON.stringify(row)}`)

  return { id: row.id, name, createdAt: ts }
}

async function deleteTestOrg(supabaseUrl: string, serviceRoleKey: string, orgId: string): Promise<void> {
  // Delete sub-resources first to avoid FK constraint failures on Supabase
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }

  // Best-effort sub-resource cleanup (continue even if individual deletes fail)
  const subTables = [
    `notifications?organization_id=eq.${orgId}`,
    `roster_shifts?organization_id=eq.${orgId}`,
    `zones?organization_id=eq.${orgId}`,
    `client_sites?organization_id=eq.${orgId}`,
    `user_profiles?organization_id=eq.${orgId}`,
  ]

  for (const table of subTables) {
    await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: 'DELETE',
      headers,
    }).catch(() => {})
  }

  // Delete the org itself
  const res = await fetch(`${supabaseUrl}/rest/v1/organizations?id=eq.${orgId}`, {
    method: 'DELETE',
    headers,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`synth-org: teardown delete returned ${res.status}: ${body.slice(0, 200)}`)
  }
}

interface SynthOrgFixtures {
  /** A freshly-created, isolated test org. Deleted after the test completes. */
  synthOrg: SynthOrg
}

export const test = base.extend<SynthOrgFixtures>({
  synthOrg: async ({}, use) => {
    const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

    if (!supabaseUrl || !serviceKey) {
      // Skip synthetic org creation silently when credentials are absent
      // (e.g. pure-UI tests that don't need live data)
      await use({ id: 'none', name: '[no-synth-org]', createdAt: Date.now() })
      return
    }

    let org: SynthOrg | undefined
    try {
      org = await createTestOrg(supabaseUrl, serviceKey)
      await use(org)
    } finally {
      if (org && org.id !== 'none') {
        await deleteTestOrg(supabaseUrl, serviceKey, org.id)
      }
    }
  },
})

export { expect } from '@playwright/test'
