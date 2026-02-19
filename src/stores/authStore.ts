import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '@/lib/supabase';

// Auth Store v2.1 - Single Session Per User with session validation

interface AuthState {
  user: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    organization_id: string;
  } | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  forceLogin: (email: string, password: string) => Promise<void>;
  setAuthState: (user: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    organization_id: string;
  }) => void;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        
        // Step 1: Authenticate with Supabase Auth
        console.log('🔑 [AUTH STORE] Step 1: Authenticating with Supabase...');
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          console.error('❌ [AUTH STORE] Authentication failed:', error);
          console.error('   Error code:', error.code);
          console.error('   Error message:', error.message);
          if (error.message.includes('Invalid login credentials')) {
            throw new Error('Invalid email or password');
          } else if (error.message.includes('Email not confirmed')) {
            throw new Error('Please verify your email address before logging in');
          } else if (error.message.includes('Too many requests')) {
            throw new Error('Too many login attempts. Please wait a few minutes');
          }
          throw new Error(`Authentication failed: ${error.message}`);
        }
        
        if (!data.user) {
          console.error('❌ [AUTH STORE] No user data returned from Supabase');
          throw new Error('Authentication failed - no user data');
        }

        // Step 2: Check for existing active sessions
        console.log('🔍 [AUTH STORE] Step 2: Checking for existing sessions...');
        const { data: existingSessions, error: sessionCheckError } = await supabase
          .from('user_sessions')
          .select('id, device_info, login_at, last_activity_at')
          .eq('user_id', data.user.id)
          .eq('is_active', true)
          .gt('expires_at', new Date().toISOString()); // Not expired

        if (sessionCheckError) {
          console.error('⚠️ [AUTH STORE] Session check failed (continuing):', sessionCheckError);
        }

        if (existingSessions && existingSessions.length > 0) {
          // Existing session found - throw error to trigger confirmation dialog
          console.log('⚠️ [AUTH STORE] Existing session detected:', existingSessions[0]);
          
          const existingSession = existingSessions[0];
          const deviceInfo = typeof existingSession.device_info === 'object' ? existingSession.device_info : {};
          const deviceName = (deviceInfo as any)?.userAgent?.substring(0, 50) || 'Another device';
          const lastActivity = new Date(existingSession.last_activity_at || existingSession.login_at);
          const minutesAgo = Math.floor((Date.now() - lastActivity.getTime()) / 1000 / 60);
          
          // Special error code to detect duplicate session
          const error = new Error(`DUPLICATE_SESSION|||You are already logged in on ${deviceName}|||Last active ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago|||Logging in here will log you out on that device. Continue?`);
          (error as any).code = 'DUPLICATE_SESSION';
          throw error;
        }

        // Fetch user profile
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('id, email, first_name, last_name, role, organization_id, phone, is_active, permissions')
          .eq('id', data.user.id)
          .single();

        if (profileError) {
          console.error('❌ [AUTH STORE] Profile fetch failed:', profileError);
          console.error('   Error code:', profileError.code);
          console.error('   Error message:', profileError.message);
          console.error('   Error details:', profileError.details);
          
          if (profileError.code === 'PGRST116') {
            throw new Error('User profile not found. Please contact your administrator.');
          } else if (profileError.message.includes('permission denied') || profileError.message.includes('row-level security')) {
            throw new Error('Permission denied. Please contact support.');
          } else if (profileError.code === '42501') {
            throw new Error('Access denied. Please contact your administrator.');
          }
          throw new Error(`Login failed: ${profileError.message || 'Unknown error'}`);
        }

        if (!profile) {
          console.error('❌ [AUTH STORE] No profile found in database');
          throw new Error('Account profile not found');
        }

        if (!profile.is_active) {
          throw new Error('Account has been deactivated');
        }

        // Step 3: Create new session record
        console.log('✅ [AUTH STORE] Step 3: Creating session record...');
        const sessionToken = data.session?.access_token || crypto.randomUUID();
        const deviceInfo = {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          timestamp: new Date().toISOString(),
        };

        const { error: sessionCreateError } = await supabase
          .from('user_sessions')
          .insert({
            user_id: data.user.id,
            session_token: sessionToken,
            device_info: deviceInfo,
            ip_address: null, // Will be set by database trigger if available
          });

        if (sessionCreateError) {
          console.error('⚠️ [AUTH STORE] Session creation failed (continuing):', sessionCreateError);
        } else {
          console.log('✅ [AUTH STORE] Session created successfully');
          // Store session token for validation
          localStorage.setItem('session_token', sessionToken);
        }

        // Update auth state
        set({
          user: {
            id: profile.id,
            email: profile.email,
            first_name: profile.first_name,
            last_name: profile.last_name,
            role: profile.role,
            organization_id: profile.organization_id || '',
          },
          isAuthenticated: true,
        });
      },

      forceLogin: async (email: string, password: string) => {
        // Force login by terminating existing sessions first
        console.log('🔑 [AUTH STORE] Force login - terminating existing sessions...');
        
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error || !data.user) {
          throw new Error('Authentication failed');
        }

        // Terminate all existing sessions
        await supabase
          .from('user_sessions')
          .update({ 
            is_active: false,
            terminated_at: new Date().toISOString(),
            terminated_by: data.user.id,
            termination_reason: 'New device login (force)'
          })
          .eq('user_id', data.user.id)
          .eq('is_active', true);

        // Now proceed with normal login flow (will create new session)
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('id, email, first_name, last_name, role, organization_id')
          .eq('id', data.user.id)
          .single();

        if (!profile) {
          throw new Error('Account profile not found');
        }

        // Create new session
        const sessionToken = data.session?.access_token || crypto.randomUUID();
        const deviceInfo = {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language,
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          timestamp: new Date().toISOString(),
        };

        await supabase
          .from('user_sessions')
          .insert({
            user_id: data.user.id,
            session_token: sessionToken,
            device_info: deviceInfo,
          });

        localStorage.setItem('session_token', sessionToken);

        set({
          user: {
            id: profile.id,
            email: profile.email,
            first_name: profile.first_name,
            last_name: profile.last_name,
            role: profile.role,
            organization_id: profile.organization_id || '',
          },
          isAuthenticated: true,
        });
      },

      logout: async () => {
        const sessionToken = localStorage.getItem('session_token');
        
        // Terminate session in database
        if (sessionToken) {
          await supabase
            .from('user_sessions')
            .update({ 
              is_active: false,
              terminated_at: new Date().toISOString(),
              termination_reason: 'User logged out'
            })
            .eq('session_token', sessionToken);
        }
        
        localStorage.removeItem('field_patrol_organization');
        localStorage.removeItem('field_patrol_zone');
        localStorage.removeItem('session_token');
        await supabase.auth.signOut();
        set({ user: null, isAuthenticated: false });
      },

      setAuthState: (user) => {
        set({ user, isAuthenticated: true });
      },

      checkSession: async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          
          if (!session?.user) {
            set({ user: null, isAuthenticated: false });
            localStorage.removeItem('session_token');
            return;
          }
          
          // ✅ FIX: Validate session using auth.getSession() instead of querying user_sessions
          // This avoids network-level blocks from shipping JWTs in URL querystrings
          const sessionToken = localStorage.getItem('session_token');
          if (sessionToken) {
            // Session is valid if we got this far (auth.getSession() succeeded)
            // No need to query user_sessions table from browser
            
            // Check expiry from session object itself
            if (session.expires_at && new Date(session.expires_at * 1000) < new Date()) {
              console.log('🚫 [AUTH STORE] Session expired - logging out');
              await supabase.auth.signOut();
              localStorage.removeItem('session_token');
              set({ user: null, isAuthenticated: false });
              return;
            }
            
            // Update last activity (optional - can be done server-side via trigger)
            // Removed direct user_sessions table access to prevent ERR_CONNECTION_CLOSED
          }
          
          const { data: profile, error } = await supabase
            .from('user_profiles')
            .select('id, email, first_name, last_name, role, organization_id, is_active')
            .eq('id', session.user.id)
            .single();
          
          if (error || !profile || !profile.is_active) {
            set({ user: null, isAuthenticated: false });
            localStorage.removeItem('session_token');
            return;
          }
          
          set({
            user: {
              id: profile.id,
              email: profile.email,
              first_name: profile.first_name,
              last_name: profile.last_name,
              role: profile.role,
              organization_id: profile.organization_id || '',
            },
            isAuthenticated: true,
          });
        } catch (error) {
          set({ user: null, isAuthenticated: false });
          localStorage.removeItem('session_token');
        }
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);
