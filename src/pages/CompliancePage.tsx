/**
 * CompliancePage – Full compliance dashboard
 *
 * Data sources (correct tables only):
 *   observations        – all scan records, compliance state
 *   canonical_vehicles  – vehicle registry (make/model/color/is_flagged/is_exempt)
 *   canonical_homeless  – authoritative homeless/exempt status per plate (V3)
 *   zones               – zone rules
 *   organizations       – org names
 *
 * Sections:
 *   1. Overview KPIs (compliance rate, breaches, active zones)
 *   2. Breach observations table (paginated, searchable)
 *   3. Per-zone compliance breakdown
 *   4. Homeless/exempt vehicles
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow, startOfDay, subDays } from 'date-fns';
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  XCircle,
  MapPin,
  Car,
  Home,
  Shield,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  TrendingDown,
  TrendingUp,
  Image as ImageIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Navigate, useSearchParams } from 'react-router-dom';
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon';
import { useGlobalFiltersStore as useGlobalFilters } from '@/stores/globalFiltersStore';
import { AppLayout } from '@/components/features/AppLayout';
import { HOMELESS_UI_STATUSES, homelessStatusLabel, normalizeHomelessStatus } from '@/lib/homelessStatus';
import { nzDateToUTCStart, nzDateToUTCEnd } from '@/lib/timezone';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils';
import { getObservationPhotoUrl } from '@/lib/photoUtils';
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation';

// ============================================================================
// Types
// ============================================================================

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

type BreachStatus = 'pending' | 'acknowledged' | 'enforcement_started';

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

// ============================================================================
// Helpers
// ============================================================================

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

function Spinner() {
  return (
    <PaperworkSearchAnimation size="sm" text="Searching records…" />
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
      <Eye className="w-8 h-8 opacity-40" />
      <span className="text-sm">{msg}</span>
    </div>
  );
}

function KPI({
  label,
  value,
  icon: Icon,
  color,
  trend,
  sub,
}: {
  label: string;
  value: string | number | undefined;
  icon: React.ElementType;
  color: string;
  trend?: 'up' | 'down' | null;
  sub?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
        <div className={cn('p-2 rounded-lg', color)}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-black text-gray-900 dark:text-white">
          {value === undefined ? <RefreshCw className="w-5 h-5 animate-spin text-gray-300" /> : value}
        </span>
        {trend === 'up' && <TrendingUp className="w-4 h-4 mb-1 text-red-500" />}
        {trend === 'down' && <TrendingDown className="w-4 h-4 mb-1 text-green-500" />}
      </div>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ============================================================================
// Tab: Overview KPIs
// ============================================================================

function OverviewTab({
  dateFrom,
  dateTo,
  orgId,
  zoneId,
}: {
  dateFrom: string;
  dateTo: string;
  orgId: string | null;
  zoneId: string | null;
}) {
  const startISO = nzDateToUTCStart(dateFrom);
  const endISO = nzDateToUTCEnd(dateTo);

  // Direct queries against observations + canonical_vehicles (respects RLS).
  const { data: stats } = useQuery({
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

      // Count observations for homeless-confirmed/claimed vehicles that are marked
      // non-compliant. These are "breach exempt" under the FC Act and should not
      // inflate the breach KPI.
      const { data: homelessPlateRows } = await (supabase.from('canonical_homeless') as any)
        .select('plate_number')
        .in('status', ['confirmed', 'claimed']);
      const homelessPlates = (homelessPlateRows ?? []).map((r: any) => r.plate_number).filter(Boolean) as string[];

      let homelessBreachCount = 0;
      if (homelessPlates.length > 0) {
        // Count non-compliant observations for homeless plates in the date/org/zone scope
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

      const total    = totalRes.count  ?? 0;
      const rawBreaches = breachRes.count ?? 0;
      const breaches = Math.max(0, rawBreaches - homelessBreachCount);
      const compliant = total - breaches;

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

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <KPI
        label="Total Observations"
        value={stats?.total_observations}
        icon={Eye}
        color="bg-blue-500"
        sub={`${dateFrom} → ${dateTo}`}
      />
      <KPI
        label="Breaches"
        value={stats?.breach_count}
        icon={XCircle}
        color="bg-red-500"
        trend={stats?.breach_count ? 'up' : null}
        sub="Non-compliant observations"
      />
      <KPI
        label="Compliance Rate"
        value={stats ? `${stats.compliance_rate}%` : undefined}
        icon={Shield}
        color={
          stats && stats.compliance_rate >= 80 ? 'bg-green-500' : 'bg-orange-500'
        }
      />
      <KPI
        label="Flagged Vehicles"
        value={stats?.flagged_vehicles}
        icon={AlertTriangle}
        color="bg-orange-500"
        sub={`${stats?.homeless_vehicles ?? '…'} homeless tracked`}
      />
    </div>
  );
}

// ============================================================================
// Tab: Breach Detail
// ============================================================================

const PAGE = 20;

function BreachesTab({
  dateFrom,
  dateTo,
  orgId,
  zoneId,
  statusFilter,
}: {
  dateFrom: string;
  dateTo: string;
  orgId: string | null;
  zoneId: string | null;
  statusFilter?: BreachStatus | null;
}) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  // Keep pagination valid when global filters change.
  useEffect(() => {
    setPage(0);
  }, [dateFrom, dateTo, orgId, zoneId]);

  const startISO = nzDateToUTCStart(dateFrom);
  const endISO = nzDateToUTCEnd(dateTo);

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['breaches-detail', page, search, dateFrom, dateTo, orgId, zoneId, statusFilter],
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
          .range(page * PAGE, (page + 1) * PAGE - 1);

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

      // Default source: observations where is_compliant = false
      const applyObsFilters = (query: any) => {
        query = query
          .eq('is_compliant', false)
          .gte('recorded_at', startISO)
          .lte('recorded_at', endISO)
          .order('recorded_at', { ascending: false })
          .range(page * PAGE, (page + 1) * PAGE - 1);

        if (search.trim()) query = query.ilike('plate_number', `%${search.trim()}%`);
        if (orgId) query = query.eq('organization_id', orgId);
        if (zoneId) query = query.eq('zone_id', zoneId);
        return query;
      };

      // Keep both id and observation_id variants for backward compatibility across
      // environments. Relation selectors use legacy FK constraint names.
      const joinSelects = [
        'id, plate_number, recorded_at, breach_type, breach_reason, zone_id, zones!vehicle_observations_v2_zone_id_fkey(name), organizations!vehicle_observations_v2_organization_id_fkey(name)',
        'id:observation_id, plate_number, recorded_at, breach_type, breach_reason, zone_id, zones!vehicle_observations_v2_zone_id_fkey(name), organizations!vehicle_observations_v2_organization_id_fkey(name)',
        'id, plate_number, recorded_at, breach_type, zone_id, zones!vehicle_observations_v2_zone_id_fkey(name), organizations!vehicle_observations_v2_organization_id_fkey(name)',
        'id:observation_id, plate_number, recorded_at, breach_type, zone_id, zones!vehicle_observations_v2_zone_id_fkey(name), organizations!vehicle_observations_v2_organization_id_fkey(name)',
      ];

      for (const selectClause of joinSelects) {
        let q = supabase.from('observations').select(selectClause, { count: 'exact' });
        q = applyObsFilters(q);
        const joined = await q;
        if (!joined.error) {
          return { rows: (joined.data ?? []) as unknown as BreachObservation[], total: joined.count ?? 0 };
        }
      }

      const plainSelects = [
        'id, plate_number, recorded_at, breach_type, breach_reason, zone_id',
        'id:observation_id, plate_number, recorded_at, breach_type, breach_reason, zone_id',
        'id, plate_number, recorded_at, breach_type, zone_id',
        'id:observation_id, plate_number, recorded_at, breach_type, zone_id',
      ];

      let fallbackData: any[] = [];
      let fallbackCount = 0;
      let fallbackError: any = null;

      for (const selectClause of plainSelects) {
        let q = supabase.from('observations').select(selectClause, { count: 'exact' });
        q = applyObsFilters(q);
        const plain = await q;
        if (!plain.error) {
          fallbackData = plain.data ?? [];
          fallbackCount = plain.count ?? 0;
          fallbackError = null;
          break;
        }
        fallbackError = plain.error;
      }

      if (fallbackError) throw fallbackError;

      const zoneIds = Array.from(new Set((fallbackData || []).map((r: any) => r.zone_id).filter(Boolean)));
      let zoneNameById = new Map<string, string>();
      if (zoneIds.length > 0) {
        const zoneRes = await supabase.from('zones').select('id, name').in('id', zoneIds);
        if (!zoneRes.error && zoneRes.data) {
          zoneNameById = new Map((zoneRes.data as any[]).map((z: any) => [z.id, z.name]));
        }
      }

      const mappedRows: BreachObservation[] = (fallbackData || []).map((row: any) => ({
        id: row.id,
        plate_number: row.plate_number,
        recorded_at: row.recorded_at,
        breach_type: row.breach_type ?? null,
        breach_reason: row.breach_reason ?? null,
        zones: row.zone_id ? { name: zoneNameById.get(row.zone_id) ?? '—' } : null,
        organizations: null,
      }));

      return { rows: mappedRows, total: fallbackCount };
    },
    placeholderData: (p) => p,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE);

  const BREACH_LABELS: Record<string, string> = {
    consecutive_nights: 'Consecutive nights',
    monthly_limit: 'Monthly limit exceeded',
    self_contained: 'Self-contained required',
    after_hours: 'After hours',
    day_visit_violation: 'Day-visit zone',
    allowed_days_violation: 'Allowed days exceeded',
    overstay: 'Overstay',
    no_self_contained: 'Self-contained required',
    overnight_in_day_only_zone: 'Day-visit zone',
    nights_exceeded: 'Nights exceeded',
    unauthorized_zone: 'Unauthorized zone',
    no_wof: 'No WOF',
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search plate number…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        <span className="self-center text-sm text-gray-500">
          {data?.total ?? '…'} {statusFilter ? `${statusFilter.replace(/_/g, ' ')} breach alert` : 'non-compliant observation'}{data?.total !== 1 ? 's' : ''}
          {isFetching && <RefreshCw className="inline w-3 h-3 ml-2 animate-spin" />}
        </span>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : isError ? (
          <Empty msg="Unable to load compliance data right now. Refresh and try again." />
        ) : !data?.rows.length ? (
          <Empty msg="All zones compliant in the selected window. Try widening your date range to review historical breaches." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-red-50 dark:bg-red-950/20 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Plate</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Zone</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Breach Type</th>
                  {statusFilter && <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>}
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.rows.map((b) => (
                  <tr key={b.id} className="hover:bg-red-50/50 dark:hover:bg-red-950/10">
                    <td className="px-4 py-3 font-mono font-bold text-red-700 dark:text-red-400">
                      {b.plate_number ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" />
                        {(b.zones as any)?.name ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                        <XCircle className="w-3 h-3" />
                        {BREACH_LABELS[b.breach_type ?? ''] ?? b.breach_type?.replace(/_/g, ' ') ?? 'Unknown'}
                      </span>
                      {b.breach_reason && (
                        <p className="text-xs text-gray-400 mt-0.5 max-w-xs truncate" title={b.breach_reason}>
                          {b.breach_reason}
                        </p>
                      )}
                    </td>
                    {statusFilter && (
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          {(b.status ?? statusFilter).replace(/_/g, ' ')}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      <span title={format(new Date(b.recorded_at), 'PPPp')}>
                        {formatDistanceToNow(new Date(b.recorded_at), { addSuffix: true })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Tab: Zone Compliance Breakdown
// ============================================================================

function ZonesTab({
  dateFrom,
  dateTo,
  orgId,
}: {
  dateFrom: string;
  dateTo: string;
  orgId: string | null;
}) {
  const startISO = nzDateToUTCStart(dateFrom);
  const endISO = nzDateToUTCEnd(dateTo);

  // Use server-side RPC to avoid the 1000-row Supabase client default limit.
  // get_zone_compliance_breakdown aggregates all observations in the DB.
  const { data: zoneStats, isLoading: zonesLoading } = useQuery({
    queryKey: ['comp-zone-breakdown', dateFrom, dateTo, orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_zone_compliance_breakdown', {
        p_start:            startISO,
        p_end:              endISO,
        p_organization_id:  orgId ?? null,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as ZoneStats[];
    },
  });

  if (zonesLoading) return <Spinner />;

  // Filter to show only specific child zones (not jurisdiction-level parent zones).
  // Jurisdiction zones have parent_zone_id = null; specific zones have a parent.
  const specificZones = (zoneStats ?? []).filter((z) => z.parent_zone_id !== null);

  if (!specificZones.length) return <Empty msg="No specific zones found" />;

  return (
    <div className="space-y-3">
      {specificZones.map((z) => (
        <div
          key={z.zone_id}
          className={cn(
            'bg-white dark:bg-gray-900 rounded-xl border shadow-sm p-4',
            z.is_active ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-800 opacity-60'
          )}
        >
          <div className="flex items-center gap-4 flex-wrap">
            {/* Zone info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="font-semibold text-gray-900 dark:text-white truncate">{z.zone_name}</span>
                {!z.is_active && (
                  <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
                    Inactive
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <span className="text-xs text-gray-400">{z.organization_name ?? '—'}</span>
                <span className="text-xs text-gray-300">·</span>
                <span className="text-xs text-gray-400">{z.nights_per_month}n/mo</span>
                <span className="text-xs text-gray-300">·</span>
                <span className="text-xs text-gray-400">{z.max_consecutive_nights} consecutive</span>
                {z.self_contained_required && (
                  <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 px-1.5 py-0.5 rounded">
                    Self-contained req.
                  </span>
                )}
                {z.day_visit_only && (
                  <span className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-600 px-1.5 py-0.5 rounded">
                    Day-visit only
                  </span>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-6 shrink-0">
              <div className="text-center">
                <div className="text-xl font-black text-gray-900 dark:text-white">{z.obs_count}</div>
                <div className="text-xs text-gray-400">obs</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-black text-red-600">{z.breach_count}</div>
                <div className="text-xs text-gray-400">breaches</div>
              </div>
              {/* Compliance bar */}
              <div className="w-24">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">Compliance</span>
                  <span
                    className={cn(
                      'font-bold',
                      z.compliance_pct >= 80
                        ? 'text-green-600'
                        : z.compliance_pct >= 60
                        ? 'text-orange-500'
                        : 'text-red-500'
                    )}
                  >
                    {z.compliance_pct}%
                  </span>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      z.compliance_pct >= 80
                        ? 'bg-green-500'
                        : z.compliance_pct >= 60
                        ? 'bg-orange-500'
                        : 'bg-red-500'
                    )}
                    style={{ width: `${z.compliance_pct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Tab: Jurisdiction (parent zones – observations not in a specific zone)
// ============================================================================

function JurisdictionTab({
  dateFrom,
  dateTo,
  orgId,
}: {
  dateFrom: string;
  dateTo: string;
  orgId: string | null;
}) {
  const startISO = nzDateToUTCStart(dateFrom);
  const endISO = nzDateToUTCEnd(dateTo);

  const { data: zoneStats, isLoading: zonesLoading } = useQuery({
    queryKey: ['comp-zone-breakdown', dateFrom, dateTo, orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_zone_compliance_breakdown', {
        p_start:            startISO,
        p_end:              endISO,
        p_organization_id:  orgId ?? null,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as ZoneStats[];
    },
  });

  if (zonesLoading) return <Spinner />;

  // Show only jurisdiction-level parent zones (parent_zone_id is null).
  // These are observations that were not matched to a specific child zone.
  const jurisdictionZones = (zoneStats ?? []).filter((z) => z.parent_zone_id === null);

  if (!jurisdictionZones.length) return <Empty msg="No jurisdiction zones found" />;

  return (
    <div className="space-y-3">
      {jurisdictionZones.map((z) => (
        <div
          key={z.zone_id}
          className={cn(
            'bg-white dark:bg-gray-900 rounded-xl border shadow-sm p-4',
            z.is_active ? 'border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-800 opacity-60'
          )}
        >
          <div className="flex items-center gap-4 flex-wrap">
            {/* Zone info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-500 shrink-0" />
                <span className="font-semibold text-gray-900 dark:text-white truncate">{z.zone_name}</span>
                {!z.is_active && (
                  <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
                    Inactive
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <span className="text-xs text-gray-400">{z.organization_name ?? '—'}</span>
                <span className="text-xs text-gray-300">·</span>
                <span className="text-xs text-gray-400">{z.nights_per_month}n/mo</span>
                <span className="text-xs text-gray-300">·</span>
                <span className="text-xs text-gray-400">{z.max_consecutive_nights} consecutive</span>
                {z.self_contained_required && (
                  <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 px-1.5 py-0.5 rounded">
                    Self-contained req.
                  </span>
                )}
                {z.day_visit_only && (
                  <span className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-600 px-1.5 py-0.5 rounded">
                    Day-visit only
                  </span>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-6 shrink-0">
              <div className="text-center">
                <div className="text-xl font-black text-gray-900 dark:text-white">{z.obs_count}</div>
                <div className="text-xs text-gray-400">obs</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-black text-red-600">{z.breach_count}</div>
                <div className="text-xs text-gray-400">breaches</div>
              </div>
              {/* Compliance bar */}
              <div className="w-24">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">Compliance</span>
                  <span
                    className={cn(
                      'font-bold',
                      z.compliance_pct >= 80
                        ? 'text-green-600'
                        : z.compliance_pct >= 60
                        ? 'text-orange-500'
                        : 'text-red-500'
                    )}
                  >
                    {z.compliance_pct}%
                  </span>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      z.compliance_pct >= 80
                        ? 'bg-green-500'
                        : z.compliance_pct >= 60
                        ? 'bg-orange-500'
                        : 'bg-red-500'
                    )}
                    style={{ width: `${z.compliance_pct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Tab: Homeless / Exempt
// ============================================================================

interface ExemptObservation {
  observation_id: string;
  plate_number: string;
  zone_id: string;
  zone_name: string;
  recorded_at: string;
  homeless_status: string;
  breach_type: string | null;
  organization_id: string;
  photo?: string | null;
  photo_url?: string | null;
  is_compliant?: boolean;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  officer_notes?: string | null;
}

interface ExemptCanonicalVehicle {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  homeless_status: string | null;
  homeless_notes: string | null;
  is_exempt: boolean | null;
}

function formatExemptVehicleSummary(v: ExemptCanonicalVehicle | undefined): string {
  if (!v) return 'Unknown vehicle';
  return [v.vehicle_make, v.vehicle_model, v.vehicle_color].filter(Boolean).join(' ') || 'Unknown vehicle';
}

function HomelessTab({
  dateFrom,
  dateTo,
  orgId,
  zoneId,
}: {
  dateFrom: string;
  dateTo: string;
  orgId: string | null;
  zoneId: string | null;
}) {
  const [selectedPlate, setSelectedPlate] = useState<string | null>(null);
  const [searchPlate, setSearchPlate] = useState('');

  // Fetch exempt breach observations via RPC
  const { data: exemptObs, isLoading: obsLoading, error: obsError } = useQuery({
    queryKey: ['exempt-observations', dateFrom, dateTo, orgId, zoneId],
    queryFn: async () => {
      const fromTs = nzDateToUTCStart(dateFrom);
      const toTs = nzDateToUTCEnd(dateTo);
      const { data, error } = await (supabase.rpc as any)('observations_homeless_exempt', {
        p_from: fromTs,
        p_to: toTs,
        ...(orgId ? { p_org_id: orgId } : {}),
        ...(zoneId ? { p_zone_id: zoneId } : {}),
      });
      if (error) throw error;
      return (data ?? []) as ExemptObservation[];
    },
  });

  // Fetch additional observation columns (photo, GPS, notes) for display
  const exemptPlates = useMemo(() => {
    const plates = new Set<string>();
    for (const obs of exemptObs ?? []) {
      if (obs.plate_number) plates.add(obs.plate_number);
    }
    return Array.from(plates);
  }, [exemptObs]);

  const { data: obsDetails } = useQuery({
    queryKey: ['exempt-obs-details', dateFrom, dateTo, orgId, zoneId, exemptPlates.join('|')],
    queryFn: async () => {
      if (exemptPlates.length === 0) return [];
      const fromTs = nzDateToUTCStart(dateFrom);
      const toTs = nzDateToUTCEnd(dateTo);
      let q = (supabase.from('observations') as any)
        .select('observation_id, plate_number, recorded_at, photo, photo_url, is_compliant, gps_latitude, gps_longitude, officer_notes')
        .in('plate_number', exemptPlates)
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
    enabled: exemptPlates.length > 0,
  });

  // Build lookup of observation details by observation_id
  const obsDetailsMap = useMemo(() => {
    const map = new Map<string, ExemptObservation>();
    for (const d of obsDetails ?? []) {
      map.set(d.observation_id, d as ExemptObservation);
    }
    return map;
  }, [obsDetails]);

  // Fetch canonical vehicle metadata for matched plates
  const { data: canonicalVehicleRows = [] } = useQuery({
    queryKey: ['exempt-canonical-vehicles', exemptPlates.join('|')],
    queryFn: async () => {
      if (exemptPlates.length === 0) return [];
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('plate_number, vehicle_make, vehicle_model, vehicle_color, is_exempt')
        .in('plate_number', exemptPlates);
      if (error) throw error;
      return data ?? [];
    },
    enabled: exemptPlates.length > 0,
  });

  // Fetch authoritative homeless status/notes from canonical_homeless
  const { data: canonicalHomelessRows = [] } = useQuery({
    queryKey: ['exempt-canonical-homeless', exemptPlates.join('|')],
    queryFn: async () => {
      if (exemptPlates.length === 0) return [];
      const { data, error } = await (supabase.from('canonical_homeless') as any)
        .select('plate_number, status, notes')
        .in('plate_number', exemptPlates);
      if (error) throw error;
      return (data ?? []) as Array<{ plate_number: string; status: string | null; notes: string | null }>;
    },
    enabled: exemptPlates.length > 0,
  });

  // Merge vehicle attributes and homeless status into ExemptCanonicalVehicle records
  const canonicalVehicles: ExemptCanonicalVehicle[] = useMemo(() => {
    const homelessByPlate = new Map<string, { status: string | null; notes: string | null }>();
    for (const h of canonicalHomelessRows) {
      homelessByPlate.set(h.plate_number, { status: h.status, notes: h.notes });
    }
    return canonicalVehicleRows.map((v: any) => {
      const h = homelessByPlate.get(v.plate_number);
      return {
        plate_number: v.plate_number,
        vehicle_make: v.vehicle_make ?? null,
        vehicle_model: v.vehicle_model ?? null,
        vehicle_color: v.vehicle_color ?? null,
        homeless_status: h?.status ?? null,
        homeless_notes: h?.notes ?? null,
        is_exempt: v.is_exempt ?? null,
      } as ExemptCanonicalVehicle;
    });
  }, [canonicalVehicleRows, canonicalHomelessRows]);

  const canonicalByPlate = useMemo(() => {
    const map = new Map<string, ExemptCanonicalVehicle>();
    for (const v of canonicalVehicles) map.set(v.plate_number, v);
    return map;
  }, [canonicalVehicles]);

  // Group observations by plate
  const groupedByPlate = useMemo(() => {
    const map = new Map<string, ExemptObservation[]>();
    for (const obs of exemptObs ?? []) {
      if (!obs.plate_number) continue;
      if (!map.has(obs.plate_number)) map.set(obs.plate_number, []);
      map.get(obs.plate_number)!.push(obs);
    }
    return map;
  }, [exemptObs]);

  // Build plate records with search filter
  const plateRecords = useMemo(() => {
    const records = Array.from(groupedByPlate.entries()).map(([plate, rows]) => ({
      plate,
      rows,
      count: rows.length,
      latestAt: rows[0]?.recorded_at || '',
    }));
    const term = searchPlate.trim().toUpperCase();
    const filtered = term
      ? records.filter((r) => r.plate.toUpperCase().includes(term))
      : records;
    return filtered.sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
  }, [groupedByPlate, searchPlate]);

  const selectedRows = selectedPlate ? groupedByPlate.get(selectedPlate) ?? [] : [];
  const selectedCanonical = selectedPlate ? canonicalByPlate.get(selectedPlate) : undefined;

  if (obsLoading) return <Spinner />;
  if (obsError) return <Empty msg="Unable to load exempt breach observations" />;
  if (!exemptObs?.length) return <Empty msg="No exempt breach observations in the current filter range" />;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Exempt Vehicles</p>
            <p className="text-2xl font-bold">{exemptPlates.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Exempt Breach Observations</p>
            <p className="text-2xl font-bold">{exemptObs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Date Range</p>
            <p className="text-sm font-medium">{dateFrom} — {dateTo}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search plate number…"
          value={searchPlate}
          onChange={(e) => setSearchPlate(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Vehicle cards */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Home className="h-4 w-4 text-purple-600" />
              Exempt Vehicles
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
            {plateRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vehicles match the current filter.</p>
            ) : (
              plateRecords.map((record) => {
                const canonical = canonicalByPlate.get(record.plate);
                const selected = selectedPlate === record.plate;
                const status = canonical ? normalizeHomelessStatus(canonical.homeless_status) : null;
                return (
                  <button
                    key={record.plate}
                    type="button"
                    onClick={() => setSelectedPlate(record.plate)}
                    className={cn(
                      'w-full text-left rounded-md border p-3 transition-colors',
                      selected
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/40'
                        : 'hover:bg-muted/40'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold">{record.plate}</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                          status === 'confirmed'
                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                            : status === 'claimed'
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                            : status === 'suspected'
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                            : 'bg-slate-100 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300'
                        )}
                      >
                        <Home className="w-3 h-3" />
                        {canonical ? homelessStatusLabel(canonical.homeless_status) : 'Exempt'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatExemptVehicleSummary(canonical)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {record.count} exempt breach{record.count !== 1 ? 'es' : ''}
                    </p>
                    {canonical?.homeless_notes && (
                      <p className="text-xs text-gray-400 mt-1 truncate" title={canonical.homeless_notes}>
                        {canonical.homeless_notes}
                      </p>
                    )}
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Right: Observations for selected vehicle */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="h-4 w-4" />
              {selectedPlate || 'No vehicle selected'}
            </CardTitle>
            {selectedCanonical && (
              <div className="text-xs text-muted-foreground">
                {formatExemptVehicleSummary(selectedCanonical)}
                {selectedCanonical.homeless_notes && (
                  <span className="ml-2 text-gray-400">— {selectedCanonical.homeless_notes}</span>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {selectedRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Select a vehicle to view its exempt breach observations.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Photo</TableHead>
                      <TableHead>Recorded</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Breach Type</TableHead>
                      <TableHead>GPS</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRows.map((obs) => {
                      const detail = obsDetailsMap.get(obs.observation_id) ?? obs;
                      const photoUrl = getObservationPhotoUrl(detail);
                      return (
                        <TableRow key={obs.observation_id}>
                          <TableCell>
                            {photoUrl ? (
                              <button
                                type="button"
                                onClick={() => window.open(photoUrl, '_blank')}
                                className="block rounded overflow-hidden border hover:opacity-90"
                              >
                                <img
                                  src={photoUrl}
                                  alt={`Observation ${obs.observation_id}`}
                                  className="h-16 w-28 object-cover"
                                  loading="lazy"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              </button>
                            ) : (
                              <div className="h-16 w-28 border rounded bg-muted flex items-center justify-center text-muted-foreground text-xs">
                                <span className="inline-flex items-center gap-1">
                                  <ImageIcon className="h-3 w-3" />
                                  No Photo
                                </span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{formatDateTime(obs.recorded_at)}</TableCell>
                          <TableCell className="text-xs">{obs.zone_name || 'Unknown'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-900/20">
                              {obs.breach_type || 'Exempt'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {detail.gps_latitude && detail.gps_longitude
                              ? `${Number(detail.gps_latitude).toFixed(5)}, ${Number(detail.gps_longitude).toFixed(5)}`
                              : 'No GPS'}
                          </TableCell>
                          <TableCell className="text-xs max-w-[240px] truncate">
                            {detail.officer_notes || '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================

type CompTab = 'overview' | 'breaches' | 'zones' | 'homeless' | 'jurisdiction';

const TABS: { id: CompTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Shield },
  { id: 'breaches', label: 'Breaches', icon: XCircle },
  { id: 'zones', label: 'By Zone', icon: MapPin },
  { id: 'homeless', label: 'Homeless / Exempt', icon: Home },
  { id: 'jurisdiction', label: 'Jurisdiction', icon: Building2 },
];

export default function CompliancePage() {
  const { isAuthenticated, user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<CompTab>('overview');
  const [searchParams] = useSearchParams();
  const {
    dateFrom,
    dateTo,
    organizationId,
    zoneId,
    setDateRange,
    setOrganization,
    setZone,
  } = useGlobalFilters();

  const drillMetric = searchParams.get('metric');
  const drillStatus = searchParams.get('status');
  const drillSource = searchParams.get('source');
  const breachStatusFilter: BreachStatus | null =
    drillStatus && ['pending', 'acknowledged', 'enforcement_started'].includes(drillStatus)
      ? (drillStatus as BreachStatus)
      : null;

  const drillContextLabel = useMemo(() => {
    if (!drillMetric && !drillStatus) return null;

    const metricLabelMap: Record<string, string> = {
      observations: 'Observations',
      compliance_rate: 'Compliance Rate',
      zone_compliance: 'Zone Compliance',
      homeless_status: 'Homeless Status',
      active_breaches: 'Active Breaches',
    };

    const metricLabel = drillMetric ? (metricLabelMap[drillMetric] ?? drillMetric.replace(/_/g, ' ')) : null;
    const statusLabel = drillStatus ? drillStatus.replace(/_/g, ' ') : null;

    if (metricLabel && statusLabel) return `${metricLabel} (${statusLabel})`;
    return metricLabel ?? statusLabel;
  }, [drillMetric, drillStatus]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    const metric = searchParams.get('metric');
    const status = searchParams.get('status');

    let resolvedTab: CompTab | null = null;

    if (tab && ['overview', 'breaches', 'zones', 'homeless'].includes(tab)) {
      resolvedTab = tab as CompTab;
    } else if (metric) {
      const metricTabMap: Record<string, CompTab> = {
        observations: 'overview',
        compliance_rate: 'zones',
        zone_compliance: 'zones',
        homeless_status: 'homeless',
        active_breaches: 'breaches',
      };
      resolvedTab = metricTabMap[metric] ?? null;
    } else if (status && ['pending', 'acknowledged', 'enforcement_started'].includes(status)) {
      resolvedTab = 'breaches';
    }

    if (resolvedTab) {
      setActiveTab(resolvedTab);
    }

    const qDateFrom = searchParams.get('dateFrom');
    const qDateTo = searchParams.get('dateTo');
    if (qDateFrom && qDateTo) {
      setDateRange(qDateFrom, qDateTo, 'custom');
    }

    const qOrgId = searchParams.get('orgId');
    if (qOrgId && user?.role === 'master') {
      setOrganization(qOrgId, null);
    }

    const qZoneId = searchParams.get('zoneId');
    if (qZoneId) {
      setZone(qZoneId, null);
    }
  }, [searchParams, setDateRange, setOrganization, setZone, user?.role]);

  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;

  const today = format(new Date(), 'yyyy-MM-dd');
  const effectiveDateFrom = dateFrom ?? format(subDays(new Date(), 30), 'yyyy-MM-dd');
  const effectiveDateTo = dateTo ?? today;

  // For non-master users the global org picker is disabled (only masters can
  // switch orgs).  Fall back to the user's own organization_id so queries
  // are always scoped and not reliant solely on RLS.
  const effectiveOrgId: string | null =
    organizationId ?? (user.role !== 'master' ? user.organization_id : null);

  // Officers see a read-only view of their own organization's compliance data.
  const isOfficer = user.role === 'officer';

  return (
    <AppLayout title="Compliance Dashboard" description="Real-time compliance data and analysis">

      <div className="space-y-6">
        {/* Page heading with drilldown context */}
        {drillContextLabel && (
          <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
            <span>Drilldown</span>
            <span className="opacity-70">:</span>
            <span className="capitalize">{drillContextLabel}</span>
            {drillSource && <span className="opacity-70">via {drillSource.replace(/_/g, ' ')}</span>}
          </div>
        )}

        {/* Global filters */}
        <GlobalFilterRibbon />

        {/* Officer read-only notice */}
        {isOfficer && (
          <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-sm text-blue-700 dark:text-blue-300">
            <Shield className="w-4 h-4 flex-shrink-0" />
            Showing compliance data for your organisation (read-only view).
          </div>
        )}

        {/* Always-visible KPI summary */}
        <OverviewTab dateFrom={effectiveDateFrom} dateTo={effectiveDateTo} orgId={effectiveOrgId} zoneId={zoneId} />

        {/* Tabbed detail sections */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="border-b border-gray-100 dark:border-gray-800 flex gap-1 px-4 overflow-x-auto">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                  activeTab === id
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="p-5">
            {activeTab === 'breaches' && (
              <BreachesTab
                dateFrom={effectiveDateFrom}
                dateTo={effectiveDateTo}
                orgId={effectiveOrgId}
                zoneId={zoneId}
                statusFilter={breachStatusFilter}
              />
            )}
            {activeTab === 'zones' && (
              <ZonesTab dateFrom={effectiveDateFrom} dateTo={effectiveDateTo} orgId={effectiveOrgId} />
            )}
            {activeTab === 'homeless' && (
              <HomelessTab
                dateFrom={effectiveDateFrom}
                dateTo={effectiveDateTo}
                orgId={effectiveOrgId}
                zoneId={zoneId}
              />
            )}
            {activeTab === 'jurisdiction' && (
              <JurisdictionTab dateFrom={effectiveDateFrom} dateTo={effectiveDateTo} orgId={effectiveOrgId} />
            )}
            {activeTab === 'overview' && (
              <Empty msg="Select Breaches, By Zone, Homeless / Exempt, or Jurisdiction for detail." />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
