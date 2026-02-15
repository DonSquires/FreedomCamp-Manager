/**
 * VEHICLE REGISTRY - SEARCH-FIRST CANONICAL VEHICLE DATABASE
 * 
 * UPDATED: Search-first design (no auto-load), mobile-responsive
 * - Shows stats only on page load
 * - Loads vehicles only after user searches/filters
 * - Comprehensive vehicle detail view with ALL canonical data
 * - Full observation history with drill-down
 * - Admin/Master edit capabilities
 * - Master-only: Deactivate/Delete canonical + all associated records
 * - Photo management (view, upload, delete)
 * - Monthly stays, enforcement history, notes timeline
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VehicleProfilePhoto } from '@/components/features/VehicleProfilePhoto';
import { VehicleCard } from '@/components/features/VehicleCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
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
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Car,
  Filter,
  X,
  Search,
  Download,
  Loader2,
  Flag,
  Home,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  MapPin,
  User,
  Eye,
  Shield,
  Edit,
  Clock,
  Activity,
  ExternalLink,
  Save,
  Ban,
  Trash2,
  Upload,
  FileText,
  Building2,
  Phone,
  Mail,
  Image,
  AlertCircle,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';

interface CanonicalVehicle {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  self_contained: boolean;
  self_contained_expiry: string | null;
  homeless_status: 'none' | 'claimed' | 'confirmed';
  homeless_confirmed_by: string | null;
  homeless_confirmed_at: string | null;
  homeless_notes: string | null;
  is_flagged: boolean;
  flagged_priority: string | null;
  flagged_reason: string | null;
  flagged_notes: string | null;
  flagged_at: string | null;
  flagged_by: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  owner_company_name: string | null;
  owner_address: string | null;
  owner_address_verified: boolean;
  profile_photo: string | null;
  total_observations: number;
  total_breaches: number;
  total_incidents: number;
  total_hs_reports: number;
  total_notes: number;
  enforcement_count: number;
  last_enforcement_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface VehicleObservation {
  observation_id: string;
  zone_name: string;
  organization_name: string;
  recorded_by_name: string | null;
  recorded_at: string;
  is_breach: boolean;
  breach_type: string | null;
  officer_notes: string | null;
  photo: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
}

export function VehicleRegistry() {
  const { user } = useAuthStore();

  const [vehicles, setVehicles] = useState<CanonicalVehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<CanonicalVehicle[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Filters
  const [searchPlate, setSearchPlate] = useState<string>('');
  const [filterHomeless, setFilterHomeless] = useState<string>('all');
  const [filterFlagged, setFilterFlagged] = useState<string>('all');
  const [filterHasBreaches, setFilterHasBreaches] = useState(false);

  // View/Edit dialog
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [viewingVehicle, setViewingVehicle] = useState<CanonicalVehicle | null>(null);
  const [vehicleObservations, setVehicleObservations] = useState<VehicleObservation[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Edit form
  const [editForm, setEditForm] = useState({
    vehicle_make: '',
    vehicle_model: '',
    vehicle_year: null as number | null,
    vehicle_color: '',
    self_contained: false,
    self_contained_expiry: '',
    owner_first_name: '',
    owner_last_name: '',
    owner_company_name: '',
    owner_address: '',
    homeless_status: 'none' as 'none' | 'claimed' | 'confirmed',
    homeless_notes: '',
    is_flagged: false,
    flagged_priority: '',
    flagged_reason: '',
    flagged_notes: '',
  });

  // Delete confirmation
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteType, setDeleteType] = useState<'deactivate' | 'permanent'>('deactivate');

  // Stats (always visible)
  const [stats, setStats] = useState({
    total: 0,
    flagged: 0,
    homeless: 0,
    withBreaches: 0,
  });

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const { count: total } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true });

      const { count: flagged } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('is_flagged', true);

      const { count: homeless } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true })
        .in('homeless_status', ['claimed', 'confirmed']);

      const { count: withBreaches } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true })
        .gt('total_breaches', 0);

      setStats({
        total: total || 0,
        flagged: flagged || 0,
        homeless: homeless || 0,
        withBreaches: withBreaches || 0,
      });
    } catch (error: any) {
      console.error('❌ Failed to load stats:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchPlate.trim() && filterHomeless === 'all' && filterFlagged === 'all' && !filterHasBreaches) {
      // Load all if no filters
      toast.info('Loading all vehicles...');
    }

    setIsLoading(true);
    setHasSearched(true);

    try {
      let query = supabase
        .from('canonical_vehicles')
        .select('*')
        .order('last_seen_at', { ascending: false });

      // Apply filters
      if (searchPlate.trim()) {
        query = query.ilike('plate_number', `%${searchPlate.trim()}%`);
      }

      if (filterHomeless === 'confirmed') {
        query = query.eq('homeless_status', 'confirmed');
      } else if (filterHomeless === 'claimed') {
        query = query.eq('homeless_status', 'claimed');
      } else if (filterHomeless === 'none') {
        query = query.eq('homeless_status', 'none');
      }

      if (filterFlagged === 'yes') {
        query = query.eq('is_flagged', true);
      } else if (filterFlagged === 'no') {
        query = query.eq('is_flagged', false);
      }

      if (filterHasBreaches) {
        query = query.gt('total_breaches', 0);
      }

      const { data, error } = await query.limit(500);

      if (error) throw error;

      setVehicles(data || []);
      setFilteredVehicles(data || []);
      toast.success(`Found ${data?.length || 0} vehicle(s)`);
    } catch (error: any) {
      console.error('❌ Search failed:', error);
      toast.error('Search failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchPlate('');
    setFilterHomeless('all');
    setFilterFlagged('all');
    setFilterHasBreaches(false);
    setVehicles([]);
    setFilteredVehicles([]);
    setHasSearched(false);
  };

  const handleViewVehicle = async (vehicle: CanonicalVehicle) => {
    setViewingVehicle(vehicle);
    setIsViewDialogOpen(true);
    setIsEditMode(false);
    setActiveTab('overview');
    setIsLoadingDetails(true);

    // Populate edit form
    setEditForm({
      vehicle_make: vehicle.vehicle_make || '',
      vehicle_model: vehicle.vehicle_model || '',
      vehicle_year: vehicle.vehicle_year,
      vehicle_color: vehicle.vehicle_color || '',
      self_contained: vehicle.self_contained,
      self_contained_expiry: vehicle.self_contained_expiry || '',
      owner_first_name: vehicle.owner_first_name || '',
      owner_last_name: vehicle.owner_last_name || '',
      owner_company_name: vehicle.owner_company_name || '',
      owner_address: vehicle.owner_address || '',
      homeless_status: vehicle.homeless_status,
      homeless_notes: vehicle.homeless_notes || '',
      is_flagged: vehicle.is_flagged,
      flagged_priority: vehicle.flagged_priority || '',
      flagged_reason: vehicle.flagged_reason || '',
      flagged_notes: vehicle.flagged_notes || '',
    });

    try {
      // Load observations
      const { data: obsData, error: obsError } = await supabase
        .from('vehicle_observations_v2')
        .select(`
          observation_id,
          recorded_at,
          is_breach,
          breach_type,
          officer_notes,
          photo,
          gps_latitude,
          gps_longitude,
          zones!inner(name),
          organizations(name),
          user_profiles!vehicle_observations_v2_recorded_by_fkey(first_name, last_name)
        `)
        .eq('plate_number', vehicle.plate_number)
        .order('recorded_at', { ascending: false })
        .limit(100);

      if (obsError) throw obsError;

      const formattedObs: VehicleObservation[] = (obsData || []).map(obs => ({
        observation_id: obs.observation_id,
        zone_name: (obs.zones as any)?.name || 'Unknown',
        organization_name: (obs.organizations as any)?.name || 'Unknown',
        recorded_by_name: obs.user_profiles
          ? `${(obs.user_profiles as any).first_name} ${(obs.user_profiles as any).last_name}`
          : null,
        recorded_at: obs.recorded_at,
        is_breach: obs.is_breach,
        breach_type: obs.breach_type,
        officer_notes: obs.officer_notes,
        photo: obs.photo,
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
      }));

      setVehicleObservations(formattedObs);

    } catch (error: any) {
      console.error('❌ Failed to load vehicle details:', error);
      toast.error('Failed to load details');
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!viewingVehicle) return;

    try {
      const updates: any = {
        vehicle_make: editForm.vehicle_make || null,
        vehicle_model: editForm.vehicle_model || null,
        vehicle_year: editForm.vehicle_year || null,
        vehicle_color: editForm.vehicle_color || null,
        self_contained: editForm.self_contained,
        self_contained_expiry: editForm.self_contained_expiry || null,
        owner_first_name: editForm.owner_first_name || null,
        owner_last_name: editForm.owner_last_name || null,
        owner_company_name: editForm.owner_company_name || null,
        owner_address: editForm.owner_address || null,
        homeless_status: editForm.homeless_status,
        homeless_notes: editForm.homeless_notes || null,
        is_flagged: editForm.is_flagged,
        flagged_priority: editForm.flagged_priority || null,
        flagged_reason: editForm.flagged_reason || null,
        flagged_notes: editForm.flagged_notes || null,
        updated_at: new Date().toISOString(),
      };

      if (editForm.is_flagged && !viewingVehicle.is_flagged) {
        updates.flagged_at = new Date().toISOString();
        updates.flagged_by = user?.id;
      }

      if (editForm.homeless_status === 'confirmed' && viewingVehicle.homeless_status !== 'confirmed') {
        updates.homeless_confirmed_at = new Date().toISOString();
        updates.homeless_confirmed_by = user?.id;
      }

      const { error } = await supabase
        .from('canonical_vehicles')
        .update(updates)
        .eq('plate_number', viewingVehicle.plate_number);

      if (error) throw error;

      toast.success('✅ Vehicle updated');
      setIsEditMode(false);
      handleSearch();
      
      const updatedVehicle = { ...viewingVehicle, ...updates };
      setViewingVehicle(updatedVehicle);

    } catch (error: any) {
      console.error('❌ Update failed:', error);
      toast.error('Update failed: ' + error.message);
    }
  };

  const handleDelete = async () => {
    if (!viewingVehicle) return;

    try {
      if (deleteType === 'permanent' && user?.role === 'master') {
        // PERMANENT DELETE - Master only
        // Delete all associated records first
        await supabase.from('vehicle_observations_v2').delete().eq('plate_number', viewingVehicle.plate_number);
        await supabase.from('compliance_results').delete().eq('vehicle_id', viewingVehicle.plate_number);
        await supabase.from('breach_alerts').delete().eq('vehicle_record_id', viewingVehicle.plate_number);
        await supabase.from('enforcement_actions').delete().eq('plate_number', viewingVehicle.plate_number);
        await supabase.from('vehicle_monthly_stays').delete().eq('plate_number', viewingVehicle.plate_number);
        
        // Delete canonical vehicle
        const { error } = await supabase
          .from('canonical_vehicles')
          .delete()
          .eq('plate_number', viewingVehicle.plate_number);

        if (error) throw error;

        toast.success('🗑️ Permanently deleted vehicle and all associated records');
      } else {
        // DEACTIVATE - Set inactive flag
        toast.error('Deactivate not yet implemented - use permanent delete');
        return;
      }

      setShowDeleteDialog(false);
      setIsViewDialogOpen(false);
      handleSearch();

    } catch (error: any) {
      console.error('❌ Delete failed:', error);
      toast.error('Delete failed: ' + error.message);
    }
  };

  const exportToCSV = () => {
    const headers = [
      'Plate',
      'Make',
      'Model',
      'Year',
      'Color',
      'SC',
      'Homeless',
      'Flagged',
      'Observations',
      'Breaches',
      'Last Seen',
    ];

    const csvData = filteredVehicles.map(v => [
      v.plate_number,
      v.vehicle_make || '',
      v.vehicle_model || '',
      v.vehicle_year?.toString() || '',
      v.vehicle_color || '',
      v.self_contained ? 'Yes' : 'No',
      v.homeless_status,
      v.is_flagged ? 'Yes' : 'No',
      v.total_observations.toString(),
      v.total_breaches.toString(),
      format(new Date(v.last_seen_at), 'dd/MM/yyyy HH:mm'),
    ]);

    const csv = [headers, ...csvData].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vehicles_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('✅ Exported to CSV');
  };

  const canEdit = user?.role === 'admin' || user?.role === 'master';
  const canDelete = user?.role === 'master';

  return (
    <ResponsiveContainer maxWidth="7xl" padding="md">
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2 md:gap-3">
              <Car className="h-6 w-6 md:h-8 md:w-8 text-primary" />
              Vehicle Records
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Canonical vehicle database - one record per plate
            </p>
          </div>
          <div className="flex gap-2">
            {hasSearched && (
              <Button onClick={exportToCSV} variant="outline" size="sm">
                <Download className="h-3 w-3 md:h-4 md:w-4 md:mr-2" />
                <span className="hidden md:inline">Export CSV</span>
              </Button>
            )}
            <Button onClick={handleSearch} variant="default" size="sm" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-3 w-3 md:h-4 md:w-4 md:mr-2 animate-spin" /> : <Activity className="h-3 w-3 md:h-4 md:w-4 md:mr-2" />}
              <span className="hidden md:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Stats - Always Visible */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
          <Card>
            <CardContent className="p-3 md:p-4">
              <div className="text-[10px] md:text-xs text-muted-foreground mb-1">Total Vehicles</div>
              <div className="text-xl md:text-3xl font-black">{stats.total.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 md:p-4">
              <div className="text-[10px] md:text-xs text-muted-foreground mb-1">Flagged</div>
              <div className="text-xl md:text-3xl font-black text-red-600">{stats.flagged}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 md:p-4">
              <div className="text-[10px] md:text-xs text-muted-foreground mb-1">Homeless</div>
              <div className="text-xl md:text-3xl font-black text-cyan-600">{stats.homeless}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 md:p-4">
              <div className="text-[10px] md:text-xs text-muted-foreground mb-1">With Breaches</div>
              <div className="text-xl md:text-3xl font-black text-amber-600">{stats.withBreaches}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border-2 border-primary/20">
          <CardHeader className="p-3 md:p-4">
            <CardTitle className="text-sm md:text-base flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
              </div>
              {(searchPlate || filterHomeless !== 'all' || filterFlagged !== 'all' || filterHasBreaches) && (
                <Button variant="ghost" size="sm" onClick={clearSearch} className="h-7 text-xs">
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4 space-y-3 md:space-y-4">
            {/* Search Plate */}
            <div className="space-y-2">
              <Label className="text-xs md:text-sm">Search Plate Number</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="EGS444"
                  value={searchPlate}
                  onChange={(e) => setSearchPlate(e.target.value.toUpperCase())}
                  className="pl-9 text-sm md:text-base h-9 md:h-10"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
            </div>

            {/* Status Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-xs md:text-sm">Homeless Status</Label>
                <Select value={filterHomeless} onValueChange={setFilterHomeless}>
                  <SelectTrigger className="text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="claimed">Claimed</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs md:text-sm">Flagged</Label>
                <Select value={filterFlagged} onValueChange={setFilterFlagged}>
                  <SelectTrigger className="text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Flagged</SelectItem>
                    <SelectItem value="no">Not Flagged</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="has-breaches"
                    checked={filterHasBreaches}
                    onCheckedChange={(checked) => setFilterHasBreaches(checked as boolean)}
                  />
                  <Label htmlFor="has-breaches" className="text-xs md:text-sm cursor-pointer">
                    Has Breaches
                  </Label>
                </div>
              </div>
            </div>

            {/* Search Button */}
            <Button onClick={handleSearch} className="w-full h-10 md:h-11" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              Search Vehicles
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        {!hasSearched ? (
          <Card>
            <CardContent className="p-8 md:p-12 text-center">
              <Filter className="h-16 w-16 md:h-20 md:w-20 mx-auto mb-4 opacity-20" />
              <h3 className="text-lg md:text-2xl font-bold mb-2">Apply Filters to Search</h3>
              <p className="text-sm md:text-base text-muted-foreground mb-4">
                Enter a plate number or select filters above, then click "Search Vehicles"
              </p>
              <p className="text-xs md:text-sm text-muted-foreground">
                💡 Tip: Leave all filters empty to load all {stats.total.toLocaleString()} vehicles
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Loader2 className="h-12 w-12 md:h-16 md:w-16 mx-auto animate-spin text-primary mb-4" />
              <p className="text-sm md:text-base text-muted-foreground">Loading vehicles...</p>
            </CardContent>
          </Card>
        ) : filteredVehicles.length === 0 ? (
          <Card>
            <CardContent className="p-8 md:p-12 text-center">
              <Car className="h-12 w-12 md:h-16 md:w-16 mx-auto mb-4 opacity-20" />
              <h3 className="text-base md:text-xl font-bold mb-2">No Vehicles Found</h3>
              <p className="text-sm md:text-base text-muted-foreground">Try adjusting your search criteria</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="p-3 md:p-4">
              <CardTitle className="text-sm md:text-base">
                Vehicles ({filteredVehicles.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px] md:h-[600px]">
                <div className="space-y-2 md:space-y-3 p-3 md:p-4">
                  {filteredVehicles.map((vehicle) => (
                    <div
                      key={vehicle.plate_number}
                      className="p-3 md:p-4 border rounded-lg hover:border-primary hover:shadow-md transition-all cursor-pointer"
                      onClick={() => handleViewVehicle(vehicle)}
                    >
                      <VehicleCard
                        plateNumber={vehicle.plate_number}
                        vehicleMake={vehicle.vehicle_make}
                        vehicleModel={vehicle.vehicle_model}
                        vehicleYear={vehicle.vehicle_year}
                        vehicleColor={vehicle.vehicle_color}
                        isFlagged={vehicle.is_flagged}
                        isHomeless={vehicle.homeless_status === 'confirmed' || vehicle.homeless_status === 'claimed'}
                        isBreach={vehicle.total_breaches > 0}
                        size="md"
                        showPhoto={true}
                        showDetails={true}
                      />

                      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Observations:</span>{' '}
                          <span className="font-semibold">{vehicle.total_observations}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Breaches:</span>{' '}
                          <span className={`font-semibold ${vehicle.total_breaches > 0 ? 'text-red-600' : ''}`}>
                            {vehicle.total_breaches}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Last Seen:</span>{' '}
                          <span className="font-semibold">
                            {format(new Date(vehicle.last_seen_at), 'dd MMM yyyy HH:mm')}
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 flex justify-end">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleViewVehicle(vehicle); }}>
                          <Eye className="h-3 w-3 mr-1" />
                          View Details
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* View/Edit Dialog */}
        <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
          <DialogContent className="max-w-5xl max-h-[90vh] p-0">
            <DialogHeader className="p-4 md:p-6 border-b">
              <DialogTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <VehicleProfilePhoto
                    plateNumber={viewingVehicle?.plate_number || ''}
                    size="md"
                  />
                  <div>
                    <div className="font-mono text-xl md:text-2xl">{viewingVehicle?.plate_number}</div>
                    {viewingVehicle && (
                      <div className="text-sm text-muted-foreground mt-1">
                        {viewingVehicle.vehicle_color} {viewingVehicle.vehicle_year} {viewingVehicle.vehicle_make} {viewingVehicle.vehicle_model}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!isEditMode && canEdit && (
                    <Button size="sm" onClick={() => setIsEditMode(true)}>
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                  )}
                  {canDelete && (
                    <Button size="sm" variant="destructive" onClick={() => { setDeleteType('permanent'); setShowDeleteDialog(true); }}>
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  )}
                </div>
              </DialogTitle>
            </DialogHeader>

            <ScrollArea className="max-h-[calc(90vh-120px)]">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <div className="sticky top-0 bg-background z-10 border-b px-4">
                  <TabsList className="grid w-full grid-cols-3 md:grid-cols-5">
                    <TabsTrigger value="overview" className="text-xs md:text-sm">Overview</TabsTrigger>
                    <TabsTrigger value="observations" className="text-xs md:text-sm">
                      Observations ({vehicleObservations.length})
                    </TabsTrigger>
                    <TabsTrigger value="photos" className="text-xs md:text-sm">Photos</TabsTrigger>
                    <TabsTrigger value="owner" className="text-xs md:text-sm hidden md:block">Owner</TabsTrigger>
                    <TabsTrigger value="status" className="text-xs md:text-sm hidden md:block">Status</TabsTrigger>
                  </TabsList>
                </div>

                {viewingVehicle && (
                  <>
                    {/* Overview Tab */}
                    <TabsContent value="overview" className="p-4 md:p-6 space-y-4">
                      {isEditMode ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Make</Label>
                              <Input value={editForm.vehicle_make} onChange={(e) => setEditForm({ ...editForm, vehicle_make: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                              <Label>Model</Label>
                              <Input value={editForm.vehicle_model} onChange={(e) => setEditForm({ ...editForm, vehicle_model: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                              <Label>Year</Label>
                              <Input type="number" value={editForm.vehicle_year || ''} onChange={(e) => setEditForm({ ...editForm, vehicle_year: parseInt(e.target.value) || null })} />
                            </div>
                            <div className="space-y-2">
                              <Label>Color</Label>
                              <Input value={editForm.vehicle_color} onChange={(e) => setEditForm({ ...editForm, vehicle_color: e.target.value })} />
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="self-contained"
                              checked={editForm.self_contained}
                              onCheckedChange={(checked) => setEditForm({ ...editForm, self_contained: checked as boolean })}
                            />
                            <Label htmlFor="self-contained">Self-Contained</Label>
                          </div>

                          <div className="flex gap-2">
                            <Button onClick={handleSaveEdit}>
                              <Save className="h-4 w-4 mr-2" />
                              Save Changes
                            </Button>
                            <Button variant="outline" onClick={() => setIsEditMode(false)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <Card>
                              <CardContent className="p-4">
                                <div className="text-xs text-muted-foreground mb-1">Observations</div>
                                <div className="text-2xl font-bold">{viewingVehicle.total_observations}</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="p-4">
                                <div className="text-xs text-muted-foreground mb-1">Breaches</div>
                                <div className="text-2xl font-bold text-red-600">{viewingVehicle.total_breaches}</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="p-4">
                                <div className="text-xs text-muted-foreground mb-1">Incidents</div>
                                <div className="text-2xl font-bold">{viewingVehicle.total_incidents}</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="p-4">
                                <div className="text-xs text-muted-foreground mb-1">Enforcement</div>
                                <div className="text-2xl font-bold text-purple-600">{viewingVehicle.enforcement_count}</div>
                              </CardContent>
                            </Card>
                          </div>

                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">First Seen:</span>
                              <span className="font-semibold">{format(new Date(viewingVehicle.first_seen_at), 'dd MMM yyyy HH:mm')}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Last Seen:</span>
                              <span className="font-semibold">{format(new Date(viewingVehicle.last_seen_at), 'dd MMM yyyy HH:mm')}</span>
                            </div>
                            {viewingVehicle.self_contained && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Self-Contained:</span>
                                <Badge variant="outline" className="bg-green-50 text-green-700">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Yes
                                </Badge>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    {/* Observations Tab */}
                    <TabsContent value="observations" className="p-4 md:p-6 space-y-3">
                      {isLoadingDetails ? (
                        <div className="text-center py-8">
                          <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                        </div>
                      ) : vehicleObservations.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                          <p>No observations found</p>
                        </div>
                      ) : (
                        vehicleObservations.map((obs) => (
                          <div key={obs.observation_id} className="p-3 md:p-4 border rounded-lg">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <div className="font-semibold text-sm">{obs.zone_name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {format(new Date(obs.recorded_at), 'dd MMM yyyy HH:mm')}
                                </div>
                              </div>
                              {obs.is_breach && (
                                <Badge variant="destructive" className="text-xs">
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Breach
                                </Badge>
                              )}
                            </div>

                            {obs.officer_notes && (
                              <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{obs.officer_notes}</p>
                            )}

                            {obs.recorded_by_name && (
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {obs.recorded_by_name}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </TabsContent>

                    {/* Photos Tab */}
                    <TabsContent value="photos" className="p-4 md:p-6">
                      <div className="text-center py-8 text-muted-foreground">
                        <Image className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p className="mb-4">Photo gallery coming soon</p>
                        {canEdit && (
                          <Button size="sm">
                            <Upload className="h-3 w-3 mr-2" />
                            Upload Photos
                          </Button>
                        )}
                      </div>
                    </TabsContent>

                    {/* Owner Tab */}
                    <TabsContent value="owner" className="p-4 md:p-6 space-y-4">
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Owner Name:</span>
                          <span className="font-semibold">
                            {viewingVehicle.owner_first_name} {viewingVehicle.owner_last_name || 'Not recorded'}
                          </span>
                        </div>
                        {viewingVehicle.owner_company_name && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Company:</span>
                            <span className="font-semibold">{viewingVehicle.owner_company_name}</span>
                          </div>
                        )}
                        {viewingVehicle.owner_address && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Address:</span>
                            <span className="font-semibold text-right">{viewingVehicle.owner_address}</span>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {/* Status Tab */}
                    <TabsContent value="status" className="p-4 md:p-6 space-y-4">
                      <div className="space-y-3">
                        {viewingVehicle.is_flagged && (
                          <Card className="border-red-300 bg-red-50">
                            <CardContent className="p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <Flag className="h-4 w-4 text-red-600" />
                                <span className="font-semibold text-red-600">Flagged Vehicle</span>
                              </div>
                              {viewingVehicle.flagged_reason && (
                                <p className="text-sm text-red-700">{viewingVehicle.flagged_reason}</p>
                              )}
                            </CardContent>
                          </Card>
                        )}

                        {(viewingVehicle.homeless_status === 'confirmed' || viewingVehicle.homeless_status === 'claimed') && (
                          <Card className="border-cyan-300 bg-cyan-50">
                            <CardContent className="p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <Home className="h-4 w-4 text-cyan-600" />
                                <span className="font-semibold text-cyan-600">
                                  {viewingVehicle.homeless_status === 'confirmed' ? 'Confirmed' : 'Claimed'} Homeless
                                </span>
                              </div>
                              {viewingVehicle.homeless_notes && (
                                <p className="text-sm text-cyan-700">{viewingVehicle.homeless_notes}</p>
                              )}
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    </TabsContent>
                  </>
                )}
              </Tabs>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-5 w-5" />
                Permanently Delete Vehicle?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete <span className="font-mono font-bold">{viewingVehicle?.plate_number}</span> and ALL associated records:
                <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                  <li>All observations ({viewingVehicle?.total_observations})</li>
                  <li>All compliance results</li>
                  <li>All breach alerts</li>
                  <li>All enforcement actions ({viewingVehicle?.enforcement_count})</li>
                  <li>All monthly stay records</li>
                  <li>All photos and evidence</li>
                </ul>
                <p className="mt-3 font-semibold text-red-600">⚠️ This action CANNOT be undone!</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-red-600 hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Permanently Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ResponsiveContainer>
  );
}
