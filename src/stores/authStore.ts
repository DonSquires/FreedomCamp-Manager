import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import { useSessionLockStore } from './sessionLockStore'
import { useGlobalFiltersStore } from './globalFiltersStore'

let authListenerInitialized = false

function clearClientAuthArtifacts() {
  if (typeof window === 'undefined') return

  const storages: Storage[] = [window.localStorage, window.sessionStorage]
  const knownKeys = ['auth-storage', 'adminOfficerPortalChoice']

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

interface AuthUser {
  id: string
  email: string
  role: 'master' | 'admin' | 'officer' | 'admin_officer' | 'nzscv_monitor' | 'grand_master' | 'client_viewer'
  organization_id: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
  /** Portal / area codes this user is explicitly allowed to access (empty = role-based only) */
  portal_access: string[]
  /** Additional org/branch IDs beyond the primary organization_id */
  authorized_work_locations: string[]
  extra_organization_ids: string[]
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
              set({ user: null, isAuthenticated: false, loading: false })
              return
            }

            const { data: profile, error: profileError } = await (supabase.from('user_profiles') as any)
              .select('id, email, role, organization_id, first_name, last_name, portal_access, authorized_work_locations, extra_organization_ids')
              .eq('id', session.user.id)
              .single()

            if (profileError) {
              console.warn('[authStore] profile refresh failed on auth change:', profileError)
              set((state) => {
                if (state.user) {
                  return { ...state, isAuthenticated: true, loading: false }
                }
                return { user: null, isAuthenticated: false, loading: false }
              })
              return
            }

            if (!profile) {
              set({ user: null, isAuthenticated: false, loading: false })
              return
            }

            const authUser: AuthUser = {
              id: profile.id,
              email: profile.email,
              role: profile.role as AuthUser['role'],
              organization_id: profile.organization_id,
              full_name: `${profile.first_name} ${profile.last_name}`,
              first_name: profile.first_name ?? null,
              last_name: profile.last_name ?? null,
              portal_access: (profile as any).portal_access ?? [],
              authorized_work_locations: (profile as any).authorized_work_locations ?? [],
              extra_organization_ids: (profile as any).extra_organization_ids ?? [],
            }
            set((state) => {
              if (state.user) {
                return { ...state, isAuthenticated: true, loading: false }
              }
              return { user: authUser, isAuthenticated: true, loading: false }
            })
          } catch (err) {
            console.warn('[authStore] onAuthStateChange handler error:', err)
            set({ user: null, isAuthenticated: false, loading: false })
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

        // Wipe any stale Supabase auth tokens from storage before creating a
        // new session.  If the app was previously force-closed without logging
        // out, a half-expired or corrupt token can cause the Supabase client to
        // enter a broken state where it attempts to reuse the old session.
        clearClientAuthArtifacts()

        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) {
          throw error
        }

        // Revoke all other active sessions for this user on the server so any
        // stale JWT from a previous force-closed session cannot be replayed.
        // Fire-and-forget — we don't want sign-out of others to block or fail
        // the current login if the network hiccups.
        supabase.auth.signOut({ scope: 'others' }).catch((e) => {
          console.warn('[authStore] Failed to revoke previous sessions on login:', e)
        })

        // Fetch user profile
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('id, email, role, organization_id, first_name, last_name, portal_access, authorized_work_locations, extra_organization_ids')
          .eq('id', data.user.id)
          .single()

        if (profileError) {
          throw profileError
        }

        const p = profile as any
        const authUser: AuthUser = {
          id: p.id,
          email: p.email,
          role: p.role as AuthUser['role'],
          organization_id: p.organization_id,
          full_name: `${p.first_name} ${p.last_name}`,
          first_name: p.first_name ?? null,
          last_name: p.last_name ?? null,
          portal_access: p.portal_access ?? [],
          authorized_work_locations: p.authorized_work_locations ?? [],
          extra_organization_ids: p.extra_organization_ids ?? [],
        }

        set({ user: authUser, isAuthenticated: true })
        useSessionLockStore.getState().unlock()
      },

      // Re-authenticates from the session lock screen without triggering the
      // global loading state, preventing the app from briefly unmounting and
      // causing a visual loop. User state is kept current via the onAuthStateChange
      // listener (registered in initializeAuth) which fires automatically on
      // successful sign-in and refreshes the user profile in the store.
      unlockSession: async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        // Clear the session lock; the auth listener will keep user state current.
        useSessionLockStore.getState().unlock()
      },

      logout: async () => {
        try {
          // Prefer local sign-out to immediately invalidate client session state.
          await supabase.auth.signOut({ scope: 'local' })
        } catch (error) {
          // Keep logout UX reliable even if remote sign-out fails.
          console.warn('[authStore] signOut failed, clearing local auth state anyway:', error)
        }
        clearClientAuthArtifacts()
        set({ user: null, isAuthenticated: false, loading: false })
        useSessionLockStore.getState().unlock()
        useGlobalFiltersStore.getState().clearFilters()
      },

      checkSession: async () => {
        try {
          const sessionPromise = supabase.auth.getSession()
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Auth session check timed out')), 10000)
          })

          const { data: { session }, error: sessionError } = await Promise.race([
            sessionPromise,
            timeoutPromise,
          ])

          if (sessionError) {
            set((state) => {
              if (state.user) {
                return { ...state, isAuthenticated: true, loading: false }
              }
              return { user: null, isAuthenticated: false, loading: false }
            })
            return
          }

          if (!session) {
            set({ user: null, isAuthenticated: false, loading: false })
            return
          }

          // Fetch user profile
          const { data: profile, error: profileError } = await (supabase.from('user_profiles') as any)
            .select('id, email, role, organization_id, first_name, last_name, portal_access, authorized_work_locations, extra_organization_ids')
            .eq('id', session.user.id)
            .single()

          if (profileError) {
            console.warn('[authStore] checkSession profile fetch failed:', profileError)
            set((state) => {
              if (state.user) {
                return { ...state, isAuthenticated: true, loading: false }
              }
              return { user: null, isAuthenticated: false, loading: false }
            })
            return
          }

          if (profile) {
            const authUser: AuthUser = {
              id: profile.id,
              email: profile.email,
              role: profile.role as AuthUser['role'],
              organization_id: profile.organization_id,
              full_name: `${profile.first_name} ${profile.last_name}`,
              first_name: profile.first_name ?? null,
              last_name: profile.last_name ?? null,
              portal_access: (profile as any).portal_access ?? [],
              authorized_work_locations: (profile as any).authorized_work_locations ?? [],
              extra_organization_ids: (profile as any).extra_organization_ids ?? [],
            }
            set({ user: authUser, isAuthenticated: true, loading: false })
          } else {
            set({ user: null, isAuthenticated: false, loading: false })
          }
        } catch (error) {
          console.warn('[authStore] checkSession failed:', error)
          set((state) => {
            if (state.user) {
              return { ...state, isAuthenticated: true, loading: false }
            }
            return { user: null, isAuthenticated: false, loading: false }
          })
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
