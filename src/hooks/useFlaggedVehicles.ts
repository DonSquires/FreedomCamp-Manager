import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export interface FlaggedVehicle {
  id: string;
  organization_id: string;
  plate_number: string;
  last_known_site: string | null;
  date_recorded: string | null;
  vehicle_description: string | null;
  name_contact: string | null;
  confirmed_homeless: boolean;
  notes: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  organization?: { id: string; name: string };
  creator?: { first_name: string; last_name: string };
}

export function useFlaggedVehicles(organizationId?: string) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['flagged-vehicles', organizationId],
    queryFn: async () => {
      console.log('📋 Fetching flagged vehicles...');
      
      let query = supabase
        .from('flagged_vehicles')
        .select(`
          *,
          organization:organizations(id, name),
          creator:user_profiles!created_by(first_name, last_name)
        `)
        .order('created_at', { ascending: false });

      // Filter by organization
      if (organizationId && organizationId !== 'all') {
        query = query.eq('organization_id', organizationId);
      } else if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error fetching flagged vehicles:', error);
        throw error;
      }

      console.log(`✅ Fetched ${data?.length || 0} flagged vehicles`);
      return data as FlaggedVehicle[];
    },
    enabled: !!user,
  });

  const createFlaggedVehicle = useMutation({
    mutationFn: async (vehicleData: Partial<FlaggedVehicle>) => {
      const { data, error } = await supabase
        .from('flagged_vehicles')
        .insert([vehicleData])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-vehicles'] });
      toast.success('Flagged vehicle created successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to create flagged vehicle: ' + error.message);
    },
  });

  const updateFlaggedVehicle = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<FlaggedVehicle> }) => {
      const { data, error } = await supabase
        .from('flagged_vehicles')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-vehicles'] });
      toast.success('Flagged vehicle updated successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to update flagged vehicle: ' + error.message);
    },
  });

  const deleteFlaggedVehicle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('flagged_vehicles')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flagged-vehicles'] });
      toast.success('Flagged vehicle deleted successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to delete flagged vehicle: ' + error.message);
    },
  });

  return {
    data: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    createFlaggedVehicle,
    updateFlaggedVehicle,
    deleteFlaggedVehicle,
  };
}
