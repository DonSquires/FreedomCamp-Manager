import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { toast } from 'sonner';

export interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'master' | 'admin' | 'officer' | 'admin_officer';
  organization_id: string | null;
  phone: string | null;
  is_active: boolean;
  permissions?: string[];
  created_at: string;
  updated_at: string;
  organization?: {
    id: string;
    name: string;
  };
  employer_organization_id?: string | null;
  authorized_work_locations?: string[];
}

export interface CreateUserInput {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: 'master' | 'admin' | 'officer' | 'admin_officer';
  organization_id?: string;
  phone?: string;
}

export interface UpdateUserInput {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: 'master' | 'admin' | 'officer' | 'admin_officer';
  organization_id?: string;
  phone?: string;
  is_active?: boolean;
  permissions?: string[];
}

export const useUsers = () => {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      // Get current authenticated user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('Not authenticated');

      // Get current user's profile to check role and organization
      const { data: currentUserProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('role, organization_id')
        .eq('id', authUser.id)
        .single();

      if (profileError) {
        console.error('Failed to fetch current user profile:', profileError);
        throw profileError;
      }

      console.log('Current user profile:', currentUserProfile);

      let query = supabase
        .from('user_profiles')
        .select(`
          id,
          email,
          first_name,
          last_name,
          role,
          organization_id,
          phone,
          is_active,
          permissions,
          created_at,
          updated_at,
          employer_organization_id,
          authorized_work_locations,
          organization:organizations(id, name)
        `)
        .order('created_at', { ascending: false });

      // Apply organization-based filtering
      if (currentUserProfile.role === 'admin' || currentUserProfile.role === 'admin_officer') {
        // Admins: Only see users in their own organization
        if (currentUserProfile.organization_id) {
          query = query.eq('organization_id', currentUserProfile.organization_id);
        } else {
          // Admin with no organization sees only themselves (safety)
          query = query.eq('id', authUser.id);
        }
      }
      // Masters and officers: See all users (no filter)

      const { data, error } = await query;

      if (error) {
        console.error('Failed to fetch users:', error);
        throw error;
      }
      
      console.log('Loaded users:', data?.length || 0);
      return data as UserProfile[];
    },
  });
};

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      console.log('Creating user via Edge Function:', input.email, 'Role:', input.role);
      
      // Call Edge Function to create user with service role privileges
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: input.email,
          password: input.password || undefined, // Optional for officers
          first_name: input.first_name,
          last_name: input.last_name,
          role: input.role,
          organization_id: input.organization_id || null,
          phone: input.phone || null,
        },
      });

      if (error) {
        console.error('Edge Function error:', error);
        
        // Extract actual error message from FunctionsHttpError
        let errorMessage = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500;
            const textContent = await error.context?.text();
            console.error('Edge Function error details:', {
              statusCode,
              textContent,
              originalMessage: error.message
            });
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`;
          } catch (extractError) {
            console.error('Failed to extract error details:', extractError);
            errorMessage = error.message || 'Failed to create user - Edge Function error';
          }
        }
        
        throw new Error(errorMessage);
      }

      if (data?.error) {
        console.error('Edge Function returned error in response:', data.error);
        throw new Error(data.error);
      }

      console.log('User created successfully:', data?.data?.email);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User created successfully', {
        description: 'User can now log in with their credentials',
      });
    },
    onError: (error: any) => {
      console.error('User creation error:', error);
      const errorMsg = error.message || 'Failed to create user';
      toast.error(errorMsg, {
        duration: 8000,
        description: 'Check browser console for detailed error information'
      });
    },
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: UpdateUserInput) => {
      const { id, ...updates } = input;
      
      const { data, error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User updated successfully');
    },
    onError: (error: any) => {
      console.error('User update error:', error);
      toast.error(error.message || 'Failed to update user');
    },
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (userId: string) => {
      // Soft delete by setting is_active to false
      const { data, error } = await supabase
        .from('user_profiles')
        .update({ is_active: false })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User deactivated successfully');
    },
    onError: (error: any) => {
      console.error('User delete error:', error);
      toast.error(error.message || 'Failed to deactivate user');
    },
  });
};

export const useResetPassword = () => {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Password reset email sent successfully');
    },
    onError: (error: any) => {
      console.error('Password reset error:', error);
      toast.error(error.message || 'Failed to send password reset email');
    },
  });
};
