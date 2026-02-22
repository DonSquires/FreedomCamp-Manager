/**
 * Officer Activity Report - Track officer performance and activity metrics
 * Shows observations logged, incidents reported, patrols completed, etc.
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
  Users,
  TrendingUp,
  Calendar,
  Download,
  Loader2,
  Shield,
  Car,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Clock,
  BarChart3,
} from 'lucide-react';
import {
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

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

interface OfficerStats {
  officer_id: string;
  officer_name: string;
  officer_email: string;
  total_observations: number;
  total_incidents: number;
  total_patrols: number;
  total_enforcement_actions: number;
  breaches_detected: number;
  compliance_rate: number;
  avg_observations_per_patrol: number;
  most_active_zone: string;
  last_activity: string;
}

interface DailyActivity {
  date: string;
  observations: number;
  incidents: number;
  patrols: number;
}

export function OfficerActivityReport() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [isLoading, setIsLoading] = useState(true);
  const [officers, setOfficers] = useState<OfficerStats[]>([]);
  const [dailyActivity, setDailyActivity] = useState<DailyActivity[]>([]);

  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [availableOrganizations, setAvailableOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [sortBy, setSortBy] = useState<'observations' | 'incidents' | 'compliance'>('observations');

  useEffect(() => {
    if (isMaster) {
      loadOrganizations();
    }
  }, [isMaster]);

  useEffect(() => {
    loadOfficerActivity();
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

  const loadOfficerActivity = async () => {
    setIsLoading(true);

    try {
      console.log('📊 Loading officer activity...');

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

      // Build organization filter
      let orgFilter = {};
      if (filterOrgId) {
        orgFilter = { organization_id: filterOrgId };
      }

      // Load all officers in organization
      let officersQuery = supabase
        .from('user_profiles')
        .select('id, first_name, last_name, email, role')
        .in('role', ['officer', 'admin', 'master']);

      if (filterOrgId) {
        officersQuery = officersQuery.eq('organization_id', filterOrgId);
      }

      const { data: officerList, error: officerError } = await officersQuery;

      if (officerError) throw officerError;

      if (!officerList || officerList.length === 0) {
        setOfficers([]);
        setDailyActivity([]);
        setIsLoading(false);
        return;
      }

      // Load stats for each officer
      const officerStats: OfficerStats[] = await Promise.all(
        officerList.map(async (officer) => {
          // Count observations
          let obsQuery = supabase
            .from('observations')
            .select('observation_id, zone_id, is_compliant', { count: 'exact' })
            .eq('recorded_by', officer.id)
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
            .eq('user_id', officer.id)
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
            .eq('user_id', officer.id)
            .gte('recorded_at', `${startDate}T00:00:00`)
            .lte('recorded_at', `${endDate}T23:59:59`);

          if (filterOrgId) {
            enfQuery = enfQuery.eq('organization_id', filterOrgId);
          }

          const { count: enfCount } = await enfQuery;

          // Calculate compliance stats
          const totalObs = obsCount || 0;
          const breaches = observations?.filter(o => !o.is_compliant).length || 0;
          const complianceRate = totalObs > 0 ? Math.round(((totalObs - breaches) / totalObs) * 100) : 100;

          // Find most active zone
          const zoneCounts = new Map<string, number>();
          (observations || []).forEach(obs => {
            zoneCounts.set(obs.zone_id, (zoneCounts.get(obs.zone_id) || 0) + 1);
          });

          const mostActiveZoneId = zoneCounts.size > 0
            ? Array.from(zoneCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
            : null;

          let mostActiveZoneName = 'N/A';
          if (mostActiveZoneId) {
            const { data: zone } = await supabase
              .from('zones')
              .select('name')
              .eq('id', mostActiveZoneId)
              .single();
            mostActiveZoneName = zone?.name || 'N/A';
          }

          // Get last activity
          const { data: lastObs } = await supabase
            .from('observations')
            .select('recorded_at')
            .eq('recorded_by', officer.id)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .single();

          return {
            officer_id: officer.id,
            officer_name: `${officer.first_name} ${officer.last_name}`,
            officer_email: officer.email,
            total_observations: totalObs,
            total_incidents: incCount || 0,
            total_patrols: 0, // Calculated separately
            total_enforcement_actions: enfCount || 0,
            breaches_detected: breaches,
            compliance_rate: complianceRate,
            avg_observations_per_patrol: 0,
            most_active_zone: mostActiveZoneName,
            last_activity: lastObs?.recorded_at || 'Never',
          };
        })
      );

      // Sort by selected metric
      officerStats.sort((a, b) => {
        if (sortBy === 'observations') return b.total_observations - a.total_observations;
        if (sortBy === 'incidents') return b.total_incidents - a.total_incidents;
        if (sortBy === 'compliance') return b.compliance_rate - a.compliance_rate;
        return 0;
      });

      setOfficers(officerStats);

      // Load daily activity trend
      const dailyMap = new Map<string, { observations: number; incidents: number; patrols: number }>();

      // Aggregate observations by date
      let dailyObsQuery = supabase
        .from('observations')
        .select('recorded_at')
        .gte('recorded_at', `${startDate}T00:00:00`)
        .lte('recorded_at', `${endDate}T23:59:59`);

      if (filterOrgId) {
        dailyObsQuery = dailyObsQuery.eq('organization_id', filterOrgId);
      }

      const { data: dailyObs } = await dailyObsQuery;

      (dailyObs || []).forEach(obs => {
        const date = obs.recorded_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { observations: 0, incidents: 0, patrols: 0 });
        }
        dailyMap.get(date)!.observations++;
      });

      // Aggregate incidents by date
      let dailyIncQuery = supabase
        .from('incidents')
        .select('created_at')
        .gte('created_at', `${startDate}T00:00:00`)
        .lte('created_at', `${endDate}T23:59:59`);

      if (filterOrgId) {
        dailyIncQuery = dailyIncQuery.eq('organization_id', filterOrgId);
      }

      const { data: dailyInc } = await dailyIncQuery;

      (dailyInc || []).forEach(inc => {
        const date = inc.created_at.split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { observations: 0, incidents: 0, patrols: 0 });
        }
        dailyMap.get(date)!.incidents++;
      });

      const dailyData: DailyActivity[] = Array.from(dailyMap.entries())
        .map(([date, stats]) => ({
          date,
          observations: stats.observations,
          incidents: stats.incidents,
          patrols: stats.patrols,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setDailyActivity(dailyData);

      console.log('✅ Loaded', officerStats.length, 'officers');
    } catch (error: any) {
      console.error('Failed to load officer activity:', error);
      toast.error('Failed to load officer activity');
    } finally {
      setIsLoading(false);
    }
  };

  const exportToCSV = () => {
    const csvData = [
      ['Officer Name', 'Email', 'Observations', 'Incidents', 'Enforcement Actions', 'Breaches', 'Compliance Rate', 'Most Active Zone', 'Last Activity'],
      ...officers.map(o => [
        o.officer_name,
        o.officer_email,
        o.total_observations.toString(),
        o.total_incidents.toString(),
        o.total_enforcement_actions.toString(),
        o.breaches_detected.toString(),
        `${o.compliance_rate}%`,
        o.most_active_zone,
        o.last_activity !== 'Never' ? new Date(o.last_activity).toLocaleString('en-NZ') : 'Never',
      ])
    ];

    const csv = csvData.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `officer-activity-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };

  const totalObservations = officers.reduce((sum, o) => sum + o.total_observations, 0);
  const totalIncidents = officers.reduce((sum, o) => sum + o.total_incidents, 0);
  const totalEnforcement = officers.reduce((sum, o) => sum + o.total_enforcement_actions, 0);
  const avgComplianceRate = officers.length > 0
    ? Math.round(officers.reduce((sum, o) => sum + o.compliance_rate, 0) / officers.length)
    : 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
            <Users className="h-8 w-8 text-primary" />
            Officer Activity Report
          </h2>
          <p className="text-muted-foreground">
            Performance metrics and activity tracking for field officers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={loadOfficerActivity} variant="outline" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <BarChart3 className="h-4 w-4 mr-2" />}
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
          <CardTitle className="text-base">Filters</CardTitle>
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
                  <SelectItem value="observations">Most Observations</SelectItem>
                  <SelectItem value="incidents">Most Incidents</SelectItem>
                  <SelectItem value="compliance">Highest Compliance</SelectItem>
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
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-muted-foreground">Active Officers</div>
                  <Users className="h-5 w-5 text-blue-600" />
                </div>
                <div className="text-4xl font-black text-blue-600">{officers.length}</div>
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
                  <div className="text-sm font-medium text-muted-foreground">Total Incidents</div>
                  <AlertTriangle className="h-5 w-5 text-orange-600" />
                </div>
                <div className="text-4xl font-black text-orange-600">{totalIncidents}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-muted-foreground">Avg Compliance</div>
                  <CheckCircle2 className="h-5 w-5 text-cyan-600" />
                </div>
                <div className="text-4xl font-black text-cyan-600">{avgComplianceRate}%</div>
              </CardContent>
            </Card>
          </div>

          {/* Daily Activity Chart */}
          {dailyActivity.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Daily Activity Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dailyActivity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickFormatter={(date) => new Date(date).toLocaleDateString('en-NZ', { month: 'short', day: 'numeric' })}
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
                    <Line
                      type="monotone"
                      dataKey="observations"
                      name="Observations"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="incidents"
                      name="Incidents"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Officer Leaderboard */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Officer Performance ({officers.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {officers.map((officer, index) => (
                  <div
                    key={officer.officer_id}
                    className="p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">
                          #{index + 1}
                        </div>
                        <div>
                          <h4 className="font-semibold">{officer.officer_name}</h4>
                          <p className="text-xs text-muted-foreground">{officer.officer_email}</p>
                        </div>
                      </div>
                      <Badge
                        variant={officer.compliance_rate >= 80 ? 'default' : 'destructive'}
                        className="text-sm"
                      >
                        {officer.compliance_rate}% Compliance
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs">Observations</div>
                        <div className="font-bold text-lg">{officer.total_observations}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Incidents</div>
                        <div className="font-bold text-lg">{officer.total_incidents}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Enforcement</div>
                        <div className="font-bold text-lg">{officer.total_enforcement_actions}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Breaches Found</div>
                        <div className="font-bold text-lg text-red-600">{officer.breaches_detected}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Most Active Zone</div>
                        <div className="font-medium text-sm truncate">{officer.most_active_zone}</div>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Last activity: {officer.last_activity !== 'Never' ? new Date(officer.last_activity).toLocaleString('en-NZ') : 'Never'}
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
