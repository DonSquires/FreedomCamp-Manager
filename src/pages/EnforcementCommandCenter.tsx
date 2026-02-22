/**
 * Enforcement Command Center - Real-Time Admin Dashboard
 * 
 * Live monitoring dashboard with:
 * - Real-time KPI metrics (scans, breaches, warnings, active officers)
 * - Live breach alert feed
 * - Auto-refresh every 30 seconds
 * - Organization-scoped data via RLS
 * 
 * Usage: Admin/Master role only
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Car, 
  AlertTriangle, 
  ShieldAlert, 
  Users, 
  Activity, 
  RefreshCw,
  MapPin,
  CheckCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================

interface DashboardStats {
  scans_today: number;
  active_breaches: number;
  unique_vehicles_24h: number;
  warnings_24h: number;
  active_officers: number;
  last_scan_time: string | null;
}

interface BreachAlert {
  alert_id: string;
  status: 'pending' | 'assigned' | 'resolved' | 'dismissed';
  created_at: string;
  plate_number: string;
  make: string | null;
  model: string | null;
  color: string | null;
  zone_name: string;
  max_consecutive_nights: number;
  nights_stayed: number;
  rule_applied: string;
}

// ============================================================================
// Main Component
// ============================================================================

export default function EnforcementCommandCenter() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [breaches, setBreaches] = useState<BreachAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchData = async () => {
    setLoading(true);
    console.log('🔄 Refreshing Command Center...');

    try {
      // 1. Get KPIs from the SQL View
      const { data: kpi, error: kpiError } = await supabase
        .from('dashboard_stats_live')
        .select('*')
        .single();
      
      if (kpiError) {
        console.error('KPI Error:', kpiError);
        toast.error('Failed to load KPI metrics');
      }
      if (kpi) {
        setStats(kpi);
      }

      // 2. Get Breach Feed from the SQL View
      const { data: feed, error: feedError } = await supabase
        .from('dashboard_breaches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (feedError) {
        console.error('Feed Error:', feedError);
        toast.error('Failed to load breach feed');
      }
      if (feed) {
        setBreaches(feed);
      }
      
      setLastUpdated(new Date());

    } catch (err) {
      console.error('Dashboard Crash:', err);
      toast.error('Failed to refresh dashboard');
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans p-4 md:p-8">
      
      {/* --- HEADER --- */}
      <header className="flex flex-col md:flex-row md:justify-between md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <ShieldAlert className="text-emerald-500" size={32} />
            Enforcement Command
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Real-time Freedom Camping Monitoring System
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 hidden md:block">
            Updated: {lastUpdated.toLocaleTimeString()}
          </span>
          <button 
            onClick={fetchData} 
            disabled={loading}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-700 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={18} className={cn(loading && 'animate-spin')} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* --- KPI GRID --- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard 
          label="Scans Today" 
          value={stats?.scans_today || 0} 
          icon={<Car className="text-blue-400" size={24} />}
          sub="Vehicles Processed"
        />
        <StatCard 
          label="Active Breaches" 
          value={stats?.active_breaches || 0} 
          icon={<ShieldAlert className="text-red-500" size={24} />} 
          active={true}
          sub="Require Attention"
        />
        <StatCard 
          label="Warnings Issued" 
          value={stats?.warnings_24h || 0} 
          icon={<AlertTriangle className="text-amber-400" size={24} />}
          sub="Last 24 Hours"
        />
        <StatCard 
          label="Active Officers" 
          value={stats?.active_officers || 0} 
          icon={<Users className="text-emerald-400" size={24} />}
          sub="Currently Patrolling"
        />
      </div>

      {/* --- MAIN CONTENT: ALERTS --- */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-gray-700 bg-gray-800/50 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Activity className="text-blue-400" size={20} />
            Live Breach Feed
          </h2>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-bold">
            Recent Activity
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-900/50 text-gray-400 uppercase text-xs font-medium tracking-wider">
              <tr>
                <th className="p-4">Status</th>
                <th className="p-4">Vehicle</th>
                <th className="p-4">Location</th>
                <th className="p-4">Violation Details</th>
                <th className="p-4 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {breaches.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-12">
                    <div className="flex flex-col items-center text-center text-gray-500">
                      <CheckCircle size={48} className="mb-4 text-gray-600" />
                      <span className="text-lg">No active breaches detected.</span>
                      <span className="text-sm mt-2">System is monitoring...</span>
                    </div>
                  </td>
                </tr>
              ) : (
                breaches.map((b) => (
                  <tr key={b.alert_id} className="hover:bg-gray-700/30 transition-colors group">
                    
                    {/* Status Badge */}
                    <td className="p-4 whitespace-nowrap">
                      <span className={cn(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold capitalize border',
                        b.status === 'pending' && 'bg-red-500/10 text-red-400 border-red-500/20',
                        b.status === 'assigned' && 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                        b.status === 'resolved' && 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                        b.status === 'dismissed' && 'bg-gray-700 text-gray-300 border-gray-600'
                      )}>
                        {b.status}
                      </span>
                    </td>

                    {/* Vehicle Info */}
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-gray-700 p-2 rounded text-gray-300">
                          <Car size={20} />
                        </div>
                        <div>
                          <div className="font-mono text-lg font-bold text-white tracking-wide">
                            {b.plate_number}
                          </div>
                          <div className="text-xs text-gray-400">
                            {b.color || 'Unknown'} {b.make || ''} {b.model || ''}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Zone */}
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-gray-300">
                        <MapPin size={16} className="text-gray-500" />
                        {b.zone_name}
                      </div>
                    </td>

                    {/* Violation */}
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="text-red-300 font-medium">{b.rule_applied}</span>
                        <span className="text-xs text-gray-500 mt-1">
                          Detected Stay: <strong className="text-white">{b.nights_stayed}</strong> / {b.max_consecutive_nights} Allowed
                        </span>
                      </div>
                    </td>

                    {/* Time */}
                    <td className="p-4 text-right whitespace-nowrap text-gray-400 font-mono">
                      {new Date(b.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      <div className="text-xs text-gray-600">
                        {new Date(b.created_at).toLocaleDateString()}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  sub: string;
  active?: boolean;
}

function StatCard({ label, value, icon, sub, active = false }: StatCardProps) {
  return (
    <div className={cn(
      'p-5 rounded-xl border transition-all duration-200',
      active 
        ? 'bg-red-900/10 border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]' 
        : 'bg-gray-800 border-gray-700 hover:border-gray-600'
    )}>
      <div className="flex justify-between items-start mb-4">
        <div className={cn(
          'p-2 rounded-lg',
          active ? 'bg-red-500/20' : 'bg-gray-900'
        )}>
          {icon}
        </div>
        <div className={cn(
          'text-3xl font-bold tracking-tight',
          active ? 'text-red-400' : 'text-white'
        )}>
          {value.toLocaleString()}
        </div>
      </div>
      <div>
        <div className={cn(
          'text-sm font-medium',
          active ? 'text-red-200' : 'text-gray-300'
        )}>
          {label}
        </div>
        <div className="text-xs text-gray-500 mt-1">{sub}</div>
      </div>
    </div>
  );
}
