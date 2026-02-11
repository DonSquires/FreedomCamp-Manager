import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { HealthSafetyReport } from '@/types';

export const useHealthSafetyReports = () => {
  return useQuery({
    queryKey: ['health-safety-reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('health_safety_reports')
        .select(`
          *,
          zone:zones(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as HealthSafetyReport[];
    },
  });
};
