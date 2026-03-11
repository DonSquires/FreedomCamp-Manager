import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import { useSessionLockStore } from './sessionLockStore'

let authListenerInitialized = false

interface AuthUser {
  id: string
  email: string
  role: 'master' | 'admin' | 'officer' | 'admin_officer'
  organization_id: string | null
  full_name: string | null
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

            const { data: profile } = await (supabase.from('user_profiles') as any)
              .select('id, email, role, organization_id, first_name, last_name')
              .eq('id', session.user.id)
              .single()

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
            }

            set({ user: authUser, isAuthenticated: true, loading: false })
          } catch (error) {
            console.warn('[authStore] onAuthStateChange failed:', error)
            set({ user: null, isAuthenticated: false, loading: false })
          }
        })
      },

      login: async (email: string, password: string) => {
        set({ loading: true })
        
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) {
          set({ loading: false })
          throw error
        }

        // Fetch user profile
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('id, email, role, organization_id, first_name, last_name')
          .eq('id', data.user.id)
          .single()

        if (profileError) {
          set({ loading: false })
          throw profileError
        }

        const p = profile as any
        const authUser: AuthUser = {
          id: p.id,
          email: p.email,
          role: p.role as AuthUser['role'],
          organization_id: p.organization_id,
          full_name: `${p.first_name} ${p.last_name}`,
        }

        set({ user: authUser, isAuthenticated: true, loading: false })
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
          await supabase.auth.signOut()
        } catch (error) {
          // Keep logout UX reliable even if remote sign-out fails.
          console.warn('[authStore] signOut failed, clearing local auth state anyway:', error)
        }
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem('adminOfficerPortalChoice')
        }
        set({ user: null, isAuthenticated: false, loading: false })
        useSessionLockStore.getState().unlock()
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
            set({ user: null, isAuthenticated: false, loading: false })
            return
          }

          if (!session) {
            set({ user: null, isAuthenticated: false, loading: false })
            return
          }

          // Fetch user profile
          const { data: profile } = await (supabase.from('user_profiles') as any)
            .select('id, email, role, organization_id, first_name, last_name')
            .eq('id', session.user.id)
            .single()

          if (profile) {
            const authUser: AuthUser = {
              id: profile.id,
              email: profile.email,
              role: profile.role as AuthUser['role'],
              organization_id: profile.organization_id,
              full_name: `${profile.first_name} ${profile.last_name}`,
            }
            set({ user: authUser, isAuthenticated: true, loading: false })
          } else {
            set({ user: null, isAuthenticated: false, loading: false })
          }
        } catch (error) {
          console.warn('[authStore] checkSession failed:', error)
          set({ user: null, isAuthenticated: false, loading: false })
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
