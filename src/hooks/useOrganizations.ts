import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export interface Organization {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateOrganizationInput {
  name: string;
  contact_email?: string;
  contact_phone?: string;
}

export interface UpdateOrganizationInput {
  id: string;
  name?: string;
  contact_email?: string;
  contact_phone?: string;
}

export const useOrganizations = () => {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      return data as Organization[];
    },
  });
};

export const useCreateOrganization = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: CreateOrganizationInput) => {
      const { data, error } = await supabase
        .from('organizations')
        .insert({
          name: input.name,
          contact_email: input.contact_email || null,
          contact_phone: input.contact_phone || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success('Organization created successfully');
    },
    onError: (error: any) => {
      console.error('Organization creation error:', error);
      toast.error(error.message || 'Failed to create organization');
    },
  });
};

export const useUpdateOrganization = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (input: UpdateOrganizationInput) => {
      const { id, ...updates } = input;
      
      const { data, error } = await supabase
        .from('organizations')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success('Organization updated successfully');
    },
    onError: (error: any) => {
      console.error('Organization update error:', error);
      toast.error(error.message || 'Failed to update organization');
    },
  });
};

export const useDeleteOrganization = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('organizations')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success('Organization deleted successfully');
    },
    onError: (error: any) => {
      console.error('Organization delete error:', error);
      toast.error(error.message || 'Failed to delete organization');
    },
  });
};
