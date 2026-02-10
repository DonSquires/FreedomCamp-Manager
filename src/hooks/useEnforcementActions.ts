import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export interface EnforcementAction {
  id: string;
  organization_id: string;
  user_id: string;
  vehicle_record_id: string | null;
  zone_id: string;
  action_type: 'warning' | 'notice' | 'tow' | 'other';
  delivery_method: 'email' | 'physical' | 'in_person' | null;
  recipient_name: string | null;
  recipient_email: string | null;
  location_lat: number | null;
  location_lng: number | null;
  notes: string | null;
  attachments: string[];
  status: 'pending' | 'delivered' | 'acknowledged' | 'expired';
  delivered_at: string | null;
  acknowledged_at: string | null;
  recorded_at: string;
  created_at: string;
  zone?: { id: string; name: string };
  organization?: { id: string; name: string };
  vehicle_record?: { id: string; plate_number: string };
  user?: { first_name: string; last_name: string };
}

export function useEnforcementActions(organizationId?: string) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['enforcement-actions', organizationId],
    queryFn: async () => {
      console.log('📋 Fetching enforcement actions...');
      
      let query = supabase
        .from('enforcement_actions')
        .select(`
          *,
          zone:zones(id, name),
          organization:organizations(id, name),
          vehicle_record:vehicle_records(id, plate_number),
          user:user_profiles!user_id(first_name, last_name)
        `)
        .order('recorded_at', { ascending: false });

      // Filter by organization
      if (organizationId && organizationId !== 'all') {
        query = query.eq('organization_id', organizationId);
      } else if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error fetching enforcement actions:', error);
        throw error;
      }

      console.log(`✅ Fetched ${data?.length || 0} enforcement actions`);
      return data as EnforcementAction[];
    },
    enabled: !!user,
  });

  const createEnforcementAction = useMutation({
    mutationFn: async (actionData: Partial<EnforcementAction>) => {
      const { data, error } = await supabase
        .from('enforcement_actions')
        .insert([actionData])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] });
      toast.success('Enforcement action created successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to create enforcement action: ' + error.message);
    },
  });

  const updateEnforcementAction = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EnforcementAction> }) => {
      const { data, error } = await supabase
        .from('enforcement_actions')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] });
      toast.success('Enforcement action updated successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to update enforcement action: ' + error.message);
    },
  });

  const deleteEnforcementAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('enforcement_actions')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enforcement-actions'] });
      toast.success('Enforcement action deleted successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to delete enforcement action: ' + error.message);
    },
  });

  return {
    data: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    createEnforcementAction,
    updateEnforcementAction,
    deleteEnforcementAction,
  };
}
