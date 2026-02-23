import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { VehicleProfilePhoto } from '@/components/features/VehicleProfilePhoto';
import { OrganizationSelector } from '@/components/features/OrganizationSelector';
import { useZones } from '@/hooks/useZones';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import {
  Car,
  MapPin,
  TrendingUp,
  Calendar,
  Search,
  Filter,
  Download,
  Eye,
  AlertTriangle,
  Home,
  Flag,
  Navigation,
  Clock,
  Loader2,
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
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { toast } from 'sonner';

interface CanonicalVehicle {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  is_homeless: boolean;
  homeless_confirmed: boolean;
  is_flagged: boolean;
  flagged_priority: string | null;
  first_seen_at: string;
  last_seen_at: string;
  total_observations: number;
}

interface VehicleObservation {
  observation_id: string;
  zone_id: string;
  zone_name: string;
  organization_id: string;
  organization_name: string;
  recorded_at: string;
  recorded_by: string;
  is_self_contained: boolean;
  is_compliant: boolean;
  evidence_photos: string[];
  notes: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
}

interface VehicleProfile extends CanonicalVehicle {
  observations: VehicleObservation[];
  unique_zones: number;
  unique_organizations: number;
  total_breaches: number;
  compliance_rate: number;
  most_common_zone: string;
  zone_distribution: Array<{ zone: string; count: number }>;
  time_distribution: Array<{ hour: number; count: number }>;
  daily_activity: Array<{ date: string; count: number }>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export function VehicleActivityReport() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';
  const { data: zones = [] } = useZones();
  const { data: organizations = [] } = useOrganizations();
  const [orgSelectorOrganizations, setOrgSelectorOrganizations] = useState<{ id: string; name: string }[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [vehicles, setVehicles] = useState<CanonicalVehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState<string>('all');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('all');
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [sortBy, setSortBy] = useState<'observations' | 'zones' | 'recent'>('observations');

  // Fetch vehicles with observation counts
  const fetchVehicles = async () => {
    setIsLoading(true);
    try {
      console.log('📊 [VEHICLE ACTIVITY] Loading vehicles...');
      console.log('   - User:', user?.id, 'Role:', user?.role);
      console.log('   - Selected Org:', selectedOrgId);

      // Get unique plates from observations filtered by organization
      let obsQuery = supabase
        .from('observations')
        .select('plate_number', { count: 'exact' });

      // Apply organization filter
      if (selectedOrgId !== 'all') {
        console.log('   - Filtering by organization:', selectedOrgId);
        obsQuery = obsQuery.eq('organization_id', selectedOrgId);
      } else if (!isMaster) {
        // Non-master users see only their organization
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();
        
        if (profile?.organization_id) {
          console.log('   - Non-master user, filtering by org:', profile.organization_id);
          obsQuery = obsQuery.eq('organization_id', profile.organization_id);
        }
      }

      const { data: obsData, error: obsError } = await obsQuery;
      if (obsError) throw obsError;

      const uniquePlates = [...new Set((obsData || []).map(o => o.plate_number))];
      console.log('   - Found', uniquePlates.length, 'unique plates in filtered observations');

      if (uniquePlates.length === 0) {
        setVehicles([]);
        setIsLoading(false);
        return;
      }

      // Load canonical vehicles for these plates
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select(`
          plate_number,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          is_homeless,
          homeless_confirmed,
          is_flagged,
          flagged_priority,
          first_seen_at,
          last_seen_at,
          total_observations
        `)
        .in('plate_number', uniquePlates)
        .order('total_observations', { ascending: false });

      if (error) throw error;

      console.log('✅ [VEHICLE ACTIVITY] Loaded', data?.length || 0, 'vehicles');
      setVehicles(data || []);
    } catch (error: any) {
      console.error('❌ [VEHICLE ACTIVITY] Failed to fetch vehicles:', error);
      toast.error('Failed to load vehicles: ' + error.message);
      setVehicles([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch detailed profile for a vehicle
  const fetchVehicleProfile = async (plateNumber: string) => {
    setLoadingProfile(true);
    try {
      // Get vehicle details
      const { data: vehicle, error: vehicleError } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', plateNumber)
        .single();

      if (vehicleError) throw vehicleError;

      // Get all observations with filters
      let observationsQuery = supabase
        .from('observations')
        .select(`
          id as observation_id,
          zone_id,
          organization_id,
          recorded_at,
          recorded_by,
          is_self_contained,
          is_compliant,
          evidence_photos,
          notes,
          gps_latitude,
          gps_longitude,
          zones!inner(name),
          organizations(name),
          user_profiles(first_name, last_name)
        `)
        .eq('plate_number', plateNumber)
        .gte('recorded_at', `${startDate}T00:00:00`)
        .lte('recorded_at', `${endDate}T23:59:59`)
        .order('recorded_at', { ascending: false });

      if (selectedOrgId !== 'all') {
        observationsQuery = observationsQuery.eq('organization_id', selectedOrgId);
      }

      if (selectedZoneId !== 'all') {
        observationsQuery = observationsQuery.eq('zone_id', selectedZoneId);
      }

      const { data: observations, error: obsError } = await observationsQuery;

      if (obsError) throw obsError;

      // Process observations into profile
      const processedObs: VehicleObservation[] = (observations || []).map(obs => ({
        observation_id: obs.observation_id,
        zone_id: obs.zone_id,
        zone_name: (obs.zones as any)?.name || 'Unknown',
        organization_id: obs.organization_id,
        organization_name: (obs.organizations as any)?.name || 'Unknown',
        recorded_at: obs.recorded_at,
        recorded_by: obs.user_profiles ? `${(obs.user_profiles as any).first_name} ${(obs.user_profiles as any).last_name}` : 'Unknown',
        is_self_contained: obs.is_self_contained,
        is_compliant: obs.is_compliant,
        evidence_photos: obs.evidence_photos || [],
        notes: obs.notes,
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
      }));

      // Calculate statistics
      const uniqueZones = new Set(processedObs.map(o => o.zone_id)).size;
      const uniqueOrgs = new Set(processedObs.map(o => o.organization_id)).size;
      const totalBreaches = processedObs.filter(o => !o.is_compliant).length;
      const complianceRate = processedObs.length > 0
        ? Math.round((processedObs.filter(o => o.is_compliant).length / processedObs.length) * 100)
        : 100;

      // Zone distribution
      const zoneCounts = new Map<string, number>();
      processedObs.forEach(obs => {
        zoneCounts.set(obs.zone_name, (zoneCounts.get(obs.zone_name) || 0) + 1);
      });

      const zoneDistribution = Array.from(zoneCounts.entries())
        .map(([zone, count]) => ({ zone, count }))
        .sort((a, b) => b.count - a.count);

      const mostCommonZone = zoneDistribution[0]?.zone || 'N/A';

      // Time distribution (by hour of day)
      const hourCounts = new Map<number, number>();
      processedObs.forEach(obs => {
        const hour = new Date(obs.recorded_at).getHours();
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      });

      const timeDistribution = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        count: hourCounts.get(hour) || 0,
      }));

      // Daily activity (last 30 days)
      const dailyCounts = new Map<string, number>();
      processedObs.forEach(obs => {
        const date = new Date(obs.recorded_at).toISOString().split('T')[0];
        dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
      });

      const dailyActivity = Array.from(dailyCounts.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const profile: VehicleProfile = {
        ...vehicle,
        observations: processedObs,
        unique_zones: uniqueZones,
        unique_organizations: uniqueOrgs,
        total_breaches: totalBreaches,
        compliance_rate: complianceRate,
        most_common_zone: mostCommonZone,
        zone_distribution: zoneDistribution,
        time_distribution: timeDistribution,
        daily_activity: dailyActivity,
      };

      setSelectedVehicle(profile);
    } catch (error: any) {
      console.error('Failed to fetch vehicle profile:', error);
      toast.error('Failed to load vehicle profile');
    } finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchVehicles();
    }
  }, [user, selectedOrgId]);

  // Filter and sort vehicles
  const filteredVehicles = useMemo(() => {
    let filtered = vehicles;

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(v =>
        v.plate_number.toLowerCase().includes(term) ||
        v.vehicle_make?.toLowerCase().includes(term) ||
        v.vehicle_model?.toLowerCase().includes(term)
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'observations') {
        return b.total_observations - a.total_observations;
      } else if (sortBy === 'recent') {
        return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
      }
      return 0;
    });

    return filtered;
  }, [vehicles, searchTerm, sortBy]);

  const exportToCSV = () => {
    const csvData = [
      ['Plate Number', 'Make', 'Model', 'Color', 'Total Observations', 'First Seen', 'Last Seen', 'Homeless', 'Flagged'],
      ...filteredVehicles.map(v => [
        v.plate_number,
        v.vehicle_make || 'N/A',
        v.vehicle_model || 'N/A',
        v.vehicle_color || 'N/A',
        v.total_observations.toString(),
        new Date(v.first_seen_at).toLocaleDateString('en-NZ'),
        new Date(v.last_seen_at).toLocaleDateString('en-NZ'),
        v.is_homeless ? 'Yes' : 'No',
        v.is_flagged ? 'Yes' : 'No',
      ])
    ];

    const csv = csvData.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vehicle-activity-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Report exported to CSV');
  };

  return (
    <div className="space-y-6">
      {/* Header with Export */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1 flex items-center gap-2">
            <Car className="h-7 w-7 text-primary" />
            Vehicle Activity Report
          </h2>
          <p className="text-muted-foreground">
            Individual vehicle profiles with cross-zone movement tracking
          </p>
        </div>
        <Button onClick={exportToCSV} variant="outline" size="lg" className="bg-green-600 text-white hover:bg-green-700 h-12 px-6">
          <Download className="h-5 w-5 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Master Organization Selector */}
      {isMaster && (
        <Card className="border-4 border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 shadow-lg">
          <CardHeader className="bg-blue-100 dark:bg-blue-900/50">
            <CardTitle className="text-lg flex items-center gap-2 text-blue-900 dark:text-blue-100">
              <Filter className="h-6 w-6" />
              🎯 Master Organization Filter
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <OrganizationSelector
              selectedOrg={selectedOrgId}
              onOrgChange={setSelectedOrgId}
              organizations={orgSelectorOrganizations}
              setOrganizations={setOrgSelectorOrganizations}
            />
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Plate, make, model..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>



            <div className="space-y-2">
              <Label>Zone</Label>
              <Select value={selectedZoneId} onValueChange={setSelectedZoneId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Zones</SelectItem>
                  {zones.map(zone => (
                    <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate}
              />
            </div>

            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                max={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div className="space-y-2">
              <Label>Sort By</Label>
              <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="observations">Most Observations</SelectItem>
                  <SelectItem value="recent">Most Recent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Vehicles</p>
                <p className="text-3xl font-bold mt-1">{filteredVehicles.length}</p>
              </div>
              <Car className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Observations</p>
                <p className="text-3xl font-bold mt-1">
                  {filteredVehicles.reduce((sum, v) => sum + v.total_observations, 0).toLocaleString()}
                </p>
              </div>
              <Eye className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Homeless Vehicles</p>
                <p className="text-3xl font-bold mt-1">
                  {filteredVehicles.filter(v => v.is_homeless).length}
                </p>
              </div>
              <Home className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Flagged Vehicles</p>
                <p className="text-3xl font-bold mt-1">
                  {filteredVehicles.filter(v => v.is_flagged).length}
                </p>
              </div>
              <Flag className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vehicle List */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Vehicle Activity ({filteredVehicles.length})
          </CardTitle>
          <CardDescription>Click any vehicle to view detailed profile</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-3" />
              <p>Loading vehicles...</p>
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Car className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No vehicles found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredVehicles.map((vehicle) => (
                <Button
                  key={vehicle.vehicle_id}
                  variant="outline"
                  className="w-full h-auto p-4 justify-start hover:bg-muted"
                  onClick={() => fetchVehicleProfile(vehicle.plate_number)}
                >
                  <div className="flex items-center gap-4 w-full">
                    <VehicleProfilePhoto plateNumber={vehicle.plate_number} size="sm" />
                    
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-bold text-lg">{vehicle.plate_number}</p>
                        {vehicle.is_homeless && (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                            <Home className="h-3 w-3 mr-1" />
                            Homeless
                          </Badge>
                        )}
                        {vehicle.is_flagged && (
                          <Badge variant="destructive">
                            <Flag className="h-3 w-3 mr-1" />
                            Flagged
                          </Badge>
                        )}
                      </div>
                      
                      {(vehicle.vehicle_make || vehicle.vehicle_model) && (
                        <p className="text-sm text-muted-foreground">
                          {[vehicle.vehicle_color, vehicle.vehicle_make, vehicle.vehicle_model]
                            .filter(Boolean)
                            .join(' ')}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {vehicle.total_observations} observations
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Last seen: {new Date(vehicle.last_seen_at).toLocaleDateString('en-NZ')}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <Button variant="ghost" size="icon">
                        <Eye className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vehicle Profile Dialog */}
      <Dialog open={!!selectedVehicle} onOpenChange={() => setSelectedVehicle(null)}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <VehicleProfilePhoto plateNumber={selectedVehicle?.plate_number || ''} size="sm" />
              {selectedVehicle?.plate_number} - Activity Profile
            </DialogTitle>
            <DialogDescription>
              Cross-zone movement patterns and observation history
            </DialogDescription>
          </DialogHeader>

          {loadingProfile ? (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary mb-3" />
              <p>Loading vehicle profile...</p>
            </div>
          ) : selectedVehicle && (
            <div className="space-y-6">
              {/* Status Badges */}
              <div className="flex flex-wrap gap-2">
                <Badge variant={selectedVehicle.compliance_rate >= 80 ? 'default' : 'destructive'}>
                  {selectedVehicle.compliance_rate}% Compliance Rate
                </Badge>
                {selectedVehicle.is_homeless && (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                    <Home className="h-3 w-3 mr-1" />
                    Homeless {selectedVehicle.homeless_confirmed && '(Confirmed)'}
                  </Badge>
                )}
                {selectedVehicle.is_flagged && (
                  <Badge variant="destructive">
                    <Flag className="h-3 w-3 mr-1" />
                    Flagged - {selectedVehicle.flagged_priority?.toUpperCase()}
                  </Badge>
                )}
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Observations</p>
                  <p className="text-2xl font-bold">{selectedVehicle.observations.length}</p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Unique Zones</p>
                  <p className="text-2xl font-bold">{selectedVehicle.unique_zones}</p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Organizations</p>
                  <p className="text-2xl font-bold">{selectedVehicle.unique_organizations}</p>
                </div>
                <div className="p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Breaches</p>
                  <p className="text-2xl font-bold text-red-500">{selectedVehicle.total_breaches}</p>
                </div>
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Zone Distribution */}
                <Card className="border-border">
                  <CardHeader>
                    <CardTitle className="text-base">Zone Distribution</CardTitle>
                    <CardDescription>Observations per zone</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedVehicle.zone_distribution.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        No zone data
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={selectedVehicle.zone_distribution}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ zone, percent }) => `${zone}: ${(percent * 100).toFixed(0)}%`}
                            outerRadius={80}
                            dataKey="count"
                          >
                            {selectedVehicle.zone_distribution.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>

                {/* Time of Day Heatmap */}
                <Card className="border-border">
                  <CardHeader>
                    <CardTitle className="text-base">Time of Day Activity</CardTitle>
                    <CardDescription>Observations by hour (24h format)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={selectedVehicle.time_distribution}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="hour"
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={12}
                          tickFormatter={(hour) => `${hour}:00`}
                        />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--card))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                          }}
                          labelFormatter={(hour) => `Hour: ${hour}:00`}
                        />
                        <Bar dataKey="count" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Daily Activity Trend */}
                <Card className="border-border lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-base">Daily Activity Trend</CardTitle>
                    <CardDescription>Observations per day over time</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={selectedVehicle.daily_activity}>
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
                          labelFormatter={(date) => new Date(date).toLocaleDateString('en-NZ')}
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="#10b981"
                          strokeWidth={2}
                          dot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Observation History */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-base">Observation History ({selectedVehicle.observations.length})</CardTitle>
                  <CardDescription>Most recent sightings first</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {selectedVehicle.observations.map((obs, index) => (
                      <div
                        key={obs.observation_id}
                        className="p-3 bg-muted/30 rounded-lg border border-border"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">#{index + 1}</Badge>
                            <span className="font-semibold text-sm">{obs.zone_name}</span>
                            {!obs.is_compliant && (
                              <Badge variant="destructive" className="text-xs">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Breach
                              </Badge>
                            )}
                            {obs.is_self_contained && (
                              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-500">
                                Self-Contained
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(obs.recorded_at).toLocaleString('en-NZ')}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {obs.organization_name}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {obs.recorded_by}
                          </div>
                        </div>

                        {obs.notes && (
                          <p className="text-sm mt-2 text-muted-foreground">{obs.notes}</p>
                        )}

                        {obs.evidence_photos.length > 0 && (
                          <div className="flex gap-1 mt-2">
                            {obs.evidence_photos.slice(0, 3).map((photo, i) => (
                              <img
                                key={i}
                                src={photo}
                                alt={`Evidence ${i + 1}`}
                                className="h-12 w-12 object-cover rounded border"
                              />
                            ))}
                            {obs.evidence_photos.length > 3 && (
                              <div className="h-12 w-12 bg-muted rounded border flex items-center justify-center text-xs">
                                +{obs.evidence_photos.length - 3}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
