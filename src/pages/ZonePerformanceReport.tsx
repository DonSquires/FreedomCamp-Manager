/**
 * Zone Performance Report - Compare zone activity, compliance, and trends
 * Shows zone-by-zone breakdown with rankings and performance metrics
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
  MapPin,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Loader2,
  Download,
  Filter,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  Car,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface ZoneMetrics {
  zone_id: string;
  zone_name: string;
  total_observations: number;
  unique_vehicles: number;
  compliance_rate: number;
  breach_count: number;
  incidents_count: number;
  enforcement_actions: number;
  avg_observations_per_day: number;
  trend: 'up' | 'down' | 'stable';
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function ZonePerformanceReport() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [isLoading, setIsLoading] = useState(true);
  const [zones, setZones] = useState<ZoneMetrics[]>([]);

  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [availableOrganizations, setAvailableOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [sortBy, setSortBy] = useState<'observations' | 'compliance' | 'breaches'>('observations');

  useEffect(() => {
    if (isMaster) {
      loadOrganizations();
    }
  }, [isMaster]);

  useEffect(() => {
    loadZonePerformance();
  }, [startDate, endDate, selectedOrgId, sortBy]);

  const loadOrganizations = async () => {
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

  const loadZonePerformance = async () => {
    setIsLoading(true);

    try {
      console.log('📊 Loading zone performance...');

      // Get user's organization if not master
      let filterOrgId: string | null = null;
      if (!isMaster) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();
        filterOrgId = profile?.organization_id || null;
      } else if (selectedOrgId !== 'all') {
        filterOrgId = selectedOrgId;
      }

      // Load all zones for organization
      let zonesQuery = supabase
        .from('zones')
        .select('id, name, organization_id')
        .eq('is_active', true);

      if (filterOrgId) {
        zonesQuery = zonesQuery.eq('organization_id', filterOrgId);
      }

      const { data: zonesList, error: zonesError } = await zonesQuery;

      if (zonesError) throw zonesError;

      if (!zonesList || zonesList.length === 0) {
        setZones([]);
        setIsLoading(false);
        return;
      }

      // Load observations for each zone
      const zoneMetrics: ZoneMetrics[] = await Promise.all(
        zonesList.map(async (zone) => {
          // Count observations
          let obsQuery = supabase
            .from('observations')
            .select('observation_id, plate_number, is_compliant', { count: 'exact' })
            .eq('zone_id', zone.id)
            .gte('recorded_at', `${startDate}T00:00:00`)
            .lte('recorded_at', `${endDate}T23:59:59`);

          if (filterOrgId) {
            obsQuery = obsQuery.eq('organization_id', filterOrgId);
          }

          const { data: observations, count: obsCount } = await obsQuery;

          // Count incidents
          let incQuery = supabase
            .from('incidents')
            .select('id', { count: 'exact', head: true })
            .eq('zone_id', zone.id)
            .gte('created_at', `${startDate}T00:00:00`)
            .lte('created_at', `${endDate}T23:59:59`);

          if (filterOrgId) {
            incQuery = incQuery.eq('organization_id', filterOrgId);
          }

          const { count: incCount } = await incQuery;

          // Count enforcement actions
          let enfQuery = supabase
            .from('enforcement_actions')
            .select('id', { count: 'exact', head: true })
            .eq('zone_id', zone.id)
            .gte('recorded_at', `${startDate}T00:00:00`)
            .lte('recorded_at', `${endDate}T23:59:59`);

          if (filterOrgId) {
            enfQuery = enfQuery.eq('organization_id', filterOrgId);
          }

          const { count: enfCount } = await enfQuery;

          // Calculate metrics
          const totalObs = obsCount || 0;
          const uniqueVehicles = new Set((observations || []).map(o => o.plate_number)).size;
          const breaches = (observations || []).filter(o => !o.is_compliant).length;
          const complianceRate = totalObs > 0 ? Math.round(((totalObs - breaches) / totalObs) * 100) : 100;

          // Calculate average observations per day
          const daysDiff = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)));
          const avgObsPerDay = totalObs / daysDiff;

          // Determine trend (simplified - compare first vs second half)
          const midDate = new Date((new Date(startDate).getTime() + new Date(endDate).getTime()) / 2).toISOString();
          const firstHalfCount = (observations || []).filter(o => o.recorded_at < midDate).length;
          const secondHalfCount = (observations || []).filter(o => o.recorded_at >= midDate).length;
          
          let trend: 'up' | 'down' | 'stable' = 'stable';
          if (secondHalfCount > firstHalfCount * 1.1) trend = 'up';
          else if (secondHalfCount < firstHalfCount * 0.9) trend = 'down';

          return {
            zone_id: zone.id,
            zone_name: zone.name,
            total_observations: totalObs,
            unique_vehicles: uniqueVehicles,
            compliance_rate: complianceRate,
            breach_count: breaches,
            incidents_count: incCount || 0,
            enforcement_actions: enfCount || 0,
            avg_observations_per_day: Math.round(avgObsPerDay * 10) / 10,
            trend,
          };
        })
      );

      // Sort zones
      zoneMetrics.sort((a, b) => {
        if (sortBy === 'observations') return b.total_observations - a.total_observations;
        if (sortBy === 'compliance') return b.compliance_rate - a.compliance_rate;
        if (sortBy === 'breaches') return b.breach_count - a.breach_count;
        return 0;
      });

      setZones(zoneMetrics);
      console.log('✅ Loaded', zoneMetrics.length, 'zones');
    } catch (error: any) {
      console.error('Failed to load zone performance:', error);
      toast.error('Failed to load zone performance');
    } finally {
      setIsLoading(false);
    }
  };

  const exportToCSV = () => {
    const csvData = [
      ['Zone Performance Report'],
      ['Generated:', new Date().toLocaleString('en-NZ')],
      ['Period:', `${startDate} to ${endDate}`],
      [''],
      ['Zone Name', 'Total Observations', 'Unique Vehicles', 'Compliance Rate', 'Breaches', 'Incidents', 'Enforcement Actions', 'Avg Obs/Day', 'Trend'],
      ...zones.map(z => [
        z.zone_name,
        z.total_observations,
        z.unique_vehicles,
        `${z.compliance_rate}%`,
        z.breach_count,
        z.incidents_count,
        z.enforcement_actions,
        z.avg_observations_per_day,
        z.trend,
      ]),
    ];

    const csv = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zone-performance-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };

  const topZone = zones.length > 0 ? zones[0] : null;
  const totalObservations = zones.reduce((sum, z) => sum + z.total_observations, 0);
  const avgCompliance = zones.length > 0 ? Math.round(zones.reduce((sum, z) => sum + z.compliance_rate, 0) / zones.length) : 0;
  const totalBreaches = zones.reduce((sum, z) => sum + z.breach_count, 0);

  // Radar chart data (top 5 zones)
  const radarData = zones.slice(0, 5).map(z => ({
    zone: z.zone_name,
    compliance: z.compliance_rate,
    activity: Math.min(100, (z.total_observations / (zones[0]?.total_observations || 1)) * 100),
    enforcement: Math.min(100, (z.enforcement_actions / (zones[0]?.enforcement_actions || 1)) * 100),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
            <MapPin className="h-8 w-8 text-primary" />
            Zone Performance Report
          </h2>
          <p className="text-muted-foreground">
            Compare zone activity, compliance rates, and enforcement metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={loadZonePerformance} variant="outline" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button onClick={exportToCSV} variant="outline">
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {isMaster && availableOrganizations.length > 0 && (
              <div className="space-y-2">
                <Label>Organization</Label>
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
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
            <div className="space-y-2">
              <Label>Sort By</Label>
              <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="observations">Most Active</SelectItem>
                  <SelectItem value="compliance">Best Compliance</SelectItem>
                  <SelectItem value="breaches">Most Breaches</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      ) : zones.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12 text-muted-foreground">
            <MapPin className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No zones found for selected period</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-muted-foreground">Active Zones</div>
                  <MapPin className="h-5 w-5 text-blue-600" />
                </div>
                <div className="text-4xl font-black text-blue-600">{zones.length}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-muted-foreground">Total Observations</div>
                  <Car className="h-5 w-5 text-green-600" />
                </div>
                <div className="text-4xl font-black text-green-600">{totalObservations}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-muted-foreground">Avg Compliance</div>
                  <CheckCircle2 className="h-5 w-5 text-cyan-600" />
                </div>
                <div className="text-4xl font-black text-cyan-600">{avgCompliance}%</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-muted-foreground">Total Breaches</div>
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <div className="text-4xl font-black text-red-600">{totalBreaches}</div>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          {zones.length > 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bar Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Zone Activity Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={zones.slice(0, 10)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="zone_name"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        angle={-45}
                        textAnchor="end"
                        height={80}
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
                      <Bar dataKey="total_observations" name="Observations" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                      <Bar dataKey="breach_count" name="Breaches" fill="#ef4444" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Radar Chart */}
              {radarData.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Top 5 Zones - Performance Profile</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="zone" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <PolarRadiusAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                        <Radar name="Compliance %" dataKey="compliance" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                        <Radar name="Activity %" dataKey="activity" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                        <Radar name="Enforcement %" dataKey="enforcement" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.3} />
                        <Legend />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Zone Rankings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Zone Rankings ({zones.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {zones.map((zone, index) => (
                  <div
                    key={zone.zone_id}
                    className="p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">
                          #{index + 1}
                        </div>
                        <div>
                          <h4 className="font-semibold">{zone.zone_name}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            {zone.trend === 'up' && (
                              <Badge variant="default" className="bg-green-500 text-xs">
                                <TrendingUp className="h-3 w-3 mr-1" />
                                Rising
                              </Badge>
                            )}
                            {zone.trend === 'down' && (
                              <Badge variant="outline" className="text-red-500 border-red-500 text-xs">
                                <TrendingDown className="h-3 w-3 mr-1" />
                                Declining
                              </Badge>
                            )}
                            <Badge
                              variant={zone.compliance_rate >= 80 ? 'default' : 'destructive'}
                              className="text-xs"
                            >
                              {zone.compliance_rate}% Compliance
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs">Observations</div>
                        <div className="font-bold text-lg">{zone.total_observations}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Unique Vehicles</div>
                        <div className="font-bold text-lg">{zone.unique_vehicles}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Breaches</div>
                        <div className="font-bold text-lg text-red-600">{zone.breach_count}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Incidents</div>
                        <div className="font-bold text-lg">{zone.incidents_count}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Enforcement</div>
                        <div className="font-bold text-lg">{zone.enforcement_actions}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Avg Obs/Day</div>
                        <div className="font-bold text-lg">{zone.avg_observations_per_day}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
