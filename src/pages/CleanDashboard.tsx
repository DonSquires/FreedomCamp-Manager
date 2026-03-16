/**
 * CleanDashboard – rebuilt app using only current schema tables:
 *   observations, canonical_vehicles, user_profiles, organizations, zones
 *
 * Route: /new  (add role guard in App.tsx as needed)
 */

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format, startOfDay } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  Car,
  MapPin,
  Users,
  CheckCircle,
  XCircle,
  Building2,
  LogOut,
  Search,
  ChevronLeft,
  ChevronRight,
  Shield,
  RefreshCw,
  Eye,
  Calendar,
  Camera,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { HOMELESS_UI_STATUSES, homelessStatusLabel, isHomelessForUi } from '@/lib/homelessStatus';
import { useAuthStore } from '@/stores/authStore';
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation';

// ============================================================================
// Types
// ============================================================================

type Tab = 'overview' | 'observations' | 'vehicles' | 'zones' | 'users';

interface Observation {
  observation_id: string;
  plate_number: string;
  recorded_at: string;
  is_compliant: boolean;
  breach_type: string | null;
  breach_reason: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  self_contained: boolean;
  nights_stayed_this_month: number;
  consecutive_nights: number;
  photo: string | null;
  photo_url: string | null;
  officer_notes: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  zones: { name: string } | null;
  organizations: { name: string } | null;
  user_profiles: { first_name: string; last_name: string } | null;
}

interface CanonicalVehicle {
  vehicle_id: string;
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  total_observations: number;
  homeless_status: string;
  is_flagged: boolean;
  flagged_priority: string | null;
  flagged_reason: string | null;
  profile_photo: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface Zone {
  id: string;
  name: string;
  organization_id: string;
  is_active: boolean;
  nights_per_month: number;
  max_consecutive_nights: number;
  self_contained_required: boolean;
  day_visit_only: boolean;
  organizations: { name: string } | null;
}

interface Organization {
  id: string;
  name: string;
  contact_email: string | null;
}

interface UserProfile {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  organization_id: string | null;
  organizations: { name: string } | null;
}

// ============================================================================
// Shared helpers
// ============================================================================

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

function ComplianceBadge({ compliant }: { compliant: boolean }) {
  return compliant ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
      <CheckCircle className="w-3 h-3" /> Compliant
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
      <XCircle className="w-3 h-3" /> Breach
    </span>
  );
}

function Spinner() {
  return (
    <PaperworkSearchAnimation size="sm" text="Searching records…" />
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <Eye className="w-10 h-10 mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ============================================================================
// KPI Card
// ============================================================================

interface KPIProps {
  title: string;
  value: number | string | undefined;
  icon: React.ElementType;
  color: string;
  sub?: string;
}

function KPICard({ title, value, icon: Icon, color, sub }: KPIProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</span>
        <div className={cn('p-2 rounded-lg', color)}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <div className="text-3xl font-black text-gray-900 dark:text-white">
        {value === undefined ? <RefreshCw className="w-5 h-5 animate-spin text-gray-300" /> : value}
      </div>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab() {
  const todayStart = startOfDay(new Date()).toISOString();

  const { data: totalObs } = useQuery({
    queryKey: ['overview-total-obs'],
    queryFn: async () => {
      const { count } = await supabase
        .from('observations')
        .select('*', { count: 'exact', head: true });
      return count ?? 0;
    },
  });

  const { data: todayObs } = useQuery({
    queryKey: ['overview-today-obs'],
    queryFn: async () => {
      const { count } = await supabase
        .from('observations')
        .select('*', { count: 'exact', head: true })
        .gte('recorded_at', todayStart);
      return count ?? 0;
    },
  });

  const { data: breachCount } = useQuery({
    queryKey: ['overview-breaches'],
    queryFn: async () => {
      const { count } = await supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      return count ?? 0;
    },
  });

  const { data: vehicleCount } = useQuery({
    queryKey: ['overview-vehicles'],
    queryFn: async () => {
      const { count } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true });
      return count ?? 0;
    },
  });

  const { data: activeZones } = useQuery({
    queryKey: ['overview-zones'],
    queryFn: async () => {
      const { count } = await supabase
        .from('zones')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      return count ?? 0;
    },
  });

  const { data: orgCount } = useQuery({
    queryKey: ['overview-orgs'],
    queryFn: async () => {
      const { count } = await supabase
        .from('organizations')
        .select('*', { count: 'exact', head: true });
      return count ?? 0;
    },
  });

  const { data: recentObs, isLoading } = useQuery({
    queryKey: ['overview-recent'],
    queryFn: async () => {
      // Relation selectors reference FK constraint names (legacy `vehicle_observations_v2_*`).
      const { data } = await supabase
        .from('observations')
        .select(
          'observation_id, plate_number, recorded_at, is_compliant, breach_type, vehicle_make, vehicle_model, vehicle_color, zones!vehicle_observations_v2_zone_id_fkey(name), organizations!vehicle_observations_v2_organization_id_fkey(name)'
        )
        .order('recorded_at', { ascending: false })
        .limit(10);
      return (data ?? []) as Array<{
        observation_id: string;
        plate_number: string;
        recorded_at: string;
        is_compliant: boolean;
        breach_type: string | null;
        vehicle_make: string | null;
        vehicle_model: string | null;
        vehicle_color: string | null;
        zones: { name: string } | null;
        organizations: { name: string } | null;
      }>;
    },
  });

  const complianceRate =
    totalObs && totalObs > 0
      ? Math.round(((totalObs - (breachCount ?? 0)) / totalObs) * 100)
      : null;

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard title="Total Observations" value={totalObs} icon={Camera} color="bg-blue-500" />
        <KPICard title="Today's Scans" value={todayObs} icon={Activity} color="bg-indigo-500" sub="Since midnight" />
        <KPICard title="Active Breaches" value={breachCount} icon={AlertTriangle} color="bg-red-500" />
        <KPICard title="Vehicles Tracked" value={vehicleCount} icon={Car} color="bg-purple-500" />
        <KPICard title="Active Zones" value={activeZones} icon={MapPin} color="bg-emerald-500" />
        <KPICard
          title="Compliance Rate"
          value={complianceRate !== null ? `${complianceRate}%` : undefined}
          icon={Shield}
          color={complianceRate !== null && complianceRate >= 80 ? 'bg-green-500' : 'bg-orange-500'}
          sub={`Across ${orgCount ?? '…'} org${orgCount !== 1 ? 's' : ''}`}
        />
      </div>

      {/* Recent activity */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-white">Recent Observations</h2>
          <p className="text-xs text-gray-400 mt-0.5">Latest 10 records from the observations table</p>
        </div>
        {isLoading ? (
          <Spinner />
        ) : !recentObs?.length ? (
          <EmptyState message="No observations found" />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {recentObs.map((obs) => (
              <div key={obs.observation_id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono font-bold text-gray-900 dark:text-white tracking-wide">
                    {obs.plate_number}
                  </span>
                  <span className="text-xs text-gray-400 truncate hidden sm:block">
                    {obs.vehicle_make} {obs.vehicle_model} {obs.vehicle_color}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400 hidden md:block">
                    {obs.zones?.name ?? '—'}
                  </span>
                  <ComplianceBadge compliant={obs.is_compliant} />
                  <span className="text-xs text-gray-400 hidden lg:block">
                    {formatDistanceToNow(new Date(obs.recorded_at), { addSuffix: true })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Observations Tab
// ============================================================================

const PAGE_SIZE = 25;

function ObservationsTab() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [complianceFilter, setComplianceFilter] = useState<'all' | 'compliant' | 'breach'>('all');

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['observations', page, search, complianceFilter],
    queryFn: async () => {
      let q = supabase
        .from('observations')
        .select(
          'observation_id, plate_number, recorded_at, is_compliant, breach_type, breach_reason, vehicle_make, vehicle_model, vehicle_color, self_contained, nights_stayed_this_month, consecutive_nights, officer_notes, gps_latitude, gps_longitude, photo, photo_url, zones!vehicle_observations_v2_zone_id_fkey(name), organizations!vehicle_observations_v2_organization_id_fkey(name), user_profiles!vehicle_observations_v2_recorded_by_fkey(first_name, last_name)',
          { count: 'exact' }
        )
        .order('recorded_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search.trim()) {
        q = q.ilike('plate_number', `%${search.trim()}%`);
      }
      if (complianceFilter === 'compliant') q = q.eq('is_compliant', true);
      if (complianceFilter === 'breach') q = q.eq('is_compliant', false);

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as Observation[], total: count ?? 0 };
    },
    placeholderData: (prev) => prev,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by plate number…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'compliant', 'breach'] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setComplianceFilter(f); setPage(0); }}
              className={cn(
                'px-3 py-2 text-xs rounded-lg border font-medium capitalize transition-colors',
                complianceFilter === f
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {data?.total.toLocaleString() ?? '…'} observations
          </span>
          {isFetching && <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />}
        </div>

        {isLoading ? (
          <Spinner />
        ) : !data?.rows.length ? (
          <EmptyState message="No observations match your filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Plate</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Vehicle</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Zone</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Officer</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Status</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden sm:table-cell">Nights</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Recorded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.rows.map((obs) => (
                  <tr key={obs.observation_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white">
                      {obs.plate_number}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 hidden md:table-cell">
                      {[obs.vehicle_year, obs.vehicle_make, obs.vehicle_model, obs.vehicle_color]
                        .filter(Boolean)
                        .join(' ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      {obs.zones?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 hidden lg:table-cell">
                      {obs.user_profiles
                        ? `${obs.user_profiles.first_name} ${obs.user_profiles.last_name}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <ComplianceBadge compliant={obs.is_compliant} />
                        {obs.breach_type && (
                          <span className="text-xs text-red-500">{obs.breach_type.replace(/_/g, ' ')}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-center">
                      <span className="text-xs text-gray-500">
                        {obs.nights_stayed_this_month}mo / {obs.consecutive_nights}consec
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      <span title={format(new Date(obs.recorded_at), 'PPPp')}>
                        {formatDistanceToNow(new Date(obs.recorded_at), { addSuffix: true })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
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
// Vehicles Tab
// ============================================================================

function VehiclesTab() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [flagFilter, setFlagFilter] = useState<'all' | 'flagged' | 'homeless'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', page, search, flagFilter],
    queryFn: async () => {
      let q = supabase
        .from('canonical_vehicles')
        .select('vehicle_id, plate_number, vehicle_make, vehicle_model, vehicle_color, total_observations, homeless_status, is_flagged, flagged_priority, flagged_reason, profile_photo, first_seen_at, last_seen_at', { count: 'exact' })
        .order('total_observations', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search.trim()) q = q.ilike('plate_number', `%${search.trim()}%`);
      if (flagFilter === 'flagged') q = q.eq('is_flagged', true);
      if (flagFilter === 'homeless') q = q.in('homeless_status', HOMELESS_UI_STATUSES);

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as CanonicalVehicle[], total: count ?? 0 };
    },
    placeholderData: (prev) => prev,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by plate number…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'flagged', 'homeless'] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setFlagFilter(f); setPage(0); }}
              className={cn(
                'px-3 py-2 text-xs rounded-lg border font-medium capitalize transition-colors',
                flagFilter === f
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {data?.total.toLocaleString() ?? '…'} vehicles in canonical registry
          </span>
        </div>

        {isLoading ? (
          <Spinner />
        ) : !data?.rows.length ? (
          <EmptyState message="No vehicles found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Photo</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Plate</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Vehicle</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-center">Observations</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Flags</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">First Seen</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden lg:table-cell">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.rows.map((v) => (
                  <tr key={v.vehicle_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      {v.profile_photo ? (
                        <img src={v.profile_photo} alt={v.plate_number} className="w-12 h-10 object-cover rounded" />
                      ) : (
                        <div className="w-12 h-10 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                          <Car className="w-5 h-5 text-gray-300" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white">
                      {v.plate_number}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 hidden md:table-cell">
                      {[v.vehicle_make, v.vehicle_model, v.vehicle_color].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-bold">
                        {v.total_observations}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {v.is_flagged && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                            <AlertTriangle className="w-3 h-3" /> {v.flagged_priority ?? 'Flagged'}
                          </span>
                        )}
                        {isHomelessForUi(v.homeless_status) && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                            🏠 {homelessStatusLabel(v.homeless_status)}
                          </span>
                        )}
                        {!v.is_flagged && !isHomelessForUi(v.homeless_status) && (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                      {format(new Date(v.first_seen_at), 'd MMM yy')}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">
                      {formatDistanceToNow(new Date(v.last_seen_at), { addSuffix: true })}
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
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800">
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
// Zones Tab
// ============================================================================

function ZonesTab() {
  const { data: zones, isLoading } = useQuery({
    queryKey: ['zones-full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name, organization_id, is_active, nights_per_month, max_consecutive_nights, self_contained_required, day_visit_only, organizations!zones_organization_id_fkey(name)')
        .order('is_active', { ascending: false })
        .order('name');
      if (error) throw error;

      // Deduplicate zones by (organization_id, name) — keep first occurrence
      const seen = new Set<string>();
      return ((data ?? []) as Zone[]).filter((zone) => {
        const key = `${zone.organization_id}::${zone.name.trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  });

  // Observation counts per zone
  const { data: zoneCounts } = useQuery({
    queryKey: ['zone-obs-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('observations')
        .select('zone_id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { zone_id: string }[]) {
        counts[row.zone_id] = (counts[row.zone_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  // Breach counts per zone
  const { data: zoneBreaches } = useQuery({
    queryKey: ['zone-breach-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('observations')
        .select('zone_id')
        .eq('is_compliant', false);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { zone_id: string }[]) {
        counts[row.zone_id] = (counts[row.zone_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {zones?.length ?? '…'} zones configured across all organisations
      </div>

      {isLoading ? (
        <Spinner />
      ) : !zones?.length ? (
        <EmptyState message="No zones found" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {zones.map((zone) => {
            const obsCount = zoneCounts?.[zone.id] ?? 0;
            const breachCount = zoneBreaches?.[zone.id] ?? 0;
            const compliance = obsCount > 0 ? Math.round(((obsCount - breachCount) / obsCount) * 100) : null;

            return (
              <div
                key={zone.id}
                className={cn(
                  'bg-white dark:bg-gray-900 rounded-xl border shadow-sm p-5',
                  zone.is_active
                    ? 'border-gray-200 dark:border-gray-700'
                    : 'border-gray-100 dark:border-gray-800 opacity-60'
                )}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">{zone.name}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{zone.organizations?.name ?? '—'}</p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-xs px-2 py-0.5 rounded-full font-medium',
                      zone.is_active
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    )}
                  >
                    {zone.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Zone rules */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {zone.day_visit_only && (
                    <span className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                      Day-visit only
                    </span>
                  )}
                  {zone.self_contained_required && (
                    <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
                      Self-contained required
                    </span>
                  )}
                  <span className="text-xs bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700">
                    {zone.nights_per_month}n/mo · {zone.max_consecutive_nights}consec
                  </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <div className="text-center">
                    <div className="text-xl font-black text-gray-900 dark:text-white">{obsCount}</div>
                    <div className="text-xs text-gray-400">observations</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-black text-red-600">{breachCount}</div>
                    <div className="text-xs text-gray-400">breaches</div>
                  </div>
                  <div className="text-center">
                    <div className={cn(
                      'text-xl font-black',
                      compliance === null ? 'text-gray-400' :
                      compliance >= 80 ? 'text-green-600' : 'text-orange-500'
                    )}>
                      {compliance !== null ? `${compliance}%` : '—'}
                    </div>
                    <div className="text-xs text-gray-400">compliance</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Users Tab
// ============================================================================

function UsersTab() {
  const { data: users, isLoading } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name, role, organization_id, organizations!user_profiles_organization_id_fkey(name)')
        .order('role')
        .order('last_name');
      if (error) throw error;
      return (data ?? []) as UserProfile[];
    },
  });

  const { data: scanCounts } = useQuery({
    queryKey: ['user-scan-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('observations')
        .select('recorded_by');
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { recorded_by: string }[]) {
        counts[row.recorded_by] = (counts[row.recorded_by] ?? 0) + 1;
      }
      return counts;
    },
  });

  const roleColor: Record<string, string> = {
    master: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    admin_officer: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    officer: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {users?.length ?? '…'} user profiles
      </div>

      {isLoading ? (
        <Spinner />
      ) : !users?.length ? (
        <EmptyState message="No user profiles found" />
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 text-left">
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Name</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400">Role</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">Organisation</th>
                  <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-center">Scans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                      {u.first_name} {u.last_name}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', roleColor[u.role] ?? 'bg-gray-100 text-gray-600')}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                      {u.organizations?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-bold">
                        {scanCounts?.[u.id] ?? 0}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Organisations Tab
// ============================================================================

function OrganisationsTab() {
  const { data: orgs, isLoading } = useQuery({
    queryKey: ['orgs-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, contact_email')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Organization[];
    },
  });

  const { data: orgObsCounts } = useQuery({
    queryKey: ['org-obs-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('observations').select('organization_id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { organization_id: string }[]) {
        counts[row.organization_id] = (counts[row.organization_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  const { data: orgBreachCounts } = useQuery({
    queryKey: ['org-breach-counts'],
    queryFn: async () => {
      // Count active breach alerts per organisation (single source of truth)
      const { data, error } = await supabase
        .from('breach_alerts')
        .select('organization_id')
        .eq('status', 'pending');
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { organization_id: string }[]) {
        counts[row.organization_id] = (counts[row.organization_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {orgs?.length ?? '…'} organisations
      </div>

      {isLoading ? (
        <Spinner />
      ) : !orgs?.length ? (
        <EmptyState message="No organisations found" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {orgs.map((org) => {
            const obs = orgObsCounts?.[org.id] ?? 0;
            const breaches = orgBreachCounts?.[org.id] ?? 0;
            const rate = obs > 0 ? Math.round(((obs - breaches) / obs) * 100) : null;
            return (
              <div key={org.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30">
                    <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 dark:text-white truncate">{org.name}</h3>
                    {org.contact_email && (
                      <p className="text-xs text-gray-400 truncate">{org.contact_email}</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <div className="text-center">
                    <div className="text-xl font-black text-gray-900 dark:text-white">{obs}</div>
                    <div className="text-xs text-gray-400">observations</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-black text-red-600">{breaches}</div>
                    <div className="text-xs text-gray-400">breaches</div>
                  </div>
                  <div className="text-center">
                    <div className={cn('text-xl font-black', rate === null ? 'text-gray-400' : rate >= 80 ? 'text-green-600' : 'text-orange-500')}>
                      {rate !== null ? `${rate}%` : '—'}
                    </div>
                    <div className="text-xs text-gray-400">compliance</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Dashboard
// ============================================================================

const TABS: { id: Tab | 'organisations'; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'observations', label: 'Observations', icon: Camera },
  { id: 'vehicles', label: 'Vehicles', icon: Car },
  { id: 'zones', label: 'Zones', icon: MapPin },
  { id: 'organisations', label: 'Organisations', icon: Building2 },
  { id: 'users', label: 'Users', icon: Users },
];

type AllTabs = Tab | 'organisations';

export default function CleanDashboard() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AllTabs>('overview');

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-blue-600">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-gray-900 dark:text-white text-sm">FreedomCamp Manager</span>
              <span className="ml-2 text-xs text-blue-600 dark:text-blue-400 font-medium">Live Data</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {user.full_name ?? user.email}
              </span>
              <span className="text-xs text-gray-400 capitalize">{user.role}</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as AllTabs)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                  activeTab === id
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'observations' && <ObservationsTab />}
        {activeTab === 'vehicles' && <VehiclesTab />}
        {activeTab === 'zones' && <ZonesTab />}
        {activeTab === 'organisations' && <OrganisationsTab />}
        {activeTab === 'users' && <UsersTab />}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-3 px-4 text-center text-xs text-gray-400">
        FreedomCamp Manager · Live data from Supabase ·{' '}
        <Calendar className="inline w-3 h-3 mx-1" />
        {format(new Date(), 'PPP')}
      </footer>
    </div>
  );
}
