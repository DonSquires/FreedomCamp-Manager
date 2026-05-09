import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useCleanDashboardOrgCounts() {
  return useQuery({
    queryKey: ['org-obs-counts'],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.from('observations').select('organization_id');
      if (error) throw error;

      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { organization_id: string }[]) {
        counts[row.organization_id] = (counts[row.organization_id] ?? 0) + 1;
      }
      return counts;
    },
  });
}
