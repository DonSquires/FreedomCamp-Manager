import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface ComplianceResult {
  is_compliant: boolean;
  violation_type: string | null;
  violation_severity: string;
  violation_message: string;
  consecutive_nights: number;
  consecutive_limit: number;
  month_nights: number;
  month_limit: number;
  requires_self_contained: boolean;
  is_self_contained: boolean;
  is_day_visit_only: boolean;
  has_overnight_stay: boolean;
  fine_amount: number;
  recommended_action: string | null;
  is_homeless_exempt: boolean;
}

interface StaySummary {
  total_records_in_zone: number;
  unique_dates_count: number;
  unique_dates: string[];
  consecutive_nights: number;
  consecutive_start_date: string | null;
  consecutive_end_date: string | null;
  current_month_nights: number;
  current_month_dates: string[];
  last_seen_date: string | null;
  is_currently_present: boolean;
}

/**
 * Hook to calculate vehicle compliance using centralized database function
 * This is the SINGLE SOURCE OF TRUTH for all compliance calculations
 */
export const useVehicleCompliance = (
  plateNumber: string | null,
  zoneId: string | null,
  checkDate?: string
) => {
  return useQuery({
    queryKey: ['vehicle-compliance', plateNumber, zoneId, checkDate],
    queryFn: async () => {
      if (!plateNumber || !zoneId) {
        return null;
      }

      const { data, error } = await supabase.rpc('calculate_vehicle_compliance', {
        p_plate_number: plateNumber.toUpperCase(),
        p_zone_id: zoneId,
        p_check_date: checkDate || new Date().toISOString().split('T')[0],
      });

      if (error) {
        console.error('Compliance calculation failed:', error);
        throw error;
      }

      return data && data.length > 0 ? (data[0] as ComplianceResult) : null;
    },
    enabled: !!plateNumber && !!zoneId,
  });
};

/**
 * Hook to get vehicle stay summary using centralized database function
 */
export const useVehicleStaySummary = (
  plateNumber: string | null,
  zoneId: string | null,
  checkDate?: string
) => {
  return useQuery({
    queryKey: ['vehicle-stay-summary', plateNumber, zoneId, checkDate],
    queryFn: async () => {
      if (!plateNumber || !zoneId) {
        return null;
      }

      const { data, error } = await supabase.rpc('get_vehicle_stay_summary', {
        p_plate_number: plateNumber.toUpperCase(),
        p_zone_id: zoneId,
        p_check_date: checkDate || new Date().toISOString().split('T')[0],
      });

      if (error) {
        console.error('Stay summary calculation failed:', error);
        throw error;
      }

      return data && data.length > 0 ? (data[0] as StaySummary) : null;
    },
    enabled: !!plateNumber && !!zoneId,
  });
};
