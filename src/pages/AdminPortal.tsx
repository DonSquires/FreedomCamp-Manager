/**
 * Admin Portal - Modern BI Dashboard
 * 
 * Clean rebuild focusing on actionable insights:
 * - Executive KPIs
 * - Live operations monitoring
 * - Zone heat map
 * - Officer welfare tracking
 * - Patrol analytics
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { Link } from 'react-router-dom';

interface DashboardStats {
  observations_today: number;
  observations_yesterday: number;
  active_breaches: number;
  active_officers: number;
  pending_patrols: number;
  welfare_alerts: number;
  zones_with_activity: number;
  compliance_rate: number;
}

interface RecentActivity {
  id: string;
  type: 'observation' | 'breach' | 'patrol' | 'welfare';
  title: string;
  description: string;
  timestamp: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

interface ZoneHeatData {
  zone_id: string;
  zone_name: string;
  observation_count: number;
  breach_count: number;
  compliance_rate: number;
}

interface OfficerStatus {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'welfare_alert';
  current_patrol?: string;
  last_activity: string;
  gps_latitude?: number;
  gps_longitude?: number;
}

export function AdminPortal() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dateRange, setDateRange] = useState(7); // days

  // Dashboard Stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin-stats', dateRange],
    queryFn: async () => {
      const now = new Date();
      const startDate = startOfDay(subDays(now, dateRange));
      const endDate = endOfDay(now);

      // Observations today
      const { count: obsToday } = await supabase
        .from('observations')
        .select('*', { count: 'exact', head: true })
        .gte('recorded_at', startOfDay(now).toISOString())
        .lte('recorded_at', endOfDay(now).toISOString());

      // Observations yesterday
      const { count: obsYesterday } = await supabase
        .from('observations')
        .select('*', { count: 'exact', head: true })
        .gte('recorded_at', startOfDay(subDays(now, 1)).toISOString())
        .lte('recorded_at', endOfDay(subDays(now, 1)).toISOString());

      // Active breaches
      const { count: activeBreaches } = await supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // Active officers (last 4 hours)
      const { count: activeOfficers } = await supabase
        .from('officer_activity_log')
        .select('user_id', { count: 'exact', head: true })
        .gte('recorded_at', subDays(now, 0.17).toISOString());

      // Pending patrols
      const { count: pendingPatrols } = await supabase
        .from('patrols')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'scheduled');

      // Welfare alerts
      const { count: welfareAlerts } = await supabase
        .from('officer_welfare_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      // Zones with activity (last 7 days)
      const { count: activeZones } = await supabase
        .from('observations')
        .select('zone_id', { count: 'exact', head: true })
        .gte('recorded_at', startDate.toISOString());

      // Compliance rate
      const { data: complianceData } = await supabase
        .from('observations')
        .select('is_compliant')
        .gte('recorded_at', startDate.toISOString());

      const complianceRate = complianceData
        ? (complianceData.filter(o => o.is_compliant).length / complianceData.length) * 100
        : 0;

      return {
        observations_today: obsToday || 0,
        observations_yesterday: obsYesterday || 0,
        active_breaches: activeBreaches || 0,
        active_officers: activeOfficers || 0,
        pending_patrols: pendingPatrols || 0,
        welfare_alerts: welfareAlerts || 0,
        zones_with_activity: activeZones || 0,
        compliance_rate: Math.round(complianceRate),
      } as DashboardStats;
    },
  });

  // Recent Activity
  const { data: recentActivity } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: async () => {
      const activities: RecentActivity[] = [];

      // Recent breaches
      const { data: breaches } = await supabase
        .from('breach_alerts')
        .select('id, plate_number, breach_type, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5);

      breaches?.forEach(b => {
        activities.push({
          id: b.id,
          type: 'breach',
          title: `Breach Alert - ${b.plate_number}`,
          description: b.breach_type || 'Compliance violation',
          timestamp: b.created_at,
          severity: 'high',
        });
      });

      // Recent welfare alerts
      const { data: welfare } = await supabase
        .from('officer_welfare_alerts')
        .select('id, officer_name, alert_type, alert_sent_at')
        .eq('status', 'pending')
        .order('alert_sent_at', { ascending: false })
        .limit(3);

      welfare?.forEach(w => {
        activities.push({
          id: w.id,
          type: 'welfare',
          title: `Welfare Alert - ${w.officer_name}`,
          description: w.alert_type,
          timestamp: w.alert_sent_at,
          severity: 'critical',
        });
      });

      // Recent patrols
      const { data: patrols } = await supabase
        .from('patrols')
        .select(`
          id,
          patrol_date,
          shift,
          status,
          zone:zones(name)
        `)
        .in('status', ['active', 'completed'])
        .order('patrol_date', { ascending: false })
        .limit(5);

      patrols?.forEach((p: any) => {
        activities.push({
          id: p.id,
          type: 'patrol',
          title: `Patrol ${p.status} - ${p.zone?.name || 'Unknown Zone'}`,
          description: `${format(new Date(p.patrol_date), 'dd MMM')} ${p.shift}`,
          timestamp: p.patrol_date,
          severity: 'low',
        });
      });

      // Sort by timestamp
      return activities.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    },
  });

  // Zone Heat Map Data
  const { data: zoneHeatMap } = useQuery({
    queryKey: ['zone-heatmap', dateRange],
    queryFn: async () => {
      const startDate = startOfDay(subDays(new Date(), dateRange));

      const { data } = await supabase
        .from('observations')
        .select(`
          zone_id,
          is_compliant,
          zone:zones(name)
        `)
        .gte('recorded_at', startDate.toISOString());

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
      })) as ZoneHeatData[];
    },
  });

  // Officer Status
  const { data: officerStatus } = useQuery({
    queryKey: ['officer-status'],
    queryFn: async () => {
      const fourHoursAgo = subDays(new Date(), 0.17).toISOString();

      const { data: officers } = await supabase
        .from('user_profiles')
        .select(`
          id,
          first_name,
          last_name,
          patrols:patrols!patrols_assigned_to_fkey(id, status, zone:zones(name)),
          activity:officer_activity_log(recorded_at, gps_latitude, gps_longitude)
        `)
        .in('role', ['officer', 'admin_officer'])
        .order('first_name');

      if (!officers) return [];

      // Check welfare alerts
      const { data: welfareAlerts } = await supabase
        .from('officer_welfare_alerts')
        .select('officer_id')
        .eq('status', 'pending');

      const welfareOfficerIds = new Set(welfareAlerts?.map(a => a.officer_id) || []);

      return officers.map((officer: any) => {
        const recentActivity = officer.activity?.[0];
        const activePatrol = officer.patrols?.find((p: any) => p.status === 'active');

        return {
          id: officer.id,
          name: `${officer.first_name} ${officer.last_name}`,
          status: welfareOfficerIds.has(officer.id)
            ? 'welfare_alert'
            : activePatrol
            ? 'active'
            : 'inactive',
          current_patrol: activePatrol?.zone?.name,
          last_activity: recentActivity?.recorded_at || '',
          gps_latitude: recentActivity?.gps_latitude,
          gps_longitude: recentActivity?.gps_longitude,
        } as OfficerStatus;
      });
    },
  });

  const getTrendIcon = (current: number, previous: number) => {
    if (current > previous) return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (current < previous) return <TrendingUp className="h-4 w-4 text-red-600 rotate-180" />;
    return <Activity className="h-4 w-4 text-muted-foreground" />;
  };

  const getSeverityColor = (severity?: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  if (statsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Admin Command Center</h1>
            <p className="text-muted-foreground mt-1">
              Real-time operations monitoring and analytics
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/historical-import">
                <Calendar className="h-4 w-4 mr-2" />
                Import Data
              </Link>
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="dashboard">
              <BarChart3 className="h-4 w-4 mr-2" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="live">
              <Radio className="h-4 w-4 mr-2" />
              Live Ops
            </TabsTrigger>
            <TabsTrigger value="heatmap">
              <MapPin className="h-4 w-4 mr-2" />
              Heat Map
            </TabsTrigger>
            <TabsTrigger value="welfare">
              <Heart className="h-4 w-4 mr-2" />
              Welfare
            </TabsTrigger>
            <TabsTrigger value="analytics">
              <Activity className="h-4 w-4 mr-2" />
              Analytics
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {/* Observations Today */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Observations Today</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.observations_today || 0}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    {getTrendIcon(
                      stats?.observations_today || 0,
                      stats?.observations_yesterday || 0
                    )}
                    <span>
                      {stats?.observations_yesterday
                        ? `${Math.abs(
                            stats.observations_today - stats.observations_yesterday
                          )} vs yesterday`
                        : 'No comparison'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Active Breaches */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Breaches</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">
                    {stats?.active_breaches || 0}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Require attention</p>
                </CardContent>
              </Card>

              {/* Active Officers */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active Officers</CardTitle>
                  <Users className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600">
                    {stats?.active_officers || 0}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stats?.welfare_alerts || 0} welfare alerts
                  </p>
                </CardContent>
              </Card>

              {/* Compliance Rate */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Compliance Rate</CardTitle>
                  <Shield className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {stats?.compliance_rate || 0}%
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Last {dateRange} days</p>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentActivity?.slice(0, 10).map((activity) => (
                    <div key={activity.id} className="flex items-start gap-3 p-3 rounded-lg border">
                      <div
                        className={`flex-shrink-0 w-2 h-2 mt-2 rounded-full ${
                          activity.severity === 'critical'
                            ? 'bg-red-600'
                            : activity.severity === 'high'
                            ? 'bg-orange-600'
                            : activity.severity === 'medium'
                            ? 'bg-yellow-600'
                            : 'bg-blue-600'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{activity.title}</div>
                        <div className="text-sm text-muted-foreground">
                          {activity.description}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground flex-shrink-0">
                        {format(new Date(activity.timestamp), 'HH:mm')}
                      </div>
                    </div>
                  ))}

                  {(!recentActivity || recentActivity.length === 0) && (
                    <div className="text-center text-muted-foreground py-8">
                      No recent activity
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Live Operations Tab */}
          <TabsContent value="live" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Active Officers */}
              <Card>
                <CardHeader>
                  <CardTitle>Active Officers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {officerStatus
                      ?.filter(o => o.status === 'active')
                      .map((officer) => (
                        <div
                          key={officer.id}
                          className="flex items-center justify-between p-3 rounded-lg border"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
                            <div>
                              <div className="font-semibold text-sm">{officer.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {officer.current_patrol || 'No active patrol'}
                              </div>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            <Radio className="h-3 w-3 mr-1" />
                            Live
                          </Badge>
                        </div>
                      ))}

                    {officerStatus?.filter(o => o.status === 'active').length === 0 && (
                      <div className="text-center text-muted-foreground py-8">
                        No active officers
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Pending Patrols */}
              <Card>
                <CardHeader>
                  <CardTitle>Pending Patrols</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center text-muted-foreground py-8">
                    {stats?.pending_patrols || 0} patrols scheduled
                  </div>
                  <Button className="w-full" asChild>
                    <Link to="/patrol-management">View All Patrols</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Heat Map Tab */}
          <TabsContent value="heatmap" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Zone Activity Heat Map</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {zoneHeatMap
                    ?.sort((a, b) => b.observation_count - a.observation_count)
                    .map((zone) => (
                      <div
                        key={zone.zone_id}
                        className="flex items-center gap-3 p-3 rounded-lg border"
                      >
                        <div className="flex-1">
                          <div className="font-semibold text-sm">{zone.zone_name}</div>
                          <div className="text-xs text-muted-foreground">
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
                            className={`w-16 h-8 rounded ${
                              zone.compliance_rate >= 90
                                ? 'bg-green-600'
                                : zone.compliance_rate >= 70
                                ? 'bg-yellow-600'
                                : 'bg-red-600'
                            }`}
                          />
                        </div>
                      </div>
                    ))}

                  {(!zoneHeatMap || zoneHeatMap.length === 0) && (
                    <div className="text-center text-muted-foreground py-8">
                      No zone activity data
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Welfare Tab */}
          <TabsContent value="welfare" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Heart className="h-5 w-5 text-red-600" />
                  Officer Welfare Monitoring
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Welfare Alerts */}
                  {officerStatus
                    ?.filter(o => o.status === 'welfare_alert')
                    .map((officer) => (
                      <div
                        key={officer.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-red-300 bg-red-50"
                      >
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="h-5 w-5 text-red-600" />
                          <div>
                            <div className="font-semibold text-sm">{officer.name}</div>
                            <div className="text-xs text-muted-foreground">
                              Last activity:{' '}
                              {officer.last_activity
                                ? format(new Date(officer.last_activity), 'HH:mm')
                                : 'Unknown'}
                            </div>
                          </div>
                        </div>
                        <Button size="sm" variant="destructive" asChild>
                          <Link to="/officer-welfare-alerts">Respond</Link>
                        </Button>
                      </div>
                    ))}

                  {/* All Officers Status */}
                  <div className="grid gap-3 md:grid-cols-2 mt-6">
                    {officerStatus?.map((officer) => (
                      <div
                        key={officer.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border ${
                          officer.status === 'active'
                            ? 'border-green-300 bg-green-50'
                            : 'border-gray-300 bg-gray-50'
                        }`}
                      >
                        <div
                          className={`w-3 h-3 rounded-full ${
                            officer.status === 'active'
                              ? 'bg-green-600 animate-pulse'
                              : 'bg-gray-400'
                          }`}
                        />
                        <div className="flex-1">
                          <div className="font-semibold text-sm">{officer.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {officer.current_patrol || 'Off duty'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {(!officerStatus || officerStatus.length === 0) && (
                    <div className="text-center text-muted-foreground py-8">
                      No officer status data
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Quick Reports</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <Button variant="outline" asChild className="h-auto py-4">
                    <Link to="/observations-report">
                      <div className="text-left w-full">
                        <div className="font-semibold">Observations Report</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Field evidence records
                        </div>
                      </div>
                    </Link>
                  </Button>

                  <Button variant="outline" asChild className="h-auto py-4">
                    <Link to="/breach-alerts-report">
                      <div className="text-left w-full">
                        <div className="font-semibold">Breach Alerts</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Active compliance issues
                        </div>
                      </div>
                    </Link>
                  </Button>

                  <Button variant="outline" asChild className="h-auto py-4">
                    <Link to="/patrol-management">
                      <div className="text-left w-full">
                        <div className="font-semibold">Patrol Analytics</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Coverage and completion
                        </div>
                      </div>
                    </Link>
                  </Button>

                  <Button variant="outline" asChild className="h-auto py-4">
                    <Link to="/zone-management">
                      <div className="text-left w-full">
                        <div className="font-semibold">Zone Performance</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Activity and compliance
                        </div>
                      </div>
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
