import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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

export const useUsers = () => {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('Not authenticated');

      const { data: currentUserProfile } = await supabase
        .from('user_profiles')
        .select('role, organization_id')
        .eq('id', authUser.id)
        .single();

      if (!currentUserProfile) throw new Error('User profile not found');

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
      if (error) throw error;
      
      return data as UserProfile[];
    },
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: { id: string; [key: string]: any }) => {
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
