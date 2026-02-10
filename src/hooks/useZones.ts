import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Zone } from '@/types';
import { toast } from 'sonner';

export interface CreateZoneInput {
  organization_id: string;
  name: string;
  description?: string;
  day_visit_only?: boolean;
  self_contained_required?: boolean;
  nights_per_month?: number;
  max_consecutive_nights?: number;
  location_lat?: number;
  location_lng?: number;
  geometry?: any;
  allowed_days?: string[];
  is_active?: boolean;
}

export interface UpdateZoneInput {
  id: string;
  organization_id?: string;
  name?: string;
  description?: string;
  day_visit_only?: boolean;
  self_contained_required?: boolean;
  nights_per_month?: number;
  max_consecutive_nights?: number;
  location_lat?: number;
  location_lng?: number;
  geometry?: any;
  is_active?: boolean;
  allowed_days?: string[];
}

export const useZones = () => {
  return useQuery({
    queryKey: ['zones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select(`
          *,
          organization:organizations(id, name)
        `)
        .order('name', { ascending: true });

      if (error) throw error;
      return data as Zone[];
    },
  });
};

export const useCreateZone = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: CreateZoneInput) => {
      // If day_visit_only is true, override related fields
      const selfContainedRequired = input.day_visit_only 
        ? false 
        : (input.self_contained_required ?? true);
      const nightsPerMonth = input.day_visit_only ? 0 : (input.nights_per_month || 28);
      const maxConsecutiveNights = input.day_visit_only ? 0 : (input.max_consecutive_nights || 3);

      const { data, error } = await supabase
        .from('zones')
        .insert({
          organization_id: input.organization_id,
          name: input.name,
          description: input.description || null,
          day_visit_only: input.day_visit_only ?? false,
          self_contained_required: selfContainedRequired,
          nights_per_month: nightsPerMonth,
          max_consecutive_nights: maxConsecutiveNights,
          location_lat: input.location_lat || null,
          location_lng: input.location_lng || null,
          geometry: input.geometry || null,
          is_active: input.is_active ?? true,
          allowed_days: input.allowed_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zones'] });
      toast.success('Zone created successfully');
    },
    onError: (error: any) => {
      console.error('Zone creation error:', error);
      toast.error(error.message || 'Failed to create zone');
    },
  });
};

export const useUpdateZone = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: UpdateZoneInput) => {
      const { id, ...updates } = input;
      
      const { data, error } = await supabase
        .from('zones')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zones'] });
      toast.success('Zone updated successfully');
    },
    onError: (error: any) => {
      console.error('Zone update error:', error);
      toast.error(error.message || 'Failed to update zone');
    },
  });
};

export const useDeleteZone = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      // Permanently delete the zone from database
      const { error } = await supabase
        .from('zones')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zones'] });
      toast.success('Zone permanently deleted');
    },
    onError: (error: any) => {
      console.error('Zone delete error:', error);
      toast.error(error.message || 'Failed to delete zone');
    },
  });
};
