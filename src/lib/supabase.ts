import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

type SupabaseLock = <T>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<T>
) => Promise<T>

const fallbackLock: SupabaseLock = async <T>(_name: string, _acquireTimeout: number, fn: () => Promise<T>) => {
  return fn()
}

const browserLock: SupabaseLock = async <T>(name: string, _acquireTimeout: number, fn: () => Promise<T>) => {
  if (typeof window === 'undefined' || !('locks' in navigator)) {
    return fn()
  }

  try {
    return await navigator.locks.request(name, { mode: 'exclusive' }, async () => fn())
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return fn()
    }
    throw error
  }
}

/**
 * True when both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are present.
 * Used by the app entry-point to guard rendering when the deployment platform
 * (e.g. OnSpace AI at https://react-9b4t5o.onspace.build) has not yet had its
 * environment variables configured.
 */
export const supabaseConfigured = !!(supabaseUrl && supabaseAnonKey)

if (!supabaseConfigured) {
  console.warn(
    '[FreedomCamp Manager] VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set. ' +
    'Configure these environment variables in your deployment platform ' +
    '(OnSpace AI dashboard → Environment Variables, or GitHub Secrets for the CI workflow). ' +
    'The application will not function until they are provided.'
  )
}

export const supabase = createClient<Database>(
  supabaseUrl || 'https://unconfigured.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      lock: typeof window === 'undefined' ? fallbackLock : browserLock,
    },
    global: {
      headers: {
        'X-Client-Timezone': 'Pacific/Auckland',
      },
    },
  }
)
