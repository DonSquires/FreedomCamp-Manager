/**
 * Testing Utilities for FreedomCamp Manager
 * 
 * Helper functions for smoke testing, data verification, and debugging
 */

import { supabase } from './supabase'
import { checkRailwayServicesHealth } from './railway'
import type { Database } from '@/types/database'

// Type aliases for query results
type Organization = Database['public']['Tables']['organizations']['Row']
type UserProfile = Database['public']['Tables']['user_profiles']['Row']
type CanonicalVehicle = Database['public']['Tables']['canonical_vehicles']['Row']
type Zone = Database['public']['Tables']['zones']['Row']
type Observation = Database['public']['Tables']['observations']['Row']
type BreachAlert = Database['public']['Tables']['breach_alerts']['Row']

// Types for tables not in database.ts
// These are manual definitions for tables that haven't been regenerated in the types file yet
type ComplianceResult = { observation_id: string }
type VehicleMonthlyStay = { plate_number: string; nights_stayed: number; consecutive_nights: number }

/**
 * Smoke Test Suite - Verify critical app functionality
 */
export const smokeTests = {
  /**
   * Test 1: Database Connectivity
   */
  async testDatabaseConnection() {
    console.log('🔍 Testing database connection...')
    
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .limit(1)
      
      if (error) throw error
      
      const orgs = data as Pick<Organization, 'id' | 'name'>[] | null
      console.log('✅ Database connection successful')
      console.log('   Sample organization:', orgs?.[0]?.name || 'None found')
      return { success: true, data }
    } catch (error: any) {
      console.error('❌ Database connection failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Test 2: Authentication
   */
  async testAuthentication() {
    console.log('🔍 Testing authentication...')
    
    try {
      const { data: { session }, error } = await supabase.auth.getSession()
      
      if (error) throw error
      
      if (session) {
        console.log('✅ User authenticated')
        console.log('   User ID:', session.user.id)
        console.log('   User Email:', session.user.email)
        return { success: true, user: session.user }
      } else {
        console.log('⚠️  No active session')
        return { success: false, error: 'Not authenticated' }
      }
    } catch (error: any) {
      console.error('❌ Authentication check failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Test 3: User Profile & Role
   */
  async testUserProfile() {
    console.log('🔍 Testing user profile...')
    
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, role, organization_id')
        .eq('id', session.user.id)
        .single()
      
      if (error) throw error
      
      const profile = data as Pick<UserProfile, 'id' | 'first_name' | 'last_name' | 'role' | 'organization_id'> | null
      console.log('✅ User profile loaded')
      console.log('   Name:', `${profile?.first_name} ${profile?.last_name}`)
      console.log('   Role:', profile?.role)
      console.log('   Organization ID:', profile?.organization_id)
      return { success: true, profile }
    } catch (error: any) {
      console.error('❌ User profile load failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Test 4: Vehicle Query
   */
  async testVehicleQuery() {
    console.log('🔍 Testing vehicle query...')
    
    try {
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('plate_number, vehicle_make, vehicle_model, total_observations')
        .limit(5)
      
      if (error) throw error
      
      const vehicles = data as Pick<CanonicalVehicle, 'plate_number' | 'vehicle_make' | 'vehicle_model' | 'total_observations'>[] | null
      console.log('✅ Vehicle query successful')
      console.log(`   Found ${vehicles?.length || 0} vehicles`)
      if (vehicles && vehicles.length > 0) {
        console.log('   Sample:', vehicles[0].plate_number, '-', vehicles[0].vehicle_make, vehicles[0].vehicle_model)
      }
      return { success: true, count: vehicles?.length || 0 }
    } catch (error: any) {
      console.error('❌ Vehicle query failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Test 5: Zone Query
   */
  async testZoneQuery() {
    console.log('🔍 Testing zone query...')
    
    try {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name, organization_id')
        .limit(5)
      
      if (error) throw error
      
      const zones = data as Pick<Zone, 'id' | 'name' | 'organization_id'>[] | null
      console.log('✅ Zone query successful')
      console.log(`   Found ${zones?.length || 0} zones`)
      if (zones && zones.length > 0) {
        console.log('   Sample:', zones[0].name)
      }
      return { success: true, count: zones?.length || 0 }
    } catch (error: any) {
      console.error('❌ Zone query failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Test 6: Observation Query
   */
  async testObservationQuery() {
    console.log('🔍 Testing observation query...')
    
    try {
      const { data, error } = await supabase
        .from('observations')
        .select('id, plate_number, recorded_at, is_compliant')
        .order('recorded_at', { ascending: false })
        .limit(10)
      
      if (error) throw error
      
      const observations = data as Pick<Observation, 'id' | 'plate_number' | 'recorded_at' | 'is_compliant'>[] | null
      console.log('✅ Observation query successful')
      console.log(`   Found ${observations?.length || 0} observations`)
      if (observations && observations.length > 0) {
        const latest = observations[0]
        console.log('   Latest:', latest.plate_number, 'at', new Date(latest.recorded_at).toLocaleString())
      }
      return { success: true, count: observations?.length || 0 }
    } catch (error: any) {
      console.error('❌ Observation query failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Test 7: Breach Alert Query
   */
  async testBreachAlertQuery() {
    console.log('🔍 Testing breach alert query...')
    
    try {
      const { data, error } = await supabase
        .from('breach_alerts')
        .select('id, plate_number, breach_type, status')
        .limit(10)
      
      if (error) throw error
      
      const breaches = data as Pick<BreachAlert, 'id' | 'plate_number' | 'breach_type' | 'status'>[] | null
      console.log('✅ Breach alert query successful')
      console.log(`   Found ${breaches?.length || 0} breach alerts`)
      if (breaches && breaches.length > 0) {
        const pending = breaches.filter(b => b.status === 'pending').length
        console.log('   Pending:', pending, '/', breaches.length)
      }
      return { success: true, count: breaches?.length || 0 }
    } catch (error: any) {
      console.error('❌ Breach alert query failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Test 8: Storage Bucket Access
   */
  async testStorageAccess() {
    console.log('🔍 Testing storage bucket access...')
    
    try {
      const { data, error } = await supabase.storage
        .from('scans')
        .list('', { limit: 5 })
      
      if (error) throw error
      
      console.log('✅ Storage access successful')
      console.log(`   Found ${data?.length || 0} files in scans bucket`)
      return { success: true, count: data?.length || 0 }
    } catch (error: any) {
      console.error('❌ Storage access failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Test 9: Edge Function Health
   */
  async testEdgeFunctionHealth() {
    console.log('🔍 Testing edge function health...')
    
    try {
      // Test a simple edge function
      const { data, error } = await supabase.functions.invoke('get-compliance-statistics', {
        body: {}
      })
      
      if (error) throw error
      
      console.log('✅ Edge function invocation successful')
      return { success: true, data }
    } catch (error: any) {
      console.error('❌ Edge function test failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Test 10: Railway Services Health
   */
  async testRailwayServices() {
    console.log('🔍 Testing Railway services...')
    
    try {
      const health = await checkRailwayServicesHealth()
      
      const allHealthy = health.proxy && health.inference
      
      if (allHealthy) {
        console.log('✅ Railway services healthy')
        console.log('   Proxy:', health.proxy)
        console.log('   Inference:', health.inference)
      } else {
        console.log('⚠️  Some Railway services unavailable')
        console.log('   Proxy:', health.proxy || 'OFFLINE')
        console.log('   Inference:', health.inference || 'OFFLINE')
      }
      
      return { success: allHealthy, health }
    } catch (error: any) {
      console.error('❌ Railway services check failed:', error.message)
      return { success: false, error: error.message }
    }
  },

  /**
   * Run all smoke tests
   */
  async runAll() {
    console.log('\n🚀 Running Complete Smoke Test Suite...\n')
    
    const results = {
      database: await this.testDatabaseConnection(),
      auth: await this.testAuthentication(),
      profile: await this.testUserProfile(),
      vehicles: await this.testVehicleQuery(),
      zones: await this.testZoneQuery(),
      observations: await this.testObservationQuery(),
      breaches: await this.testBreachAlertQuery(),
      storage: await this.testStorageAccess(),
      edgeFunctions: await this.testEdgeFunctionHealth(),
      railway: await this.testRailwayServices(),
    }

    console.log('\n📊 Test Summary:')
    const passed = Object.values(results).filter(r => r.success).length
    const total = Object.keys(results).length
    console.log(`   ✅ Passed: ${passed}/${total}`)
    console.log(`   ❌ Failed: ${total - passed}/${total}`)

    const allPassed = passed === total
    if (allPassed) {
      console.log('\n🎉 All tests passed! Application is ready.')
    } else {
      console.log('\n⚠️  Some tests failed. Check logs above for details.')
    }

    return {
      results,
      summary: { passed, total, allPassed }
    }
  }
}

/**
 * Data Verification Helpers
 */
export const dataVerification = {
  /**
   * Check for duplicate observations (same plate, zone, timestamp)
   */
  async checkDuplicateObservations() {
    const { data, error } = await supabase.rpc('check_duplicate_observations')
    if (error) {
      console.error('Duplicate check failed:', error)
      return null
    }
    return data
  },

  /**
   * Verify compliance state is populated on all observations
   * NOTE: compliance_results table was dropped in 20260221_rebuild_observations_clean.sql.
   * Compliance state (is_compliant, breach_type) is now stored directly on observations.
   */
  async verifyComplianceResults() {
    const { data: observationsData } = await supabase
      .from('observations')
      .select('id, is_compliant')
      
      .limit(100)

    const observations = observationsData as Array<Pick<Observation, 'id'> & { is_compliant: boolean }> | null
    if (!observations) return { total: 0, missing: 0 }

    // Compliance state is embedded directly on each observation (is_compliant column).
    // "Missing" compliance means is_compliant is null rather than a boolean.
    const total = observations.length
    const withCompliance = observations.filter(o => o.is_compliant !== null && o.is_compliant !== undefined).length
    const missingIds = observations
      .filter(o => o.is_compliant === null || o.is_compliant === undefined)
      .map(o => o.id)

    console.log(`Compliance State: ${withCompliance}/${total} observations have is_compliant set`)
    if (missingIds.length > 0) {
      console.warn(`Missing compliance state for ${missingIds.length} observations`)
    }

    return {
      total,
      withCompliance,
      missing: missingIds.length,
      missingIds,
    }
  },

  /**
   * Verify monthly stay counts are populated on observations for the current month.
   * NOTE: vehicle_monthly_stays is no longer auto-updated by the new observations pipeline.
   * nights_stayed_this_month and consecutive_nights are stored as snapshots directly
   * on each observation row. This function checks those fields instead.
   */
  async verifyMonthlyStays() {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const { data: obsData, error } = await (supabase as any)
      .from('observations')
      .select('plate_number, nights_stayed_this_month, consecutive_nights')
      
      .gte('recorded_at', monthStart)
      .limit(500)

    if (error) {
      console.error('Monthly stays check failed:', error)
      return null
    }

    const obs = (obsData as Array<{ plate_number: string; nights_stayed_this_month: number | null; consecutive_nights: number | null }>) ?? []

    // Deduplicate: most recent per plate (simplified count)
    const seen = new Set<string>()
    let totalNights = 0
    for (const o of obs) {
      if (!seen.has(o.plate_number)) {
        seen.add(o.plate_number)
        totalNights += o.nights_stayed_this_month ?? 0
      }
    }

    console.log(`Monthly Stay Snapshots (${monthStart.slice(0, 7)}): ${seen.size} unique vehicles tracked`)

    return {
      month: monthStart.slice(0, 7) + '-01',
      vehicleCount: seen.size,
      totalNights,
    }
  }
}

/**
 * Performance Testing
 */
export const performanceTests = {
  /**
   * Measure query performance
   */
  async measureQueryTime(queryName: string, queryFn: () => Promise<any>) {
    const start = performance.now()
    try {
      const result = await queryFn()
      const duration = performance.now() - start
      console.log(`⏱️  ${queryName}: ${duration.toFixed(2)}ms`)
      return { success: true, duration, result }
    } catch (error: any) {
      const duration = performance.now() - start
      console.error(`❌ ${queryName} failed after ${duration.toFixed(2)}ms:`, error.message)
      return { success: false, duration, error: error.message }
    }
  },

  /**
   * Run performance benchmark
   */
  async runBenchmark() {
    console.log('\n⏱️  Running Performance Benchmark...\n')

    const results = {
      vehicleList: await this.measureQueryTime('Vehicle List (100 records)', () =>
        supabase.from('canonical_vehicles').select('*').limit(100)
      ),
      zoneList: await this.measureQueryTime('Zone List (50 records)', () =>
        supabase.from('zones').select('*').limit(50)
      ),
      observationList: await this.measureQueryTime('Observation List (100 records)', () =>
        supabase.from('observations').select('*').order('recorded_at', { ascending: false }).limit(100)
      ),
      breachList: await this.measureQueryTime('Breach Alert List (100 records)', () =>
        supabase.from('breach_alerts').select('*').limit(100)
      ),
      dashboardStats: await this.measureQueryTime('Dashboard Stats', () =>
        supabase.rpc('get_admin_dashboard_stats')
      ),
    }

    console.log('\n📊 Performance Summary:')
    Object.entries(results).forEach(([name, result]) => {
      const status = result.success ? '✅' : '❌'
      console.log(`   ${status} ${name}: ${result.duration.toFixed(2)}ms`)
    })

    return results
  }
}

// Export convenience function for browser console
export async function runSmokeTests() {
  return await smokeTests.runAll()
}

// Window extension interface for browser console access
interface TestUtilsWindow {
  smokeTests?: typeof smokeTests
  dataVerification?: typeof dataVerification
  performanceTests?: typeof performanceTests
  runSmokeTests?: typeof runSmokeTests
}

// Make available in window for easy console access
if (typeof window !== 'undefined') {
  const win = window as TestUtilsWindow
  win.smokeTests = smokeTests
  win.dataVerification = dataVerification
  win.performanceTests = performanceTests
  win.runSmokeTests = runSmokeTests
}
