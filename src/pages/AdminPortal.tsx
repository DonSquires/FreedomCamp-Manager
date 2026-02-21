/**
 * Admin Portal - Enforcement & Compliance Command Center
 * 
 * Production-ready admin dashboard with:
 * - Global filters (date, org, zone) with persistence
 * - Real-time KPIs with drilldown navigation
 * - Charts (timeseries, breaches by type, top zones)
 * - Quick actions to all enforcement screens
 * - Database maintenance tools
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Activity,
  AlertTriangle,
  Shield,
  MapPin,
  Users,
  FileText,
  Database,
  Loader2,
  RefreshCw,
  Navigation,
  CarFront,
  Home,
  TrendingUp,
  Eye,
  Flame,
  ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useGlobalFilters } from '@/stores/globalFiltersStore';
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';
import { cn } from '@/lib/utils';

interface DashboardStats {
  total_observations: number;
  total_breaches: number;
  pending_breaches: number;
  active_investigations: number;
  active_officers: number;
  zones_with_activity: number;
  total_vehicles: number;
  flagged_vehicles: number;
  homeless_vehicles: number;
  homeless_exempt: number;
}

interface TimeseriesPoint {
  date: string;
  observations: number;
}

interface BreachByType {
  breach_type: string;
  count: number;
}

interface TopZone {
  zone_id: string;
  zone_name: string;
  observation_count: number;
  breach_count: number;
}

export function AdminPortal() {
  const navigate = useNavigate();
  const { dateFrom, dateTo, organizationId, zoneId } = useGlobalFilters();
  
  // Stats
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [breachesByType, setBreachesByType] = useState<BreachByType[]>([]);
  const [topZones, setTopZones] = useState<TopZone[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  // Load dashboard stats when filters change
  useEffect(() => {
    loadDashboardData();
  }, [dateFrom, dateTo, organizationId, zoneId]);

  const loadDashboardData = async () => {
    setIsLoading(true);
    setError(null);
    setErrorId(null);
    try {
      // Convert date strings to ISO with time boundaries
      const startOfDay = new Date(dateFrom);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);

      // Load KPIs using existing RPC function
      const { data: statsData, error: statsError } = await supabase.rpc('get_admin_dashboard_stats', {
        p_start_date: startOfDay.toISOString(),
        p_end_date: endOfDay.toISOString(),
        p_organization_id: organizationId,
      });

      if (statsError) throw statsError;

      if (statsData && statsData.length > 0) {
        const statsRow = statsData[0];
        setStats({
          total_observations: Number(statsRow.total_observations) || 0,
          total_breaches: Number(statsRow.total_breaches) || 0,
          pending_breaches: Number(statsRow.pending_breaches) || 0,
          active_investigations: Number(statsRow.active_investigations) || 0,
          active_officers: Number(statsRow.active_officers) || 0,
          zones_with_activity: Number(statsRow.zones_with_activity) || 0,
          total_vehicles: Number(statsRow.total_vehicles) || 0,
          flagged_vehicles: Number(statsRow.flagged_vehicles) || 0,
          homeless_vehicles: Number(statsRow.homeless_vehicles) || 0,
          homeless_exempt: Number(statsRow.homeless_exempt) || 0,
        });
      }

      // Load timeseries data (observations per day)
      const { data: timeseriesData, error: timeseriesError } = await supabase
        .from('observations')
        .select('recorded_at')
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString())
        .then(({ data, error }) => {
          if (error) throw error;
          
          // Group by date
          const grouped = (data || []).reduce((acc: Record<string, number>, obs) => {
            const date = new Date(obs.recorded_at).toISOString().split('T')[0];
            acc[date] = (acc[date] || 0) + 1;
            return acc;
          }, {});

          const series = Object.entries(grouped).map(([date, count]) => ({
            date,
            observations: count,
          }));

          return { data: series, error: null };
        });

      if (!timeseriesError) {
        setTimeseries(timeseriesData || []);
      }

      // Load breaches by type
      const { data: breachesData, error: breachesError } = await supabase
        .from('observations')
        .select('breach_type')
        .eq('is_compliant', false)
        .not('breach_type', 'is', null)
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString())
        .then(({ data, error }) => {
          if (error) throw error;

          // Group by breach type
          const grouped = (data || []).reduce((acc: Record<string, number>, obs) => {
            const type = obs.breach_type || 'Unknown';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
          }, {});

          const series = Object.entries(grouped)
            .map(([breach_type, count]) => ({ breach_type, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

          return { data: series, error: null };
        });

      if (!breachesError) {
        setBreachesByType(breachesData || []);
      }

      // Load top zones
      const { data: zonesData, error: zonesError } = await supabase.rpc('get_zones_with_activity', {
        p_organization_id: organizationId,
        p_start_date: startOfDay.toISOString(),
        p_end_date: endOfDay.toISOString(),
      });

      if (!zonesError) {
        setTopZones((zonesData || []).slice(0, 10));
      }

    } catch (error: any) {
      const errorIdStr = `ERR-${Date.now()}`;
      console.error('Failed to load dashboard data:', error, { errorId: errorIdStr });
      setError(error.message || 'Failed to load dashboard data');
      setErrorId(errorIdStr);
      toast.error(`Couldn't load dashboard. Try Refresh. (${errorIdStr})`);
    } finally {
      setIsLoading(false);
    }
  };

  // Drilldown navigation - preserves global filters
  const handleDrilldown = (path: string, params?: Record<string, string>) => {
    // Preserve global filters as query params
    const allParams = {
      dateFrom,
      dateTo,
      ...(organizationId && { organizationId }),
      ...(zoneId && { zoneId }),
      ...params, // Additional params override if needed
    };
    const searchParams = new URLSearchParams(allParams);
    navigate(`${path}?${searchParams.toString()}`);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <AdminNavigationMenu />
              <div>
                <h1 className="text-2xl font-bold">Admin Dashboard</h1>
                <p className="text-sm text-muted-foreground">
                  Enforcement & Compliance Command Center
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Global Filter Ribbon */}
        <GlobalFilterRibbon onRefresh={loadDashboardData} />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* Error Banner */}
            {error && (
              <Card className="border-red-500 bg-red-50 dark:bg-red-950/20">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-red-900 dark:text-red-100">Dashboard Load Error</p>
                      <p className="text-sm text-red-700 dark:text-red-200 mt-1">{error}</p>
                      {errorId && (
                        <p className="text-xs text-red-600 dark:text-red-300 mt-1">Error ID: {errorId}</p>
                      )}
                      <Button
                        onClick={loadDashboardData}
                        variant="outline"
                        size="sm"
                        className="mt-3 border-red-600 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
                      >
                        <RefreshCw className="h-3 w-3 mr-2" />
                        Retry
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* KPI Cards - Now Clickable for Drilldowns */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              {/* Total Observations */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Card 
                      className="cursor-pointer hover:shadow-lg transition-all"
                      onClick={() => handleDrilldown('/admin/observations')}
                    >
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Observations</CardTitle>
                        <Activity className="h-4 w-4 text-blue-600" />
                      </CardHeader>
                      <CardContent>
                        {isLoading ? (
                          <Skeleton className="h-8 w-20 mb-2" />
                        ) : (
                          <div className="text-2xl font-bold">{stats?.total_observations || 0}</div>
                        )}
                        <p className="text-xs text-muted-foreground mt-1 flex items-center">
                          Click to view details
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </p>
                      </CardContent>
                    </Card>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>View all vehicle observations for selected period</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Pending Breaches */}
              <Card 
                className="cursor-pointer hover:shadow-lg transition-all"
                onClick={() => handleDrilldown('/admin/breaches', { tab: 'pending' })}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Pending Breaches</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">{isLoading ? '...' : stats?.pending_breaches || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center">
                    of {stats?.total_breaches || 0} total
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </p>
                </CardContent>
              </Card>

              {/* Active Officers */}
              <Card 
                className="cursor-pointer hover:shadow-lg transition-all"
                onClick={() => handleDrilldown('/admin/officer-welfare')}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Officers</CardTitle>
                  <Users className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{isLoading ? '...' : stats?.active_officers || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center">
                    Recorded today
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </p>
                </CardContent>
              </Card>

              {/* Active Zones */}
              <Card 
                className="cursor-pointer hover:shadow-lg transition-all"
                onClick={() => handleDrilldown('/admin/zones')}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Zones</CardTitle>
                  <MapPin className="h-4 w-4 text-indigo-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-indigo-600">{isLoading ? '...' : stats?.zones_with_activity || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center">
                    With activity
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </p>
                </CardContent>
              </Card>

              {/* Active Investigations */}
              <Card 
                className="cursor-pointer hover:shadow-lg transition-all"
                onClick={() => handleDrilldown('/admin/enforcement', { tab: 'investigations' })}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Investigations</CardTitle>
                  <Shield className="h-4 w-4 text-purple-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600">{isLoading ? '...' : stats?.active_investigations || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center">
                    In progress
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Second Row of KPIs */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              {/* Total Vehicles */}
              <Card 
                className="cursor-pointer hover:shadow-lg transition-all"
                onClick={() => handleDrilldown('/admin/vehicles')}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Vehicles</CardTitle>
                  <CarFront className="h-4 w-4 text-cyan-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-cyan-600">{isLoading ? '...' : stats?.total_vehicles || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center">
                    In registry
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </p>
                </CardContent>
              </Card>

              {/* Flagged Vehicles */}
              <Card 
                className="cursor-pointer hover:shadow-lg transition-all"
                onClick={() => handleDrilldown('/admin/vehicles', { tab: 'flagged' })}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Flagged</CardTitle>
                  <Home className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600">{isLoading ? '...' : stats?.flagged_vehicles || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center">
                    Attention needed
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </p>
                </CardContent>
              </Card>

              {/* Homeless Vehicles */}
              <Card 
                className="cursor-pointer hover:shadow-lg transition-all"
                onClick={() => handleDrilldown('/admin/vehicles', { tab: 'homeless' })}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Homeless</CardTitle>
                  <Home className="h-4 w-4 text-emerald-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-emerald-600">{isLoading ? '...' : stats?.homeless_vehicles || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center">
                    Confirmed
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </p>
                </CardContent>
              </Card>

              {/* Homeless Exempt */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Exempt Today</CardTitle>
                  <Home className="h-4 w-4 text-teal-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-teal-600">{isLoading ? '...' : stats?.homeless_exempt || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Exemptions granted
                  </p>
                </CardContent>
              </Card>

              {/* Hotspots Link */}
              <Card 
                className="cursor-pointer hover:shadow-lg transition-all bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-950/20 dark:to-red-950/20"
                onClick={() => handleDrilldown('/admin/hotspots')}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Hotspots</CardTitle>
                  <Flame className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold text-orange-600">View Map</div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center">
                    Heat map & clusters
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Charts Row */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Timeseries Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Observations Over Time
                  </CardTitle>
                  <CardDescription>
                    Daily observation count for selected period
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="h-48 flex items-center justify-center text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : timeseries.length === 0 ? (
                    <div className="h-48 flex items-center justify-center text-muted-foreground">
                      No data for selected period
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {timeseries.map((point) => (
                        <div key={point.date} className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            {format(new Date(point.date), 'dd MMM')}
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-600" 
                                style={{ width: `${(point.observations / (Math.max(...timeseries.map(p => p.observations)) || 1)) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-8 text-right">{point.observations}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Breaches by Type Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    Breaches by Type
                  </CardTitle>
                  <CardDescription>
                    Top 10 violation types for selected period
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="h-48 flex items-center justify-center text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : breachesByType.length === 0 ? (
                    <div className="h-48 flex items-center justify-center text-muted-foreground">
                      No breaches for selected period
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {breachesByType.map((breach) => (
                        <div key={breach.breach_type} className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground truncate">
                            {breach.breach_type}
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-red-600" 
                                style={{ width: `${(breach.count / (Math.max(...breachesByType.map(b => b.count)) || 1)) * 100}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium w-8 text-right">{breach.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Top Zones Table */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Top Zones by Activity
                </CardTitle>
                <CardDescription>
                  Zones with most observations for selected period
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : topZones.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground">
                    No zone activity for selected period
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 text-sm font-medium text-muted-foreground">Zone</th>
                          <th className="text-right py-2 text-sm font-medium text-muted-foreground">Observations</th>
                          <th className="text-right py-2 text-sm font-medium text-muted-foreground">Breaches</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topZones.map((zone) => (
                          <tr 
                            key={zone.zone_id} 
                            className="border-b hover:bg-muted/50 cursor-pointer"
                            onClick={() => handleDrilldown('/admin/observations', { zone: zone.zone_id })}
                          >
                            <td className="py-2 text-sm">{zone.zone_name}</td>
                            <td className="py-2 text-sm text-right font-medium">{zone.observation_count}</td>
                            <td className="py-2 text-sm text-right font-medium text-red-600">{zone.breach_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Actions - No longer needed, use hamburger menu */}
          </div>
        </div>
      </div>
    </div>
  );
}
