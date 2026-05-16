/**
 * EXAMPLE / TEMPLATE — Safe Supabase Client Setup
 *
 * This file is a reference template, not production code.
 * Copy and adapt as needed. Never hard-code credentials.
 *
 * Follows: docs/BOB_SAFE_RUNTIME_CONTRACT.md
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ─── Client Setup ─────────────────────────────────────────────────────────────
// All credentials come from environment variables.
// Never embed SUPABASE_SERVICE_ROLE_KEY in client-side bundles.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env',
  )
}

/**
 * Standard typed Supabase client for use in React components and hooks.
 * Uses the anon key — subject to Row Level Security.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    headers: {
      'X-Client-Timezone': 'Pacific/Auckland',
    },
  },
})

// ─── Server-side / Edge Function Client ───────────────────────────────────────
// Use the service-role key ONLY in server-side Edge Functions (Deno).
// Never expose this key to the browser.

/**
 * Example: typed service-role client for Edge Functions.
 * In practice, import this only in supabase/functions/<name>/index.ts
 *
 * const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
 * const adminClient = createClient<Database>(supabaseUrl, serviceKey)
 */

// ─── Org-Scoped Query Helper ───────────────────────────────────────────────────

/**
 * Returns a query builder pre-filtered by the active organization.
 * All table reads in multi-org contexts should go through this helper.
 *
 * @example
 * const { data } = await orgScoped('incidents', orgId).select('*')
 */
export function orgScoped(table: string, organizationId: string) {
  return supabase.from(table as never).select().eq('organization_id', organizationId)
}
