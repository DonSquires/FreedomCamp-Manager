import { test as base } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { loginAs } from './auth'

const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
export const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null

export interface SyntheticOrganization {
  id: string
  name: string
}

async function createSyntheticOrganization(): Promise<SyntheticOrganization> {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for synthetic organization fixtures')
  }

  const name = `Playwright Synthetic Org ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({
      name,
      // Keep fixture values aligned with the live DB check constraint enum.
      organization_type: 'client',
      is_active: true,
      overnight_verification_mode: 'two_photo_verification',
    })
    .select('id, name')
    .single()

  if (error || !data) throw error || new Error('Failed to create synthetic organization')
  return data as SyntheticOrganization
}

async function deleteSyntheticOrganization(organizationId: string): Promise<void> {
  if (!supabaseAdmin) return
  await supabaseAdmin.from('organizations').delete().eq('id', organizationId)
}

export async function applySyntheticOrganization(page: any, organization: SyntheticOrganization): Promise<void> {
  await page.evaluate(({ id, name }) => {
    window.localStorage.setItem(
      'global-filters-storage',
      JSON.stringify({
        state: {
          dateFrom: null,
          dateTo: null,
          datePreset: null,
          organizationId: id,
          organizationName: name,
          zoneId: null,
          zoneName: null,
        },
        version: 2,
      }),
    )
  }, organization)
}

/**
 * Test fixtures for authentication and common setup
 */
export const test = base.extend<{
  authenticatedPage: any
  masterUser: any
  adminUser: any
  officerUser: any
  syntheticOrganization: SyntheticOrganization
}>({
  // Master user authentication
  masterUser: async ({ page }, use) => {
    await loginAs(page, 'master')
    await use(page)
  },

  // Admin user authentication
  adminUser: async ({ page }, use) => {
    await loginAs(page, 'adminOrg1')
    await use(page)
  },

  // Officer user authentication
  officerUser: async ({ page }, use) => {
    await loginAs(page, 'officerOrg1')
    await use(page)
  },

  syntheticOrganization: async ({}, use) => {
    const organization = await createSyntheticOrganization()
    try {
      await use(organization)
    } finally {
      await deleteSyntheticOrganization(organization.id)
    }
  },
})

export { expect } from '@playwright/test'

/**
 * Helper functions
 */
export const helpers = {
  supabase,

  /**
   * Wait for toast notification
   */
  async waitForToast(page: any, message: string) {
    await page.waitForSelector(`text=${message}`, { timeout: 5000 })
  },

  /**
   * Clear test data from database
   */
  async clearTestData() {
    // Delete test observations
    await supabase.from('observations').delete().like('id', 'o%')
    
    // Delete test breaches
    await supabase.from('breach_alerts').delete().like('id', 'b%')
    
    // Delete test patrols
    await supabase.from('patrols').delete().like('id', 'p%')
  },

  /**
   * Create test observation
   */
  async createTestObservation(data: {
    plate_number: string
    zone_id: string
    organization_id: string
    recorded_by: string
    is_compliant?: boolean
  }) {
    const { data: observation, error } = await supabase
      .from('observations')
      .insert({
        plate_number: data.plate_number,
        photo_url: 'https://example.com/test-photo.jpg',
        photo_hash: 'test-hash-' + Date.now(),
        recorded_at: new Date().toISOString(),
        zone_id: data.zone_id,
        organization_id: data.organization_id,
        gps_latitude: -36.8485,
        gps_longitude: 174.7633,
        gps_accuracy: 10.0,
        recorded_by: data.recorded_by,
        is_compliant: data.is_compliant ?? true,
      })
      .select()
      .single()

    if (error) throw error
    return observation
  },
}
