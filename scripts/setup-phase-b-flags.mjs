#!/usr/bin/env node

import * as dotenv from 'dotenv';

dotenv.config();

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const VITE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!ACCESS_TOKEN || !PROJECT_REF) {
  console.error('❌ Missing SUPABASE_ACCESS_TOKEN or PROJECT_REF');
  process.exit(1);
}

async function fetchServiceRoleKey() {
  try {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const serviceRoleKey = data.find(k => k.name === 'service_role')?.api_key;

    if (!serviceRoleKey) {
      throw new Error('Service role key not found');
    }

    return serviceRoleKey;
  } catch (err) {
    console.error('❌ Failed to fetch service role key:', err.message);
    process.exit(1);
  }
}

async function createPhaseB() {
  console.log('\n🚀 Phase B Global Feature Flags Setup\n');
  console.log('='.repeat(60));

  try {
    // Step 1: Get service role key
    console.log('\n🔑 Step 1: Retrieving service-role key from Supabase Management API...\n');
    const serviceRoleKey = await fetchServiceRoleKey();
    console.log('✅ Service-role key retrieved');

    // Step 2: Create global feature flags
    console.log('\n⚙️  Step 2: Creating Phase B feature flags (GLOBAL, 5% rollout)...\n');

    const flags = [
      { name: 'FF_PHASE_B_PATROL_EVENTS', description: 'Activate patrol_events writes on observation capture' },
      { name: 'FF_PHASE_B_DISPATCH_EVENTS', description: 'Activate dispatch_events writes on job assignment' },
      { name: 'FF_PHASE_B_ENFORCEMENT_EVENTS', description: 'Activate enforcement event writes on action create/complete' },
    ];

    const results = [];

    for (const flag of flags) {
      const flagResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/feature_flags`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': VITE_ANON_KEY || serviceRoleKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: flag.name,
            description: flag.description,
            phase: 'B',
            enabled: true,
            rollout_percentage: 5,
            rollout_strategy: 'percentage',
            canary_error_rate_threshold: 0.05,
            canary_p95_latency_threshold_ms: 1000,
          }),
        }
      );

      if (flagResponse.status === 201) {
        console.log(`✅ ${flag.name}`);
        console.log(`   Rollout: 5% (random percentage-based)`);
        console.log(`   Canary thresholds: error_rate < 5%, p95_latency < 1000ms`);
        results.push({ name: flag.name, status: 'created' });
      } else if (flagResponse.status === 409) {
        console.log(`ℹ️  ${flag.name} (already exists)`);
        results.push({ name: flag.name, status: 'exists' });
      } else {
        const errorText = await flagResponse.text();
        console.log(`❌ ${flag.name}`);
        console.log(`   Error: ${flagResponse.status} — ${errorText.slice(0, 100)}`);
        results.push({ name: flag.name, status: 'error', error: errorText });
      }
    }

    // Step 3: Verification
    console.log('\n📊 Step 3: Verifying flag creation...\n');
    const verifyResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/feature_flags?select=name,phase,enabled,rollout_percentage&phase=eq.B`,
      {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': VITE_ANON_KEY || serviceRoleKey,
        },
      }
    );

    if (verifyResponse.ok) {
      const allFlags = await verifyResponse.json();
      console.log(`✅ ${allFlags.length} Phase B flag(s) now deployed:\n`);
      allFlags.forEach(f => {
        console.log(`   ${f.name.padEnd(40)} | Rollout: ${String(f.rollout_percentage).padEnd(3)}% | Enabled: ${f.enabled}`);
      });
    }

    console.log('\n✅ Feature flag setup complete!\n');
    console.log('='.repeat(60));
    console.log('\n📖 Next immediate steps:');
    console.log('   1. Start the dev server: npm run dev');
    console.log('   2. Navigate to a bootstrapped route (Patrol, Dispatch, or Enforcement)');
    console.log('   3. Execute an action (capture observation, dispatch job, or create action)');
    console.log('   4. Verify events appear in: SELECT * FROM patrol_events|dispatch_events|enforcement_events');
    console.log('   5. Continue to canary progression (25%, 50%, 100%) after smoke tests\n');

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  }
}

createPhaseB();
