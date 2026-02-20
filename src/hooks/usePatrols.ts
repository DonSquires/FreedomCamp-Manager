import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Patrol } from '@/types';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';

export const usePatrols = (organizationId?: string | null) => {
  const { user } = useAuthStore();
  
  return useQuery({
    queryKey: ['patrols', organizationId],
    queryFn: async () => {
      console.log('🔍 usePatrols - Fetching patrols...');
      console.log('User role:', user?.role);
      console.log('Filter org:', organizationId);
      
      let query = supabase
        .from('patrols')
        .select(`
          *,
          zone:zones(*),
          officer:user_profiles(*),
          organization:organizations(id, name)
        `);
      
      // Apply organization filter if specified
      if (organizationId && organizationId !== 'all' && organizationId !== '') {
        console.log('📊 Applying org filter:', organizationId);
        query = query.eq('organization_id', organizationId);
      } else {
        console.log('🌍 No org filter - fetching ALL (RLS will apply)');
      }
      
      const { data, error } = await query
        .order('patrol_date', { ascending: false })
        .limit(100);

      if (error) {
        console.error('❌ Patrol fetch error:', error);
        throw error;
      }
      
      console.log('✅ Fetched patrols:', data?.length || 0);
      return data as Patrol[];
    },
  });
};

export const useUpdatePatrol = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Patrol> }) => {
      const { data, error } = await supabase
        .from('patrols')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patrols'] });
      toast.success('Patrol updated successfully');
    },
    onError: (error: any) => {
      console.error('Patrol update error:', error);
      toast.error(error.message || 'Failed to update patrol');
    },
  });
};
