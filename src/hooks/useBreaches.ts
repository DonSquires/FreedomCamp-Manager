import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { BreachAlert } from '@/types';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';

/**
 * Hook to fetch breach alerts from database
 * All breach data is generated using the centralized calculate_vehicle_compliance() function
 */
export const useBreaches = (organizationId?: string | null) => {
  const { user } = useAuthStore();
  
  return useQuery({
    queryKey: ['breaches', organizationId],
    queryFn: async () => {
      let query = supabase
        .from('breach_alerts')
        .select(`
          *,
          zone:zones(id, name),
          organization:organizations(id, name),
          vehicle:canonical_vehicles!breach_alerts_plate_number_fkey(plate_number, make, model, colour, homeless_status, is_flagged)
        `);
      
      // Apply organization filter if specified
      if (organizationId && organizationId !== 'all') {
        query = query.eq('organization_id', organizationId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('❌ Breach fetch error:', error);
        throw error;
      }
      
      return data as BreachAlert[];
    },
  });
};

export const useUpdateBreach = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<BreachAlert> }) => {
      const { data, error } = await supabase
        .from('breach_alerts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['breaches'] });
      toast.success('Breach alert updated successfully');
    },
    onError: (error: any) => {
      console.error('Breach update error:', error);
      toast.error(error.message || 'Failed to update breach alert');
    },
  });
};
