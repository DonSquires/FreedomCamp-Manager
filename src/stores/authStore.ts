import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import { useSessionLockStore } from './sessionLockStore'
import { useGlobalFiltersStore } from './globalFiltersStore'

let authListenerInitialized = false

async function fetchProfileWithRetry(userId: string, attempts = 2) {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data, error } = await (supabase.from('user_profiles') as any)
      .select('id, email, role, organization_id, employer_organization_id, first_name, last_name, job_title, portal_access, authorized_work_locations, extra_organization_ids, ptt_channel_access')
      .eq('id', userId)
      .single()

    if (!error && data) {
      return { profile: data, error: null as unknown }
    }

    lastError = error
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  return { profile: null, error: lastError }
}

function clearClientAuthArtifacts() {
  if (typeof window === 'undefined') return

  const storages: Storage[] = [window.localStorage, window.sessionStorage]
  const knownKeys = ['auth-storage', 'adminOfficerPortalChoice', 'chat-target']

  // Remove known app keys first.
  for (const storage of storages) {
    for (const key of knownKeys) {
      storage.removeItem(key)
    }
  }

  // Remove any Supabase auth token artifacts for this browser profile.
  for (const storage of storages) {
    const keysToDelete: string[] = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (!key) continue
      if (key.startsWith('sb-') && key.includes('-auth-token')) {
        keysToDelete.push(key)
      }
    }
    for (const key of keysToDelete) {
      storage.removeItem(key)
    }
  }
}

function clearInvalidAuthState(set: (partial: Partial<AuthState>) => void) {
  clearClientAuthArtifacts()
  set({ user: null, isAuthenticated: false, loading: false })
  useSessionLockStore.getState().unlock()
  useGlobalFiltersStore.getState().syncForUser(null)
}

function softResolveAuthLoading(set: (partial: Partial<AuthState> | ((state: AuthState) => Partial<AuthState>)) => void, sessionUserId?: string) {
  set((state) => ({
    loading: false,
    isAuthenticated: sessionUserId ? state.user?.id === sessionUserId || state.isAuthenticated : state.isAuthenticated,
  }))
}
async function getFreshSessionAfterLogin() {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    throw error
  }
  if (!data.session) {
    throw new Error('No active session after login')
  }
  return data.session
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

interface AuthUser {
  id: string
  email: string
  role: 'master' | 'admin' | 'officer' | 'admin_officer' | 'nzscv_monitor' | 'grand_master' | 'client_viewer' | 'client_officer' | 'client_admin'
  organization_id: string | null
  employer_organization_id: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
  job_title: string | null
  /** Portal / area codes this user is explicitly allowed to access (empty = role-based only) */
  portal_access: string[]
  /** Additional org/branch IDs beyond the primary organization_id */
  authorized_work_locations: string[]
  extra_organization_ids: string[]
  /** Optional per-officer PTT scopes beyond the default org channel */
  ptt_channel_access: string[] | null
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  loading: boolean
  ensureLoadingResolved: () => void
  login: (email: string, password: string) => Promise<void>
  unlockSession: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkSession: () => Promise<void>
  initializeAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      loading: true,

      ensureLoadingResolved: () => {
        set((state) => {
          if (!state.loading) return state
          return { ...state, loading: false, isAuthenticated: !!state.user }
        })
      },

      initializeAuth: () => {
        if (authListenerInitialized) {
          return
        }

        authListenerInitialized = true

        supabase.auth.onAuthStateChange(async (_event, session) => {
          try {
            if (!session) {
              clearInvalidAuthState(set)
              return
            }

            const { profile, error: profileError } = await fetchProfileWithRetry(session.user.id)

            if (profileError) {
              console.warn('[authStore] profile refresh failed on auth change:', profileError)
              softResolveAuthLoading(set, session.user.id)
              return
            }

            if (!profile) {
              clearInvalidAuthState(set)
              return
            }

            const authUser: AuthUser = {
              id: profile.id,
              email: profile.email,
              role: profile.role as AuthUser['role'],
              organization_id: profile.organization_id,
              employer_organization_id: (profile as any).employer_organization_id ?? null,
              full_name: `${profile.first_name} ${profile.last_name}`,
              first_name: profile.first_name ?? null,
              last_name: profile.last_name ?? null,
              job_title: (profile as any).job_title ?? null,
              portal_access: (profile as any).portal_access ?? [],
              authorized_work_locations: (profile as any).authorized_work_locations ?? [],
              extra_organization_ids: (profile as any).extra_organization_ids ?? [],
              ptt_channel_access: (profile as any).ptt_channel_access ?? null,
            }
            // Null-guard: only write to store if the built authUser is valid.
            // Always write the freshly-fetched profile so the store stays
            // current even when a token refresh or tab-focus event fires while
            // the user is already authenticated.
            if (authUser?.id) {
              set({ user: authUser, isAuthenticated: true, loading: false })
              useGlobalFiltersStore.getState().syncForUser(authUser.id)
            } else {
              set({ user: null, isAuthenticated: false, loading: false })
            }
          } catch (err) {
            console.warn('[authStore] onAuthStateChange handler error:', err)
            softResolveAuthLoading(set)
          }
        })
      },

      login: async (email: string, password: string) => {
        // Do NOT touch the global `loading` flag here.
        // `loading` is reserved for the initial page-load auth check so that
        // App.tsx can gate routing until the session is known.  Setting it to
        // `true` during a normal login causes App.tsx to unmount all routes and
        // render a full-screen dark spinner — which officers see as a black
        // screen before the portal appears.  The Login page has its own local
        // loading state (disabled button / "Signing in…" label) for UX feedback.

        // Wipe locally persisted auth artifacts that may be stale from an
        // interrupted browser session before creating a new one.
        clearClientAuthArtifacts()

        const { data, error } = await withTimeout(
          supabase.auth.signInWithPassword({
            email,
            password,
          }),
          20000,
          'signInWithPassword'
        )

        if (error) {
          throw error
        }

        // Prefer the session returned by sign-in. Immediate refresh can deadlock
        // under competing auth locks in browser automation contexts.
        const freshSession = data.session ?? await getFreshSessionAfterLogin()

        // Fetch user profile with a short retry window. The auth session can
        // be valid before the profile row is immediately readable through RLS
        // in the same turn, so a single retry avoids turning a successful sign-in
        // into a false login failure.
        const { profile, error: profileError } = await fetchProfileWithRetry(freshSession.user.id, 3)

        if (profileError) {
          throw profileError
        }

        const p = profile as any
        const authUser: AuthUser = {
          id: p.id,
          email: p.email,
          role: p.role as AuthUser['role'],
          organization_id: p.organization_id,
          employer_organization_id: p.employer_organization_id ?? null,
          full_name: `${p.first_name} ${p.last_name}`,
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          job_title: p.job_title ?? null,
          portal_access: p.portal_access ?? [],
          authorized_work_locations: p.authorized_work_locations ?? [],
          extra_organization_ids: p.extra_organization_ids ?? [],
          ptt_channel_access: p.ptt_channel_access ?? null,
        }

        set({ user: authUser, isAuthenticated: true })
        useSessionLockStore.getState().unlock()
        useGlobalFiltersStore.getState().syncForUser(authUser.id)
      },

      // Re-authenticates from the session lock screen without triggering the
      // global loading state, preventing the app from briefly unmounting and
      // causing a visual loop.
      unlockSession: async (email: string, password: string) => {
        const { data, error } = await withTimeout(
          supabase.auth.signInWithPassword({ email, password }),
          20000,
          'unlock signInWithPassword'
        )
        if (error) throw error

        const freshSession = data.session ?? await getFreshSessionAfterLogin()

        const { profile, error: profileError } = await fetchProfileWithRetry(freshSession.user.id, 3)

        if (profileError) {
          throw profileError
        }

        const p = profile as any
        const authUser: AuthUser = {
          id: p.id,
          email: p.email,
          role: p.role as AuthUser['role'],
          organization_id: p.organization_id,
          employer_organization_id: p.employer_organization_id ?? null,
          full_name: `${p.first_name} ${p.last_name}`,
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          job_title: p.job_title ?? null,
          portal_access: p.portal_access ?? [],
          authorized_work_locations: p.authorized_work_locations ?? [],
          extra_organization_ids: p.extra_organization_ids ?? [],
          ptt_channel_access: p.ptt_channel_access ?? null,
        }

        set({ user: authUser, isAuthenticated: true, loading: false })
        useSessionLockStore.getState().unlock()
        useGlobalFiltersStore.getState().syncForUser(authUser.id)
      },

      logout: async () => {
        try {
          // Revoke user refresh tokens server-side and then clear local state.
          await supabase.auth.signOut({ scope: 'global' })
          await supabase.auth.signOut({ scope: 'local' })
        } catch (error) {
          // Keep logout UX reliable even if remote sign-out fails.
          console.warn('[authStore] signOut failed, clearing local auth state anyway:', error)
        }
        clearClientAuthArtifacts()
        set({ user: null, isAuthenticated: false, loading: false })
        useSessionLockStore.getState().unlock()
        useGlobalFiltersStore.getState().syncForUser(null)
      },

      checkSession: async () => {
        try {
          const { data: { session }, error: sessionError } = await withTimeout(
            supabase.auth.getSession(),
            45000,
            'Auth session check'
          )

          if (sessionError) {
            console.warn('[authStore] session check reported an auth error:', sessionError)
            softResolveAuthLoading(set)
            return
          }

          if (!session) {
            clearInvalidAuthState(set)
            return
          }

          // Fetch user profile
          const { profile, error: profileError } = await fetchProfileWithRetry(session.user.id)

          if (profileError) {
            console.warn('[authStore] checkSession profile fetch failed:', profileError)
            softResolveAuthLoading(set, session.user.id)
            return
          }

          if (profile) {
            const authUser: AuthUser = {
              id: profile.id,
              email: profile.email,
              role: profile.role as AuthUser['role'],
              organization_id: profile.organization_id,
              employer_organization_id: (profile as any).employer_organization_id ?? null,
              full_name: `${profile.first_name} ${profile.last_name}`,
              first_name: profile.first_name ?? null,
              last_name: profile.last_name ?? null,
              job_title: (profile as any).job_title ?? null,
              portal_access: (profile as any).portal_access ?? [],
              authorized_work_locations: (profile as any).authorized_work_locations ?? [],
              extra_organization_ids: (profile as any).extra_organization_ids ?? [],
              ptt_channel_access: (profile as any).ptt_channel_access ?? null,
            }
            set({ user: authUser, isAuthenticated: true, loading: false })
            useGlobalFiltersStore.getState().syncForUser(authUser.id)
          } else {
            clearInvalidAuthState(set)
          }
        } catch (error) {
          console.warn('[authStore] checkSession failed:', error)
          softResolveAuthLoading(set)
        }
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => sessionStorage),
      // Persist only user profile details; auth truth comes from Supabase session.
      partialize: (state) => ({ user: state.user }),
    }
  )
)
