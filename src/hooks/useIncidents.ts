import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export interface IncidentVehicle {
  id: string;
  incident_id: string;
  vehicle_id: string;
  vehicle_role?: string;
  notes?: string;
  vehicle?: any;
}

export interface IncidentPerson {
  id: string;
  incident_id: string;
  person_name: string;
  person_role?: string;
  contact_email?: string;
  contact_phone?: string;
  id_verified?: boolean;
  notes?: string;
}

export interface IncidentAction {
  id: string;
  incident_id: string;
  action_type: string;
  performed_by: string;
  changes?: any;
  notes?: string;
  timestamp: string;
  user?: any;
}

export interface Incident {
  id: string;
  organization_id: string;
  user_id: string;
  zone_id: string;
  incident_type: 'vandalism' | 'theft' | 'assault' | 'harassment' | 'noise' | 'littering' | 'damage' | 'other' | 'VERBAL_WARNING' | 'WARNING_NOTICE' | 'TRESPASS' | 'FINE' | 'TOWED';
  description: string;
  status: 'pending' | 'investigating' | 'resolved' | 'closed' | 'open' | 'under_review';
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolution_notes: string | null;
  resolved_by: string | null;
  location_lat: number | null;
  location_lng: number | null;
  attachments: string[];
  recorded_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  // Enhanced fields
  vehicle_id?: string;
  photos?: string[];
  photo_hashes?: string[];
  gps_latitude?: number;
  gps_longitude?: number;
  gps_accuracy?: number;
  happened_at?: string;
  court_ready?: boolean;
  approved_by?: string;
  approved_at?: string;
  evidence_notes?: string;
  enforcement_action_id?: string;
  // Relations
  zone?: { id: string; name: string };
  organization?: { id: string; name: string };
  user?: { first_name: string; last_name: string; email?: string };
  resolver?: { first_name: string; last_name: string };
  vehicle?: any;
  incident_vehicles?: IncidentVehicle[];
  incident_persons?: IncidentPerson[];
  incident_actions?: IncidentAction[];
  enforcement_action?: any;
}

export function useIncidents(organizationId?: string) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['incidents', organizationId],
    queryFn: async () => {
      console.log('📋 Fetching incidents...');
      
      let query = supabase
        .from('incidents')
        .select(`
          *,
          zone:zones(id, name),
          organization:organizations(id, name),
          user:user_profiles!user_id(first_name, last_name),
          resolver:user_profiles!resolved_by(first_name, last_name)
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
        console.error('❌ Error fetching incidents:', error);
        throw error;
      }

      console.log(`✅ Fetched ${data?.length || 0} incidents`);
      return data as Incident[];
    },
    enabled: !!user,
  });

  const createIncident = useMutation({
    mutationFn: async (incidentData: Partial<Incident>) => {
      const { data, error } = await supabase
        .from('incidents')
        .insert([incidentData])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      toast.success('Incident created successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to create incident: ' + error.message);
    },
  });

  const updateIncident = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Incident> }) => {
      const { data, error } = await supabase
        .from('incidents')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      toast.success('Incident updated successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to update incident: ' + error.message);
    },
  });

  const deleteIncident = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('incidents')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      toast.success('Incident deleted successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to delete incident: ' + error.message);
    },
  });

  return {
    data: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    createIncident,
    updateIncident,
    deleteIncident,
  };
}
