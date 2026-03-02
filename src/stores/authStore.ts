import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

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
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkSession: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      loading: true,

      login: async (email: string, password: string) => {
        set({ loading: true })
        
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (error) throw error

        // Fetch user profile
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('id, email, role, organization_id, first_name, last_name')
          .eq('id', data.user.id)
          .single()

        if (profileError) throw profileError

        const authUser: AuthUser = {
          id: profile.id,
          email: profile.email,
          role: profile.role as AuthUser['role'],
          organization_id: profile.organization_id,
          full_name: `${profile.first_name} ${profile.last_name}`,
        }

        set({ user: authUser, isAuthenticated: true, loading: false })
      },

      logout: async () => {
        await supabase.auth.signOut()
        set({ user: null, isAuthenticated: false, loading: false })
      },

      checkSession: async () => {
        const { data: { session } } = await supabase.auth.getSession()
        
        if (!session) {
          set({ user: null, isAuthenticated: false, loading: false })
          return
        }

        // Fetch user profile
        const { data: profile } = await supabase
          .from('user_profiles')
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
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
)
