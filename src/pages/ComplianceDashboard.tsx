/**
 * COMPLIANCE DASHBOARD
 * Real-time and historical compliance monitoring with zone-level breakdowns
 * Tracks overstayers, about-to-breach, compliance rates, and enforcement metrics
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  TrendingUp,
  Activity,
  Flag,
  Home,
  Users,
  MapPin,
  Calendar,
  Clock,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { formatInTimeZone } from 'date-fns-tz';

const NZ_TIMEZONE = 'Pacific/Auckland';

interface ComplianceMetrics {
  overstayers: number;
  enforceable: number;
  aboutToOverstay: number;
  totalObservations: number;
  uniqueVehicles: number;
  compliance: number;
  flagged: number;
  homeless: number;
  officers: number;
}

interface ZoneMetrics {
  zone_id: string;
  zone_name: string;
  observations: number;
  vehicles: number;
  enforceable: number;
  about_to_breach: number;
  compliance: number;
}

export function ComplianceDashboard() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  // Organization selection
  const [selectedOrgId, setSelectedOrgId] = useState<string>(user?.organization_id || '');

  // Date range state
  const [fromDate, setFromDate] = useState<string>(() => {
    const today = new Date();
    return formatInTimeZone(today, NZ_TIMEZONE, 'yyyy-MM-dd');
  });
  const [toDate, setToDate] = useState<string>(() => {
    const today = new Date();
    return formatInTimeZone(today, NZ_TIMEZONE, 'yyyy-MM-dd');
  });

  // Quick date presets
  const setDatePreset = (preset: string) => {
    const today = new Date();
    const todayStr = formatInTimeZone(today, NZ_TIMEZONE, 'yyyy-MM-dd');

    if (preset === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
    } else if (preset === 'yesterday') {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = formatInTimeZone(yesterday, NZ_TIMEZONE, 'yyyy-MM-dd');
      setFromDate(yesterdayStr);
      setToDate(yesterdayStr);
    } else if (preset === 'last_7_days') {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      setFromDate(formatInTimeZone(weekAgo, NZ_TIMEZONE, 'yyyy-MM-dd'));
      setToDate(todayStr);
    } else if (preset === 'last_30_days') {
      const monthAgo = new Date(today);
      monthAgo.setDate(monthAgo.getDate() - 30);
      setFromDate(formatInTimeZone(monthAgo, NZ_TIMEZONE, 'yyyy-MM-dd'));
      setToDate(todayStr);
    } else if (preset === 'last_90_days') {
      const threeMonthsAgo = new Date(today);
      threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);
      setFromDate(formatInTimeZone(threeMonthsAgo, NZ_TIMEZONE, 'yyyy-MM-dd'));
      setToDate(todayStr);
    }
  };

  const handlePreviousDay = () => {
    const from = new Date(fromDate);
    from.setDate(from.getDate() - 1);
    const to = new Date(toDate);
    to.setDate(to.getDate() - 1);
    setFromDate(formatInTimeZone(from, NZ_TIMEZONE, 'yyyy-MM-dd'));
    setToDate(formatInTimeZone(to, NZ_TIMEZONE, 'yyyy-MM-dd'));
  };

  const handleNextDay = () => {
    const from = new Date(fromDate);
    from.setDate(from.getDate() + 1);
    const to = new Date(toDate);
    to.setDate(to.getDate() + 1);
    setFromDate(formatInTimeZone(from, NZ_TIMEZONE, 'yyyy-MM-dd'));
    setToDate(formatInTimeZone(to, NZ_TIMEZONE, 'yyyy-MM-dd'));
  };

  // Fetch organizations (for master users)
  const { data: organizations = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data || [];
    },
    enabled: isMaster,
  });

  // Fetch compliance metrics
  const { data: metrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery({
    queryKey: ['compliance-metrics', selectedOrgId, fromDate, toDate],
    queryFn: async () => {
      if (!selectedOrgId) throw new Error('No organization selected');

      console.log('📊 Fetching compliance metrics:', { selectedOrgId, fromDate, toDate });

      // Get all observations in date range
      const { data: observations, error: obsError } = await supabase
        .from('vehicle_observations_v2')
        .select('observation_id, plate_number, zone_id, recorded_at, is_breach, is_compliant')
        .eq('organization_id', selectedOrgId)
        .gte('recorded_at', `${fromDate}T00:00:00`)
        .lte('recorded_at', `${toDate}T23:59:59`);

      if (obsError) throw obsError;

      const totalObs = observations?.length || 0;
      const uniquePlates = new Set(observations?.map(o => o.plate_number) || []);
      const uniqueVehicles = uniquePlates.size;

      // Get breach alerts that are ACTIVE during the selected date range
      // (created before or during, and still active or resolved after the start date)
      const { data: breaches, error: breachError } = await supabase
        .from('breach_alerts')
        .select('id, status, plate_number, created_at')
        .eq('organization_id', selectedOrgId)
        .lte('created_at', `${toDate}T23:59:59`); // Created on or before end date

      if (breachError) throw breachError;

      // Filter breaches: active ones OR ones resolved after the start date
      const relevantBreaches = breaches?.filter(b => {
        // Must be linked to a vehicle observed during the date range
        const hasObservation = uniquePlates.has(b.plate_number);
        return hasObservation && (b.status === 'active' || b.status === 'pending');
      }) || [];

      const overstayers = relevantBreaches.filter(b => b.status === 'active').length;
      const enforceable = relevantBreaches.length;

      // Get flagged vehicles that appear in this date range
      const { data: flaggedVehicles } = await supabase
        .from('canonical_vehicles')
        .select('plate_number')
        .eq('is_flagged', true)
        .in('plate_number', Array.from(uniquePlates));

      const flaggedCount = flaggedVehicles?.length || 0;

      // Get homeless vehicles that appear in this date range
      const { data: homelessVehicles } = await supabase
        .from('canonical_vehicles')
        .select('plate_number')
        .eq('homeless_status', 'confirmed')
        .in('plate_number', Array.from(uniquePlates));

      const homelessCount = homelessVehicles?.length || 0;

      // Get active officers count (this doesn't need date filtering)
      const { data: officers } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('organization_id', selectedOrgId)
        .eq('is_active', true)
        .in('role', ['officer', 'admin_officer']);

      // Calculate compliance rate
      const compliantObs = observations?.filter(o => o.is_compliant).length || 0;
      const compliance = totalObs > 0 ? Math.round((compliantObs / totalObs) * 100) : 100;

      // Get about to overstay: vehicles with 2+ consecutive nights in this period but NOT yet breached
      const { data: monthlyStays } = await supabase
        .from('vehicle_monthly_stays')
        .select('plate_number, consecutive_nights, last_observation_date')
        .eq('organization_id', selectedOrgId)
        .gte('consecutive_nights', 2)
        .gte('last_observation_date', fromDate)
        .lte('last_observation_date', toDate);

      // Filter out vehicles that already have active breaches
      const breachedPlates = new Set(relevantBreaches.filter(b => b.status === 'active').map(b => b.plate_number));
      const aboutToOverstay = monthlyStays?.filter(ms => !breachedPlates.has(ms.plate_number)).length || 0;

      const result: ComplianceMetrics = {
        overstayers,
        enforceable,
        aboutToOverstay,
        totalObservations: totalObs,
        uniqueVehicles,
        compliance,
        flagged: flaggedCount,
        homeless: homelessCount,
        officers: officers?.length || 0,
      };

      console.log('✅ Compliance metrics (date-filtered):', result);
      return result;
    },
    enabled: !!selectedOrgId,
  });

  // Fetch zone breakdown
  const { data: zoneMetrics = [], isLoading: zonesLoading } = useQuery({
    queryKey: ['zone-metrics', selectedOrgId, fromDate, toDate],
    queryFn: async () => {
      if (!selectedOrgId) return [];

      console.log('🗺️ Fetching zone metrics:', { selectedOrgId, fromDate, toDate });

      // Get all zones for this org
      const { data: zones, error: zoneError } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', selectedOrgId)
        .eq('is_active', true)
        .order('name');

      if (zoneError) throw zoneError;

      const results: ZoneMetrics[] = [];

      for (const zone of zones || []) {
        // Get observations
        const { data: observations } = await supabase
          .from('vehicle_observations_v2')
          .select('observation_id, plate_number, is_breach, is_compliant')
          .eq('zone_id', zone.id)
          .gte('recorded_at', `${fromDate}T00:00:00`)
          .lte('recorded_at', `${toDate}T23:59:59`);

        const obsCount = observations?.length || 0;
        const uniqueVehicles = new Set(observations?.map(o => o.plate_number) || []).size;

        // Get breach alerts
        const { data: breaches } = await supabase
          .from('breach_alerts')
          .select('id, status')
          .eq('zone_id', zone.id)
          .gte('created_at', `${fromDate}T00:00:00`)
          .lte('created_at', `${toDate}T23:59:59`);

        const enforceable = breaches?.filter(b => b.status !== 'resolved').length || 0;

        // Get about to breach - ONLY for vehicles observed in this date range
        const uniquePlatesInRange = new Set(observations?.map(o => o.plate_number) || []);
        
        if (uniquePlatesInRange.size === 0) {
          // No observations = no vehicles to check
          results.push({
            zone_id: zone.id,
            zone_name: zone.name,
            observations: 0,
            vehicles: 0,
            enforceable: 0,
            about_to_breach: 0,
            compliance: 100,
          });
          continue;
        }

        const { data: monthlyStays } = await supabase
          .from('vehicle_monthly_stays')
          .select('plate_number, consecutive_nights, last_observation_date')
          .eq('zone_id', zone.id)
          .gte('consecutive_nights', 2)
          .gte('last_observation_date', fromDate)
          .lte('last_observation_date', toDate)
          .in('plate_number', Array.from(uniquePlatesInRange));

        const aboutToBreach = monthlyStays?.filter(ms => {
          const hasActiveBreach = breaches?.some(b => 
            b.status === 'active' && observations?.some(o => 
              o.plate_number === ms.plate_number && o.is_breach
            )
          );
          return !hasActiveBreach;
        }).length || 0;

        // Calculate compliance
        const compliantObs = observations?.filter(o => o.is_compliant).length || 0;
        const compliance = obsCount > 0 ? Math.round((compliantObs / obsCount) * 100) : 100;

        results.push({
          zone_id: zone.id,
          zone_name: zone.name,
          observations: obsCount,
          vehicles: uniqueVehicles,
          enforceable,
          about_to_breach: aboutToBreach,
          compliance,
        });
      }

      // Filter out zones with no observations
      const filtered = results.filter(z => z.observations > 0);
      console.log(`✅ Zone metrics: ${filtered.length} zones with data`);
      return filtered;
    },
    enabled: !!selectedOrgId,
  });

  // Auto-select first organization for master users
  useEffect(() => {
    if (isMaster && organizations.length > 0 && !selectedOrgId) {
      setSelectedOrgId(organizations[0].id);
    }
  }, [isMaster, organizations, selectedOrgId]);

  const selectedOrg = organizations.find(o => o.id === selectedOrgId);

  const isLoading = metricsLoading || zonesLoading;

  return (
    <ResponsiveContainer maxWidth="full" padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Activity className="h-8 w-8 text-blue-600" />
              {selectedOrg?.name || 'Compliance Dashboard'}
            </h1>
            <p className="text-muted-foreground mt-1">
              Real-time compliance monitoring dashboard
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchMetrics();
              toast.success('Dashboard refreshed');
            }}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Organization Selector (Master only) */}
        {isMaster && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <Label className="text-sm font-semibold min-w-[100px]">Organization</Label>
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select organization..." />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Date Range Filter */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-5 w-5" />
              Date Range Filter
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Quick Select Buttons */}
            <div>
              <Label className="text-sm text-muted-foreground mb-2 block">Quick Select:</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDatePreset('today')}
                  className="h-9"
                >
                  <Clock className="h-3 w-3 mr-1" />
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDatePreset('yesterday')}
                  className="h-9"
                >
                  Yesterday
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDatePreset('last_7_days')}
                  className="h-9"
                >
                  Last 7 Days
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDatePreset('last_30_days')}
                  className="h-9"
                >
                  Last 30 Days
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDatePreset('last_90_days')}
                  className="h-9"
                >
                  Last 90 Days
                </Button>
              </div>
            </div>

            {/* Navigation Buttons */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousDay}
                className="flex-1"
              >
                <ChevronRight className="h-4 w-4 mr-1 rotate-180" />
                Previous Day
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextDay}
                className="flex-1"
              >
                Next Day
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            {/* Date Inputs */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="from-date">From Date</Label>
                <input
                  id="from-date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to-date">To Date</Label>
                <input
                  id="to-date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>

            {/* Current Filter Display */}
            <div className="text-xs text-muted-foreground text-center p-2 bg-muted/50 rounded">
              Current filter: <span className="font-semibold">{fromDate}</span> → <span className="font-semibold">{toDate}</span>
            </div>
          </CardContent>
        </Card>

        {/* Metrics Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : metrics ? (
          <>
            {/* Critical Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Overstayers */}
              <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-2">
                    <div className="h-12 w-12 rounded-full bg-red-500 flex items-center justify-center">
                      <AlertTriangle className="h-6 w-6 text-white" />
                    </div>
                    <Badge variant="destructive" className="h-8 px-3">
                      <span className="text-lg font-bold">{metrics.enforceable}</span>
                    </Badge>
                  </div>
                  <h3 className="text-lg font-bold text-red-900 dark:text-red-100 mb-1">
                    Overstayers
                  </h3>
                  <p className="text-sm text-red-700 dark:text-red-300">
                    Vehicles exceeding stay limits
                  </p>
                  <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-800">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-red-700 dark:text-red-300">Enforceable:</span>
                      <Badge variant="destructive">{metrics.enforceable}</Badge>
                    </div>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      Subject to enforcement action
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* About to Overstay */}
              <Card className="border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-2">
                    <div className="h-12 w-12 rounded-full bg-yellow-500 flex items-center justify-center">
                      <Clock className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-yellow-900 dark:text-yellow-100 mb-1">
                    About to Overstay
                  </h3>
                  <div className="text-4xl font-black text-yellow-600 mb-2">
                    {metrics.aboutToOverstay}
                  </div>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Will breach if they stay tonight
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Activity Metrics */}
            <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950/20">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-2">
                  <div className="h-12 w-12 rounded-full bg-blue-500 flex items-center justify-center">
                    <Activity className="h-6 w-6 text-white" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-blue-900 dark:text-blue-100 mb-1">
                  Total Observations
                </h3>
                <div className="text-4xl font-black text-blue-600 mb-2">
                  {metrics.totalObservations}
                </div>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {metrics.uniqueVehicles} unique vehicles
                </p>
              </CardContent>
            </Card>

            {/* Secondary Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="text-3xl font-bold text-green-600">
                    {metrics.compliance}%
                  </div>
                  <p className="text-xs text-muted-foreground">Compliance</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Flag className="h-5 w-5 text-red-600" />
                  </div>
                  <div className="text-3xl font-bold">
                    {metrics.flagged}
                  </div>
                  <p className="text-xs text-muted-foreground">Flagged</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Home className="h-5 w-5 text-cyan-600" />
                  </div>
                  <div className="text-3xl font-bold">
                    {metrics.homeless}
                  </div>
                  <p className="text-xs text-muted-foreground">Homeless</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-3xl font-bold">
                    {metrics.officers}
                  </div>
                  <p className="text-xs text-muted-foreground">Officers</p>
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            Select an organization to view metrics
          </div>
        )}

        {/* Zone Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Zone Breakdown ({zoneMetrics.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading zones...
              </div>
            ) : zoneMetrics.length === 0 ? (
              <div className="text-center py-12">
                <MapPin className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-20" />
                <p className="text-muted-foreground">
                  No zones found in this date range
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {zoneMetrics.map((zone) => (
                  <Card key={zone.zone_id} className="border-2">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-bold text-lg">{zone.zone_name}</h4>
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-sm text-muted-foreground">Observations</div>
                          <div className="text-2xl font-bold">{zone.observations}</div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Vehicles</div>
                          <div className="text-2xl font-bold">{zone.vehicles}</div>
                        </div>
                        <div className="bg-red-50 dark:bg-red-950/20 p-2 rounded">
                          <div className="text-xs text-red-700 dark:text-red-300">Enforceable</div>
                          <div className="text-xl font-bold text-red-600">{zone.enforceable}</div>
                        </div>
                        <div className="bg-yellow-50 dark:bg-yellow-950/20 p-2 rounded">
                          <div className="text-xs text-yellow-700 dark:text-yellow-300">About to</div>
                          <div className="text-xl font-bold text-yellow-600">{zone.about_to_breach}</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Compliance</span>
                          <Badge
                            variant={zone.compliance === 100 ? 'default' : 'secondary'}
                            className="h-7 px-3"
                          >
                            {zone.compliance}%
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ResponsiveContainer>
  );
}
