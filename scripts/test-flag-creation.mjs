#!/usr/bin/env node

import * as dotenv from 'dotenv';

dotenv.config();

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const VITE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

async function test() {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`,
    {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
      },
    }
  );

  const data = await response.json();
  const serviceRoleKey = data.find(k => k.name === 'service_role')?.api_key;
  
  console.log('Testing flag creation with service-role key...\n');
  
  const testOrg = '4691b995-1c91-44fc-a741-84d57b872a3b';
  
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
        organization_id: testOrg,
        name: 'FF_PHASE_B_PATROL_EVENTS',
        description: 'Activate patrol_events writes',
        phase: 'B',
        enabled: true,
        rollout_percentage: 5,
        canary_error_rate_threshold: 0.05,
        canary_p95_latency_threshold_ms: 1000,
      }),
    }
  );

  console.log('Status:', flagResponse.status);
  const errorText = await flagResponse.text();
  console.log('Response:', errorText);
}

test();
