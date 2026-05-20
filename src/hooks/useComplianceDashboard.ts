import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { HOMELESS_UI_STATUSES } from '@/lib/homelessStatus';
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone';

interface BreachObservation {
  id: string;
  plate_number: string | null;
  recorded_at: string;
  breach_type: string | null;
  breach_reason: string | null;
  status?: string | null;
  zones: { name: string } | null;
  organizations: { name: string } | null;
}

interface ZoneStats {
  zone_id: string;
  zone_name: string;
  organization_name: string | null;
  is_active: boolean;
  nights_per_month: number;
  max_consecutive_nights: number;
  self_contained_required: boolean;
  day_visit_only: boolean;
  obs_count: number;
  breach_count: number;
  compliance_pct: number;
  zone_type: string | null;
  parent_zone_id: string | null;
}

export function useComplianceStats({
  orgId,
  dateFrom,
  dateTo,
  zoneId,
}: {
  orgId?: string | null;
  dateFrom: string;
  dateTo: string;
  zoneId?: string | null;
}) {
  const startISO = nzDateToUTCStart(dateFrom);
  const endISO = nzDateToUTCEnd(dateTo);

  return useQuery({
    queryKey: ['comp-stats', dateFrom, dateTo, orgId, zoneId],
    queryFn: async () => {
      const applyObs = (q: any) => {
        q = q.gte('recorded_at', startISO).lte('recorded_at', endISO);
        if (orgId)  q = q.eq('organization_id', orgId);
        if (zoneId) q = q.eq('zone_id', zoneId);
        return q;
      };

      const [totalRes, breachRes, flaggedRes, homelessRes] = await Promise.all([
        applyObs(supabase.from('observations').select('*', { count: 'exact', head: true })),
        applyObs(supabase.from('observations').select('*', { count: 'exact', head: true }).eq('is_compliant', false)),
        supabase.from('canonical_vehicles').select('*', { count: 'exact', head: true }).eq('is_flagged', true),
        (supabase.from('canonical_homeless') as any).select('*', { count: 'exact', head: true }).in('status', HOMELESS_UI_STATUSES),
      ]);

      const { data: homelessPlateRows } = await (supabase.from('canonical_homeless') as any)
        .select('plate_number')
        .in('status', ['confirmed', 'claimed']);
      const homelessPlates = (homelessPlateRows ?? []).map((r: any) => r.plate_number).filter(Boolean) as string[];

      let homelessBreachCount = 0;
      if (homelessPlates.length > 0) {
        const chunks: string[][] = [];
        for (let i = 0; i < homelessPlates.length; i += 200) {
          chunks.push(homelessPlates.slice(i, i + 200));
        }
        const chunkResults = await Promise.all(
          chunks.map((chunk) =>
            applyObs(
              (supabase.from('observations') as any)
                .select('*', { count: 'exact', head: true })
                .eq('is_compliant', false)
                .in('plate_number', chunk)
            )
          )
        );
        for (const res of chunkResults) {
          homelessBreachCount += res.count ?? 0;
        }
      }

      const total      = totalRes.count  ?? 0;
      const rawBreaches = breachRes.count ?? 0;
      const breaches   = Math.max(0, rawBreaches - homelessBreachCount);
      const compliant  = total - breaches;

      return {
        total_observations: total,
        breach_count:       breaches,
        compliant_count:    compliant,
        compliance_rate:    total > 0 ? Math.round(100 * compliant / total) : 0,
        flagged_vehicles:   flaggedRes.count  ?? 0,
        homeless_vehicles:  homelessRes.count ?? 0,
      };
    },
  });
}

export function useComplianceBreachObservations({
  orgId,
  dateFrom,
  dateTo,
  zoneId,
  searchQuery,
  page,
  pageSize,
  statusFilter,
}: {
  orgId?: string | null;
  dateFrom: string;
  dateTo: string;
  zoneId?: string | null;
  searchQuery?: string;
  page?: number;
  pageSize?: number;
  statusFilter?: string | null;
}) {
  const startISO = nzDateToUTCStart(dateFrom);
  const endISO = nzDateToUTCEnd(dateTo);
  const PAGE = pageSize ?? 20;
  const currentPage = page ?? 0;
  const search = searchQuery ?? '';

  return useQuery({
    queryKey: ['breaches-detail', currentPage, search, dateFrom, dateTo, orgId, zoneId, statusFilter],
    queryFn: async () => {
      if (statusFilter) {
        let q = supabase
          .from('breach_alerts')
          .select(
            'id, plate_number, created_at, breach_type, breach_details, status, zones(name), organizations(name)',
            { count: 'exact' }
          )
          .eq('status', statusFilter)
          .gte('created_at', startISO)
          .lte('created_at', endISO)
          .order('created_at', { ascending: false })
          .range(currentPage * PAGE, (currentPage + 1) * PAGE - 1);

        if (search.trim()) q = q.ilike('plate_number', `%${search.trim()}%`);
        if (orgId) q = q.eq('organization_id', orgId);
        if (zoneId) q = q.eq('zone_id', zoneId);

        const { data, count, error } = await q;
        if (error) throw error;

        const rows: BreachObservation[] = (data ?? []).map((row: any) => ({
          id: row.id,
          plate_number: row.plate_number,
          recorded_at: row.created_at,
          breach_type: row.breach_type,
          breach_reason: row.breach_details?.breach_reason ?? null,
          status: row.status,
          zones: row.zones ?? null,
          organizations: row.organizations ?? null,
        }));

        return { rows, total: count ?? 0 };
      }

      const applyObsFilters = (query: any) => {
        query = query
          .eq('is_compliant', false)
          .gte('recorded_at', startISO)
          .lte('recorded_at', endISO)
          .order('recorded_at', { ascending: false })
          .range(currentPage * PAGE, (currentPage + 1) * PAGE - 1);

        if (search.trim()) query = query.ilike('plate_number', `%${search.trim()}%`);
        if (orgId) query = query.eq('organization_id', orgId);
        if (zoneId) query = query.eq('zone_id', zoneId);
        return query;
      };

      // Use observation_id (the non-null PK) for the key so React key props are
      // always unique. The nullable `id` column must not be used as a list key.
      // Use generic relationship names (no FK hint) so queries work after the
      // observations table was rebuilt and the old vehicle_observations_v2 FK
      // constraints were removed.
      const joinQuery = applyObsFilters(
        supabase.from('observations').select(
          'observation_id, plate_number, recorded_at, breach_type, breach_reason, zone_id, zones(name), organizations(name)',
          { count: 'exact' }
        )
      );
      const joinResult = await joinQuery;

      if (!joinResult.error) {
        const rows: BreachObservation[] = (joinResult.data ?? []).map((row: any) => ({
          id: row.observation_id,
          plate_number: row.plate_number,
          recorded_at: row.recorded_at,
          breach_type: row.breach_type ?? null,
          breach_reason: row.breach_reason ?? null,
          zones: row.zones ?? null,
          organizations: row.organizations ?? null,
        }));
        return { rows, total: joinResult.count ?? 0 };
      }

      // Fallback: plain select without joins, then resolve zone names separately.
      const plainQuery = applyObsFilters(
        supabase.from('observations').select(
          'observation_id, plate_number, recorded_at, breach_type, breach_reason, zone_id',
          { count: 'exact' }
        )
      );
      const plainResult = await plainQuery;

      if (plainResult.error) throw plainResult.error;

      const zoneIds: string[] = Array.from(new Set(
        (plainResult.data ?? [])
          .map((r: any): string | null => (typeof r.zone_id === 'string' && r.zone_id.length > 0 ? r.zone_id : null))
          .filter((value): value is string => value !== null)
      ));
      let zoneNameById = new Map<string, string>();
      if (zoneIds.length > 0) {
        const zoneRes = await supabase.from('zones').select('id, name').in('id', zoneIds);
        if (!zoneRes.error && zoneRes.data) {
          zoneNameById = new Map((zoneRes.data as any[]).map((z: any) => [z.id, z.name]));
        }
      }

      const mappedRows: BreachObservation[] = (plainResult.data ?? []).map((row: any) => ({
        id: row.observation_id,
        plate_number: row.plate_number,
        recorded_at: row.recorded_at,
        breach_type: row.breach_type ?? null,
        breach_reason: row.breach_reason ?? null,
        zones: row.zone_id ? { name: zoneNameById.get(row.zone_id) ?? '—' } : null,
        organizations: null,
      }));

      return { rows: mappedRows, total: plainResult.count ?? 0 };
    },
    placeholderData: (p) => p,
  });
}

export function useComplianceZoneBreakdown({
  orgId,
  dateFrom,
  dateTo,
}: {
  orgId?: string | null;
  dateFrom: string;
  dateTo: string;
}) {
  const startISO = nzDateToUTCStart(dateFrom);
  const endISO = nzDateToUTCEnd(dateTo);

  return useQuery({
    queryKey: ['comp-zone-breakdown', dateFrom, dateTo, orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_zone_compliance_breakdown', {
        p_start:           startISO,
        p_end:             endISO,
        p_organization_id: orgId ?? null,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as ZoneStats[];
    },
  });
}

export function useComplianceExemptObservations({
  orgId,
  dateFrom,
  dateTo,
  zoneId,
  plates,
}: {
  orgId?: string | null;
  dateFrom: string;
  dateTo: string;
  zoneId?: string | null;
  plates: string[];
}) {
  return useQuery({
    queryKey: ['exempt-obs-details', dateFrom, dateTo, orgId, zoneId, plates.join('|')],
    queryFn: async () => {
      if (plates.length === 0) return [];
      const fromTs = nzDateToUTCStart(dateFrom);
      const toTs = nzDateToUTCEnd(dateTo);
      let q = (supabase.from('observations') as any)
        .select('observation_id, plate_number, recorded_at, photo, photo_url, is_compliant, gps_latitude, gps_longitude, officer_notes')
        .in('plate_number', plates)
        .gte('recorded_at', fromTs)
        .lte('recorded_at', toTs)
        .order('recorded_at', { ascending: false });
      if (orgId) q = q.eq('organization_id', orgId);
      if (zoneId) q = q.eq('zone_id', zoneId);
      const { data, error } = await q;
      if (error) {
        console.warn('Failed to fetch exempt observation details:', error.message);
        return [];
      }
      return data ?? [];
    },
    enabled: plates.length > 0,
  });
}

export function useComplianceCanonicalHomeless({ plates }: { plates: string[] }) {
  const vehicleQuery = useQuery({
    queryKey: ['exempt-canonical-vehicles', plates.join('|')],
    queryFn: async () => {
      if (plates.length === 0) return [];
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('plate_number, vehicle_make, vehicle_model, vehicle_color, is_exempt')
        .in('plate_number', plates);
      if (error) throw error;
      return data ?? [];
    },
    enabled: plates.length > 0,
  });

  const homelessQuery = useQuery({
    queryKey: ['exempt-canonical-homeless', plates.join('|')],
    queryFn: async () => {
      if (plates.length === 0) return [];
      const { data, error } = await (supabase.from('canonical_homeless') as any)
        .select('plate_number, status, notes')
        .in('plate_number', plates);
      if (error) throw error;
      return (data ?? []) as Array<{ plate_number: string; status: string | null; notes: string | null }>;
    },
    enabled: plates.length > 0,
  });

  return {
    canonicalVehicleRows: (vehicleQuery.data ?? []) as any[],
    canonicalHomelessRows: (homelessQuery.data ?? []) as Array<{ plate_number: string; status: string | null; notes: string | null }>,
  };
}
