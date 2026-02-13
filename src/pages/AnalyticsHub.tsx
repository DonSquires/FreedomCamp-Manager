/**
 * ANALYTICS HUB - COMPLETE REBUILD
 * Unified analytics dashboard with proper data loading and state management
 * 
 * Features:
 * - Compliance trends with homeless tracking
 * - Zone performance comparison
 * - Officer activity leaderboards
 * - Unified filters and exports
 * - Real-time data refresh
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  TrendingUp,
  TrendingDown,
  Users,
  MapPin,
  Filter,
  Download,
  RefreshCw,
  Loader2,
  BarChart3,
  Home,
  CheckCircle2,
  AlertTriangle,
  Car,
  FileText,
  Calendar,
  Award,
  Activity,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
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
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';

const COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];

interface AnalyticsData {
  // Overall metrics
  totalObservations: number;
  complianceRate: number;
  uniqueVehicles: number;
  uniqueZones: number;
  totalBreaches: number;
  homelessVehicles: number;
  homelessPercentage: number;
  
  // Trend data (time series)
  dailyTrends: Array<{
    date: string;
    observations: number;
    complianceRate: number;
    breaches: number;
    homelessCount: number;
  }>;
  
  // Zone performance
  zoneStats: Array<{
    zoneId: string;
    zoneName: string;
    observations: number;
    compliance: number;
    breaches: number;
    uniqueVehicles: number;
    homelessCount: number;
  }>;
  
  // Officer activity
  officerStats: Array<{
    officerId: string;
    officerName: string;
    scans: number;
    breachesDetected: number;
    complianceRate: number;
    zones: number;
  }>;
  
  // Breach breakdown
  breachTypes: Array<{
    type: string;
    count: number;
    percentage: number;
  }>;
}

export function AnalyticsHub() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [activeTab, setActiveTab] = useState<'overview' | 'zones' | 'officers' | 'breaches'>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const [data, setData] = useState<AnalyticsData | null>(null);

  // Filters
  const [selectedOrg, setSelectedOrg] = useState<string>('all');
  const [availableOrgs, setAvailableOrgs] = useState<Array<{ id: string; name: string }>>([]);
  
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (isMaster) {
      loadOrganizations();
    }
  }, [isMaster]);

  useEffect(() => {
    loadAnalytics();
  }, [startDate, endDate, selectedOrg]);

  const loadOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setAvailableOrgs(data || []);
    } catch (error: any) {
      console.error('Failed to load organizations:', error);
    }
  };

  const loadAnalytics = async () => {
    if (isRefreshing) return;
    
    setIsLoading(true);
    
    try {
      console.log('📊 Loading analytics data...');

      // Determine organization filter
      let orgFilter: string | null = null;
      if (isMaster && selectedOrg !== 'all') {
        orgFilter = selectedOrg;
      } else if (!isMaster && user?.organization_id) {
        orgFilter = user.organization_id;
      }

      // Build base observation query
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          plate_number,
          zone_id,
          recorded_by,
          recorded_at,
          organization_id,
          zones!inner(id, name),
          canonical_vehicles(homeless_status),
          compliance_results(is_compliant, violation_reasons)
        `)
        .gte('recorded_at', `${startDate}T00:00:00`)
        .lte('recorded_at', `${endDate}T23:59:59`)
        .order('recorded_at', { ascending: true });

      if (orgFilter) {
        obsQuery = obsQuery.eq('organization_id', orgFilter);
      }

      const { data: observations, error: obsError } = await obsQuery;

      if (obsError) throw obsError;

      const obs = observations || [];
      console.log(`✅ Loaded ${obs.length} observations`);

      if (obs.length === 0) {
        setData({
          totalObservations: 0,
          complianceRate: 100,
          uniqueVehicles: 0,
          uniqueZones: 0,
          totalBreaches: 0,
          homelessVehicles: 0,
          homelessPercentage: 0,
          dailyTrends: [],
          zoneStats: [],
          officerStats: [],
          breachTypes: [],
        });
        setIsLoading(false);
        return;
      }

      // Calculate overall metrics
      const uniquePlates = new Set(obs.map(o => o.plate_number));
      const uniqueZoneIds = new Set(obs.map(o => o.zone_id));
      
      const homelessPlates = new Set(
        obs.filter(o => {
          const status = (o.canonical_vehicles as any)?.homeless_status;
          return status === 'confirmed' || status === 'claimed';
        }).map(o => o.plate_number)
      );

      const complianceResults = obs.map(o => {
        const result = (o.compliance_results as any);
        return Array.isArray(result) && result.length > 0 ? result[0].is_compliant : true;
      });

      const compliantCount = complianceResults.filter(c => c === true).length;
      const breachCount = complianceResults.filter(c => c === false).length;

      // Daily trends
      const dailyMap = new Map<string, {
        observations: number;
        compliant: number;
        breaches: number;
        homelessPlates: Set<string>;
      }>();

      obs.forEach(o => {
        const date = o.recorded_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, {
            observations: 0,
            compliant: 0,
            breaches: 0,
            homelessPlates: new Set(),
          });
        }

        const day = dailyMap.get(date)!;
        day.observations++;

        const result = (o.compliance_results as any);
        const isCompliant = Array.isArray(result) && result.length > 0 ? result[0].is_compliant : true;
        
        if (isCompliant) {
          day.compliant++;
        } else {
          day.breaches++;
        }

        const status = (o.canonical_vehicles as any)?.homeless_status;
        if (status === 'confirmed' || status === 'claimed') {
          day.homelessPlates.add(o.plate_number);
        }
      });

      const dailyTrends = Array.from(dailyMap.entries())
        .map(([date, stats]) => ({
          date,
          observations: stats.observations,
          complianceRate: stats.observations > 0 ? Math.round((stats.compliant / stats.observations) * 100) : 100,
          breaches: stats.breaches,
          homelessCount: stats.homelessPlates.size,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Zone statistics
      const zoneMap = new Map<string, {
        name: string;
        observations: number;
        compliant: number;
        plates: Set<string>;
        homelessPlates: Set<string>;
      }>();

      obs.forEach(o => {
        if (!zoneMap.has(o.zone_id)) {
          zoneMap.set(o.zone_id, {
            name: (o.zones as any)?.name || 'Unknown',
            observations: 0,
            compliant: 0,
            plates: new Set(),
            homelessPlates: new Set(),
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
      });

      const zoneStats = Array.from(zoneMap.entries())
        .map(([id, stats]) => ({
          zoneId: id,
          zoneName: stats.name,
          observations: stats.observations,
          compliance: stats.observations > 0 ? Math.round((stats.compliant / stats.observations) * 100) : 100,
          breaches: stats.observations - stats.compliant,
          uniqueVehicles: stats.plates.size,
          homelessCount: stats.homelessPlates.size,
        }))
        .sort((a, b) => b.observations - a.observations);

      // Officer statistics
      const officerMap = new Map<string, {
        scans: number;
        breaches: number;
        zones: Set<string>;
      }>();

      obs.forEach(o => {
        if (!o.recorded_by) return;
        
        if (!officerMap.has(o.recorded_by)) {
          officerMap.set(o.recorded_by, {
            scans: 0,
            breaches: 0,
            zones: new Set(),
          });
        }

        const officer = officerMap.get(o.recorded_by)!;
        officer.scans++;
        officer.zones.add(o.zone_id);

        const result = (o.compliance_results as any);
        const isCompliant = Array.isArray(result) && result.length > 0 ? result[0].is_compliant : true;
        if (!isCompliant) officer.breaches++;
      });

      // Get officer names
      const { data: officers } = await supabase
        .from('user_profiles')
        .select('id, first_name, last_name')
        .in('id', Array.from(officerMap.keys()));

      const officerStats = Array.from(officerMap.entries())
        .map(([id, stats]) => {
          const profile = (officers || []).find(o => o.id === id);
          return {
            officerId: id,
            officerName: profile ? `${profile.first_name} ${profile.last_name}` : 'Unknown',
            scans: stats.scans,
            breachesDetected: stats.breaches,
            complianceRate: stats.scans > 0 ? Math.round(((stats.scans - stats.breaches) / stats.scans) * 100) : 100,
            zones: stats.zones.size,
          };
        })
        .sort((a, b) => b.scans - a.scans);

      // Breach type breakdown
      const breachTypeMap = new Map<string, number>();

      obs.forEach(o => {
        const result = (o.compliance_results as any);
        if (Array.isArray(result) && result.length > 0 && !result[0].is_compliant) {
          const reasons = result[0].violation_reasons || [];
          reasons.forEach((reason: string) => {
            breachTypeMap.set(reason, (breachTypeMap.get(reason) || 0) + 1);
          });
        }
      });

      const breachTypes = Array.from(breachTypeMap.entries())
        .map(([type, count]) => ({
          type: type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          count,
          percentage: breachCount > 0 ? Math.round((count / breachCount) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);

      // Set all data
      setData({
        totalObservations: obs.length,
        complianceRate: obs.length > 0 ? Math.round((compliantCount / obs.length) * 100) : 100,
        uniqueVehicles: uniquePlates.size,
        uniqueZones: uniqueZoneIds.size,
        totalBreaches: breachCount,
        homelessVehicles: homelessPlates.size,
        homelessPercentage: uniquePlates.size > 0 ? Math.round((homelessPlates.size / uniquePlates.size) * 100) : 0,
        dailyTrends,
        zoneStats,
        officerStats,
        breachTypes,
      });

      console.log('✅ Analytics loaded successfully');

    } catch (error: any) {
      console.error('❌ Failed to load analytics:', error);
      toast.error('Failed to load analytics: ' + error.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadAnalytics();
  };

  const handleExportCSV = () => {
    if (!data) {
      toast.error('No data to export');
      return;
    }

    const csvRows = [
      ['Analytics Report'],
      ['Generated:', new Date().toLocaleString('en-NZ')],
      ['Period:', `${startDate} to ${endDate}`],
      [''],
      ['Overall Metrics'],
      ['Total Observations', data.totalObservations],
      ['Compliance Rate', `${data.complianceRate}%`],
      ['Unique Vehicles', data.uniqueVehicles],
      ['Total Breaches', data.totalBreaches],
      ['Homeless Vehicles', `${data.homelessVehicles} (${data.homelessPercentage}%)`],
      [''],
      ['Top Zones'],
      ['Zone', 'Observations', 'Compliance Rate', 'Breaches'],
      ...data.zoneStats.slice(0, 10).map(z => [z.zoneName, z.observations, `${z.compliance}%`, z.breaches]),
      [''],
      ['Top Officers'],
      ['Officer', 'Scans', 'Breaches Detected', 'Compliance Rate'],
      ...data.officerStats.slice(0, 10).map(o => [o.officerName, o.scans, o.breachesDetected, `${o.complianceRate}%`]),
    ];

    const csv = csvRows.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Analytics exported successfully');
  };

  const daysDiff = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-gray-900 dark:text-white">
            <BarChart3 className="h-8 w-8 text-blue-600" />
            Analytics Hub
          </h1>
          <p className="text-gray-700 dark:text-gray-200 mt-1 font-semibold">
            Comprehensive reporting: compliance trends, zones, officers, and breach analytics
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm" disabled={isLoading || isRefreshing}>
            {isLoading || isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
          <Button onClick={handleExportCSV} variant="outline" size="sm" disabled={!data}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-2 border-blue-500/30 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-gray-900 dark:text-white">
            <Filter className="h-4 w-4" />
            Universal Filters (Apply to All Views)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {isMaster && availableOrgs.length > 0 && (
              <div className="space-y-2">
                <Label className="font-semibold text-gray-900 dark:text-white">Organization</Label>
                <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                  <SelectTrigger className="border-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Organizations</SelectItem>
                    {availableOrgs.map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label className="font-semibold text-gray-900 dark:text-white">Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border-2" />
            </div>
            <div className="space-y-2">
              <Label className="font-semibold text-gray-900 dark:text-white">End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border-2" />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 font-semibold">
            <Calendar className="h-4 w-4" />
            <span>
              Analyzing {daysDiff} days ({new Date(startDate).toLocaleDateString('en-NZ')} to {new Date(endDate).toLocaleDateString('en-NZ')})
              {selectedOrg !== 'all' && ` for ${availableOrgs.find(o => o.id === selectedOrg)?.name || 'selected org'}`}
            </span>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="h-16 w-16 animate-spin text-blue-600 mb-4" />
          <p className="text-lg text-gray-700 dark:text-gray-200 font-semibold">Loading analytics data...</p>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 font-medium">This may take a moment for large datasets</p>
        </div>
      ) : !data || data.totalObservations === 0 ? (
        <Card className="border-2">
          <CardContent className="text-center py-24">
            <BarChart3 className="h-20 w-20 mx-auto mb-4 text-gray-400 dark:text-gray-500" />
            <h3 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">No Data Available</h3>
            <p className="text-gray-700 dark:text-gray-200 font-semibold">
              No observations found for the selected date range.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 font-medium">
              Try adjusting your filters or selecting a different time period.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <Card className="border-2 border-blue-500/30 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/40">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-blue-700 dark:text-blue-300">Observations</div>
                  <Activity className="h-5 w-5 text-blue-600" />
                </div>
                <div className="text-3xl font-black text-blue-600">{data.totalObservations}</div>
                <div className="text-xs text-blue-600/80 mt-1 font-medium">
                  {Math.round(data.totalObservations / daysDiff)} avg/day
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/40">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-green-700 dark:text-green-300">Compliance</div>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div className="text-3xl font-black text-green-600">{data.complianceRate}%</div>
                <div className="text-xs text-green-600/80 mt-1 font-medium">
                  {data.totalObservations - data.totalBreaches} compliant
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-red-500/30 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/40 dark:to-red-900/40">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-red-700 dark:text-red-300">Breaches</div>
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <div className="text-3xl font-black text-red-600">{data.totalBreaches}</div>
                <div className="text-xs text-red-600/80 mt-1 font-medium">
                  {100 - data.complianceRate}% breach rate
                </div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-300">Vehicles</div>
                  <Car className="h-5 w-5 text-purple-600" />
                </div>
                <div className="text-3xl font-black text-purple-600">{data.uniqueVehicles}</div>
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 font-medium">
                  Unique plates
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-950/40 dark:to-cyan-900/40">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-cyan-700 dark:text-cyan-300">Homeless</div>
                  <Home className="h-5 w-5 text-cyan-600" />
                </div>
                <div className="text-3xl font-black text-cyan-600">{data.homelessVehicles}</div>
                <div className="text-xs text-cyan-600/80 mt-1 font-medium">
                  {data.homelessPercentage}% of vehicles
                </div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-300">Zones</div>
                  <MapPin className="h-5 w-5 text-amber-600" />
                </div>
                <div className="text-3xl font-black text-amber-600">{data.uniqueZones}</div>
                <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 font-medium">
                  Active zones
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList className="grid w-full grid-cols-4 h-auto">
              <TabsTrigger value="overview" className="flex items-center gap-2 py-3">
                <TrendingUp className="h-4 w-4" />
                <span className="hidden md:inline">Overview</span>
                <span className="md:hidden">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="zones" className="flex items-center gap-2 py-3">
                <MapPin className="h-4 w-4" />
                <span className="hidden md:inline">Zones ({data.zoneStats.length})</span>
                <span className="md:hidden">Zones</span>
              </TabsTrigger>
              <TabsTrigger value="officers" className="flex items-center gap-2 py-3">
                <Users className="h-4 w-4" />
                <span className="hidden md:inline">Officers ({data.officerStats.length})</span>
                <span className="md:hidden">Officers</span>
              </TabsTrigger>
              <TabsTrigger value="breaches" className="flex items-center gap-2 py-3">
                <AlertTriangle className="h-4 w-4" />
                <span className="hidden md:inline">Breaches ({data.totalBreaches})</span>
                <span className="md:hidden">Breaches</span>
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="mt-6 space-y-6">
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg text-gray-900 dark:text-white">Daily Compliance Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={data.dailyTrends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickFormatter={(date) => new Date(date).toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' })}
                      />
                      <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} label={{ value: 'Compliance %', angle: -90, position: 'insideLeft' }} />
                      <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" fontSize={12} label={{ value: 'Count', angle: 90, position: 'insideRight' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="complianceRate"
                        name="Compliance Rate (%)"
                        stroke="#22c55e"
                        strokeWidth={3}
                        dot={{ r: 4 }}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="observations"
                        name="Observations"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="breaches"
                        name="Breaches"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {data.breachTypes.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="border-2">
                    <CardHeader>
                      <CardTitle className="text-lg text-gray-900 dark:text-white">Breach Type Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={data.breachTypes}
                            dataKey="count"
                            nameKey="type"
                            cx="50%"
                            cy="50%"
                            outerRadius={100}
                            label={(entry) => `${entry.type} (${entry.percentage}%)`}
                          >
                            {data.breachTypes.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <Card className="border-2">
                    <CardHeader>
                      <CardTitle className="text-lg text-gray-900 dark:text-white">Top Breach Types</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[300px]">
                        <div className="space-y-3">
                          {data.breachTypes.map((breach, index) => (
                            <div key={breach.type} className="flex items-center justify-between p-3 border-2 rounded-lg">
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-4 h-4 rounded-full shrink-0"
                                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                />
                                <span className="font-bold text-gray-900 dark:text-white">{breach.type}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">{breach.count} incidents</span>
                                <Badge variant="outline" className="font-semibold">{breach.percentage}%</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            {/* Zones Tab */}
            <TabsContent value="zones" className="mt-6 space-y-6">
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg text-gray-900 dark:text-white">Top 10 Zones by Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={data.zoneStats.slice(0, 10)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="zoneName"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        angle={-45}
                        textAnchor="end"
                        height={100}
                      />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="observations" name="Observations" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="breaches" name="Breaches" fill="#ef4444" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg text-gray-900 dark:text-white">All Zones ({data.zoneStats.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-3">
                      {data.zoneStats.map((zone, index) => (
                        <div key={zone.zoneId} className="p-4 border-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 font-black">
                                #{index + 1}
                              </div>
                              <div>
                                <h4 className="font-bold text-gray-900 dark:text-white">{zone.zoneName}</h4>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant={zone.compliance >= 80 ? 'default' : 'destructive'} className="font-semibold">
                                    {zone.compliance}% Compliance
                                  </Badge>
                                  {zone.homelessCount > 0 && (
                                    <Badge variant="secondary" className="font-semibold bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
                                      <Home className="h-3 w-3 mr-1" />
                                      {zone.homelessCount} Homeless
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-gray-600 dark:text-gray-300 text-xs font-medium mb-1">Observations</div>
                              <div className="font-black text-lg text-gray-900 dark:text-white">{zone.observations}</div>
                            </div>
                            <div>
                              <div className="text-gray-600 dark:text-gray-300 text-xs font-medium mb-1">Unique Vehicles</div>
                              <div className="font-black text-lg text-gray-900 dark:text-white">{zone.uniqueVehicles}</div>
                            </div>
                            <div>
                              <div className="text-gray-600 dark:text-gray-300 text-xs font-medium mb-1">Breaches</div>
                              <div className="font-black text-lg text-red-600">{zone.breaches}</div>
                            </div>
                            <div>
                              <div className="text-gray-600 dark:text-gray-300 text-xs font-medium mb-1">Avg/Day</div>
                              <div className="font-black text-lg text-gray-900 dark:text-white">{Math.round(zone.observations / daysDiff)}</div>
                            </div>
                          </div>

                          <div className="mt-3 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 dark:bg-green-600"
                              style={{ width: `${zone.compliance}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Officers Tab */}
            <TabsContent value="officers" className="mt-6 space-y-6">
              <Card className="border-2">
                <CardHeader>
                  <CardTitle className="text-lg text-gray-900 dark:text-white">Officer Leaderboard ({data.officerStats.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[600px]">
                    <div className="space-y-3">
                      {data.officerStats.map((officer, index) => (
                        <div
                          key={officer.officerId}
                          className={`p-4 border-2 rounded-lg transition-colors ${
                            index === 0
                              ? 'border-amber-500 bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-900/30'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex items-center justify-center w-10 h-10 rounded-full font-black text-lg ${
                                  index === 0
                                    ? 'bg-amber-500 text-white'
                                    : index === 1
                                    ? 'bg-gray-400 text-white'
                                    : index === 2
                                    ? 'bg-orange-500 text-white'
                                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600'
                                }`}
                              >
                                {index === 0 ? (
                                  <Award className="h-5 w-5" />
                                ) : (
                                  `#${index + 1}`
                                )}
                              </div>
                              <div>
                                <h4 className="font-bold text-gray-900 dark:text-white">{officer.officerName}</h4>
                                <Badge variant="outline" className="mt-1 font-semibold">
                                  {officer.complianceRate}% Compliance
                                </Badge>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-gray-600 dark:text-gray-300 text-xs font-medium mb-1">Total Scans</div>
                              <div className="font-black text-lg text-blue-600">{officer.scans}</div>
                            </div>
                            <div>
                              <div className="text-gray-600 dark:text-gray-300 text-xs font-medium mb-1">Breaches Found</div>
                              <div className="font-black text-lg text-red-600">{officer.breachesDetected}</div>
                            </div>
                            <div>
                              <div className="text-gray-600 dark:text-gray-300 text-xs font-medium mb-1">Zones Covered</div>
                              <div className="font-black text-lg text-purple-600">{officer.zones}</div>
                            </div>
                            <div>
                              <div className="text-gray-600 dark:text-gray-300 text-xs font-medium mb-1">Avg/Day</div>
                              <div className="font-black text-lg text-gray-900 dark:text-white">{Math.round(officer.scans / daysDiff)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Breaches Tab */}
            <TabsContent value="breaches" className="mt-6 space-y-6">
              {data.breachTypes.length === 0 ? (
                <Card className="border-2">
                  <CardContent className="text-center py-24">
                    <CheckCircle2 className="h-20 w-20 mx-auto mb-4 text-green-500" />
                    <h3 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">No Breaches Detected!</h3>
                    <p className="text-gray-700 dark:text-gray-200 font-semibold">
                      100% compliance for selected period
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="border-2 border-red-500/30 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/40 dark:to-red-900/40">
                      <CardContent className="p-6">
                        <div className="text-sm font-bold text-red-700 dark:text-red-300 mb-2">Total Breaches</div>
                        <div className="text-5xl font-black text-red-600">{data.totalBreaches}</div>
                      </CardContent>
                    </Card>

                    <Card className="border-2">
                      <CardContent className="p-6">
                        <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Breach Types</div>
                        <div className="text-5xl font-black text-gray-900 dark:text-white">{data.breachTypes.length}</div>
                      </CardContent>
                    </Card>

                    <Card className="border-2 border-amber-500/30 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/40">
                      <CardContent className="p-6">
                        <div className="text-sm font-bold text-amber-700 dark:text-amber-300 mb-2">Most Common</div>
                        <div className="text-xl font-black text-amber-600 truncate">{data.breachTypes[0]?.type || 'N/A'}</div>
                        <div className="text-sm text-amber-600/80 mt-1 font-medium">{data.breachTypes[0]?.count || 0} incidents</div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="border-2">
                    <CardHeader>
                      <CardTitle className="text-lg text-gray-900 dark:text-white">Breach Type Analysis</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {data.breachTypes.map((breach, index) => (
                          <div key={breach.type} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-6 h-6 rounded-full shrink-0"
                                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                />
                                <span className="font-bold text-gray-900 dark:text-white">{breach.type}</span>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-sm text-gray-600 dark:text-gray-300 font-medium">{breach.count} incidents</span>
                                <Badge className="font-semibold">{breach.percentage}%</Badge>
                              </div>
                            </div>
                            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-full transition-all duration-500"
                                style={{
                                  width: `${breach.percentage}%`,
                                  backgroundColor: COLORS[index % COLORS.length],
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
