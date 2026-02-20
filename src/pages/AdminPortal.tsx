/**
 * Admin Portal - Compliance & Enforcement Command Center
 * 
 * Full-featured admin dashboard with:
 * - Clickable KPI drill-downs (Breaches, Overstays, Homeless, At-Risk)
 * - Advanced date filtering (Today, Yesterday, Previous/Next Day navigation)
 * - Heat map visualization
 * - Officer welfare monitoring
 * - Database maintenance (Recalculations, Zone Corrections, Duplicates)
 * - Breadcrumb navigation for drill-down views
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Activity,
  AlertTriangle,
  TrendingUp,
  Users,
  MapPin,
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  Calendar,
  Radio,
  Heart,
  Navigation,
  BarChart3,
  Loader2,
  Home,
  FileText,
  Settings,
  Database,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Download,
  RefreshCw,
  Zap,
  UserCheck,
  CarFront,
  MapPinned,
  TrendingDown,
} from 'lucide-react';
import { format, subDays, addDays, startOfDay, endOfDay } from 'date-fns';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type ViewMode = 
  | 'dashboard' 
  | 'breach-detail' 
  | 'overstay-detail' 
  | 'homeless-detail' 
  | 'at-risk-detail'
  | 'heatmap'
  | 'welfare'
  | 'analytics'
  | 'maintenance';

interface BreadcrumbItem {
  label: string;
  view: ViewMode;
}

interface DashboardStats {
  total_observations: number;
  breaches_count: number;
  overstays_count: number;
  homeless_count: number;
  at_risk_count: number;
  active_officers: number;
  welfare_alerts: number;
  compliance_rate: number;
  zones_active: number;
  trend_vs_yesterday: number;
}

interface ObservationRecord {
  id: string;
  plate_number: string;
  photo_url: string;
  recorded_at: string;
  zone_name: string;
  officer_name: string;
  is_compliant: boolean;
  breach_type: string | null;
  breach_reason: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  nights_stayed_this_month: number;
  consecutive_nights: number;
  gps_latitude: number;
  gps_longitude: number;
}

export function AdminPortal() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  
  // View State
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { label: 'Dashboard', view: 'dashboard' }
  ]);

  // Date Navigation State
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dateInput, setDateInput] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Filters
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');

  // Quick Date Actions
  const goToToday = () => {
    const today = new Date();
    setSelectedDate(today);
    setDateInput(format(today, 'yyyy-MM-dd'));
  };

  const goToYesterday = () => {
    const yesterday = subDays(new Date(), 1);
    setSelectedDate(yesterday);
    setDateInput(format(yesterday, 'yyyy-MM-dd'));
  };

  const goToPreviousDay = () => {
    const prev = subDays(selectedDate, 1);
    setSelectedDate(prev);
    setDateInput(format(prev, 'yyyy-MM-dd'));
  };

  const goToNextDay = () => {
    const next = addDays(selectedDate, 1);
    setSelectedDate(next);
    setDateInput(format(next, 'yyyy-MM-dd'));
  };

  const handleDateInputChange = (dateStr: string) => {
    setDateInput(dateStr);
    const newDate = new Date(dateStr);
    if (!isNaN(newDate.getTime())) {
      setSelectedDate(newDate);
    }
  };

  // Breadcrumb Navigation
  const navigateToView = (view: ViewMode, label: string) => {
    setCurrentView(view);
    
    // Update breadcrumbs
    const existingIndex = breadcrumbs.findIndex(b => b.view === view);
    if (existingIndex >= 0) {
      // Going back to existing breadcrumb
      setBreadcrumbs(breadcrumbs.slice(0, existingIndex + 1));
    } else {
      // Adding new breadcrumb
      setBreadcrumbs([...breadcrumbs, { label, view }]);
    }
  };

  const goBack = () => {
    if (breadcrumbs.length > 1) {
      const newBreadcrumbs = breadcrumbs.slice(0, -1);
      setBreadcrumbs(newBreadcrumbs);
      setCurrentView(newBreadcrumbs[newBreadcrumbs.length - 1].view);
    }
  };

  // Dashboard Stats Query
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats', selectedDate, selectedOrgId, selectedZoneId],
    queryFn: async () => {
      const startOfSelectedDay = startOfDay(selectedDate);
      const endOfSelectedDay = endOfDay(selectedDate);
      const startOfYesterday = startOfDay(subDays(selectedDate, 1));
      const endOfYesterday = endOfDay(subDays(selectedDate, 1));

      // Total observations for selected date
      let obsQuery = supabase
        .from('observations')
        .select('*', { count: 'exact', head: false })
        .gte('recorded_at', startOfSelectedDay.toISOString())
        .lte('recorded_at', endOfSelectedDay.toISOString());

      if (selectedOrgId) obsQuery = obsQuery.eq('organization_id', selectedOrgId);
      if (selectedZoneId) obsQuery = obsQuery.eq('zone_id', selectedZoneId);

      const { data: obsData, count: totalObs } = await obsQuery;

      // Yesterday's count for trend
      let yesterdayQuery = supabase
        .from('observations')
        .select('*', { count: 'exact', head: true })
        .gte('recorded_at', startOfYesterday.toISOString())
        .lte('recorded_at', endOfYesterday.toISOString());

      if (selectedOrgId) yesterdayQuery = yesterdayQuery.eq('organization_id', selectedOrgId);
      if (selectedZoneId) yesterdayQuery = yesterdayQuery.eq('zone_id', selectedZoneId);

      const { count: yesterdayCount } = await yesterdayQuery;

      // Calculate cohorts from today's observations
      const breaches = obsData?.filter(o => !o.is_compliant) || [];
      const overstays = obsData?.filter(o => o.nights_stayed_this_month > 28 || o.consecutive_nights > 3) || [];
      const homeless = obsData?.filter(o => o.officer_notes?.toLowerCase().includes('homeless') || o.breach_reason?.toLowerCase().includes('homeless')) || [];
      const atRisk = obsData?.filter(o => 
        (o.nights_stayed_this_month >= 25 && o.nights_stayed_this_month <= 28) ||
        (o.consecutive_nights >= 2 && o.consecutive_nights <= 3)
      ) || [];

      // Active officers (last 4 hours)
      const { count: activeOfficers } = await supabase
        .from('officer_activity_log')
        .select('user_id', { count: 'exact', head: true })
        .gte('recorded_at', subDays(new Date(), 0.17).toISOString());

      // Welfare alerts
      const { count: welfareAlerts } = await supabase
        .from('officer_welfare_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // Zones with activity today
      const { count: zonesActive } = await supabase
        .from('observations')
        .select('zone_id', { count: 'exact', head: true })
        .gte('recorded_at', startOfSelectedDay.toISOString())
        .lte('recorded_at', endOfSelectedDay.toISOString());

      const complianceRate = obsData && obsData.length > 0
        ? (obsData.filter(o => o.is_compliant).length / obsData.length) * 100
        : 0;

      return {
        total_observations: totalObs || 0,
        breaches_count: breaches.length,
        overstays_count: overstays.length,
        homeless_count: homeless.length,
        at_risk_count: atRisk.length,
        active_officers: activeOfficers || 0,
        welfare_alerts: welfareAlerts || 0,
        compliance_rate: Math.round(complianceRate),
        zones_active: zonesActive || 0,
        trend_vs_yesterday: (totalObs || 0) - (yesterdayCount || 0),
      } as DashboardStats;
    },
    refetchInterval: 60000, // Auto-refresh every minute
  });

  // Observations Query (for drill-down views)
  const { data: observations, isLoading: obsLoading } = useQuery({
    queryKey: ['observations-detail', currentView, selectedDate, selectedOrgId, selectedZoneId],
    queryFn: async () => {
      if (currentView === 'dashboard' || currentView === 'heatmap' || currentView === 'welfare' || currentView === 'analytics' || currentView === 'maintenance') {
        return [];
      }

      const startOfSelectedDay = startOfDay(selectedDate);
      const endOfSelectedDay = endOfDay(selectedDate);

      let query = supabase
        .from('observations')
        .select(`
          *,
          zone:zones(name),
          officer:user_profiles!observations_recorded_by_fkey(first_name, last_name)
        `)
        .gte('recorded_at', startOfSelectedDay.toISOString())
        .lte('recorded_at', endOfSelectedDay.toISOString())
        .order('recorded_at', { ascending: false });

      if (selectedOrgId) query = query.eq('organization_id', selectedOrgId);
      if (selectedZoneId) query = query.eq('zone_id', selectedZoneId);

      const { data, error } = await query;
      if (error) throw error;

      // Filter based on drill-down view
      let filteredData = data || [];
      
      if (currentView === 'breach-detail') {
        filteredData = filteredData.filter(o => !o.is_compliant);
      } else if (currentView === 'overstay-detail') {
        filteredData = filteredData.filter(o => o.nights_stayed_this_month > 28 || o.consecutive_nights > 3);
      } else if (currentView === 'homeless-detail') {
        filteredData = filteredData.filter(o => 
          o.officer_notes?.toLowerCase().includes('homeless') || 
          o.breach_reason?.toLowerCase().includes('homeless')
        );
      } else if (currentView === 'at-risk-detail') {
        filteredData = filteredData.filter(o =>
          (o.nights_stayed_this_month >= 25 && o.nights_stayed_this_month <= 28) ||
          (o.consecutive_nights >= 2 && o.consecutive_nights <= 3)
        );
      }

      return filteredData.map((obs: any) => ({
        id: obs.id,
        plate_number: obs.plate_number,
        photo_url: obs.photo_url,
        recorded_at: obs.recorded_at,
        zone_name: obs.zone?.name || 'Unknown Zone',
        officer_name: obs.officer ? `${obs.officer.first_name} ${obs.officer.last_name}` : 'Unknown',
        is_compliant: obs.is_compliant,
        breach_type: obs.breach_type,
        breach_reason: obs.breach_reason,
        vehicle_make: obs.vehicle_make,
        vehicle_model: obs.vehicle_model,
        vehicle_color: obs.vehicle_color,
        nights_stayed_this_month: obs.nights_stayed_this_month,
        consecutive_nights: obs.consecutive_nights,
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
      })) as ObservationRecord[];
    },
    enabled: ['breach-detail', 'overstay-detail', 'homeless-detail', 'at-risk-detail'].includes(currentView),
  });

  // Zone Heat Map Data
  const { data: heatMapData } = useQuery({
    queryKey: ['zone-heatmap', selectedDate, selectedOrgId],
    queryFn: async () => {
      const startOfSelectedDay = startOfDay(selectedDate);
      const endOfSelectedDay = endOfDay(selectedDate);

      let query = supabase
        .from('observations')
        .select(`
          zone_id,
          is_compliant,
          zone:zones(name)
        `)
        .gte('recorded_at', startOfSelectedDay.toISOString())
        .lte('recorded_at', endOfSelectedDay.toISOString());

      if (selectedOrgId) query = query.eq('organization_id', selectedOrgId);

      const { data } = await query;
      if (!data) return [];

      // Group by zone
      const zoneMap = new Map<string, { name: string; total: number; breaches: number }>();
      data.forEach((obs: any) => {
        const zoneId = obs.zone_id;
        const zoneName = obs.zone?.name || 'Unknown Zone';

        if (!zoneMap.has(zoneId)) {
          zoneMap.set(zoneId, { name: zoneName, total: 0, breaches: 0 });
        }

        const zone = zoneMap.get(zoneId)!;
        zone.total++;
        if (!obs.is_compliant) zone.breaches++;
      });

      return Array.from(zoneMap.entries()).map(([zone_id, data]) => ({
        zone_id,
        zone_name: data.name,
        observation_count: data.total,
        breach_count: data.breaches,
        compliance_rate: ((data.total - data.breaches) / data.total) * 100,
      })).sort((a, b) => b.observation_count - a.observation_count);
    },
    enabled: currentView === 'heatmap',
  });

  // Render Dashboard View
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* KPI Tiles */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Total Observations */}
        <Card className="cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Observations</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total_observations || 0}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
              {(stats?.trend_vs_yesterday || 0) >= 0 ? (
                <TrendingUp className="h-3 w-3 text-green-600" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-600" />
              )}
              <span className={cn(
                (stats?.trend_vs_yesterday || 0) >= 0 ? 'text-green-600' : 'text-red-600'
              )}>
                {stats?.trend_vs_yesterday > 0 ? '+' : ''}{stats?.trend_vs_yesterday || 0} vs yesterday
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Breaches - CLICKABLE */}
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => navigateToView('breach-detail', 'Breaches')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Breaches</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats?.breaches_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Click to drill down →</p>
          </CardContent>
        </Card>

        {/* Overstays - CLICKABLE */}
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => navigateToView('overstay-detail', 'Overstays')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overstays</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{stats?.overstays_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Click to drill down →</p>
          </CardContent>
        </Card>

        {/* Homeless - CLICKABLE */}
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => navigateToView('homeless-detail', 'Homeless')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Homeless</CardTitle>
            <Home className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{stats?.homeless_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Click to drill down →</p>
          </CardContent>
        </Card>

        {/* At Risk - CLICKABLE */}
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow"
          onClick={() => navigateToView('at-risk-detail', 'At Risk')}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">At Risk</CardTitle>
            <Zap className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats?.at_risk_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Click to drill down →</p>
          </CardContent>
        </Card>

        {/* Active Officers */}
        <Card className="cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Officers</CardTitle>
            <Users className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats?.active_officers || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.welfare_alerts || 0} welfare alerts
            </p>
          </CardContent>
        </Card>

        {/* Compliance Rate */}
        <Card className="cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compliance Rate</CardTitle>
            <Shield className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats?.compliance_rate || 0}%</div>
            <p className="text-xs text-muted-foreground mt-1">Today's observations</p>
          </CardContent>
        </Card>

        {/* Zones Active */}
        <Card className="cursor-default">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Zones</CardTitle>
            <MapPin className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-indigo-600">{stats?.zones_active || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">With activity today</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Button variant="outline" asChild className="h-auto py-4 justify-start">
            <Link to="/observations-report">
              <FileText className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Observations Report</div>
                <div className="text-xs text-muted-foreground">Field evidence records</div>
              </div>
            </Link>
          </Button>

          <Button variant="outline" asChild className="h-auto py-4 justify-start">
            <Link to="/breach-alerts-report">
              <AlertTriangle className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Breach Alerts</div>
                <div className="text-xs text-muted-foreground">Active violations</div>
              </div>
            </Link>
          </Button>

          <Button variant="outline" asChild className="h-auto py-4 justify-start">
            <Link to="/patrol-management">
              <Navigation className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Patrol Management</div>
                <div className="text-xs text-muted-foreground">Schedule and assign</div>
              </div>
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  // Render Drill-Down Detail View
  const renderDetailView = () => {
    const viewTitles: Record<string, { title: string; icon: any; color: string }> = {
      'breach-detail': { title: 'Breach Details', icon: AlertTriangle, color: 'text-red-600' },
      'overstay-detail': { title: 'Overstay Details', icon: Clock, color: 'text-orange-600' },
      'homeless-detail': { title: 'Homeless Details', icon: Home, color: 'text-purple-600' },
      'at-risk-detail': { title: 'At-Risk Details', icon: Zap, color: 'text-yellow-600' },
    };

    const viewConfig = viewTitles[currentView as keyof typeof viewTitles];
    if (!viewConfig) return null;

    const Icon = viewConfig.icon;

    return (
      <div className="space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Icon className={cn('h-6 w-6', viewConfig.color)} />
              <div>
                <CardTitle>{viewConfig.title}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {observations?.length || 0} record{observations?.length !== 1 ? 's' : ''} found
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Records List */}
        {obsLoading ? (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-muted-foreground">Loading records...</p>
              </div>
            </CardContent>
          </Card>
        ) : !observations || observations.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No records found for {format(selectedDate, 'dd MMM yyyy')}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {observations.map((obs) => (
              <Card key={obs.id}>
                <div className="flex flex-col md:flex-row">
                  {/* Photo */}
                  <div className="md:w-48 h-32 md:h-auto bg-muted flex-shrink-0">
                    <img
                      src={obs.photo_url}
                      alt={obs.plate_number}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Details */}
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-mono font-bold">{obs.plate_number}</h3>
                          {!obs.is_compliant && (
                            <Badge variant="destructive">BREACH</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {[obs.vehicle_color, obs.vehicle_make, obs.vehicle_model]
                            .filter(Boolean)
                            .join(' ')}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <div className="font-semibold">
                          {format(new Date(obs.recorded_at), 'HH:mm')}
                        </div>
                        <div className="text-muted-foreground">{obs.zone_name}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs">Officer</div>
                        <div className="font-semibold">{obs.officer_name}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Nights (Month)</div>
                        <div className="font-semibold">{obs.nights_stayed_this_month}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Consecutive</div>
                        <div className="font-semibold">{obs.consecutive_nights}</div>
                      </div>
                    </div>

                    {obs.breach_reason && (
                      <div className="mt-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded p-2 text-sm">
                        <div className="font-semibold text-red-900 dark:text-red-100">
                          {obs.breach_type || 'Breach'}
                        </div>
                        <div className="text-red-800 dark:text-red-200">{obs.breach_reason}</div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Render Heat Map View
  const renderHeatMap = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Zone Activity Heat Map
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!heatMapData || heatMapData.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No zone activity for {format(selectedDate, 'dd MMM yyyy')}
            </div>
          ) : (
            <div className="space-y-3">
              {heatMapData.map((zone: any) => (
                <div key={zone.zone_id} className="flex items-center gap-3 p-3 rounded-lg border">
                  <div className="flex-1">
                    <div className="font-semibold">{zone.zone_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {zone.observation_count} observations • {zone.breach_count} breaches
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <div className="text-sm font-semibold">
                        {Math.round(zone.compliance_rate)}%
                      </div>
                      <div className="text-xs text-muted-foreground">Compliant</div>
                    </div>
                    <div
                      className={cn(
                        'w-16 h-8 rounded',
                        zone.compliance_rate >= 90
                          ? 'bg-green-600'
                          : zone.compliance_rate >= 70
                          ? 'bg-yellow-600'
                          : 'bg-red-600'
                      )}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  // Render Welfare View
  const renderWelfare = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-red-600" />
            Officer Welfare Monitoring
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              {stats?.welfare_alerts || 0} active welfare alert{stats?.welfare_alerts !== 1 ? 's' : ''}
            </p>
            <Button asChild>
              <Link to="/officer-welfare-alerts">View Welfare Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // Render Analytics View
  const renderAnalytics = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Analytics & Reports</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Button variant="outline" asChild className="h-auto py-4 justify-start">
            <Link to="/observations-report">
              <FileText className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Observations Report</div>
                <div className="text-xs text-muted-foreground">All field records</div>
              </div>
            </Link>
          </Button>

          <Button variant="outline" asChild className="h-auto py-4 justify-start">
            <Link to="/zone-management">
              <MapPinned className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Zone Management</div>
                <div className="text-xs text-muted-foreground">Zone configuration</div>
              </div>
            </Link>
          </Button>

          <Button variant="outline" asChild className="h-auto py-4 justify-start">
            <Link to="/vehicle-management">
              <CarFront className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Vehicle Registry</div>
                <div className="text-xs text-muted-foreground">All vehicles</div>
              </div>
            </Link>
          </Button>

          <Button variant="outline" asChild className="h-auto py-4 justify-start">
            <Link to="/compliance-analytics">
              <BarChart3 className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Compliance Analytics</div>
                <div className="text-xs text-muted-foreground">Trend analysis</div>
              </div>
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  // Render Maintenance View
  const renderMaintenance = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Maintenance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Recalculations */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-semibold flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Compliance Recalculation
                </div>
                <div className="text-sm text-muted-foreground">
                  Rebuild compliance results for all observations
                </div>
              </div>
              <Button variant="outline" asChild>
                <Link to="/compliance-recalculation">Run</Link>
              </Button>
            </div>
          </div>

          {/* Zone Corrections */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  Zone Corrections
                </div>
                <div className="text-sm text-muted-foreground">
                  Fix GPS-zone mismatches
                </div>
              </div>
              <Button variant="outline" asChild>
                <Link to="/zone-corrections">Run</Link>
              </Button>
            </div>
          </div>

          {/* Duplicate Detection */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-semibold flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Duplicate Detection
                </div>
                <div className="text-sm text-muted-foreground">
                  Find and merge duplicate records
                </div>
              </div>
              <Button variant="outline" asChild>
                <Link to="/data-integrity-check">Run</Link>
              </Button>
            </div>
          </div>

          {/* Data Integrity Check */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Full Integrity Scan
                </div>
                <div className="text-sm text-muted-foreground">
                  Comprehensive database health check
                </div>
              </div>
              <Button variant="outline" asChild>
                <Link to="/database-diagnostic">Run</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Admin Command Center</h1>
            <p className="text-muted-foreground mt-1">
              Compliance & Enforcement Management
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/historical-import">
              <Download className="h-4 w-4 mr-2" />
              Import Data
            </Link>
          </Button>
        </div>

        {/* Breadcrumb Navigation */}
        {breadcrumbs.length > 1 && (
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {breadcrumbs.map((crumb, index) => (
                    <div key={index} className="flex items-center gap-2">
                      {index > 0 && <span>/</span>}
                      <span className={index === breadcrumbs.length - 1 ? 'font-semibold text-foreground' : ''}>
                        {crumb.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Date Navigation Controls */}
        <Card>
          <CardContent className="py-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              {/* Quick Date Buttons */}
              <div className="md:col-span-5 flex gap-2">
                <Button variant="outline" size="sm" onClick={goToToday}>
                  <Calendar className="h-4 w-4 mr-2" />
                  Today
                </Button>
                <Button variant="outline" size="sm" onClick={goToYesterday}>
                  Yesterday
                </Button>
                <Button variant="outline" size="sm" onClick={goToPreviousDay}>
                  <ChevronLeft className="h-4 w-4" />
                  Prev Day
                </Button>
                <Button variant="outline" size="sm" onClick={goToNextDay}>
                  Next Day
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Date Picker */}
              <div className="md:col-span-3">
                <Label className="text-xs text-muted-foreground mb-1 block">Selected Date</Label>
                <Input
                  type="date"
                  value={dateInput}
                  onChange={(e) => handleDateInputChange(e.target.value)}
                  className="w-full"
                />
              </div>

              {/* Filters */}
              <div className="md:col-span-4 grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Zone (Optional)</Label>
                  <Select value={selectedZoneId || 'all'} onValueChange={(val) => setSelectedZoneId(val === 'all' ? '' : val)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All Zones" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Zones</SelectItem>
                      {/* Add zones from useZones hook if needed */}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Quick View</Label>
                  <Select value={currentView} onValueChange={(val) => setCurrentView(val as ViewMode)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dashboard">Dashboard</SelectItem>
                      <SelectItem value="heatmap">Heat Map</SelectItem>
                      <SelectItem value="welfare">Welfare</SelectItem>
                      <SelectItem value="analytics">Analytics</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading State */}
        {statsLoading && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-muted-foreground">Loading data...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Content Based on View */}
        {!statsLoading && (
          <>
            {currentView === 'dashboard' && renderDashboard()}
            {['breach-detail', 'overstay-detail', 'homeless-detail', 'at-risk-detail'].includes(currentView) && renderDetailView()}
            {currentView === 'heatmap' && renderHeatMap()}
            {currentView === 'welfare' && renderWelfare()}
            {currentView === 'analytics' && renderAnalytics()}
            {currentView === 'maintenance' && renderMaintenance()}
          </>
        )}
      </div>
    </div>
  );
}
