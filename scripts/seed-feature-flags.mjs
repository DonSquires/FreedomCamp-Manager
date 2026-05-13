#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.error('❌ SUPABASE_URL not found in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Test organization seed
const SEED_ORG = {
  name: 'Test Organization — Phase B Rollout',
  organization_type: 'client',
  contact_email: 'test@phase-b.local',
};

const FLAG_CONFIGS = [
  { name: 'FF_PHASE_B_PATROL_EVENTS', description: 'Activate patrol_events writes' },
  { name: 'FF_PHASE_B_DISPATCH_EVENTS', description: 'Activate dispatch_events writes' },
  { name: 'FF_PHASE_B_ENFORCEMENT_EVENTS', description: 'Activate enforcement_events writes' },
];

async function seedFeatureFlags() {
  try {
    console.log('\n🚀 Feature Flag Seeding Script\n');
    console.log('=' .repeat(60));

    // Step 1: Check existing organizations
    console.log('\n📋 Step 1: Checking existing organizations...\n');
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name');

    if (orgsError) {
      console.error('❌ Error querying organizations:', orgsError.message);
      process.exit(1);
    }

    console.log(`Found: ${orgs?.length || 0} organization(s)`);
    if (orgs && orgs.length > 0) {
      orgs.forEach(org => console.log(`  • ${org.id} (${org.name})`));
    }

    // Step 2: Create seed organization if needed
    let targetOrgs = orgs || [];
    
    if (targetOrgs.length === 0) {
      console.log('\n🌱 Step 2: Creating test organization...\n');
      
      const { data: newOrg, error: createError } = await supabase
        .from('organizations')
        .insert(SEED_ORG)
        .select();

      if (createError) {
        console.error('❌ Error creating organization:', createError.message);
        process.exit(1);
      } else {
        console.log(`✅ Created organization: ${newOrg[0]?.id}`);
        console.log(`   Name: ${newOrg[0]?.name}`);
        targetOrgs = newOrg;
      }
    } else {
      console.log('\n✅ Step 2: Skipped (organizations already exist)\n');
    }

    // Step 3: Create feature flags for each organization
    console.log('\n⚙️  Step 3: Creating feature flags...\n');

    for (const org of targetOrgs) {
      console.log(`\n🏢 Organization: ${org.id}`);

      for (const flagConfig of FLAG_CONFIGS) {
        const { data, error } = await supabase
          .from('feature_flags')
          .insert({
            organization_id: org.id,
            name: flagConfig.name,
            description: flagConfig.description,
            phase: 'B',
            enabled: true,
            rollout_percentage: 5,
            canary_error_rate_threshold: 0.05,
            canary_p95_latency_threshold_ms: 1000,
          })
          .select();

        if (error) {
          if (error.code === '23505') {
            console.log(`  ℹ️  ${flagConfig.name} (already exists)`);
          } else {
            console.error(`  ❌ ${flagConfig.name} — ${error.message}`);
          }
        } else {
          console.log(`  ✅ ${flagConfig.name} (rollout: 5%)`);
        }
      }
    }

    // Step 4: Verification
    console.log('\n\n📊 Step 4: Verification\n');
    const { data: allFlags, error: flagError } = await supabase
      .from('feature_flags')
      .select('organization_id, name, rollout_percentage, enabled, phase')
      .order('organization_id')
      .order('name');

    if (flagError) {
      console.error('❌ Error fetching flags:', flagError.message);
      process.exit(1);
    }

    const flagsByOrg = (allFlags || []).reduce((acc, flag) => {
      if (!acc[flag.organization_id]) acc[flag.organization_id] = [];
      acc[flag.organization_id].push(flag);
      return acc;
    }, {});

    console.log(`Total organizations with flags: ${Object.keys(flagsByOrg).length}\n`);

    for (const [orgId, flags] of Object.entries(flagsByOrg)) {
      const phaseB = flags.filter(f => f.phase === 'B');
      console.log(`🏢 ${orgId}`);
      phaseB.forEach(f => {
        console.log(`   ${f.name.padEnd(40)} | Rollout: ${String(f.rollout_percentage).padEnd(3)}% | Enabled: ${f.enabled}`);
      });
    }

    console.log('\n✅ Feature flag seeding complete!\n');
    console.log('=' .repeat(60));
    console.log('\n📖 Next steps:');
    console.log('   1. Run smoke tests: npm run test:e2e -- tests/e2e/bootstrap-routes.test.ts');
    console.log('   2. Monitor: Watch feature_flag_evaluations table for health metrics');
    console.log('   3. Canary progression: Begin rollout to 5% → 25% → 50% → 100%\n');

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  }
}

seedFeatureFlags();
