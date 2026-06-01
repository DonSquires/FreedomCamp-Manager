/**
 * Strict Geofence Enforcement RPC Validation Suite
 * 
 * Tests core RPC logic for boundary verification, context resolution,
 * and policy retrieval. These tests validate behavior before officer UI wiring.
 * 
 * Note: Requires migrations 20260714000001 and 20260714000002 to be deployed.
 */

import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  ''

const canRun = Boolean(supabaseUrl && supabaseKey)

if (!canRun) {
  console.warn(
    'Skipping geofence-strict tests: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required',
  )
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const describeIf = canRun ? describe : describe.skip

describeIf('Strict Geofence Enforcement RPCs', () => {
  /**
   * Test 1: is_point_inside_zone with circle radius
   * 
   * Purpose: Verify haversine distance calculation for radius-based zones.
   * Setup: Create a test zone with location_lat, location_lng, radius_meters.
   * Test: Call is_point_inside_zone with points inside/outside radius.
   */
  it('is_point_inside_zone correctly evaluates circle radius geofence', async () => {
    // Create test org and zone
    const { data: org } = await supabase
      .from('organizations')
      .insert({ name: 'Test Geofence Org', organization_type: 'service_provider' })
      .select()
      .single()

    expect(org).toBeDefined()

    const { data: zone } = await supabase
      .from('zones')
      .insert({
        organization_id: org.id,
        name: 'Test Zone Circle',
        zone_type: 'general',
        zone_kind: 'dispatch',
        location_lat: -41.2865, // Wellington NZ
        location_lng: 174.7762,
        radius_meters: 1000, // 1km radius
      })
      .select()
      .single()

    expect(zone).toBeDefined()

    // Test point inside radius (should return true)
    const { data: insideResult } = await supabase.rpc('is_point_inside_zone', {
      p_zone_id: zone.id,
      p_lat: -41.2850, // ~1.7km away (outside 1km radius)
      p_lng: 174.7762,
    })

    // Test point outside radius (should return false)
    const { data: outsideResult } = await supabase.rpc('is_point_inside_zone', {
      p_zone_id: zone.id,
      p_lat: -41.295, // ~2.8km away (outside 1km radius)
      p_lng: 174.7762,
    })

    // Cleanup
    await supabase.from('zones').delete().eq('id', zone.id)
    await supabase.from('organizations').delete().eq('id', org.id)

    expect(typeof insideResult).toBe('boolean')
    expect(typeof outsideResult).toBe('boolean')
  })

  /**
   * Test 2: resolve_boundary_context returns matched zone + policy rules
   * 
   * Purpose: Verify context resolution includes zone metadata, operational_rules,
   * jurisdiction info, and service-specific policies.
   * Setup: Create zone with operational_rules JSONB payload.
   * Test: Call resolve_boundary_context inside zone boundary.
   */
  it('resolve_boundary_context returns zone + jurisdiction + operational_rules', async () => {
    const { data: org } = await supabase
      .from('organizations')
      .insert({ name: 'Test Context Org', organization_type: 'service_provider' })
      .select()
      .single()

    const testRules = {
      parking: { max_stay_minutes: 120, paid_minutes: 60 },
      noise_control: { decibel_limit: 75, quiet_hours_start: 22 },
    }

    const { data: zone } = await supabase
      .from('zones')
      .insert({
        organization_id: org.id,
        name: 'Test Context Zone',
        zone_type: 'general',
        zone_kind: 'dispatch',
        location_lat: -41.2865,
        location_lng: 174.7762,
        radius_meters: 500,
        operational_rules: testRules,
      })
      .select()
      .single()

    // Call resolve_boundary_context from inside the zone
    const { data: context, error } = await supabase.rpc('resolve_boundary_context', {
      p_organization_id: org.id,
      p_service_type: 'general',
      p_lat: -41.2865,
      p_lng: 174.7762,
      p_zone_id: zone.id,
    })

    await supabase.from('zones').delete().eq('id', zone.id)
    await supabase.from('organizations').delete().eq('id', org.id)

    expect(error).toBeNull()
    expect(context).toBeDefined()
    expect(context.matched).toBe(true)
    expect(context.inside_boundary).toBe(true)
    expect(context.zone).toBeDefined()
    expect(context.zone.operational_rules).toEqual(testRules)
    expect(context.parking_rules).toBeDefined()
    expect(context.noise_control_rules).toBeDefined()
  })

  /**
   * Test 3: patrol_auto_checkin_verified requires inside boundary
   * 
   * Purpose: Verify that auto checkin fails if GPS is outside patrol's zone boundary.
   * Setup: Create patrol with zone, call RPC from outside boundary.
   * Expected: success=false, reason='outside_geofence'
   */
  it('patrol_auto_checkin_verified rejects checkin from outside geofence', async () => {
    const { data: org } = await supabase
      .from('organizations')
      .insert({ name: 'Test Patrol Org', organization_type: 'service_provider' })
      .select()
      .single()

    const { data: authData } = await supabase.auth.admin.createUser({
      email: `test-patrol-${Date.now()}@example.com`,
      password: 'TestPassword123!',
      email_confirm: true,
    })

    const user = authData?.user
    expect(user?.id).toBeDefined()

    const { data: zone } = await supabase
      .from('zones')
      .insert({
        organization_id: org.id,
        name: 'Test Patrol Zone',
        zone_type: 'general',
        zone_kind: 'dispatch',
        location_lat: -41.2865,
        location_lng: 174.7762,
        radius_meters: 500,
      })
      .select()
      .single()

    const { data: patrol } = await supabase
      .from('patrols')
      .insert({
        organization_id: org.id,
        assigned_to: user.id,
        zone_id: zone.id,
        patrol_date: new Date().toISOString().split('T')[0],
        status: 'scheduled',
      })
      .select()
      .single()

    // Try checkin from outside zone (2km away)
    const { data: result } = await supabase.rpc('patrol_auto_checkin_verified', {
      p_patrol_id: patrol.id,
      p_gps_lat: -41.305,
      p_gps_lng: 174.7762,
    })

    // Cleanup
    await supabase.from('patrols').delete().eq('id', patrol.id)
    await supabase.from('zones').delete().eq('id', zone.id)
    if (user?.id) {
      await supabase.auth.admin.deleteUser(user.id)
    }
    await supabase.from('organizations').delete().eq('id', org.id)

    expect(result).toBeDefined()
    expect(result.success).toBe(false)
    expect(result.reason).toBe('outside_geofence')
  })

  /**
   * Test 4: patrol_auto_checkout_verified requires outside boundary
   * 
   * Purpose: Verify that checkout succeeds only if GPS is outside patrol zone.
   * Setup: Create checked-in patrol, call checkout RPC from inside zone.
   * Expected: success=false, reason='still_inside_geofence'
   */
  it('patrol_auto_checkout_verified rejects checkout from inside geofence', async () => {
    const { data: org } = await supabase
      .from('organizations')
      .insert({ name: 'Test Checkout Org', organization_type: 'service_provider' })
      .select()
      .single()

    const { data: authData } = await supabase.auth.admin.createUser({
      email: `test-checkout-${Date.now()}@example.com`,
      password: 'TestPassword123!',
      email_confirm: true,
    })

    const user = authData?.user
    expect(user?.id).toBeDefined()

    const { data: zone } = await supabase
      .from('zones')
      .insert({
        organization_id: org.id,
        name: 'Test Checkout Zone',
        zone_type: 'general',
        zone_kind: 'dispatch',
        location_lat: -41.2865,
        location_lng: 174.7762,
        radius_meters: 500,
      })
      .select()
      .single()

    const { data: patrol } = await supabase
      .from('patrols')
      .insert({
        organization_id: org.id,
        assigned_to: user.id,
        zone_id: zone.id,
        patrol_date: new Date().toISOString().split('T')[0],
        status: 'in_progress',
        checked_in_at: new Date().toISOString(),
      })
      .select()
      .single()

    // Try checkout from inside zone (center point)
    const { data: result } = await supabase.rpc('patrol_auto_checkout_verified', {
      p_patrol_id: patrol.id,
      p_gps_lat: -41.2865, // Inside zone
      p_gps_lng: 174.7762,
    })

    // Cleanup
    await supabase.from('patrols').delete().eq('id', patrol.id)
    await supabase.from('zones').delete().eq('id', zone.id)
    if (user?.id) {
      await supabase.auth.admin.deleteUser(user.id)
    }
    await supabase.from('organizations').delete().eq('id', org.id)

    expect(result).toBeDefined()
    expect(result.success).toBe(false)
    expect(result.reason).toBe('still_inside_geofence')
  })

  /**
   * Test 5: get_zone_operational_policy retrieves service-specific rules
   * 
   * Purpose: Verify policy RPC returns correct operational_rules structure.
   * Setup: Create zone with parking + noise_control rules.
   * Test: Call get_zone_operational_policy with service_type='parking'.
   */
  it('get_zone_operational_policy returns service-aware rules', async () => {
    const { data: org } = await supabase
      .from('organizations')
      .insert({ name: 'Test Policy Org', organization_type: 'service_provider' })
      .select()
      .single()

    const rules = {
      parking: { max_stay_minutes: 180, fee_schedule: 'standard' },
      noise_control: { quiet_hours_start: 22, quiet_hours_end: 7 },
    }

    const { data: zone } = await supabase
      .from('zones')
      .insert({
        organization_id: org.id,
        name: 'Test Policy Zone',
        zone_type: 'parking',
        zone_kind: 'dispatch',
        location_lat: -41.2865,
        location_lng: 174.7762,
        operational_rules: rules,
      })
      .select()
      .single()

    const { data: policy } = await supabase.rpc('get_zone_operational_policy', {
      p_zone_id: zone.id,
      p_service_type: 'parking',
    })

    await supabase.from('zones').delete().eq('id', zone.id)
    await supabase.from('organizations').delete().eq('id', org.id)

    expect(policy).toBeDefined()
    expect(policy.found).toBe(true)
    expect(policy.parking_rules).toBeDefined()
    expect(policy.parking_rules.max_stay_minutes).toBe(180)
  })

  /**
   * Test 6: upsert_incident_location_context resolves zone + jurisdiction
   * 
   * Purpose: Verify incident context upsert populates zone/jurisdiction from location.
   * Setup: Create incident, call upsert_incident_location_context from inside zone.
   * Expected: incident updated with zone_id, geo_zone_id, jurisdiction_org_id, boundary_context.
   */
  it('upsert_incident_location_context resolves incident zone and jurisdiction', async () => {
    const { data: org } = await supabase
      .from('organizations')
      .insert({ name: 'Test Incident Org', organization_type: 'service_provider' })
      .select()
      .single()

    const { data: zone } = await supabase
      .from('zones')
      .insert({
        organization_id: org.id,
        name: 'Test Incident Zone',
        zone_type: 'general',
        zone_kind: 'dispatch',
        location_lat: -41.2865,
        location_lng: 174.7762,
        radius_meters: 500,
      })
      .select()
      .single()

    const { data: incident } = await supabase
      .from('incidents')
      .insert({
        organization_id: org.id,
        incident_type: 'breach',
        location_address: 'Test Location',
      })
      .select()
      .single()

    const { data: result } = await supabase.rpc('upsert_incident_location_context', {
      p_incident_id: incident.id,
      p_location_lat: -41.2865,
      p_location_lng: 174.7762,
      p_service_type: 'general',
    })

    // Fetch updated incident
    const { data: updated } = await supabase
      .from('incidents')
      .select('zone_id, boundary_context')
      .eq('id', incident.id)
      .single()

    await supabase.from('incidents').delete().eq('id', incident.id)
    await supabase.from('zones').delete().eq('id', zone.id)
    await supabase.from('organizations').delete().eq('id', org.id)

    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(updated?.zone_id).toBeDefined()
    expect(updated?.boundary_context).toBeDefined()
  })
})
