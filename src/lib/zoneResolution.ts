import { supabase } from '@/lib/supabase'

export type ZoneResolutionSource =
  | 'preferred'
  | 'rpc_other_location'
  | 'fallback_other_location'
  | 'fallback_any_active_zone'

interface ResolvedZone {
  zoneId: string
  source: ZoneResolutionSource
}

export async function resolveObservationZoneForOrg(
  organizationId: string,
  preferredZoneId?: string | null
): Promise<ResolvedZone> {
  if (preferredZoneId) {
    return { zoneId: preferredZoneId, source: 'preferred' }
  }

  const { data: rpcZoneId, error: rpcError } = await (supabase as any).rpc('ensure_other_location_zone', {
    p_organization_id: organizationId,
  })

  if (!rpcError && rpcZoneId) {
    return { zoneId: rpcZoneId, source: 'rpc_other_location' }
  }

  const { data: byNameZones, error: byNameError } = await (supabase.from('zones') as any)
    .select('id, name')
    .eq('organization_id', organizationId)
    .ilike('name', 'other location')
    .limit(1)

  if (!byNameError && byNameZones?.[0]?.id) {
    return { zoneId: byNameZones[0].id as string, source: 'fallback_other_location' }
  }

  const { data: activeZones, error: activeZonesError } = await (supabase.from('zones') as any)
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(1)

  if (!activeZonesError && activeZones?.[0]?.id) {
    return { zoneId: activeZones[0].id as string, source: 'fallback_any_active_zone' }
  }

  const detail = rpcError?.message || byNameError?.message || activeZonesError?.message || 'No fallback zone available'
  throw new Error(`Could not resolve zone for observation: ${detail}`)
}
