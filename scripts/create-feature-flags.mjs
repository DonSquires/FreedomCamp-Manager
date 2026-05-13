#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL or SUPABASE_ANON_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const flagConfigs = [
  { name: 'FF_PHASE_B_PATROL_EVENTS', description: 'Activate patrol_events writes' },
  { name: 'FF_PHASE_B_DISPATCH_EVENTS', description: 'Activate dispatch_events writes' },
  { name: 'FF_PHASE_B_ENFORCEMENT_EVENTS', description: 'Activate enforcement_events writes' },
];

async function createFeatureFlags() {
  try {
    // Get all organizations
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id');

    if (orgsError) {
      console.error('❌ Error fetching organizations:', orgsError.message);
      process.exit(1);
    }

    console.log(`\n📋 Found ${orgs?.length || 0} organizations\n`);

    if (!orgs || orgs.length === 0) {
      console.warn('⚠️  No organizations found. Please create at least one organization first.');
      process.exit(0);
    }

    // Create flags for each organization
    for (const org of orgs) {
      console.log(`\n🏢 Creating flags for organization: ${org.id}`);

      for (const flagConfig of flagConfigs) {
        // Insert feature flag
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
          // Check if flag already exists (duplicate key error)
          if (error.code === '23505') {
            console.log(`ℹ️  Flag ${flagConfig.name} already exists for org ${org.id}`);
          } else {
            console.error(`❌ Error creating ${flagConfig.name}:`, error.message);
          }
        } else {
          console.log(`✅ Created ${flagConfig.name} (rollout: 5%)`);
        }
      }
    }

    // Verify all flags were created
    console.log('\n\n✅ Feature flag creation complete!\n');
    const { data: allFlags, error: flagError } = await supabase
      .from('feature_flags')
      .select('organization_id, name, rollout_percentage, enabled');

    if (!flagError && allFlags) {
      console.log('📊 Current feature flags:\n');
      const flagsByOrg = allFlags.reduce((acc, flag) => {
        if (!acc[flag.organization_id]) acc[flag.organization_id] = [];
        acc[flag.organization_id].push(flag);
        return acc;
      }, {});

      for (const [orgId, flags] of Object.entries(flagsByOrg)) {
        console.log(`\n🏢 Organization ${orgId}:`);
        flags.forEach(f => {
          console.log(`   ${f.name.padEnd(35)} | Enabled: ${String(f.enabled).padEnd(5)} | Rollout: ${String(f.rollout_percentage).padEnd(3)}%`);
        });
      }
    }
  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  }
}

createFeatureFlags();
