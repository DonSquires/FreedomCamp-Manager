import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export interface PersonRecord {
  id: string;
  organization_id: string;
  user_id: string;
  zone_id: string;
  full_name: string;
  date_of_birth: string | null;
  id_verified: boolean;
  homeless_claimed: boolean;
  homeless_confirmed: boolean;
  homeless_confirmed_by: string | null;
  homeless_confirmed_at: string | null;
  location_lat: number | null;
  location_lng: number | null;
  notes: string | null;
  attachments: string[];
  recorded_at: string;
  created_at: string;
  zone?: { id: string; name: string };
  organization?: { id: string; name: string };
  recorded_by_user?: { first_name: string; last_name: string };
  confirmed_by_user?: { first_name: string; last_name: string };
}

export function usePersonRecords(organizationId?: string) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['person-records', organizationId],
    queryFn: async () => {
      console.log('📋 Fetching person records...');
      
      let query = supabase
        .from('person_records')
        .select(`
          *,
          zone:zones(id, name),
          organization:organizations(id, name),
          recorded_by_user:user_profiles!user_id(first_name, last_name),
          confirmed_by_user:user_profiles!homeless_confirmed_by(first_name, last_name)
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
        console.error('❌ Error fetching person records:', error);
        throw error;
      }

      console.log(`✅ Fetched ${data?.length || 0} person records`);
      return data as PersonRecord[];
    },
    enabled: !!user,
  });

  const createPersonRecord = useMutation({
    mutationFn: async (personData: Partial<PersonRecord>) => {
      const { data, error } = await supabase
        .from('person_records')
        .insert([personData])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-records'] });
      toast.success('Person record created successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to create person record: ' + error.message);
    },
  });

  const updatePersonRecord = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<PersonRecord> }) => {
      const { data, error } = await supabase
        .from('person_records')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-records'] });
      toast.success('Person record updated successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to update person record: ' + error.message);
    },
  });

  const deletePersonRecord = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('person_records')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['person-records'] });
      toast.success('Person record deleted successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to delete person record: ' + error.message);
    },
  });

  return {
    data: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    createPersonRecord,
    updatePersonRecord,
    deletePersonRecord,
  };
}
