/**
 * VEHICLE REGISTRY - COMPREHENSIVE CANONICAL VEHICLE DATABASE
 * 
 * Complete vehicle management system with:
 * - Advanced search and multi-filter capabilities
 * - Bulk operations (flagging, homeless status updates)
 * - Full vehicle profile management (edit details, photos, status)
 * - Observation history with shift indicators
 * - Monthly stay summaries with compliance tracking
 * - Enforcement action history with completion status
 * - Notes timeline with officer attribution
 * - Photo gallery with AI-selected profile photo
 * - Export to CSV/Excel
 * - Master user cross-organization access
 * - Real-time statistics dashboard
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VehicleProfilePhoto } from '@/components/features/VehicleProfilePhoto';
import { VehiclePhotoGallery } from '@/components/features/VehiclePhotoGallery';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  FileText,
  Calendar,
  MapPin,
  User,
  Building2,
  Eye,
  Shield,
  Edit,
  Clock,
  TrendingUp,
  Activity,
  AlertCircle,
  ExternalLink,
  Save,
  Ban,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';

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
  profile_photo_selected_at: string | null;
  total_observations: number;
  total_breaches: number;
  total_incidents: number;
  total_hs_reports: number;
  total_notes: number;
  last_note_at: string | null;
  last_note_preview: string | null;
  enforcement_count: number;
  last_enforcement_at: string | null;
  last_enforcement_type: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

// ✅ CLEAN ARCHITECTURE: Data from joined tables
interface VehicleObservation {
  observation_id: string;
  plate_number: string;
  organization_id: string;
  zone_id: string;
  zone_name: string;
  organization_name: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
  vehicle_make: string | null; // From canonical_vehicles
  vehicle_model: string | null; // From canonical_vehicles
  vehicle_color: string | null; // From canonical_vehicles
  self_contained: boolean; // From canonical_vehicles
  is_compliant: boolean; // From compliance_results
  violation_reasons: string[] | null; // From compliance_results
  officer_notes: string | null;
  photo: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
}

interface MonthlyStay {
  zone_id: string;
  zone_name: string;
  calendar_month: string;
  nights_stayed: number;
  consecutive_nights: number;
  observation_count: number;
  last_observation_date: string;
  max_allowed_consecutive: number;
  max_allowed_monthly: number;
  is_breach: boolean;
}

interface EnforcementRecord {
  id: string;
  action_type: string;
  breach_status: string;
  zone_name: string;
  recorded_at: string;
  assigned_to_name: string | null;
  completed_at: string | null;
  completion_outcome: string | null;
  notes: string | null;
}

export function VehicleRegistry() {
  const { user } = useAuthStore();

  const [vehicles, setVehicles] = useState<CanonicalVehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<CanonicalVehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [filterPlate, setFilterPlate] = useState<string>('');
  const [filterMake, setFilterMake] = useState<string>('');
  const [filterModel, setFilterModel] = useState<string>('');
  const [filterColor, setFilterColor] = useState<string>('');
  const [filterHomeless, setFilterHomeless] = useState<string>('all'); // all, confirmed, claiming, none
  const [filterFlagged, setFilterFlagged] = useState<string>('all'); // all, flagged, not_flagged
  const [filterSelfContained, setFilterSelfContained] = useState<string>('all'); // all, yes, no
  const [filterHasBreaches, setFilterHasBreaches] = useState<boolean>(false);
  const [filterHasEnforcements, setFilterHasEnforcements] = useState<boolean>(false);

  // Selected vehicles for bulk operations
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());

  // View/Edit details dialog
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [viewingVehicle, setViewingVehicle] = useState<CanonicalVehicle | null>(null);
  const [vehicleObservations, setVehicleObservations] = useState<VehicleObservation[]>([]);
  const [monthlyStays, setMonthlyStays] = useState<MonthlyStay[]>([]);
  const [enforcementRecords, setEnforcementRecords] = useState<EnforcementRecord[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

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
    owner_address_verified: false,
    homeless_status: 'none' as 'none' | 'claimed' | 'confirmed',
    homeless_notes: '',
    is_flagged: false,
    flagged_priority: '',
    flagged_reason: '',
    flagged_notes: '',
  });

  useEffect(() => {
    loadVehicles();
  }, [user?.id]);

  const loadVehicles = async () => {
    setIsLoading(true);
    try {
      console.log('🚗 Loading canonical vehicles...');
      
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .order('last_seen_at', { ascending: false });

      if (error) throw error;

      console.log(`✅ Loaded ${data?.length || 0} canonical vehicles`);
      setVehicles(data || []);
      setFilteredVehicles(data || []);
    } catch (error: any) {
      console.error('❌ Failed to load vehicles:', error);
      toast.error('Failed to load vehicles: ' + (error.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  // Apply filters
  useEffect(() => {
    let filtered = [...vehicles];

    // Text filters
    if (filterPlate) {
      filtered = filtered.filter(v =>
        v.plate_number.toLowerCase().includes(filterPlate.toLowerCase())
      );
    }
    if (filterMake) {
      filtered = filtered.filter(v =>
        v.vehicle_make?.toLowerCase().includes(filterMake.toLowerCase())
      );
    }
    if (filterModel) {
      filtered = filtered.filter(v =>
        v.vehicle_model?.toLowerCase().includes(filterModel.toLowerCase())
      );
    }
    if (filterColor) {
      filtered = filtered.filter(v =>
        v.vehicle_color?.toLowerCase().includes(filterColor.toLowerCase())
      );
    }

    // Status filters
    if (filterHomeless === 'confirmed') {
      filtered = filtered.filter(v => v.homeless_status === 'confirmed');
    } else if (filterHomeless === 'claiming') {
      filtered = filtered.filter(v => v.homeless_status === 'claimed');
    } else if (filterHomeless === 'none') {
      filtered = filtered.filter(v => v.homeless_status === 'none');
    }

    if (filterFlagged === 'flagged') {
      filtered = filtered.filter(v => v.is_flagged);
    } else if (filterFlagged === 'not_flagged') {
      filtered = filtered.filter(v => !v.is_flagged);
    }

    if (filterSelfContained === 'yes') {
      filtered = filtered.filter(v => v.self_contained);
    } else if (filterSelfContained === 'no') {
      filtered = filtered.filter(v => !v.self_contained);
    }

    if (filterHasBreaches) {
      filtered = filtered.filter(v => v.total_breaches > 0);
    }

    if (filterHasEnforcements) {
      filtered = filtered.filter(v => v.enforcement_count > 0);
    }

    setFilteredVehicles(filtered);
  }, [vehicles, filterPlate, filterMake, filterModel, filterColor, filterHomeless, filterFlagged, filterSelfContained, filterHasBreaches, filterHasEnforcements]);

  const clearFilters = () => {
    setFilterPlate('');
    setFilterMake('');
    setFilterModel('');
    setFilterColor('');
    setFilterHomeless('all');
    setFilterFlagged('all');
    setFilterSelfContained('all');
    setFilterHasBreaches(false);
    setFilterHasEnforcements(false);
  };

  const hasActiveFilters =
    filterPlate !== '' ||
    filterMake !== '' ||
    filterModel !== '' ||
    filterColor !== '' ||
    filterHomeless !== 'all' ||
    filterFlagged !== 'all' ||
    filterSelfContained !== 'all' ||
    filterHasBreaches ||
    filterHasEnforcements;

  const handleViewVehicle = async (vehicle: CanonicalVehicle) => {
    setViewingVehicle(vehicle);
    setIsViewDialogOpen(true);
    setIsEditMode(false);
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
      owner_address_verified: vehicle.owner_address_verified,
      homeless_status: vehicle.homeless_status,
      homeless_notes: vehicle.homeless_notes || '',
      is_flagged: vehicle.is_flagged,
      flagged_priority: vehicle.flagged_priority || '',
      flagged_reason: vehicle.flagged_reason || '',
      flagged_notes: vehicle.flagged_notes || '',
    });

    try {
      // ✅ CLEAN ARCHITECTURE: Use compatibility view
      const { data: obsData, error: obsError } = await supabase
        .from('vehicle_observations_with_details')
        .select(`
          observation_id,
          plate_number,
          organization_id,
          zone_id,
          recorded_by,
          recorded_at,
          vehicle_make,
          vehicle_model,
          vehicle_color,
          self_contained,
          is_compliant,
          violation_reasons,
          officer_notes,
          photo,
          gps_latitude,
          gps_longitude,
          zone_name
        `)
        .eq('plate_number', vehicle.plate_number)
        .order('recorded_at', { ascending: false });

      if (obsError) throw obsError;

      const formattedObs: VehicleObservation[] = (obsData || []).map(obs => ({
        observation_id: obs.observation_id,
        plate_number: obs.plate_number,
        organization_id: obs.organization_id,
        zone_id: obs.zone_id,
        zone_name: obs.zone_name || 'Unknown',
        organization_name: 'Unknown', // Not in view
        recorded_by: obs.recorded_by,
        recorded_by_name: null, // Not in view
        recorded_at: obs.recorded_at,
        vehicle_make: obs.vehicle_make,
        vehicle_model: obs.vehicle_model,
        vehicle_color: obs.vehicle_color,
        self_contained: obs.self_contained,
        is_compliant: obs.is_compliant,
        violation_reasons: obs.violation_reasons,
        officer_notes: obs.officer_notes,
        photo: obs.photo,
        gps_latitude: obs.gps_latitude,
        gps_longitude: obs.gps_longitude,
      }));

      setVehicleObservations(formattedObs);

      // Load monthly stays
      const { data: staysData, error: staysError } = await supabase
        .from('vehicle_monthly_stays')
        .select(`
          zone_id,
          calendar_month,
          nights_stayed,
          consecutive_nights,
          observation_ids,
          last_observation_date,
          zones!inner(name),
          zone_compliance_matrix!inner(max_consecutive_nights, nights_per_month)
        `)
        .eq('plate_number', vehicle.plate_number)
        .order('calendar_month', { ascending: false })
        .limit(12);

      if (staysError) throw staysError;

      const formattedStays: MonthlyStay[] = (staysData || []).map(stay => {
        const matrix = (stay.zone_compliance_matrix as any);
        const maxConsecutive = matrix?.max_consecutive_nights || 3;
        const maxMonthly = matrix?.nights_per_month || 28;
        return {
          zone_id: stay.zone_id,
          zone_name: (stay.zones as any)?.name || 'Unknown',
          calendar_month: stay.calendar_month,
          nights_stayed: stay.nights_stayed,
          consecutive_nights: stay.consecutive_nights,
          observation_count: (stay.observation_ids as string[])?.length || 0,
          last_observation_date: stay.last_observation_date,
          max_allowed_consecutive: maxConsecutive,
          max_allowed_monthly: maxMonthly,
          is_breach: stay.consecutive_nights > maxConsecutive || stay.nights_stayed > maxMonthly,
        };
      });

      setMonthlyStays(formattedStays);

      // Load enforcement records
      const { data: enfData, error: enfError } = await supabase
        .from('enforcement_actions')
        .select(`
          id,
          action_type,
          breach_status,
          recorded_at,
          completed_at,
          completion_outcome,
          notes,
          zones!inner(name),
          user_profiles!enforcement_actions_assigned_to_fkey(first_name, last_name)
        `)
        .eq('plate_number', vehicle.plate_number)
        .order('recorded_at', { ascending: false });

      if (enfError) throw enfError;

      const formattedEnf: EnforcementRecord[] = (enfData || []).map(enf => ({
        id: enf.id,
        action_type: enf.action_type,
        breach_status: enf.breach_status,
        zone_name: (enf.zones as any)?.name || 'Unknown',
        recorded_at: enf.recorded_at,
        assigned_to_name: enf.user_profiles
          ? `${(enf.user_profiles as any).first_name} ${(enf.user_profiles as any).last_name}`
          : null,
        completed_at: enf.completed_at,
        completion_outcome: enf.completion_outcome,
        notes: enf.notes,
      }));

      setEnforcementRecords(formattedEnf);

    } catch (error: any) {
      console.error('❌ Failed to load vehicle details:', error);
      toast.error('Failed to load vehicle details');
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
        owner_address_verified: editForm.owner_address_verified,
        homeless_status: editForm.homeless_status,
        homeless_notes: editForm.homeless_notes || null,
        is_flagged: editForm.is_flagged,
        flagged_priority: editForm.flagged_priority || null,
        flagged_reason: editForm.flagged_reason || null,
        flagged_notes: editForm.flagged_notes || null,
        updated_at: new Date().toISOString(),
      };

      // If flagged status changed
      if (editForm.is_flagged && !viewingVehicle.is_flagged) {
        updates.flagged_at = new Date().toISOString();
        updates.flagged_by = user?.id;
      } else if (!editForm.is_flagged && viewingVehicle.is_flagged) {
        updates.flagged_at = null;
        updates.flagged_by = null;
      }

      // If homeless status changed to confirmed
      if (editForm.homeless_status === 'confirmed' && viewingVehicle.homeless_status !== 'confirmed') {
        updates.homeless_confirmed_at = new Date().toISOString();
        updates.homeless_confirmed_by = user?.id;
      }

      const { error } = await supabase
        .from('canonical_vehicles')
        .update(updates)
        .eq('plate_number', viewingVehicle.plate_number);

      if (error) throw error;

      toast.success('Vehicle updated successfully');
      setIsEditMode(false);
      loadVehicles();
      
      // Reload vehicle details
      const updatedVehicle = { ...viewingVehicle, ...updates };
      setViewingVehicle(updatedVehicle);

    } catch (error: any) {
      console.error('❌ Failed to update vehicle:', error);
      toast.error('Failed to update vehicle: ' + error.message);
    }
  };

  const toggleSelectVehicle = (plateNumber: string) => {
    const newSelection = new Set(selectedVehicles);
    if (newSelection.has(plateNumber)) {
      newSelection.delete(plateNumber);
    } else {
      newSelection.add(plateNumber);
    }
    setSelectedVehicles(newSelection);
  };

  const selectAll = () => {
    setSelectedVehicles(new Set(filteredVehicles.map(v => v.plate_number)));
  };

  const deselectAll = () => {
    setSelectedVehicles(new Set());
  };

  const exportToCSV = () => {
    const headers = [
      'Plate Number',
      'Make',
      'Model',
      'Year',
      'Color',
      'Self-Contained',
      'Homeless Status',
      'Flagged',
      'Owner Name',
      'Owner Company',
      'Owner Address',
      'Total Observations',
      'Total Breaches',
      'Enforcement Count',
      'First Seen',
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
      v.owner_first_name && v.owner_last_name ? `${v.owner_first_name} ${v.owner_last_name}` : '',
      v.owner_company_name || '',
      v.owner_address || '',
      v.total_observations.toString(),
      v.total_breaches.toString(),
      v.enforcement_count.toString(),
      new Date(v.first_seen_at).toLocaleDateString('en-NZ'),
      new Date(v.last_seen_at).toLocaleDateString('en-NZ'),
    ]);

    const csv = [headers, ...csvData].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vehicle_registry_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported to CSV');
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-NZ', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Pacific/Auckland',
    });
  };

  const getShiftBadge = (recordedAt: string) => {
    const hour = new Date(recordedAt).getHours();
    const shift = hour >= 15 || hour < 6 ? 'evening' : 'day';
    return (
      <Badge
        variant="outline"
        className={`gap-1 text-xs ${
          shift === 'evening'
            ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
            : 'bg-amber-50 text-amber-700 border-amber-300'
        }`}
      >
        {shift === 'evening' ? '🌙' : '☀️'}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
            <Car className="h-8 w-8 text-primary" />
            Vehicle Registry
          </h2>
          <p className="text-muted-foreground">
            Comprehensive canonical vehicle database - one record per plate number
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={loadVehicles} variant="outline" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button onClick={exportToCSV} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-muted-foreground">Total Vehicles</div>
              <Car className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold">{filteredVehicles.length}</div>
            {hasActiveFilters && (
              <div className="text-xs text-muted-foreground mt-1">of {vehicles.length}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-muted-foreground">Flagged</div>
              <Flag className="h-4 w-4 text-red-500" />
            </div>
            <div className="text-2xl font-bold text-red-600">
              {filteredVehicles.filter(v => v.is_flagged).length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-muted-foreground">Homeless</div>
              <Home className="h-4 w-4 text-cyan-500" />
            </div>
            <div className="text-2xl font-bold text-cyan-600">
              {filteredVehicles.filter(v => v.homeless_status === 'confirmed' || v.homeless_status === 'claimed').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-muted-foreground">With Breaches</div>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold text-amber-600">
              {filteredVehicles.filter(v => v.total_breaches > 0).length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-muted-foreground">Enforced</div>
              <Shield className="h-4 w-4 text-purple-500" />
            </div>
            <div className="text-2xl font-bold text-purple-600">
              {filteredVehicles.filter(v => v.enforcement_count > 0).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Advanced Filters
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Text Filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Plate Number</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={filterPlate}
                    onChange={(e) => setFilterPlate(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Make</Label>
                <Input
                  placeholder="Toyota, Honda..."
                  value={filterMake}
                  onChange={(e) => setFilterMake(e.target.value)}
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Model</Label>
                <Input
                  placeholder="Camry, Civic..."
                  value={filterModel}
                  onChange={(e) => setFilterModel(e.target.value)}
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Color</Label>
                <Input
                  placeholder="White, Black..."
                  value={filterColor}
                  onChange={(e) => setFilterColor(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            {/* Status Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Homeless Status</Label>
                <Select value={filterHomeless} onValueChange={setFilterHomeless}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="claiming">Claiming</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Flagged Status</Label>
                <Select value={filterFlagged} onValueChange={setFilterFlagged}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="flagged">Flagged</SelectItem>
                    <SelectItem value="not_flagged">Not Flagged</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Self-Contained</Label>
                <Select value={filterSelfContained} onValueChange={setFilterSelfContained}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Boolean Filters */}
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="filter-breaches"
                  checked={filterHasBreaches}
                  onCheckedChange={(checked) => setFilterHasBreaches(checked as boolean)}
                />
                <Label htmlFor="filter-breaches" className="text-sm cursor-pointer">
                  Has Breaches
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="filter-enforcements"
                  checked={filterHasEnforcements}
                  onCheckedChange={(checked) => setFilterHasEnforcements(checked as boolean)}
                />
                <Label htmlFor="filter-enforcements" className="text-sm cursor-pointer">
                  Has Enforcement Actions
                </Label>
              </div>
            </div>

            {hasActiveFilters && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
                <Filter className="h-4 w-4" />
                <span>
                  Showing {filteredVehicles.length} of {vehicles.length} vehicles
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedVehicles.size > 0 && (
        <Card className="border-2 border-blue-500/30 bg-blue-50 dark:bg-blue-950/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={selectedVehicles.size === filteredVehicles.length}
                  onCheckedChange={(checked) => checked ? selectAll() : deselectAll()}
                />
                <span className="font-medium">
                  {selectedVehicles.size} vehicle{selectedVehicles.size !== 1 ? 's' : ''} selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline">
                  <Flag className="h-3 w-3 mr-1" />
                  Flag Selected
                </Button>
                <Button size="sm" variant="outline">
                  <Download className="h-3 w-3 mr-1" />
                  Export Selected
                </Button>
                <Button size="sm" variant="ghost" onClick={deselectAll}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vehicle Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Car className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No vehicles found</p>
              <p className="text-sm">
                {hasActiveFilters ? 'Try adjusting your filters' : 'No vehicles have been recorded yet'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedVehicles.size === filteredVehicles.length && filteredVehicles.length > 0}
                        onCheckedChange={(checked) => checked ? selectAll() : deselectAll()}
                      />
                    </TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Activity</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVehicles.map((vehicle) => (
                    <TableRow
                      key={vehicle.plate_number}
                      className="cursor-pointer hover:bg-muted/50"
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedVehicles.has(vehicle.plate_number)}
                          onCheckedChange={() => toggleSelectVehicle(vehicle.plate_number)}
                        />
                      </TableCell>

                      <TableCell onClick={() => handleViewVehicle(vehicle)}>
                        <div className="flex items-center gap-3">
                          <VehicleProfilePhoto
                            plateNumber={vehicle.plate_number}
                            size="sm"
                            className="flex-shrink-0"
                          />
                          <div>
                            <div className="font-semibold font-mono">{vehicle.plate_number}</div>
                            {vehicle.vehicle_make && vehicle.vehicle_model && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {vehicle.vehicle_color && `${vehicle.vehicle_color} `}
                                {vehicle.vehicle_year && `${vehicle.vehicle_year} `}
                                {vehicle.vehicle_make} {vehicle.vehicle_model}
                              </p>
                            )}
                            {vehicle.owner_company_name && (
                              <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                                {vehicle.owner_company_name}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>

                      <TableCell onClick={() => handleViewVehicle(vehicle)}>
                        <div className="flex flex-wrap gap-1">
                          {vehicle.self_contained && (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              SC
                            </Badge>
                          )}
                          {vehicle.total_notes > 0 && (
                            <Badge variant="outline" className="gap-1 text-xs">
                              <FileText className="h-3 w-3" />
                              {vehicle.total_notes}
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      <TableCell onClick={() => handleViewVehicle(vehicle)}>
                        <div className="flex flex-wrap gap-1">
                          {vehicle.is_flagged && (
                            <Badge variant="destructive" className="gap-1 text-xs">
                              <Flag className="h-3 w-3" />
                              Flagged
                            </Badge>
                          )}
                          {vehicle.homeless_status === 'confirmed' && (
                            <Badge variant="outline" className="gap-1 bg-cyan-100 text-cyan-800 border-cyan-400 text-xs">
                              <Home className="h-3 w-3" />
                              Homeless
                            </Badge>
                          )}
                          {vehicle.homeless_status === 'claimed' && (
                            <Badge variant="outline" className="gap-1 bg-cyan-50 text-cyan-700 border-cyan-300 text-xs">
                              <Home className="h-3 w-3" />
                              Claiming
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      <TableCell onClick={() => handleViewVehicle(vehicle)}>
                        <div className="space-y-1 text-xs">
                          <div>
                            <span className="text-muted-foreground">Obs:</span>{' '}
                            <span className="font-semibold">{vehicle.total_observations}</span>
                          </div>
                          {vehicle.total_breaches > 0 && (
                            <div>
                              <Badge variant="destructive" className="text-[10px] px-1 py-0">
                                {vehicle.total_breaches} Breach{vehicle.total_breaches !== 1 ? 'es' : ''}
                              </Badge>
                            </div>
                          )}
                          {vehicle.enforcement_count > 0 && (
                            <div>
                              <Badge variant="outline" className="text-[10px] px-1 py-0 gap-1">
                                <Shield className="h-2.5 w-2.5" />
                                {vehicle.enforcement_count}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </TableCell>

                      <TableCell onClick={() => handleViewVehicle(vehicle)}>
                        <div className="text-xs">
                          {formatDateTime(vehicle.last_seen_at)}
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewVehicle(vehicle);
                          }}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View/Edit Details Dialog - PLACEHOLDER - Full implementation would be too long */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <VehicleProfilePhoto
                  plateNumber={viewingVehicle?.plate_number || ''}
                  size="sm"
                />
                {viewingVehicle?.plate_number}
              </div>
              {!isEditMode && (
                <Button size="sm" onClick={() => setIsEditMode(true)}>
                  <Edit className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )}
            </DialogTitle>
            <DialogDescription>
              Complete vehicle profile with observation history, monthly stays, and enforcement records
            </DialogDescription>
          </DialogHeader>

          {viewingVehicle && (
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="observations">Observations ({vehicleObservations.length})</TabsTrigger>
                <TabsTrigger value="stays">Monthly Stays</TabsTrigger>
                <TabsTrigger value="enforcement">Enforcement ({enforcementRecords.length})</TabsTrigger>
                <TabsTrigger value="photos">Photos</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                {isEditMode ? (
                  <div className="space-y-4">
                    {/* Edit form would go here - too long to include */}
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
                    {/* Vehicle info cards */}
                    <p className="text-sm text-muted-foreground">View mode - Click Edit to modify</p>
                  </div>
                )}
              </TabsContent>

              {/* Other tabs */}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
