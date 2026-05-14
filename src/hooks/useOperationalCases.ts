import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

type OperationalCase = {
  id: string;
  title?: string | null;
  case_type?: string | null;
  status?: string | null;
  created_at?: string | null;
  dispatch_job_id?: string | null;
  summary?: string | null;
  created_from?: string | null;
  [key: string]: unknown;
};

type PatrolEvent = {
  id: string;
  case_id: string;
  event_timestamp?: string | null;
  [key: string]: unknown;
};

type DispatchEvent = {
  id: string;
  case_id: string;
  event_timestamp?: string | null;
  [key: string]: unknown;
};

type EnforcementEvent = {
  id: string;
  case_id: string;
  event_timestamp?: string | null;
  [key: string]: unknown;
};

// These Phase A/B tables may not exist in generated Database types yet.
// Use runtime queries while schema/type generation catches up.
const sb = supabase as any;

/**
 * Hook: Fetch operational cases for current organization
 * Used by: Field Officer, Dispatch Console, Enforcement Timeline routes
 */
export const useOperationalCases = (filters?: {
  status?: string;
  caseType?: string;
  limit?: number;
}) => {
  return useQuery({
    queryKey: ['operationalCases', filters],
    queryFn: async () => {
      let query = sb
        .from('operational_cases')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.caseType) {
        query = query.eq('case_type', filters.caseType);
      }
      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as OperationalCase[];
    },
  });
};

/**
 * Hook: Get single case with all related events
 */
export const useOperationalCaseWithEvents = (caseId: string | null) => {
  return useQuery({
    queryKey: ['operationalCase', caseId],
    queryFn: async () => {
      if (!caseId) return null;

      const { data: caseData, error: caseError } = await sb
        .from('operational_cases')
        .select('*')
        .eq('id', caseId)
        .single();

      if (caseError) throw caseError;

      // Fetch all related events
      const [{ data: patrolEvents }, { data: dispatchEvents }, { data: enforcementEvents }] =
        await Promise.all([
          sb.from('patrol_events').select('*').eq('case_id', caseId),
          sb.from('dispatch_events').select('*').eq('case_id', caseId),
          sb.from('enforcement_events').select('*').eq('case_id', caseId),
        ]);

      return {
        case: caseData as OperationalCase,
        patrolEvents: (patrolEvents || []) as PatrolEvent[],
        dispatchEvents: (dispatchEvents || []) as DispatchEvent[],
        enforcementEvents: (enforcementEvents || []) as EnforcementEvent[],
      };
    },
    enabled: !!caseId,
  });
};

/**
 * Hook: Create new operational case
 */
export const useCreateOperationalCase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      caseType: string;
      title: string;
      dispatchJobId?: string;
      summary?: string;
    }) => {
      const { data, error } = await sb
        .from('operational_cases')
        .insert({
          case_type: input.caseType,
          title: input.title,
          dispatch_job_id: input.dispatchJobId,
          summary: input.summary,
          created_from: input.dispatchJobId ? 'dispatch' : 'manual',
        })
        .select()
        .single();

      if (error) throw error;
      return data as OperationalCase;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operationalCases'] });
    },
  });
};

/**
 * Hook: Fetch patrol events for a case
 */
export const usePatrolEvents = (caseId: string | null) => {
  return useQuery({
    queryKey: ['patrolEvents', caseId],
    queryFn: async () => {
      const { data, error } = await sb
        .from('patrol_events')
        .select('*')
        .eq('case_id', caseId)
        .order('event_timestamp', { ascending: false });

      if (error) throw error;
      return data as PatrolEvent[];
    },
    enabled: !!caseId,
  });
};

/**
 * Hook: Create patrol event
 */
export const useCreatePatrolEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      caseId: string;
      officerId: string;
      patrolType: string;
      eventType: string;
      observationText?: string;
      gpsLat?: number;
      gpsLng?: number;
    }) => {
      const { data, error } = await sb
        .from('patrol_events')
        .insert({
          case_id: input.caseId,
          officer_id: input.officerId,
          patrol_type: input.patrolType,
          event_type: input.eventType,
          observation_text: input.observationText,
          gps_lat: input.gpsLat,
          gps_lng: input.gpsLng,
        })
        .select()
        .single();

      if (error) throw error;
      return data as PatrolEvent;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['patrolEvents', variables.caseId],
      });
    },
  });
};

/**
 * Hook: Fetch dispatch events for a case
 */
export const useDispatchEvents = (caseId: string | null) => {
  return useQuery({
    queryKey: ['dispatchEvents', caseId],
    queryFn: async () => {
      const { data, error } = await sb
        .from('dispatch_events')
        .select('*')
        .eq('case_id', caseId)
        .order('event_timestamp', { ascending: false });

      if (error) throw error;
      return data as DispatchEvent[];
    },
    enabled: !!caseId,
  });
};

/**
 * Hook: Create dispatch event
 */
export const useCreateDispatchEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      caseId: string;
      dispatchJobId: string;
      eventType: string;
      assignedTo?: string;
      statusAtEvent?: string;
    }) => {
      const { data, error } = await sb
        .from('dispatch_events')
        .insert({
          case_id: input.caseId,
          dispatch_job_id: input.dispatchJobId,
          event_type: input.eventType,
          assigned_to: input.assignedTo,
          status_at_event: input.statusAtEvent,
        })
        .select()
        .single();

      if (error) throw error;
      return data as DispatchEvent;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['dispatchEvents', variables.caseId],
      });
    },
  });
};

/**
 * Hook: Fetch enforcement events for a case
 */
export const useEnforcementEvents = (caseId: string | null) => {
  return useQuery({
    queryKey: ['enforcementEvents', caseId],
    queryFn: async () => {
      const { data, error } = await sb
        .from('enforcement_events')
        .select('*')
        .eq('case_id', caseId)
        .order('event_timestamp', { ascending: false });

      if (error) throw error;
      return data as EnforcementEvent[];
    },
    enabled: !!caseId,
  });
};

/**
 * Hook: Create enforcement event
 */
export const useCreateEnforcementEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      caseId: string;
      eventType: string;
      officerId: string;
      violationType?: string;
      actionTaken?: string;
      outcome?: string;
    }) => {
      const { data, error } = await sb
        .from('enforcement_events')
        .insert({
          case_id: input.caseId,
          event_type: input.eventType,
          officer_id: input.officerId,
          violation_type: input.violationType,
          action_taken: input.actionTaken,
          outcome: input.outcome,
        })
        .select()
        .single();

      if (error) throw error;
      return data as EnforcementEvent;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['enforcementEvents', variables.caseId],
      });
    },
  });
};

/**
 * Hook: Get feature flag status
 * Used to conditionally enable Phase B features
 */
export const useFeatureFlag = (flagName: string) => {
  const user = useAuthStore((state) => state.user);

  return useQuery({
    queryKey: ['featureFlag', flagName, user?.id ?? null, user?.organization_id ?? null],
    queryFn: async () => {
      const { data, error } = await sb
        .rpc('is_feature_enabled', { flag_name: flagName });

      if (error) throw error;

      const enabled = (data as boolean) || false;

      const { data: flagRow, error: flagLookupError } = await sb
        .from('feature_flags')
        .select('id')
        .eq('name', flagName)
        .maybeSingle();

      if (flagLookupError) {
        console.warn('[useFeatureFlag] failed to resolve flag id for evaluation logging:', flagLookupError);
        return enabled;
      }

      if (flagRow?.id) {
        const { error: evaluationError } = await sb
          .from('feature_flag_evaluations')
          .insert({
            flag_id: flagRow.id,
            enabled,
            evaluated_at: new Date().toISOString(),
            organization_id: user?.organization_id ?? null,
            user_id: user?.id ?? null,
          });

        if (evaluationError) {
          console.warn('[useFeatureFlag] failed to log feature flag evaluation:', evaluationError);
        }
      }

      return enabled;
    },
  });
};

export default {
  useOperationalCases,
  useOperationalCaseWithEvents,
  useCreateOperationalCase,
  usePatrolEvents,
  useCreatePatrolEvent,
  useDispatchEvents,
  useCreateDispatchEvent,
  useEnforcementEvents,
  useCreateEnforcementEvent,
  useFeatureFlag,
};
