import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

export const useVehicles = (organizationId?: string | null) => {
  const { user } = useAuthStore();
  
  return useQuery({
    queryKey: ['vehicles', organizationId],
    queryFn: async () => {
      console.log('🔍 useVehicles - Fetching canonical vehicles...');
      console.log('User:', { email: user?.email, role: user?.role, org: user?.organization_id });
      console.log('Filter org:', organizationId);
      
      // Query canonical_vehicles (new schema with plate_number as PK)
      const { data: vehicles, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .order('last_seen_at', { ascending: false });

      if (error) {
        console.error('❌ Vehicle fetch error:', error);
        throw error;
      }
      
      console.log('✅ Fetched canonical vehicles:', vehicles?.length || 0);
      if (vehicles && vehicles.length > 0) {
        console.log('Sample vehicles:', vehicles.slice(0, 3).map(v => ({
          plate: v.plate_number,
          make: v.vehicle_make,
          model: v.vehicle_model,
          flagged: v.is_flagged,
          homeless: v.homeless_status,
          last_seen: v.last_seen_at
        })));
      }
      
      return vehicles || [];
    },
  });
};

export const useVehicleLookup = (plateNumber: string) => {
  return useQuery({
    queryKey: ['vehicle', plateNumber],
    queryFn: async () => {
      if (!plateNumber || plateNumber.length < 3) return null;

      // Get canonical vehicle record
      const { data: canonicalData, error: canonicalError } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', plateNumber.toUpperCase())
        .single();

      if (canonicalError && canonicalError.code !== 'PGRST116') throw canonicalError;
      if (!canonicalData) return null;

      // Get most recent observation for this vehicle
      const { data: recentObs, error: obsError } = await supabase
        .from('vehicle_observations_v2')
        .select(`
          *,
          zone:zones(*)
        `)
        .eq('plate_number', plateNumber.toUpperCase())
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single();

      if (obsError && obsError.code !== 'PGRST116') throw obsError;

      // Get all enforcement actions for this vehicle
      const { data: enforcementData, error: enforcementError } = await supabase
        .from('enforcement_actions')
        .select(`
          *,
          zone:zones(*)
        `)
        .eq('plate_number', plateNumber.toUpperCase());

      if (enforcementError) throw enforcementError;

      const enforcement = enforcementData || [];
      const activeEnforcement = enforcement.filter(
        e => e.breach_status === 'active'
      );

      return {
        vehicle: canonicalData,
        recent_observation: recentObs,
        enforcement_actions: enforcement,
        compliance_status: canonicalData.total_breaches > 0 ? 'non-compliant' : 'compliant',
        active_enforcement: activeEnforcement.length,
        homeless_status: canonicalData.homeless_status,
        flagged: canonicalData.is_flagged,
      };
    },
    enabled: plateNumber.length >= 3,
  });
};
