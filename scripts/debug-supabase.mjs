#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Supabase Configuration Debug\n');
console.log('VITE_SUPABASE_URL:', SUPABASE_URL ? '✅ Set' : '❌ Missing');
console.log('VITE_SUPABASE_ANON_KEY:', SUPABASE_KEY ? '✅ Set' : '❌ Missing');
console.log('SUPABASE_SERVICE_ROLE_KEY:', SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');

if (!SUPABASE_URL) {
  console.error('\n❌ Cannot connect without SUPABASE_URL');
  process.exit(1);
}

// Try with anon key first
if (SUPABASE_KEY) {
  console.log('\n📝 Testing with ANON key...\n');
  const anonClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  try {
    const { data, error } = await anonClient
      .from('organizations')
      .select('count', { count: 'exact' });
    
    console.log('Organizations query result:', error ? `❌ ${error.message}` : `✅ Found ${data?.[0]?.count || 0} orgs`);
  } catch (e) {
    console.log('Organizations query error:', e.message);
  }
  
  try {
    const { data: { user } } = await anonClient.auth.getUser();
    console.log('Current user:', user ? `✅ ${user.id}` : '❌ Not authenticated');
  } catch (e) {
    console.log('Auth error:', e.message);
  }
}

// Try with service role key if available
if (SERVICE_ROLE_KEY) {
  console.log('\n📝 Testing with SERVICE_ROLE key...\n');
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  
  try {
    const { data, error } = await adminClient
      .from('organizations')
      .select('*', { count: 'exact' });
    
    if (data && data.length > 0) {
      console.log(`✅ Found ${data.length} organizations:`);
      data.slice(0, 5).forEach(org => {
        console.log(`   - ${org.id} (${org.name || 'unnamed'})`);
      });
    } else {
      console.log('❌ No organizations found');
    }
    
    if (error) console.log('Error:', error.message);
  } catch (e) {
    console.log('Organizations query error:', e.message);
  }
}
