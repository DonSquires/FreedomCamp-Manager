import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''
const envFallbackNote = '(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)'
const DEPRECATED_SUPABASE_PROJECT_REFS = new Set(['xbfnlzmpumthnjmtqufp'])

const memoryStorage = new Map<string, string>()

const sessionAuthStorage = {
  getItem: (key: string) => {
    if (typeof window === 'undefined') return memoryStorage.get(key) ?? null
    return window.sessionStorage.getItem(key)
  },
  setItem: (key: string, value: string) => {
    if (typeof window === 'undefined') {
      memoryStorage.set(key, value)
      return
    }
    window.sessionStorage.setItem(key, value)
  },
  removeItem: (key: string) => {
    if (typeof window === 'undefined') {
      memoryStorage.delete(key)
      return
    }
    window.sessionStorage.removeItem(key)
  },
}

type SupabaseLock = <T>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<T>
) => Promise<T>

const fallbackLock: SupabaseLock = async <T>(_name: string, _acquireTimeout: number, fn: () => Promise<T>) => {
  return fn()
}

/**
 * True when both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are present.
 * Used by the app entry-point to guard rendering when the deployment platform
 * has not yet had its environment variables configured.
 */
const supabaseProjectRef = (() => {
  try {
    const hostname = new URL(supabaseUrl).hostname.toLowerCase()
    if (!hostname.endsWith('.supabase.co')) return ''
    return hostname.replace('.supabase.co', '')
  } catch {
    return ''
  }
})()

const hasDeprecatedProjectRef = DEPRECATED_SUPABASE_PROJECT_REFS.has(supabaseProjectRef)
const hasValidSupabaseHost = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)

export const supabaseConfigured = !!(supabaseUrl && supabaseAnonKey && hasValidSupabaseHost && !hasDeprecatedProjectRef)

if (!supabaseConfigured) {
  const deprecatedProjectHint = hasDeprecatedProjectRef
    ? ` Detected deprecated Supabase project ref: ${supabaseProjectRef}.`
    : ''

  console.warn(
    '[Field Compliance Manager] Supabase env vars are not set. ' +
    `Configure ${envFallbackNote} in your deployment platform ` +
    '(Environment Variables dashboard, or GitHub Secrets for the CI workflow). ' +
    'The application will not function until they are provided.' +
    deprecatedProjectHint
  )
}

export const supabase = createClient<Database>(
  supabaseUrl || 'https://unconfigured.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The custom navigator.locks integration has caused browser-side auth
      // session checks and subsequent PostgREST mutations to stall in real UI
      // workflows. Use the non-blocking fallback lock instead.
      lock: fallbackLock,
      storage: sessionAuthStorage,
    },
    global: {
      headers: {
        'X-Client-Timezone': 'Pacific/Auckland',
      },
    },
  }
)
