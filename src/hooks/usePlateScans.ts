import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { Database } from '@/types/database';
import { toast } from 'sonner';

type PlateScan = Database['public']['Tables']['plate_scans']['Row'];
type PlateScanInsert = Database['public']['Tables']['plate_scans']['Insert'];
type PlateScanUpdate = Database['public']['Tables']['plate_scans']['Update'];

export interface PlateScanWithDetails extends PlateScan {
  zone?: { name: string };
  organization?: { name: string };
  scanned_by_user?: { first_name: string; last_name: string };
  reviewed_by_user?: { first_name: string; last_name: string };
}

export function usePlateScans() {
  const { user } = useAuthStore();
  const [data, setData] = useState<PlateScanWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPlateScans = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      let query = supabase
        .from('plate_scans')
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name),
          scanned_by_user:user_profiles!scanned_by(first_name, last_name),
          reviewed_by_user:user_profiles!reviewed_by(first_name, last_name)
        `)
        .order('scanned_at', { ascending: false });

      // Admins/Master see all scans in their org, Officers see only their own
      if (user.role === 'master') {
        // Master sees all scans across all organizations
      } else if (user.role === 'admin') {
        // Admins see all scans in their organization
        query = query.eq('organization_id', user.organization_id);
      } else {
        // Officers see only their own scans
        query = query.eq('scanned_by', user.id);
      }

      const { data: scans, error: scansError } = await query;

      if (scansError) throw scansError;
      setData(scans || []);
    } catch (err: any) {
      console.error('Failed to fetch plate scans:', err);
      setError(err);
      toast.error('Failed to load plate scans');
    } finally {
      setIsLoading(false);
    }
  };

  const createPlateScan = async (scan: PlateScanInsert) => {
    try {
      const { data: newScan, error: insertError } = await supabase
        .from('plate_scans')
        .insert(scan)
        .select()
        .single();

      if (insertError) throw insertError;

      setData((prev) => [newScan, ...prev]);
      toast.success('Scan recorded');
      return newScan;
    } catch (err: any) {
      console.error('Failed to create plate scan:', err);
      toast.error('Failed to record scan');
      throw err;
    }
  };

  const updatePlateScan = async (id: string, updates: PlateScanUpdate) => {
    try {
      const { data: updatedScan, error: updateError } = await supabase
        .from('plate_scans')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      setData((prev) =>
        prev.map((scan) => (scan.id === id ? { ...scan, ...updatedScan } : scan))
      );
      toast.success('Scan updated');
      return updatedScan;
    } catch (err: any) {
      console.error('Failed to update plate scan:', err);
      toast.error('Failed to update scan');
      throw err;
    }
  };

  const deletePlateScan = async (id: string) => {
    try {
      const { error: deleteError } = await supabase
        .from('plate_scans')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      setData((prev) => prev.filter((scan) => scan.id !== id));
      toast.success('Scan deleted');
    } catch (err: any) {
      console.error('Failed to delete plate scan:', err);
      toast.error('Failed to delete scan');
      throw err;
    }
  };

  useEffect(() => {
    fetchPlateScans();

    // Real-time subscription
    const channel = supabase
      .channel('plate_scans_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'plate_scans',
        },
        () => {
          fetchPlateScans();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return {
    data,
    isLoading,
    error,
    createPlateScan,
    updatePlateScan,
    deletePlateScan,
    refetch: fetchPlateScans,
  };
}
