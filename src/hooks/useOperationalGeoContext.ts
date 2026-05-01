import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type OperationalGeoContextParams = {
  providerOrgId?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  preferredClientOrgId?: string | null;
  userId?: string | null;
  defaultTranslationLang?: string;
  enabled?: boolean;
};

export function useOperationalGeoContext({
  providerOrgId,
  longitude,
  latitude,
  preferredClientOrgId,
  userId,
  defaultTranslationLang = 'hi-IN',
  enabled = true,
}: OperationalGeoContextParams) {
  const isReady =
    enabled &&
    !!providerOrgId &&
    typeof longitude === 'number' &&
    typeof latitude === 'number';

  return useQuery({
    queryKey: [
      'operational-geo-context',
      providerOrgId,
      longitude,
      latitude,
      preferredClientOrgId,
      userId,
      defaultTranslationLang,
    ],
    enabled: isReady,
    queryFn: async () => {
      const client = supabase as any;
      const { data, error } = await client.rpc('resolve_geofence_operational_context', {
        p_provider_org_id: providerOrgId,
        p_longitude: longitude,
        p_latitude: latitude,
        p_preferred_client_org_id: preferredClientOrgId ?? null,
        p_user_id: userId ?? null,
        p_default_translation_lang: defaultTranslationLang,
      });

      if (error) {
        throw error;
      }

      return data;
    },
    staleTime: 15 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}
