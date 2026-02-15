/**
 * ORGANIZATION OVERVIEW - BI-STYLE LANDING PAGE
 * 
 * UPDATED: Now uses NEW compliance architecture (Feb 2025)
 * - Primary source: compliance_results table (authoritative compliance)
 * - Breach data: breach_alerts table (enforcement queue)
 * - Synced fields: vehicle_observations_v2.is_breach (auto-synced)
 * - Vehicle details: canonical_vehicles (master data)
 * 
 * Features:
 * - Real-time compliance from compliance_results
 * - Active breach counts from breach_alerts
 * - Homeless data from canonical_vehicles
 * - Zone performance breakdown
 * - Compliance trend charts
 * - Export to CSV/PDF
 * - Universal filters (organization + zone)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  MapPin,
  Car,
  AlertTriangle,
  CheckCircle2,
  Shield,
  FileText,
  Download,
  RefreshCw,
  Loader2,
  ChevronRight,
  Activity,
  Home,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

  useEffect(() => {
    loadDashboardData();
  }, [dateRange, selectedOrganization, selectedZone, user?.organization_id]);

  const loadDashboardData = async () => {
    setIsLoading(true);

    try {
      console.log('📊 Loading organization overview (using canonical_vehicles)...');

      const daysAgo = parseInt(dateRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = new Date().toISOString().split('T')[0];

      // Determine organization filter
      let orgId: string | null = null;
      if (user?.role === 'master' && selectedOrganization !== 'all') {
        orgId = selectedOrganization;
      } else if (user?.role !== 'master' && user?.organization_id) {
        orgId = user.organization_id;
      }

      // Load observations with compliance_results (NEW architecture)
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          plate_number,
          zone_id,
          recorded_at,
          is_breach,
          zones!inner(id, name),
          canonical_vehicles!inner(
            homeless_status,
            is_flagged
          ),
          compliance_results(
            is_compliant,
            violation_reasons
          )
        `)
        .gte('recorded_at', `${startDateStr}T00:00:00`)
        .lte('recorded_at', `${endDateStr}T23:59:59`);

      if (orgId) {
        obsQuery = obsQuery.eq('organization_id', orgId);
      }
      
      if (selectedZone !== 'all') {
        obsQuery = obsQuery.eq('zone_id', selectedZone);
      }

      const { data: observations, error: obsError } = await obsQuery;
      if (obsError) throw obsError;

      const obs = observations || [];
      console.log(`✅ Loaded ${obs.length} observations with compliance data`);

      // Calculate KPIs from compliance_results (authoritative source)
      const uniquePlates = new Set(obs.map(o => o.plate_number));
      const uniqueVehicles = uniquePlates.size;

      // Count breaches from is_breach field (synced from compliance_results)
      const breachedObservations = obs.filter(o => o.is_breach === true);
      const totalBreaches = breachedObservations.length;

      // Compliance rate: vehicles WITHOUT breaches
      const complianceRate = uniqueVehicles > 0 
        ? Math.round(((uniqueVehicles - totalBreaches) / uniqueVehicles) * 100) 
        : 100;

      // Homeless vehicles
      const homelessPlates = new Set(
        obs.filter(o => {
          const vehicle = o.canonical_vehicles as any;
          const status = vehicle?.homeless_status;
          return status === 'confirmed' || status === 'claimed';
        }).map(o => o.plate_number)
      );

      // Flagged vehicles
      const flaggedPlates = new Set(
        obs.filter(o => {
          const vehicle = o.canonical_vehicles as any;
          return vehicle?.is_flagged === true;
        }).map(o => o.plate_number)
      );

      console.log('📊 KPI Summary (NEW Compliance Architecture):');
      console.log('  - Observations:', obs.length);
      console.log('  - Unique Vehicles:', uniqueVehicles);
      console.log('  - Total Breaches:', totalBreaches);
      console.log('  - Compliance Rate:', complianceRate + '%');
      console.log('  - Homeless:', homelessPlates.size);
      console.log('  - Flagged:', flaggedPlates.size);

      // Load ACTIVE breach alerts count (enforcement queue)
      let breachQuery = supabase
        .from('breach_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .gte('created_at', `${startDateStr}T00:00:00`)
        .lte('created_at', `${endDateStr}T23:59:59`);

      if (orgId) breachQuery = breachQuery.eq('organization_id', orgId);
      if (selectedZone !== 'all') breachQuery = breachQuery.eq('zone_id', selectedZone);

      const { count: activeBreachCount } = await breachQuery;

      // Load enforcement actions count
      let enfQuery = supabase
        .from('enforcement_actions')
        .select('id', { count: 'exact', head: true })
        .gte('recorded_at', `${startDateStr}T00:00:00`)
        .lte('recorded_at', `${endDateStr}T23:59:59`);

      if (orgId) enfQuery = enfQuery.eq('organization_id', orgId);
      if (selectedZone !== 'all') enfQuery = enfQuery.eq('zone_id', selectedZone);

      const { count: enfCount } = await enfQuery;

      const kpiData: KPIMetric[] = [
        {
          label: 'Total Observations',
          value: obs.length,
          change: 0,
          trend: 'stable',
          icon: Activity,
          color: 'blue',
        },
        {
          label: 'Compliance Rate',
          value: complianceRate,
          change: 0,
          trend: complianceRate >= 80 ? 'up' : 'down',
          icon: CheckCircle2,
          color: 'green',
        },
        {
          label: 'Active Breaches',
          value: activeBreachCount || 0,
          change: 0,
          trend: activeBreachCount && activeBreachCount > 0 ? 'up' : 'stable',
          icon: AlertTriangle,
          color: 'red',
        },
        {
          label: 'Unique Vehicles',
          value: uniqueVehicles,
          change: 0,
          trend: 'stable',
          icon: Car,
          color: 'purple',
        },
        {
          label: 'Homeless Vehicles',
          value: homelessPlates.size,
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
        plates: Set<string>;
        breachCount: number;
        homelessPlates: Set<string>;
        lastActivity: string;
      }>();

      obs.forEach(o => {
        if (!zoneMap.has(o.zone_id)) {
          zoneMap.set(o.zone_id, {
            name: (o.zones as any)?.name || 'Unknown',
            observations: 0,
            plates: new Set(),
            breachCount: 0,
            homelessPlates: new Set(),
            lastActivity: o.recorded_at,
          });
        }

        const zone = zoneMap.get(o.zone_id)!;
        zone.observations++;
        zone.plates.add(o.plate_number);

        // Count breaches from is_breach field (synced from compliance_results)
        if (o.is_breach === true) {
          zone.breachCount++;
        }

        const vehicle = o.canonical_vehicles as any;
        if (vehicle) {
          const status = vehicle.homeless_status;
          if (status === 'confirmed' || status === 'claimed') {
            zone.homelessPlates.add(o.plate_number);
          }
        }

        if (o.recorded_at > zone.lastActivity) {
          zone.lastActivity = o.recorded_at;
        }
      });

      const zoneCards: ZoneCard[] = Array.from(zoneMap.entries())
        .map(([id, stats]) => {
          const breachCount = stats.breachCount;
          const totalObservations = stats.observations;
          const complianceRate = totalObservations > 0 
            ? Math.round(((totalObservations - breachCount) / totalObservations) * 100) 
            : 100;

          return {
            zone_id: id,
            zone_name: stats.name,
            total_observations: stats.observations,
            compliance_rate: complianceRate,
            breach_count: breachCount,
            unique_vehicles: stats.plates.size,
            homeless_count: stats.homelessPlates.size,
            trend: 'stable' as const,
            last_activity: stats.lastActivity,
          };
        })
        .sort((a, b) => b.total_observations - a.total_observations);

      setZones(zoneCards);

      // Compliance Trend (daily) - using is_breach field
      const dailyMap = new Map<string, { 
        observations: number;
        breaches: number;
      }>();

      obs.forEach(o => {
        const date = o.recorded_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { observations: 0, breaches: 0 });
        }

        const day = dailyMap.get(date)!;
        day.observations++;

        if (o.is_breach === true) {
          day.breaches++;
        }
      });

      const trendData = Array.from(dailyMap.entries())
        .map(([date, stats]) => {
          const totalObs = stats.observations;
          const breachCount = stats.breaches;
          const complianceRate = totalObs > 0 
            ? Math.round(((totalObs - breachCount) / totalObs) * 100) 
            : 100;

          return {
            date,
            compliance: complianceRate,
            vehicles: totalObs,
            breaches: breachCount,
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      setComplianceTrend(trendData);

      console.log('✅ Dashboard data loaded successfully');
    } catch (error: any) {
      console.error('❌ Failed to load dashboard:', error);
      toast.error('Failed to load dashboard data: ' + error.message);
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
    <div className="space-y-4 md:space-y-6 p-3 md:p-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 md:gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2 md:gap-3 text-gray-900 dark:text-white">
            <LayoutDashboard className="h-6 w-6 md:h-8 md:w-8 text-blue-600" />
            <span className="hidden sm:inline">Organization Overview</span>
            <span className="sm:hidden">Dashboard</span>
          </h1>
          <p className="text-sm md:text-base text-gray-700 dark:text-gray-200 mt-1 font-semibold">
            Executive dashboard with BI-style reporting
          </p>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as '7' | '30' | '90')}>
            <SelectTrigger className="w-24 md:w-32 text-xs md:text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 Days</SelectItem>
              <SelectItem value="30">30 Days</SelectItem>
              <SelectItem value="90">90 Days</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={loadDashboardData} variant="outline" size="sm" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>

          <Button onClick={handleExportCSV} variant="outline" size="sm" className="hidden sm:flex">
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>

          <Button onClick={handleExportPDF} variant="outline" size="sm" className="hidden sm:flex">
            <FileText className="h-4 w-4 mr-2" />
            PDF
          </Button>
          
          {/* Mobile Export */}
          <Button onClick={handleExportCSV} variant="outline" size="sm" className="sm:hidden">
            <Download className="h-4 w-4" />
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-4">
            {kpis.map((kpi, index) => {
              const Icon = kpi.icon;
              const TrendIcon = kpi.trend === 'up' ? ArrowUpRight : kpi.trend === 'down' ? ArrowDownRight : Minus;

              return (
                <Card key={index} className={`border-2 border-${kpi.color}-500/30 bg-gradient-to-br from-${kpi.color}-50 to-${kpi.color}-100 dark:from-${kpi.color}-950/40 dark:to-${kpi.color}-900/40`}>
                  <CardContent className="p-3 md:p-4">
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
                    <div className={`text-[10px] md:text-xs text-${kpi.color}-700 dark:text-${kpi.color}-300 font-medium mb-1 line-clamp-2`}>
                      {kpi.label}
                    </div>
                    <div className={`text-xl md:text-3xl font-black text-${kpi.color}-600`}>
                      {kpi.label.includes('Rate') ? `${kpi.value}%` : kpi.value.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Compliance Trend Chart */}
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

          {/* Zone Performance Grid */}
          <Card className="border-2">
            <CardHeader className="p-4 md:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <CardTitle className="text-base md:text-lg text-gray-900 dark:text-white flex items-center gap-2">
                  <MapPin className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                  <span className="hidden sm:inline">Zone Performance ({filteredZones.length})</span>
                  <span className="sm:hidden">Zones ({filteredZones.length})</span>
                </CardTitle>

                <Select value={selectedZoneFilter} onValueChange={(v) => setSelectedZoneFilter(v as 'all' | 'high' | 'medium' | 'low')}>
                  <SelectTrigger className="w-full sm:w-48 text-xs md:text-sm">
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
            <CardContent className="p-3 md:p-6">
              <ScrollArea className="h-[500px] md:h-[600px]">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 pr-2 md:pr-4">
                  {filteredZones.map((zone, index) => {
                    const performance = getPerformanceBadge(zone.compliance_rate);

                    return (
                      <Card
                        key={zone.zone_id}
                        className="border-2 hover:shadow-lg transition-all cursor-pointer group active:scale-[0.98]"
                        onClick={() => onZoneDrillDown?.(zone.zone_id, zone.zone_name)}
                      >
                        <CardContent className="p-3 md:p-4">
                          <div className="flex items-start justify-between mb-2 md:mb-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 md:gap-2 mb-2">
                                <div className="h-6 w-6 md:h-8 md:w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                                  <span className="text-xs md:text-sm font-black text-blue-600">#{index + 1}</span>
                                </div>
                                <h3 className="text-sm md:text-base font-bold text-gray-900 dark:text-white truncate" title={zone.zone_name}>
                                  {zone.zone_name}
                                </h3>
                              </div>
                              <Badge variant={performance.variant} className="text-xs md:text-sm font-semibold">
                                {performance.label} - {zone.compliance_rate}%
                              </Badge>
                            </div>
                            <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all" />
                          </div>

                          <div className="grid grid-cols-2 gap-2 md:gap-3 mb-2 md:mb-3">
                            <div className="p-1.5 md:p-2 bg-gray-50 dark:bg-gray-900/30 rounded">
                              <div className="text-[10px] md:text-xs text-gray-600 dark:text-gray-300 font-medium">Observations</div>
                              <div className="text-base md:text-xl font-black text-gray-900 dark:text-white">{zone.total_observations.toLocaleString()}</div>
                            </div>
                            <div className="p-1.5 md:p-2 bg-gray-50 dark:bg-gray-900/30 rounded">
                              <div className="text-[10px] md:text-xs text-gray-600 dark:text-gray-300 font-medium">Vehicles</div>
                              <div className="text-base md:text-xl font-black text-gray-900 dark:text-white">{zone.unique_vehicles}</div>
                            </div>
                            <div className="p-1.5 md:p-2 bg-red-50 dark:bg-red-950/20 rounded">
                              <div className="text-[10px] md:text-xs text-red-700 dark:text-red-300 font-medium">Breaches</div>
                              <div className="text-base md:text-xl font-black text-red-600">{zone.breach_count}</div>
                            </div>
                            {zone.homeless_count > 0 && (
                              <div className="p-1.5 md:p-2 bg-cyan-50 dark:bg-cyan-950/20 rounded">
                                <div className="text-[10px] md:text-xs text-cyan-700 dark:text-cyan-300 font-medium flex items-center gap-1">
                                  <Home className="h-3 w-3" />
                                  <span className="hidden sm:inline">Homeless</span>
                                  <span className="sm:hidden">FC</span>
                                </div>
                                <div className="text-base md:text-xl font-black text-cyan-600">{zone.homeless_count}</div>
                              </div>
                            )}
                          </div>

                          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${performance.color}`}
                              style={{ width: `${zone.compliance_rate}%` }}
                            />
                          </div>

                          <div className="mt-2 md:mt-3 text-[10px] md:text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1">
                            <Calendar className="h-3 w-3 shrink-0" />
                            <span className="truncate">Last: {format(new Date(zone.last_activity), 'dd MMM HH:mm')}</span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
