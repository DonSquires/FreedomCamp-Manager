/**
 * CompliancePage – Full compliance dashboard
 *
 * Data sources (correct tables only):
 *   observations        – all scan records, compliance state
 *   canonical_vehicles  – vehicle registry (homeless, flagged)
 *   zones               – zone rules
 *   organizations       – org names
 *
 * Sections:
 *   1. Overview KPIs (compliance rate, breaches, active zones)
 *   2. Breach observations table (paginated, searchable)
 *   3. Per-zone compliance breakdown
 *   4. Homeless/exempt vehicles
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow, startOfDay, subDays } from 'date-fns';
import {
  AlertTriangle,
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
  Calendar,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Navigate } from 'react-router-dom';
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon';
import { useGlobalFiltersStore as useGlobalFilters } from '@/stores/globalFiltersStore';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';

// ============================================================================
// Types
// ============================================================================

interface BreachObservation {
  id: string;
  plate_number: string;
  recorded_at: string;
  breach_type: string | null;
  breach_reason: string | null;
  nights_stayed_this_month: number;
  consecutive_nights: number;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  self_contained: boolean;
  photo_url: string;
  zones: { name: string } | null;
  organizations: { name: string } | null;
  user_profiles: { first_name: string; last_name: string } | null;
}

interface ZoneStats {
  id: string;
  name: string;
  is_active: boolean;
  nights_per_month: number;
  max_consecutive_nights: number;
  self_contained_required: boolean;
  day_visit_only: boolean;
  organizations: { name: string } | null;
  obs_count: number;
  breach_count: number;
  compliance_pct: number;
}

// ============================================================================
// Helpers
// ============================================================================

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
    </div>
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
  const from = new Date(dateFrom);
  from.setHours(0, 0, 0, 0);
  const to = new Date(dateTo);
  to.setHours(23, 59, 59, 999);

  const { data: total } = useQuery({
    queryKey: ['comp-total', dateFrom, dateTo, orgId, zoneId],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select('*', { count: 'exact', head: true })
        .is('deleted_at', null)
        .gte('recorded_at', from.toISOString())
        .lte('recorded_at', to.toISOString());
      if (orgId) q = q.eq('organization_id', orgId);
      if (zoneId) q = q.eq('zone_id', zoneId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: breaches } = useQuery({
    queryKey: ['comp-breaches', dateFrom, dateTo, orgId, zoneId],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select('*', { count: 'exact', head: true })
        .is('deleted_at', null)
        .eq('is_compliant', false)
        .gte('recorded_at', from.toISOString())
        .lte('recorded_at', to.toISOString());
      if (orgId) q = q.eq('organization_id', orgId);
      if (zoneId) q = q.eq('zone_id', zoneId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: flagged } = useQuery({
    queryKey: ['comp-flagged'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('is_flagged', true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: homeless } = useQuery({
    queryKey: ['comp-homeless'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('is_homeless', true);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const compRate =
    total && total > 0
      ? `${Math.round(((total - (breaches ?? 0)) / total) * 100)}%`
      : undefined;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <KPI
        label="Total Observations"
        value={total}
        icon={Eye}
        color="bg-blue-500"
        sub={`${dateFrom} → ${dateTo}`}
      />
      <KPI
        label="Breaches"
        value={breaches}
        icon={XCircle}
        color="bg-red-500"
        trend={breaches ? 'up' : null}
        sub="Non-compliant observations"
      />
      <KPI
        label="Compliance Rate"
        value={compRate}
        icon={Shield}
        color={
          compRate && parseInt(compRate) >= 80 ? 'bg-green-500' : 'bg-orange-500'
        }
      />
      <KPI
        label="Flagged Vehicles"
        value={flagged}
        icon={AlertTriangle}
        color="bg-orange-500"
        sub={`${homeless ?? '…'} homeless tracked`}
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
}: {
  dateFrom: string;
  dateTo: string;
  orgId: string | null;
  zoneId: string | null;
}) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  const from = new Date(dateFrom);
  from.setHours(0, 0, 0, 0);
  const to = new Date(dateTo);
  to.setHours(23, 59, 59, 999);

  const { data, isLoading, isFetching, isError, error: queryError } = useQuery({
    queryKey: ['breaches-detail', page, search, dateFrom, dateTo, orgId, zoneId],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select(
          'id:observation_id, plate_number, recorded_at, breach_type, breach_reason, nights_stayed_this_month, consecutive_nights, vehicle_make, vehicle_model, vehicle_color, self_contained, photo_url, zones(name), organizations(name), user_profiles(first_name, last_name)',
          { count: 'exact' }
        )
        .is('deleted_at', null)
        .eq('is_compliant', false)
        .gte('recorded_at', from.toISOString())
        .lte('recorded_at', to.toISOString())
        .order('recorded_at', { ascending: false })
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (search.trim()) q = q.ilike('plate_number', `%${search.trim()}%`);
      if (orgId) q = q.eq('organization_id', orgId);
      if (zoneId) q = q.eq('zone_id', zoneId);
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as BreachObservation[], total: count ?? 0 };
    },
    placeholderData: (p) => p,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE);

  const BREACH_LABELS: Record<string, string> = {
    overstay: 'Overstay',
    consecutive_days: 'Consecutive nights',
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
          {data?.total ?? '…'} breach{data?.total !== 1 ? 'es' : ''}
          {isFetching && <RefreshCw className="inline w-3 h-3 ml-2 animate-spin" />}
        </span>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : isError ? (
          <Empty msg={`Failed to load breaches: ${(queryError as Error)?.message ?? 'Unknown error'}`} />
        ) : !data?.rows.length ? (
          <Empty msg="No breaches found in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-red-50 dark:bg-red-950/20 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Plate</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Vehicle</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Zone</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Breach Type</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden sm:table-cell">Nights</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Photo</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.rows.map((b) => (
                  <tr key={b.id} className="hover:bg-red-50/50 dark:hover:bg-red-950/10">
                    <td className="px-4 py-3 font-mono font-bold text-red-700 dark:text-red-400">
                      {b.plate_number}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                      {[b.vehicle_make, b.vehicle_model, b.vehicle_color].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" />
                        {b.zones?.name ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                        <XCircle className="w-3 h-3" />
                        {b.breach_type ? BREACH_LABELS[b.breach_type] ?? b.breach_type.replace(/_/g, ' ') : 'Breach'}
                      </span>
                      {b.breach_reason && (
                        <p className="text-xs text-gray-400 mt-0.5 max-w-xs truncate" title={b.breach_reason}>
                          {b.breach_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-center">
                      <span className="text-xs text-gray-500">
                        {b.nights_stayed_this_month}mo / {b.consecutive_nights}consec
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {b.photo_url ? (
                        <a href={b.photo_url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={b.photo_url}
                            alt="evidence"
                            className="h-10 w-16 object-cover rounded border border-gray-200"
                          />
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
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
  const from = new Date(dateFrom);
  from.setHours(0, 0, 0, 0);
  const to = new Date(dateTo);
  to.setHours(23, 59, 59, 999);

  const { data: zones, isLoading: zonesLoading } = useQuery({
    queryKey: ['comp-zones', orgId],
    queryFn: async () => {
      let q = supabase
        .from('zones')
        .select('id, name, is_active, nights_per_month, max_consecutive_nights, self_contained_required, day_visit_only, organizations(name)')
        .order('name');
      if (orgId) q = q.eq('organization_id', orgId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: obsCounts } = useQuery({
    queryKey: ['comp-zone-obs', dateFrom, dateTo, orgId],
    queryFn: async () => {
      let q = (supabase.from('observations') as any)
        .select('zone_id, is_compliant')
        .is('deleted_at', null)
        .gte('recorded_at', from.toISOString())
        .lte('recorded_at', to.toISOString());
      if (orgId) q = q.eq('organization_id', orgId);
      const { data, error } = await q;
      if (error) throw error;
      const counts: Record<string, { total: number; breaches: number }> = {};
      for (const r of data ?? []) {
        if (!counts[r.zone_id]) counts[r.zone_id] = { total: 0, breaches: 0 };
        counts[r.zone_id].total++;
        if (!r.is_compliant) counts[r.zone_id].breaches++;
      }
      return counts;
    },
  });

  if (zonesLoading) return <Spinner />;
  if (!zones?.length) return <Empty msg="No zones found" />;

  const zoneStats: ZoneStats[] = zones.map((z: any) => {
    const c = obsCounts?.[z.id] ?? { total: 0, breaches: 0 };
    const pct = c.total > 0 ? Math.round(((c.total - c.breaches) / c.total) * 100) : 100;
    return { ...z, obs_count: c.total, breach_count: c.breaches, compliance_pct: pct };
  });

  // Sort by breach count desc
  zoneStats.sort((a, b) => b.breach_count - a.breach_count);

  return (
    <div className="space-y-3">
      {zoneStats.map((z) => (
        <div
          key={z.id}
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
                <span className="font-semibold text-gray-900 dark:text-white truncate">{z.name}</span>
                {!z.is_active && (
                  <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
                    Inactive
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <span className="text-xs text-gray-400">{z.organizations?.name ?? '—'}</span>
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

function HomelessTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['homeless-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('canonical_vehicles')
        .select('vehicle_id, plate_number, vehicle_make, vehicle_model, vehicle_color, is_homeless, homeless_confirmed, homeless_notes, total_observations, last_seen_at')
        .eq('is_homeless', true)
        .order('homeless_confirmed', { ascending: false })
        .order('last_seen_at', { ascending: false });
      return data ?? [];
    },
  });

  if (isLoading) return <Spinner />;
  if (!data?.length) return <Empty msg="No homeless vehicles on record" />;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {data.length} vehicle{data.length !== 1 ? 's' : ''} with homeless status
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-purple-50 dark:bg-purple-950/20 text-left">
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Plate</th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Vehicle</th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Notes</th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-center">Obs.</th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Last Seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.map((v: any) => (
              <tr key={v.vehicle_id} className="hover:bg-purple-50/50 dark:hover:bg-purple-950/10">
                <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white">
                  {v.plate_number}
                </td>
                <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                  {[v.vehicle_make, v.vehicle_model, v.vehicle_color].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                      v.homeless_confirmed
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                        : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                    )}
                  >
                    <Home className="w-3 h-3" />
                    {v.homeless_confirmed ? 'Confirmed — FC Act exempt' : 'Claimed — pending review'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 hidden md:table-cell max-w-xs truncate" title={v.homeless_notes ?? ''}>
                  {v.homeless_notes || '—'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-bold">
                    {v.total_observations}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                  {formatDistanceToNow(new Date(v.last_seen_at), { addSuffix: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================

type CompTab = 'overview' | 'breaches' | 'zones' | 'homeless';

const TABS: { id: CompTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Shield },
  { id: 'breaches', label: 'Breaches', icon: XCircle },
  { id: 'zones', label: 'By Zone', icon: MapPin },
  { id: 'homeless', label: 'Homeless / Exempt', icon: Home },
];

export default function CompliancePage() {
  const { isAuthenticated, user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<CompTab>('overview');
  const { dateFrom, dateTo, organizationId, zoneId } = useGlobalFilters();

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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminNavigationMenu />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Page heading */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
              <Shield className="w-6 h-6 text-blue-600" />
              Compliance Dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Real-time compliance data from the{' '}
              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">observations</code> table
            </p>
          </div>
          <div className="text-xs text-gray-400 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {format(new Date(), 'PPP')}
          </div>
        </div>

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
              />
            )}
            {activeTab === 'zones' && (
              <ZonesTab dateFrom={effectiveDateFrom} dateTo={effectiveDateTo} orgId={effectiveOrgId} />
            )}
            {activeTab === 'homeless' && <HomelessTab />}
            {activeTab === 'overview' && (
              <Empty msg="Select Breaches, By Zone, or Homeless / Exempt for detail." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
