import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

export interface ImportHistory {
  id: string;
  organization_id: string;
  imported_by: string;
  import_type: 'flagged_vehicles' | 'vehicle_records' | 'person_records' | 'other';
  file_name: string | null;
  records_imported: number;
  duplicates_skipped: number;
  failed_records: number;
  status: 'completed' | 'failed' | 'partial';
  error_log: any[];
  created_at: string;
  organization?: { id: string; name: string };
  importer?: { first_name: string; last_name: string };
}

export function useImportHistory(organizationId?: string) {
  const { user } = useAuthStore();

  const query = useQuery({
    queryKey: ['import-history', organizationId],
    queryFn: async () => {
      console.log('📋 Fetching import history...');
      
      let query = supabase
        .from('import_history')
        .select(`
          *,
          organization:organizations(id, name),
          importer:user_profiles!imported_by(first_name, last_name)
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
        console.error('❌ Error fetching import history:', error);
        throw error;
      }

      console.log(`✅ Fetched ${data?.length || 0} import history records`);
      return data as ImportHistory[];
    },
    enabled: !!user,
  });

  return {
    data: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
