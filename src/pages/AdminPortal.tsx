/**
 * Admin Portal - Enforcement & Compliance Management
 * 
 * Simple working admin dashboard with:
 * - Real KPI stats from actual database tables
 * - Working navigation links to all enforcement screens
 * - Date filtering with Today/Yesterday/Prev/Next buttons
 * - Database maintenance tools
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  Shield,
  Clock,
  MapPin,
  Users,
  FileText,
  Database,
  Loader2,
  Calendar,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Navigation,
  CarFront,
  Home,
} from 'lucide-react';
import { format, subDays, addDays } from 'date-fns';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useOrganizations } from '@/hooks/useOrganizations';

interface DashboardStats {
  total_observations: number;
  total_breaches: number;
  pending_breaches: number;
  active_investigations: number;
  active_officers: number;
  zones_with_activity: number;
  total_vehicles: number;
  flagged_vehicles: number;
}

export function AdminPortal() {
  const { user } = useAuthStore();
  const { organizations } = useOrganizations();
  
  // Date filtering
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dateInput, setDateInput] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Organization filter (masters only)
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  
  // Stats
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Load dashboard stats
  useEffect(() => {
    loadStats();
  }, [selectedDate, selectedOrgId]);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Build organization filter
      const orgFilter = user?.role === 'master' && selectedOrgId 
        ? selectedOrgId 
        : user?.organization_id || '';

      // Total observations for selected date
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select('*', { count: 'exact', head: false })
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString());

      if (orgFilter) {
        obsQuery = obsQuery.eq('organization_id', orgFilter);
      }

      const { count: totalObs } = await obsQuery;

      // Total breaches
      let breachQuery = supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true });

      if (orgFilter) {
        breachQuery = breachQuery.eq('organization_id', orgFilter);
      }

      const { count: totalBreaches } = await breachQuery;

      // Pending breaches
      let pendingQuery = supabase
        .from('breach_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (orgFilter) {
        pendingQuery = pendingQuery.eq('organization_id', orgFilter);
      }

      const { count: pendingBreaches } = await pendingQuery;

      // Active investigations
      let investigationsQuery = supabase
        .from('investigation_jobs')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'in_progress']);

      if (orgFilter) {
        investigationsQuery = investigationsQuery.eq('organization_id', orgFilter);
      }

      const { count: activeInvestigations } = await investigationsQuery;

      // Active officers (those who recorded observations today)
      let officersQuery = supabase
        .from('vehicle_observations_v2')
        .select('recorded_by', { count: 'exact' })
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString());

      if (orgFilter) {
        officersQuery = officersQuery.eq('organization_id', orgFilter);
      }

      const { data: officerObs } = await officersQuery;
      const uniqueOfficers = new Set(officerObs?.map((o: any) => o.recorded_by) || []);

      // Zones with activity today
      let zonesQuery = supabase
        .from('vehicle_observations_v2')
        .select('zone_id', { count: 'exact' })
        .gte('recorded_at', startOfDay.toISOString())
        .lte('recorded_at', endOfDay.toISOString());

      if (orgFilter) {
        zonesQuery = zonesQuery.eq('organization_id', orgFilter);
      }

      const { data: zoneObs } = await zonesQuery;
      const uniqueZones = new Set(zoneObs?.map((z: any) => z.zone_id) || []);

      // Total vehicles
      const { count: totalVehicles } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true });

      // Flagged vehicles
      const { count: flaggedVehicles } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('is_flagged', true);

      setStats({
        total_observations: totalObs || 0,
        total_breaches: totalBreaches || 0,
        pending_breaches: pendingBreaches || 0,
        active_investigations: activeInvestigations || 0,
        active_officers: uniqueOfficers.size,
        zones_with_activity: uniqueZones.size,
        total_vehicles: totalVehicles || 0,
        flagged_vehicles: flaggedVehicles || 0,
      });

    } catch (error: any) {
      console.error('Failed to load stats:', error);
      toast.error('Failed to load dashboard stats');
    } finally {
      setIsLoading(false);
    }
  };

  // Date navigation
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

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Admin Portal</h1>
            <p className="text-muted-foreground mt-1">
              Enforcement & Compliance Management
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/historical-import">
              <Download className="h-4 w-4 mr-2" />
              Import Data
            </Link>
          </Button>
        </div>

        {/* Date Navigation */}
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
                  Prev
                </Button>
                <Button variant="outline" size="sm" onClick={goToNextDay}>
                  Next
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

              {/* Organization Filter (Masters Only) */}
              {user?.role === 'master' && (
                <div className="md:col-span-4">
                  <Label className="text-xs text-muted-foreground mb-1 block">Organization</Label>
                  <Select value={selectedOrgId || 'all'} onValueChange={(val) => setSelectedOrgId(val === 'all' ? '' : val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Organizations" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Organizations</SelectItem>
                      {organizations?.map(org => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Total Observations */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Observations</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{isLoading ? '...' : stats?.total_observations || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {format(selectedDate, 'dd MMM yyyy')}
              </p>
            </CardContent>
          </Card>

          {/* Pending Breaches */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Breaches</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{isLoading ? '...' : stats?.pending_breaches || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                of {stats?.total_breaches || 0} total breaches
              </p>
            </CardContent>
          </Card>

          {/* Active Officers */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Officers</CardTitle>
              <Users className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{isLoading ? '...' : stats?.active_officers || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Recorded observations today
              </p>
            </CardContent>
          </Card>

          {/* Active Zones */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Zones</CardTitle>
              <MapPin className="h-4 w-4 text-indigo-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-indigo-600">{isLoading ? '...' : stats?.zones_with_activity || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                With activity today
              </p>
            </CardContent>
          </Card>

          {/* Active Investigations */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Investigations</CardTitle>
              <Shield className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{isLoading ? '...' : stats?.active_investigations || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Pending or in progress
              </p>
            </CardContent>
          </Card>

          {/* Total Vehicles */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Vehicles</CardTitle>
              <CarFront className="h-4 w-4 text-cyan-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-cyan-600">{isLoading ? '...' : stats?.total_vehicles || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                In canonical registry
              </p>
            </CardContent>
          </Card>

          {/* Flagged Vehicles */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Flagged</CardTitle>
              <Home className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{isLoading ? '...' : stats?.flagged_vehicles || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Requiring attention
              </p>
            </CardContent>
          </Card>

          {/* Refresh Button */}
          <Card className="flex items-center justify-center">
            <CardContent className="py-6">
              <Button onClick={loadStats} disabled={isLoading} className="w-full">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Refresh Stats
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Enforcement & Compliance */}
        <Card>
          <CardHeader>
            <CardTitle>Enforcement & Compliance</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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
              <Link to="/enforcement-actions">
                <Shield className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">Enforcement Actions</div>
                  <div className="text-xs text-muted-foreground">Manage enforcement jobs</div>
                </div>
              </Link>
            </Button>

            <Button variant="outline" asChild className="h-auto py-4 justify-start">
              <Link to="/investigation-jobs">
                <FileText className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">Investigation Jobs</div>
                  <div className="text-xs text-muted-foreground">Assign investigations</div>
                </div>
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Reports & Analytics */}
        <Card>
          <CardHeader>
            <CardTitle>Reports & Analytics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
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
              <Link to="/patrol-management">
                <Navigation className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">Patrol Management</div>
                  <div className="text-xs text-muted-foreground">Schedule and assign</div>
                </div>
              </Link>
            </Button>

            <Button variant="outline" asChild className="h-auto py-4 justify-start">
              <Link to="/officer-welfare-alerts">
                <Users className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">Officer Welfare</div>
                  <div className="text-xs text-muted-foreground">Safety monitoring</div>
                </div>
              </Link>
            </Button>

            <Button variant="outline" asChild className="h-auto py-4 justify-start">
              <Link to="/zone-management">
                <MapPin className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">Zone Management</div>
                  <div className="text-xs text-muted-foreground">Configure zones</div>
                </div>
              </Link>
            </Button>

            <Button variant="outline" asChild className="h-auto py-4 justify-start">
              <Link to="/vehicle-management">
                <CarFront className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">Vehicle Management</div>
                  <div className="text-xs text-muted-foreground">Canonical registry</div>
                </div>
              </Link>
            </Button>

            <Button variant="outline" asChild className="h-auto py-4 justify-start">
              <Link to="/user-management">
                <Users className="h-5 w-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">User Management</div>
                  <div className="text-xs text-muted-foreground">Manage staff</div>
                </div>
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* Database Maintenance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Database Maintenance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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

            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Data Integrity Check
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Comprehensive database health check
                  </div>
                </div>
                <Button variant="outline" asChild>
                  <Link to="/data-integrity-check">Run</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
