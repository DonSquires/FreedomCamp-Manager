import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

type HybridWorkspaceHandshakeParams = {
  providerOrgId?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  preferredClientOrgId?: string | null;
  userId?: string | null;
  defaultTranslationLang?: string;
  enabled?: boolean;
};

type HybridWorkspaceHandshakeResult = {
  handshake_active?: boolean | null;
  handshake_reason?: string | null;
  matched?: boolean | null;
  conflict?: boolean | null;
  reason?: string | null;
  client_org_id?: string | null;
  provider_org_id?: string | null;
  workspace_id?: string | null;
  workspace_name?: string | null;
  translation_active?: boolean | null;
  branch_id?: string | null;
  ptt_channel?: string | null;
  target_translation_language?: string | null;
};

function normalizeHandshakePayload(data: unknown): HybridWorkspaceHandshakeResult | null {
  if (Array.isArray(data)) {
    const first = data.find((row) => row && typeof row === 'object') as HybridWorkspaceHandshakeResult | undefined;
    return first || null;
  }

  if (data && typeof data === 'object') {
    return data as HybridWorkspaceHandshakeResult;
  }

  return null;
}

export function useHybridWorkspaceHandshake({
  providerOrgId,
  longitude,
  latitude,
  preferredClientOrgId,
  userId,
  defaultTranslationLang = 'hi-IN',
  enabled = true,
}: HybridWorkspaceHandshakeParams) {
  const hasCoordinates = typeof longitude === 'number' && typeof latitude === 'number';
  const isReady = enabled && !!providerOrgId;

  return useQuery({
    queryKey: [
      'hybrid-workspace-handshake',
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
      const { data, error } = await client.rpc('resolve_hybrid_workspace_handshake', {
        p_provider_org_id: providerOrgId,
        p_longitude: hasCoordinates ? longitude : null,
        p_latitude: hasCoordinates ? latitude : null,
        p_preferred_client_org_id: preferredClientOrgId ?? null,
        p_user_id: userId ?? null,
        p_default_translation_lang: defaultTranslationLang,
      });

      if (error) {
        throw error;
      }

      return normalizeHandshakePayload(data);
    },
    staleTime: 15 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}
