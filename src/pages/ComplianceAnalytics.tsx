/**
 * Compliance Analytics - Comprehensive compliance tracking and trends
 * Shows overall compliance rates, zone breakdowns, time-series trends
 */

import { useState, useEffect } from 'react';
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
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  MapPin,
  Calendar,
  BarChart3,
  Download,
  Filter,
  Home,
  Users,
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
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

const COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899'];

interface ComplianceMetrics {
  total_observations: number;
  compliant_count: number;
  non_compliant_count: number;
  compliance_rate: number;
  unique_vehicles: number;
  unique_zones: number;
  homeless_confirmed: number;
  homeless_claimed: number;
  homeless_percentage: number;
}

interface ZoneCompliance {
  zone_id: string;
  zone_name: string;
  total_observations: number;
  compliant_count: number;
  compliance_rate: number;
  homeless_count: number;
  homeless_confirmed: number;
  homeless_claimed: number;
}

interface TrendData {
  date: string;
  compliance_rate: number;
  total: number;
  homeless_count: number;
}

export function ComplianceAnalytics() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [isLoading, setIsLoading] = useState(true);
  const [metrics, setMetrics] = useState<ComplianceMetrics | null>(null);
  const [zoneCompliance, setZoneCompliance] = useState<ZoneCompliance[]>([]);
  const [trendData, setTrendData] = useState<TrendData[]>([]);

  const [selectedOrganization, setSelectedOrganization] = useState<string>('all');
  const [availableOrganizations, setAvailableOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadOrganizations();
  }, []);

  useEffect(() => {
    if (availableOrganizations.length > 0 || !isMaster) {
      loadAnalytics();
    }
  }, [startDate, endDate, selectedOrganization, availableOrganizations]);

  const loadOrganizations = async () => {
    if (!isMaster) return;

    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setAvailableOrganizations(data || []);
    } catch (error: any) {
      console.error('Failed to load organizations:', error);
      toast.error('Failed to load organizations');
    }
  };

  const loadAnalytics = async () => {
    setIsLoading(true);

    try {
      console.log('📊 Loading compliance analytics...');

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id, role')
        .eq('id', user?.id)
        .single();

      let filterOrgId: string | null = null;

      if (isMaster && selectedOrganization !== 'all') {
        filterOrgId = selectedOrganization;
      } else if (!isMaster) {
        filterOrgId = profile?.organization_id || null;
      }

      // Load observations in date range WITH homeless status
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          plate_number,
          zone_id,
          organization_id,
          is_compliant,
          recorded_at,
          zones(name),
          canonical_vehicles(homeless_status)
        `)
        .gte('recorded_at', `${startDate}T00:00:00`)
        .lte('recorded_at', `${endDate}T23:59:59`);

      if (filterOrgId) {
        obsQuery = obsQuery.eq('organization_id', filterOrgId);
      }

      const { data: observations, error: obsError } = await obsQuery;

      if (obsError) throw obsError;

      const obs = observations || [];
      console.log(`✅ Loaded ${obs.length} observations`);

      // Calculate overall metrics INCLUDING HOMELESS
      const compliantCount = obs.filter(o => o.is_compliant).length;
      const uniquePlates = new Set(obs.map(o => o.plate_number)).size;
      const uniqueZones = new Set(obs.map(o => o.zone_id)).size;
      
      // Count homeless vehicles
      const homelessConfirmed = new Set(
        obs.filter(o => (o.canonical_vehicles as any)?.homeless_status === 'confirmed')
          .map(o => o.plate_number)
      ).size;
      
      const homelessClaimed = new Set(
        obs.filter(o => (o.canonical_vehicles as any)?.homeless_status === 'claimed')
          .map(o => o.plate_number)
      ).size;
      
      const totalHomeless = homelessConfirmed + homelessClaimed;

      setMetrics({
        total_observations: obs.length,
        compliant_count: compliantCount,
        non_compliant_count: obs.length - compliantCount,
        compliance_rate: obs.length > 0 ? Math.round((compliantCount / obs.length) * 100) : 100,
        unique_vehicles: uniquePlates,
        unique_zones: uniqueZones,
        homeless_confirmed: homelessConfirmed,
        homeless_claimed: homelessClaimed,
        homeless_percentage: uniquePlates > 0 ? Math.round((totalHomeless / uniquePlates) * 100) : 0,
      });

      // Zone breakdown WITH HOMELESS
      const zoneMap = new Map<string, { 
        name: string; 
        total: number; 
        compliant: number;
        plates: Set<string>;
        homelessConfirmed: Set<string>;
        homelessClaimed: Set<string>;
      }>();

      obs.forEach(o => {
        if (!zoneMap.has(o.zone_id)) {
          zoneMap.set(o.zone_id, {
            name: (o.zones as any)?.name || 'Unknown',
            total: 0,
            compliant: 0,
            plates: new Set(),
            homelessConfirmed: new Set(),
            homelessClaimed: new Set(),
          });
        }

        const zone = zoneMap.get(o.zone_id)!;
        zone.total++;
        zone.plates.add(o.plate_number);
        if (o.is_compliant) zone.compliant++;
        
        // Track homeless by plate
        const homelessStatus = (o.canonical_vehicles as any)?.homeless_status;
        if (homelessStatus === 'confirmed') {
          zone.homelessConfirmed.add(o.plate_number);
        } else if (homelessStatus === 'claimed') {
          zone.homelessClaimed.add(o.plate_number);
        }
      });

      const zoneStats: ZoneCompliance[] = Array.from(zoneMap.entries()).map(([id, stats]) => ({
        zone_id: id,
        zone_name: stats.name,
        total_observations: stats.total,
        compliant_count: stats.compliant,
        compliance_rate: Math.round((stats.compliant / stats.total) * 100),
        homeless_count: stats.homelessConfirmed.size + stats.homelessClaimed.size,
        homeless_confirmed: stats.homelessConfirmed.size,
        homeless_claimed: stats.homelessClaimed.size,
      })).sort((a, b) => b.total_observations - a.total_observations);

      setZoneCompliance(zoneStats);

      // Daily trend WITH HOMELESS
      const dailyMap = new Map<string, { 
        total: number; 
        compliant: number;
        homelessPlates: Set<string>;
      }>();

      obs.forEach(o => {
        const date = o.recorded_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { total: 0, compliant: 0, homelessPlates: new Set() });
        }
        const day = dailyMap.get(date)!;
        day.total++;
        if (o.is_compliant) day.compliant++;
        
        const homelessStatus = (o.canonical_vehicles as any)?.homeless_status;
        if (homelessStatus === 'confirmed' || homelessStatus === 'claimed') {
          day.homelessPlates.add(o.plate_number);
        }
      });

      const trends: TrendData[] = Array.from(dailyMap.entries()).map(([date, stats]) => ({
        date,
        compliance_rate: Math.round((stats.compliant / stats.total) * 100),
        total: stats.total,
        homeless_count: stats.homelessPlates.size,
      })).sort((a, b) => a.date.localeCompare(b.date));

      setTrendData(trends);

    } catch (error: any) {
      console.error('Failed to load analytics:', error);
      toast.error('Failed to load analytics');
    } finally {
      setIsLoading(false);
    }
  };

  const exportData = () => {
    if (!metrics || !zoneCompliance.length) {
      toast.error('No data to export');
      return;
    }

    const csvData = [
      ['Compliance Analytics Report'],
      ['Generated:', new Date().toLocaleString('en-NZ')],
      ['Period:', `${startDate} to ${endDate}`],
      [''],
      ['Overall Metrics'],
      ['Total Observations', metrics.total_observations],
      ['Compliant', metrics.compliant_count],
      ['Non-Compliant', metrics.non_compliant_count],
      ['Compliance Rate', `${metrics.compliance_rate}%`],
      ['Unique Vehicles', metrics.unique_vehicles],
      ['Unique Zones', metrics.unique_zones],
      [''],
      ['Zone Breakdown'],
      ['Zone Name', 'Total Observations', 'Compliant', 'Compliance Rate'],
      ...zoneCompliance.map(z => [z.zone_name, z.total_observations, z.compliant_count, `${z.compliance_rate}%`]),
    ];

    const csv = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance-analytics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-primary" />
            Compliance Analytics
          </h2>
          <p className="text-muted-foreground">
            Comprehensive compliance tracking and trends
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={loadAnalytics} variant="outline" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button onClick={exportData} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {isMaster && availableOrganizations.length > 0 && (
              <div className="space-y-2">
                <Label>Organization</Label>
                <Select value={selectedOrganization} onValueChange={setSelectedOrganization}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Organizations</SelectItem>
                    {availableOrganizations.map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      ) : metrics ? (
        <>
          {/* KPI Cards - WITH HOMELESS */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/20 dark:to-green-900/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-green-700 dark:text-green-300">Compliance Rate</div>
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <div className="text-4xl font-black text-green-600">{metrics.compliance_rate}%</div>
                <div className="text-xs text-green-600/80 mt-1">
                  {metrics.compliant_count} / {metrics.total_observations} observations
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-muted-foreground">Total Observations</div>
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                </div>
                <div className="text-4xl font-black text-blue-600">{metrics.total_observations}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-muted-foreground">Unique Vehicles</div>
                  <CheckCircle2 className="h-5 w-5 text-cyan-600" />
                </div>
                <div className="text-4xl font-black text-cyan-600">{metrics.unique_vehicles}</div>
              </CardContent>
            </Card>

            <Card className="border-2 border-red-500/30 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/20 dark:to-red-900/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-red-700 dark:text-red-300">Non-Compliant</div>
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <div className="text-4xl font-black text-red-600">{metrics.non_compliant_count}</div>
              </CardContent>
            </Card>

            <Card className="border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-950/20 dark:to-cyan-900/10">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-cyan-700 dark:text-cyan-300">Homeless Vehicles</div>
                  <Home className="h-5 w-5 text-cyan-600" />
                </div>
                <div className="text-4xl font-black text-cyan-600">{metrics.homeless_confirmed + metrics.homeless_claimed}</div>
                <div className="text-xs text-cyan-600/80 mt-1">
                  {metrics.homeless_percentage}% of vehicles
                </div>
                <div className="mt-2 pt-2 border-t border-cyan-300/30">
                  <div className="flex justify-between text-xs">
                    <span className="text-cyan-700 dark:text-cyan-300">Confirmed: {metrics.homeless_confirmed}</span>
                    <span className="text-cyan-700 dark:text-cyan-300">Claimed: {metrics.homeless_claimed}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Trend Chart - WITH HOMELESS */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Compliance & Homeless Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(date) => new Date(date).toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[0, 100]} />
                  <YAxis yAxisId="right" orientation="right" stroke="#06b6d4" fontSize={12} />
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
                    dataKey="compliance_rate"
                    name="Compliance Rate (%)"
                    stroke="#22c55e"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="homeless_count"
                    name="Homeless Vehicles"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Zone Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Zone Compliance Breakdown ({zoneCompliance.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {zoneCompliance.map((zone) => (
                  <div key={zone.zone_id} className="p-4 border rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">{zone.zone_name}</h4>
                      <Badge variant={zone.compliance_rate >= 80 ? 'default' : 'destructive'}>
                        {zone.compliance_rate}%
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                      <span>{zone.total_observations} observations</span>
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                        {zone.compliant_count} compliant
                      </span>
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-600" />
                        {zone.total_observations - zone.compliant_count} non-compliant
                      </span>
                      {zone.homeless_count > 0 && (
                        <span className="flex items-center gap-1">
                          <Home className="h-3 w-3 text-cyan-600" />
                          {zone.homeless_count} homeless ({zone.homeless_confirmed} confirmed, {zone.homeless_claimed} claimed)
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500"
                        style={{ width: `${zone.compliance_rate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No data available for selected period</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
