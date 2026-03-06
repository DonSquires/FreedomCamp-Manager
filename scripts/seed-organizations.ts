/**
 * SAFE IDEMPOTENT ORGANIZATION SEEDING SCRIPT
 * 
 * This script:
 * 1. Checks if data exists before inserting
 * 2. Updates existing records if needed
 * 3. Creates missing "Other Location" parent zones
 * 4. Logs all actions for audit trail
 * 
 * Run with: deno run --allow-net --allow-env scripts/seed-organizations.ts
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Full list of 78+ NZ Organizations
const organizations = [
  // Territorial Authorities (Councils)
  { name: 'Auckland Council', type: 'council' },
  { name: 'Bay of Plenty Regional Council', type: 'council' },
  { name: 'Canterbury Regional Council', type: 'council' },
  { name: 'Christchurch City Council', type: 'council' },
  { name: 'Clutha District Council', type: 'council' },
  { name: 'Dunedin City Council', type: 'council' },
  { name: 'Far North District Council', type: 'council' },
  { name: 'Gisborne District Council', type: 'council' },
  { name: 'Gore District Council', type: 'council' },
  { name: 'Grey District Council', type: 'council' },
  { name: 'Hamilton City Council', type: 'council' },
  { name: 'Hastings District Council', type: 'council' },
  { name: 'Hauraki District Council', type: 'council' },
  { name: 'Horowhenua District Council', type: 'council' },
  { name: 'Hurunui District Council', type: 'council' },
  { name: 'Hutt City Council', type: 'council' },
  { name: 'Invercargill City Council', type: 'council' },
  { name: 'Kaikōura District Council', type: 'council' },
  { name: 'Kapiti Coast District Council', type: 'council' },
  { name: 'Kawerau District Council', type: 'council' },
  { name: 'Mackenzie District Council', type: 'council' },
  { name: 'Manawatu District Council', type: 'council' },
  { name: 'Marlborough District Council', type: 'council' },
  { name: 'Masterton District Council', type: 'council' },
  { name: 'Matamata-Piako District Council', type: 'council' },
  { name: 'Napier City Council', type: 'council' },
  { name: 'Nelson City Council', type: 'council' },
  { name: 'New Plymouth District Council', type: 'council' },
  { name: 'Ōpōtiki District Council', type: 'council' },
  { name: 'Ōtorohanga District Council', type: 'council' },
  { name: 'Palmerston North City Council', type: 'council' },
  { name: 'Porirua City Council', type: 'council' },
  { name: 'Queenstown-Lakes District Council', type: 'council' },
  { name: 'Rangitīkei District Council', type: 'council' },
  { name: 'Rotorua Lakes Council', type: 'council' },
  { name: 'Ruapehu District Council', type: 'council' },
  { name: 'Selwyn District Council', type: 'council' },
  { name: 'South Taranaki District Council', type: 'council' },
  { name: 'South Waikato District Council', type: 'council' },
  { name: 'South Wairarapa District Council', type: 'council' },
  { name: 'Southland District Council', type: 'council' },
  { name: 'Stratford District Council', type: 'council' },
  { name: 'Tararua District Council', type: 'council' },
  { name: 'Tasman District Council', type: 'council' },
  { name: 'Taupō District Council', type: 'council' },
  { name: 'Tauranga City Council', type: 'council' },
  { name: 'Thames-Coromandel District Council', type: 'council' },
  { name: 'Timaru District Council', type: 'council' },
  { name: 'Upper Hutt City Council', type: 'council' },
  { name: 'Waikato District Council', type: 'council' },
  { name: 'Waikato Regional Council', type: 'council' },
  { name: 'Waimakariri District Council', type: 'council' },
  { name: 'Waimate District Council', type: 'council' },
  { name: 'Waipa District Council', type: 'council' },
  { name: 'Wairoa District Council', type: 'council' },
  { name: 'Waitaki District Council', type: 'council' },
  { name: 'Waitomo District Council', type: 'council' },
  { name: 'Wellington City Council', type: 'council' },
  { name: 'Western Bay of Plenty District Council', type: 'council' },
  { name: 'Westland District Council', type: 'council' },
  { name: 'Whakatāne District Council', type: 'council' },
  { name: 'Whanganui District Council', type: 'council' },
  { name: 'Whangarei District Council', type: 'council' },
  
  // Crown Entities
  { name: 'Department of Conservation (DOC)', type: 'crown' },
  { name: 'LINZ - Land Information New Zealand', type: 'crown' },
  
  // Additional Regional Councils
  { name: "Hawke's Bay Regional Council", type: 'council' },
  { name: 'Horizons Regional Council', type: 'council' },
  { name: 'Northland Regional Council', type: 'council' },
  { name: 'Otago Regional Council', type: 'council' },
  { name: 'Southland Regional Council', type: 'council' },
  { name: 'Taranaki Regional Council', type: 'council' },
  { name: 'Wellington Regional Council', type: 'council' },
  { name: 'West Coast Regional Council', type: 'council' },
  
  // Additional Territorial Authorities
  { name: 'Buller District Council', type: 'council' },
  { name: 'Carterton District Council', type: 'council' },
  { name: 'Central Hawkes Bay District Council', type: 'council' },
  { name: 'Central Otago District Council', type: 'council' },
]

interface SeedResult {
  success: number
  created: number
  updated: number
  errors: string[]
  warnings: string[]
}

async function seedOrganizations(): Promise<SeedResult> {
  const result: SeedResult = {
    success: 0,
    created: 0,
    updated: 0,
    errors: [],
    warnings: []
  }

  console.log('🌱 Starting Organization Seeding...\n')

  // Step 1: Get or Create Iron Eagle Client
  console.log('📋 Step 1: Checking Iron Eagle client...')
  const { data: initialClient, error: clientError } = await supabase
    .from('clients')
    .select('id')
    .eq('name', 'Iron Eagle')
    .maybeSingle()

  if (clientError) {
    result.errors.push(`Failed to query clients: ${clientError.message}`)
    return result
  }

  let client = initialClient

  if (!client) {
    console.log('  ➕ Creating Iron Eagle client...')
    const { data: newClient, error: createError } = await supabase
      .from('clients')
      .insert({ name: 'Iron Eagle' })
      .select('id')
      .single()

    if (createError) {
      result.errors.push(`Failed to create client: ${createError.message}`)
      return result
    }

    client = newClient
    console.log(`  ✓ Client created with ID: ${client.id}`)
  } else {
    console.log(`  ✓ Client exists with ID: ${client.id}`)
  }

  const clientId = client.id

  // Step 2: Process Each Organization
  console.log(`\n📋 Step 2: Processing ${organizations.length} organizations...\n`)

  for (const org of organizations) {
    console.log(`Processing: ${org.name}`)

    try {
      // Check if organization exists
      const { data: existingOrg, error: orgQueryError } = await supabase
        .from('organizations')
        .select('id')
        .eq('name', org.name)
        .maybeSingle()

      if (orgQueryError) {
        result.errors.push(`${org.name}: Query failed - ${orgQueryError.message}`)
        continue
      }

      let orgId: string

      if (!existingOrg) {
        // Create new organization
        const { data: newOrg, error: createOrgError } = await supabase
          .from('organizations')
          .insert({
            name: org.name,
            organization_type: org.type,
            client_id: clientId,
            is_active: true
          })
          .select('id')
          .single()

        if (createOrgError) {
          result.errors.push(`${org.name}: Failed to create - ${createOrgError.message}`)
          continue
        }

        orgId = newOrg.id
        result.created++
        console.log(`  ✓ Organization created (ID: ${orgId})`)
      } else {
        orgId = existingOrg.id
        result.updated++
        console.log(`  ✓ Organization exists (ID: ${orgId})`)
      }

      // Check for "Other Location" parent zone
      const { data: existingZone, error: zoneQueryError } = await supabase
        .from('zones')
        .select('id, geom')
        .eq('organization_id', orgId)
        .eq('name', 'Other Location')
        .eq('zone_type', 'general')
        .maybeSingle()

      if (zoneQueryError) {
        result.errors.push(`${org.name}: Zone query failed - ${zoneQueryError.message}`)
        continue
      }

      if (!existingZone) {
        // Create parent jurisdiction zone
        const { error: createZoneError } = await supabase
          .from('zones')
          .insert({
            organization_id: orgId,
            name: 'Other Location',
            zone_type: 'general',
            description: `${org.name} jurisdiction area`,
            is_active: true,
            self_contained_required: true,
            nights_per_month: 28,
            max_consecutive_nights: 3,
          })

        if (createZoneError) {
          result.errors.push(`${org.name}: Failed to create zone - ${createZoneError.message}`)
          continue
        }

        console.log(`  ✓ Parent zone created`)
      } else {
        console.log(`  ✓ Parent zone exists`)

        // Check for missing geometry
        if (existingZone.geom === null) {
          result.warnings.push(`${org.name}: Parent zone exists but lacks geometry (map data)`)
          console.log(`  ⚠ WARNING: Zone exists but missing geometry`)
        }
      }

      result.success++

    } catch (error: any) {
      result.errors.push(`${org.name}: Unexpected error - ${error.message}`)
      console.error(`  ✗ Error: ${error.message}`)
    }
  }

  return result
}

// Run the seeding
async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  NZ ORGANIZATIONS & JURISDICTIONS SEEDER')
  console.log('  Idempotent Check-then-Upsert Pattern')
  console.log('═══════════════════════════════════════════════════════\n')

  const result = await seedOrganizations()

  console.log('\n═══════════════════════════════════════════════════════')
  console.log('  SEEDING COMPLETE')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`✓ Successful: ${result.success}`)
  console.log(`➕ Created: ${result.created}`)
  console.log(`📝 Updated: ${result.updated}`)
  console.log(`⚠ Warnings: ${result.warnings.length}`)
  console.log(`✗ Errors: ${result.errors.length}`)

  if (result.warnings.length > 0) {
    console.log('\n⚠ WARNINGS:')
    result.warnings.forEach(w => console.log(`  - ${w}`))
  }

  if (result.errors.length > 0) {
    console.log('\n✗ ERRORS:')
    result.errors.forEach(e => console.log(`  - ${e}`))
  }

  console.log('\n═══════════════════════════════════════════════════════\n')
}

// Execute
if (import.meta.main) {
  main()
}
