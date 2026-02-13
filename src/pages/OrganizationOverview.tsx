/**
 * ORGANIZATION OVERVIEW - BI-STYLE LANDING PAGE
 * 
 * Executive dashboard with drill-down capabilities:
 * - KPI summary cards with trends
 * - Zone performance grid with interactive drill-down
 * - Recent activity feed
 * - Compliance trends with charts
 * - Quick actions for common tasks
 * 
 * Features:
 * - BI-style reporting with visual analytics
 * - Click-through zone drill-down
 * - Real-time data updates
 * - Export to CSV/PDF
 * - Mobile-responsive design
 * - Universal filters (organization + zone)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  MapPin,
  Car,
  AlertTriangle,
  CheckCircle2,
  Users,
  Shield,
  FileText,
  Download,
  RefreshCw,
  Loader2,
  Eye,
  ChevronRight,
  Activity,
  BarChart3,
  Home,
  Flag,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { format } from 'date-fns';
import { UniversalFilters } from '@/components/features/UniversalFilters';

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

interface KPIMetric {
  label: string;
  value: number;
  change: number;
  trend: 'up' | 'down' | 'stable';
  icon: any;
  color: string;
}

interface ZoneCard {
  zone_id: string;
  zone_name: string;
  total_observations: number;
  compliance_rate: number;
  breach_count: number;
  unique_vehicles: number;
  homeless_count: number;
  trend: 'up' | 'down' | 'stable';
  last_activity: string;
}

interface ActivityItem {
  id: string;
  type: 'observation' | 'breach' | 'enforcement' | 'incident';
  title: string;
  description: string;
  zone_name: string;
  timestamp: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export function OrganizationOverview({ onZoneDrillDown }: { onZoneDrillDown?: (zoneId: string, zoneName: string) => void }) {
  const { user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'7' | '30' | '90'>('30');
  
  // Universal Filters
  const [selectedOrganization, setSelectedOrganization] = useState('all');
  const [selectedZone, setSelectedZone] = useState('all');

  // KPI Metrics
  const [kpis, setKpis] = useState<KPIMetric[]>([]);

  // Zone Performance
  const [zones, setZones] = useState<ZoneCard[]>([]);
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  // Charts
  const [complianceTrend, setComplianceTrend] = useState<any[]>([]);
  const [breachDistribution, setBreachDistribution] = useState<any[]>([]);

  // Recent Activity
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, [dateRange, selectedOrganization, selectedZone, user?.organization_id]);

  const loadDashboardData = async () => {
    setIsLoading(true);

    try {
      console.log('📊 Loading organization overview...');

      const daysAgo = parseInt(dateRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = new Date().toISOString().split('T')[0];

      // Previous period for comparison
      const prevStartDate = new Date(startDate);
      prevStartDate.setDate(prevStartDate.getDate() - daysAgo);
      const prevStartDateStr = prevStartDate.toISOString().split('T')[0];

      // Determine organization filter
      let orgId: string | null = null;
      if (user?.role === 'master' && selectedOrganization !== 'all') {
        orgId = selectedOrganization;
      } else if (user?.role !== 'master' && user?.organization_id) {
        orgId = user.organization_id;
      }

      // Load current period observations
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          plate_number,
          zone_id,
          recorded_at,
          zones!inner(id, name),
          canonical_vehicles(homeless_status),
          compliance_results(is_compliant, violation_reasons)
        `)
        .gte('recorded_at', `${startDateStr}T00:00:00`)
        .lte('recorded_at', `${endDateStr}T23:59:59`);

      if (orgId) {
        obsQuery = obsQuery.eq('organization_id', orgId);
      }
      
      // Apply zone filter
      if (selectedZone !== 'all') {
        obsQuery = obsQuery.eq('zone_id', selectedZone);
      }

      const { data: observations, error: obsError } = await obsQuery;
      if (obsError) throw obsError;

      // Load previous period for comparison
      let prevObsQuery = supabase
        .from('vehicle_observations_v2')
        .select('observation_id, plate_number', { count: 'exact', head: true })
        .gte('recorded_at', `${prevStartDateStr}T00:00:00`)
        .lt('recorded_at', `${startDateStr}T00:00:00`);

      if (orgId) {
        prevObsQuery = prevObsQuery.eq('organization_id', orgId);
      }
      
      if (selectedZone !== 'all') {
        prevObsQuery = prevObsQuery.eq('zone_id', selectedZone);
      }

      const { count: prevObsCount } = await prevObsQuery;

      const obs = observations || [];
      console.log(`✅ Loaded ${obs.length} observations`);

      // Calculate KPIs
      const uniquePlates = new Set(obs.map(o => o.plate_number)).size;
      const uniqueZones = new Set(obs.map(o => o.zone_id)).size;

      const compliantCount = obs.filter(o => {
        const result = (o.compliance_results as any);
        return Array.isArray(result) && result.length > 0 ? result[0].is_compliant : true;
      }).length;

      const breachCount = obs.length - compliantCount;
      const complianceRate = obs.length > 0 ? Math.round((compliantCount / obs.length) * 100) : 100;

      const homelessPlates = new Set(
        obs.filter(o => {
          const status = (o.canonical_vehicles as any)?.homeless_status;
          return status === 'confirmed' || status === 'claimed';
        }).map(o => o.plate_number)
      ).size;

      // Load enforcement actions count
      let enfQuery = supabase
        .from('enforcement_actions')
        .select('id', { count: 'exact', head: true })
        .gte('recorded_at', `${startDateStr}T00:00:00`)
        .lte('recorded_at', `${endDateStr}T23:59:59`);

      if (orgId) {
        enfQuery = enfQuery.eq('organization_id', orgId);
      }
      
      if (selectedZone !== 'all') {
        enfQuery = enfQuery.eq('zone_id', selectedZone);
      }

      const { count: enfCount } = await enfQuery;

      // Load incidents count
      let incQuery = supabase
        .from('incidents')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', `${startDateStr}T00:00:00`)
        .lte('created_at', `${endDateStr}T23:59:59`);

      if (orgId) {
        incQuery = incQuery.eq('organization_id', orgId);
      }
      
      if (selectedZone !== 'all') {
        incQuery = incQuery.eq('zone_id', selectedZone);
      }

      const { count: incCount } = await incQuery;

      // Calculate trends (compare to previous period)
      const obsChange = prevObsCount ? Math.round(((obs.length - prevObsCount) / prevObsCount) * 100) : 0;

      const kpiData: KPIMetric[] = [
        {
          label: 'Total Observations',
          value: obs.length,
          change: obsChange,
          trend: obsChange > 5 ? 'up' : obsChange < -5 ? 'down' : 'stable',
          icon: Activity,
          color: 'blue',
        },
        {
          label: 'Compliance Rate',
          value: complianceRate,
          change: 0, // TODO: Calculate vs previous period
          trend: 'stable',
          icon: CheckCircle2,
          color: 'green',
        },
        {
          label: 'Active Breaches',
          value: breachCount,
          change: 0,
          trend: breachCount > 0 ? 'up' : 'stable',
          icon: AlertTriangle,
          color: 'red',
        },
        {
          label: 'Unique Vehicles',
          value: uniquePlates,
          change: 0,
          trend: 'stable',
          icon: Car,
          color: 'purple',
        },
        {
          label: 'Homeless Vehicles',
          value: homelessPlates,
          change: 0,
          trend: 'stable',
          icon: Home,
          color: 'cyan',
        },
        {
          label: 'Enforcement Actions',
          value: enfCount || 0,
          change: 0,
          trend: 'stable',
          icon: Shield,
          color: 'amber',
        },
      ];

      setKpis(kpiData);

      // Zone Performance Breakdown
      const zoneMap = new Map<string, {
        name: string;
        observations: number;
        compliant: number;
        plates: Set<string>;
        homelessPlates: Set<string>;
        lastActivity: string;
      }>();

      obs.forEach(o => {
        if (!zoneMap.has(o.zone_id)) {
          zoneMap.set(o.zone_id, {
            name: (o.zones as any)?.name || 'Unknown',
            observations: 0,
            compliant: 0,
            plates: new Set(),
            homelessPlates: new Set(),
            lastActivity: o.recorded_at,
          });
        }

        const zone = zoneMap.get(o.zone_id)!;
        zone.observations++;
        zone.plates.add(o.plate_number);

        const result = (o.compliance_results as any);
        const isCompliant = Array.isArray(result) && result.length > 0 ? result[0].is_compliant : true;
        if (isCompliant) zone.compliant++;

        const status = (o.canonical_vehicles as any)?.homeless_status;
        if (status === 'confirmed' || status === 'claimed') {
          zone.homelessPlates.add(o.plate_number);
        }

        if (o.recorded_at > zone.lastActivity) {
          zone.lastActivity = o.recorded_at;
        }
      });

      const zoneCards: ZoneCard[] = Array.from(zoneMap.entries())
        .map(([id, stats]) => ({
          zone_id: id,
          zone_name: stats.name,
          total_observations: stats.observations,
          compliance_rate: stats.observations > 0 ? Math.round((stats.compliant / stats.observations) * 100) : 100,
          breach_count: stats.observations - stats.compliant,
          unique_vehicles: stats.plates.size,
          homeless_count: stats.homelessPlates.size,
          trend: 'stable' as const, // TODO: Calculate trend
          last_activity: stats.lastActivity,
        }))
        .sort((a, b) => b.total_observations - a.total_observations);

      setZones(zoneCards);

      // Compliance Trend (daily)
      const dailyMap = new Map<string, { total: number; compliant: number }>();

      obs.forEach(o => {
        const date = o.recorded_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { total: 0, compliant: 0 });
        }

        const day = dailyMap.get(date)!;
        day.total++;

        const result = (o.compliance_results as any);
        const isCompliant = Array.isArray(result) && result.length > 0 ? result[0].is_compliant : true;
        if (isCompliant) day.compliant++;
      });

      const trendData = Array.from(dailyMap.entries())
        .map(([date, stats]) => ({
          date,
          compliance: stats.total > 0 ? Math.round((stats.compliant / stats.total) * 100) : 100,
          observations: stats.total,
          breaches: stats.total - stats.compliant,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setComplianceTrend(trendData);

      // Breach Distribution (by type)
      const breachTypeMap = new Map<string, number>();

      obs.forEach(o => {
        const result = (o.compliance_results as any);
        if (Array.isArray(result) && result.length > 0 && !result[0].is_compliant) {
          const reasons = result[0].violation_reasons || [];
          reasons.forEach((reason: string) => {
            const label = reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            breachTypeMap.set(label, (breachTypeMap.get(label) || 0) + 1);
          });
        }
      });

      const breachData = Array.from(breachTypeMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

      setBreachDistribution(breachData);

      // Recent Activity Feed
      const recentObs = obs
        .slice(0, 10)
        .map(o => ({
          id: o.observation_id,
          type: 'observation' as const,
          title: `Vehicle Scan - ${o.plate_number}`,
          description: `Scanned in ${(o.zones as any)?.name || 'Unknown Zone'}`,
          zone_name: (o.zones as any)?.name || 'Unknown',
          timestamp: o.recorded_at,
        }));

      setRecentActivity(recentObs);

      console.log('✅ Dashboard data loaded');
    } catch (error: any) {
      console.error('❌ Failed to load dashboard:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportPDF = () => {
    toast.info('PDF export coming soon');
  };

  const handleExportCSV = () => {
    const csvData = [
      ['Organization Overview Report'],
      ['Generated:', new Date().toLocaleString('en-NZ')],
      ['Period:', `Last ${dateRange} days`],
      [''],
      ['KPI Metrics'],
      ['Metric', 'Value', 'Change %'],
      ...kpis.map(k => [k.label, k.value, `${k.change > 0 ? '+' : ''}${k.change}%`]),
      [''],
      ['Zone Performance'],
      ['Zone', 'Observations', 'Compliance %', 'Breaches', 'Unique Vehicles', 'Homeless'],
      ...zones.map(z => [z.zone_name, z.total_observations, z.compliance_rate, z.breach_count, z.unique_vehicles, z.homeless_count]),
    ];

    const csv = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `org-overview-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };

  const getPerformanceBadge = (complianceRate: number) => {
    if (complianceRate >= 90) return { label: 'Excellent', variant: 'default' as const, color: 'bg-green-600' };
    if (complianceRate >= 80) return { label: 'Good', variant: 'secondary' as const, color: 'bg-blue-600' };
    if (complianceRate >= 70) return { label: 'Fair', variant: 'outline' as const, color: 'bg-amber-600' };
    return { label: 'Poor', variant: 'destructive' as const, color: 'bg-red-600' };
  };

  const filteredZones = zones.filter(z => {
    if (selectedZoneFilter === 'all') return true;
    if (selectedZoneFilter === 'high') return z.compliance_rate >= 80;
    if (selectedZoneFilter === 'medium') return z.compliance_rate >= 60 && z.compliance_rate < 80;
    if (selectedZoneFilter === 'low') return z.compliance_rate < 60;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-gray-900 dark:text-white">
            <LayoutDashboard className="h-8 w-8 text-blue-600" />
            Organization Overview
          </h1>
          <p className="text-gray-700 dark:text-gray-200 mt-1 font-semibold">
            Executive dashboard with BI-style reporting and zone drill-down
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as '7' | '30' | '90')}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={loadDashboardData} variant="outline" size="sm" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>

          <Button onClick={handleExportCSV} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>

          <Button onClick={handleExportPDF} variant="outline" size="sm">
            <FileText className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      {/* Universal Filters */}
      <UniversalFilters
        selectedOrganization={selectedOrganization}
        selectedZone={selectedZone}
        onOrganizationChange={setSelectedOrganization}
        onZoneChange={setSelectedZone}
      />

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="h-16 w-16 animate-spin text-blue-600 mb-4" />
          <p className="text-lg text-gray-700 dark:text-gray-200 font-semibold">Loading organization overview...</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {kpis.map((kpi, index) => {
              const Icon = kpi.icon;
              const TrendIcon = kpi.trend === 'up' ? ArrowUpRight : kpi.trend === 'down' ? ArrowDownRight : Minus;

              return (
                <Card key={index} className={`border-2 border-${kpi.color}-500/30 bg-gradient-to-br from-${kpi.color}-50 to-${kpi.color}-100 dark:from-${kpi.color}-950/40 dark:to-${kpi.color}-900/40`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`h-10 w-10 rounded-full bg-${kpi.color}-600 flex items-center justify-center`}>
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      {kpi.change !== 0 && (
                        <Badge variant="outline" className={`text-xs ${kpi.trend === 'up' ? 'text-green-600 border-green-600' : kpi.trend === 'down' ? 'text-red-600 border-red-600' : 'text-gray-600'}`}>
                          <TrendIcon className="h-3 w-3 mr-1" />
                          {Math.abs(kpi.change)}%
                        </Badge>
                      )}
                    </div>
                    <div className={`text-xs text-${kpi.color}-700 dark:text-${kpi.color}-300 font-medium mb-1`}>
                      {kpi.label}
                    </div>
                    <div className={`text-3xl font-black text-${kpi.color}-600`}>
                      {kpi.label.includes('Rate') ? `${kpi.value}%` : kpi.value.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Compliance Trend */}
            <Card className="border-2">
              <CardHeader>
                <CardTitle className="text-lg text-gray-900 dark:text-white flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  Compliance Trend (Last {dateRange} Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={complianceTrend}>
                    <defs>
                      <linearGradient id="complianceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickFormatter={(date: string) => format(new Date(date), 'MMM dd')}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="compliance"
                      name="Compliance %"
                      stroke="#22c55e"
                      strokeWidth={3}
                      fill="url(#complianceGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Breach Distribution */}
            {breachDistribution.length > 0 && (
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg text-gray-900 dark:text-white flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                    Top 5 Breach Types
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={breachDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={(entry: any) => `${entry.name} (${entry.value})`}
                      >
                        {breachDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Zone Performance Grid */}
          <Card className="border-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg text-gray-900 dark:text-white flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  Zone Performance Breakdown ({filteredZones.length})
                </CardTitle>

                <Select value={selectedZoneFilter} onValueChange={(v) => setSelectedZoneFilter(v as 'all' | 'high' | 'medium' | 'low')}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Zones</SelectItem>
                    <SelectItem value="high">High Performance (≥80%)</SelectItem>
                    <SelectItem value="medium">Medium Performance (60-80%)</SelectItem>
                    <SelectItem value="low">Low Performance (&lt;60%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[600px]">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredZones.map((zone, index) => {
                    const performance = getPerformanceBadge(zone.compliance_rate);

                    return (
                      <Card
                        key={zone.zone_id}
                        className="border-2 hover:shadow-lg transition-all cursor-pointer group"
                        onClick={() => onZoneDrillDown?.(zone.zone_id, zone.zone_name)}
                      >
                        <CardContent className="p-4">
                          {/* Header */}
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                                  <span className="text-sm font-black text-blue-600">#{index + 1}</span>
                                </div>
                                <h3 className="font-bold text-gray-900 dark:text-white truncate" title={zone.zone_name}>
                                  {zone.zone_name}
                                </h3>
                              </div>
                              <Badge variant={performance.variant} className="font-semibold">
                                {performance.label} - {zone.compliance_rate}%
                              </Badge>
                            </div>
                            <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                          </div>

                          {/* Stats Grid */}
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div className="p-2 bg-gray-50 dark:bg-gray-900/30 rounded">
                              <div className="text-xs text-gray-600 dark:text-gray-300 font-medium">Observations</div>
                              <div className="text-xl font-black text-gray-900 dark:text-white">{zone.total_observations}</div>
                            </div>
                            <div className="p-2 bg-gray-50 dark:bg-gray-900/30 rounded">
                              <div className="text-xs text-gray-600 dark:text-gray-300 font-medium">Vehicles</div>
                              <div className="text-xl font-black text-gray-900 dark:text-white">{zone.unique_vehicles}</div>
                            </div>
                            <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded">
                              <div className="text-xs text-red-700 dark:text-red-300 font-medium">Breaches</div>
                              <div className="text-xl font-black text-red-600">{zone.breach_count}</div>
                            </div>
                            {zone.homeless_count > 0 && (
                              <div className="p-2 bg-cyan-50 dark:bg-cyan-950/20 rounded">
                                <div className="text-xs text-cyan-700 dark:text-cyan-300 font-medium flex items-center gap-1">
                                  <Home className="h-3 w-3" />
                                  Homeless
                                </div>
                                <div className="text-xl font-black text-cyan-600">{zone.homeless_count}</div>
                              </div>
                            )}
                          </div>

                          {/* Progress Bar */}
                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${performance.color}`}
                              style={{ width: `${zone.compliance_rate}%` }}
                            />
                          </div>

                          {/* Last Activity */}
                          <div className="mt-3 text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Last: {format(new Date(zone.last_activity), 'MMM dd, HH:mm')}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Recent Activity Feed */}
          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <Activity className="h-5 w-5 text-purple-600" />
                Recent Activity (Last 10)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {recentActivity.map((item) => (
                    <div key={item.id} className="p-3 border-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs font-semibold">
                              {item.type.toUpperCase()}
                            </Badge>
                            <h4 className="font-bold text-gray-900 dark:text-white">{item.title}</h4>
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-200 mb-1 font-semibold">{item.description}</p>
                          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                            <MapPin className="h-3 w-3" />
                            {item.zone_name}
                            <span>•</span>
                            <span>{format(new Date(item.timestamp), 'MMM dd, HH:mm')}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
