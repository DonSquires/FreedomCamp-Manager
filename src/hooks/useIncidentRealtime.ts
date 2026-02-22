/**
 * Incident Realtime Subscription Hook
 * 
 * Auto-refreshes incident data when ALPR processing completes.
 * Uses Supabase Realtime postgres_changes subscription.
 * 
 * Usage:
 * const incident = useIncidentRealtime(incidentId);
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface Incident {
  id: string;
  organization_id: string;
  user_id: string;
  status: 'new' | 'processing' | 'complete' | 'failed';
  plate_number: string | null;
  alpr_confidence: number | null;
  alpr_provider: string | null;
  alpr_processed_at: string | null;
  evidence_count: number;
  primary_evidence_url: string | null;
  retention_hold: boolean;
  retention_until: string | null;
  retention_notes: string | null;
  created_at: string;
  updated_at: string;
  incident_type: string | null;
  description: string | null;
  notes: string | null;
}

export function useIncidentRealtime(incidentId: string | null) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!incidentId) {
      setIncident(null);
      setLoading(false);
      return;
    }

    let isMounted = true;

    // Fetch initial data
    async function fetchIncident() {
      try {
        const { data, error: fetchError } = await supabase
          .from('incidents')
          .select('*')
          .eq('id', incidentId)
          .single();

        if (!isMounted) return;

        if (fetchError) {
          console.error('Failed to fetch incident:', fetchError);
          setError(fetchError.message);
          setLoading(false);
          return;
        }

        setIncident(data);
        setError(null);
        setLoading(false);
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Unexpected error fetching incident:', err);
        setError(err.message || 'Failed to load incident');
        setLoading(false);
      }
    }

    fetchIncident();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`incidents:${incidentId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'incidents',
          filter: `id=eq.${incidentId}`,
        },
        (payload) => {
          if (!isMounted) return;
          
          console.log('🔄 Incident updated:', payload.new);
          
          // Update local state with new data
          setIncident((prev) => ({
            ...(prev || ({} as Incident)),
            ...(payload.new as Incident),
          }));
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ Subscribed to incident updates: ${incidentId}`);
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Failed to subscribe to incident updates');
        }
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [incidentId]);

  return { incident, loading, error };
}

/**
 * Hook for listing incidents with realtime updates
 */
export function useIncidentsList(filters?: {
  organizationId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  plateSearch?: string;
}) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchIncidents() {
      try {
        let query = supabase.from('incidents').select('*');

        // Apply filters
        if (filters?.organizationId) {
          query = query.eq('organization_id', filters.organizationId);
        }
        if (filters?.status) {
          query = query.eq('status', filters.status);
        }
        if (filters?.dateFrom) {
          query = query.gte('created_at', filters.dateFrom);
        }
        if (filters?.dateTo) {
          query = query.lte('created_at', filters.dateTo);
        }
        if (filters?.plateSearch) {
          query = query.ilike('plate_number', `%${filters.plateSearch}%`);
        }

        // Sort by newest first
        query = query.order('created_at', { ascending: false });

        const { data, error: fetchError } = await query;

        if (!isMounted) return;

        if (fetchError) {
          console.error('Failed to fetch incidents:', fetchError);
          setError(fetchError.message);
          setLoading(false);
          return;
        }

        setIncidents(data || []);
        setError(null);
        setLoading(false);
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Unexpected error fetching incidents:', err);
        setError(err.message || 'Failed to load incidents');
        setLoading(false);
      }
    }

    fetchIncidents();

    // Subscribe to INSERT/UPDATE events for realtime list updates
    const channel = supabase
      .channel('incidents-list')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'incidents',
        },
        (payload) => {
          if (!isMounted) return;

          console.log('🔄 Incidents list updated:', payload);

          if (payload.eventType === 'INSERT') {
            setIncidents((prev) => [payload.new as Incident, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setIncidents((prev) =>
              prev.map((inc) =>
                inc.id === payload.new.id ? (payload.new as Incident) : inc
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setIncidents((prev) => prev.filter((inc) => inc.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [
    filters?.organizationId,
    filters?.status,
    filters?.dateFrom,
    filters?.dateTo,
    filters?.plateSearch,
  ]);

  return { incidents, loading, error };
}
