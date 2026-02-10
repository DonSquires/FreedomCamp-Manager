
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VehicleProfilePhoto } from '@/components/features/VehicleProfilePhoto';
import { VehiclePhotoGallery } from '@/components/features/VehiclePhotoGallery';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Car,
  Edit,
  Trash2,
  Filter,
  X,
  Calendar,
  MapPin,
  Building2,
  CheckCircle2,
  XCircle,
  Moon,
  User,
  Clock,
  Image as ImageIcon,
  FileText,
  Search,
  Download,
  AlertTriangle,
  Copy,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useZones } from '@/hooks/useZones';
import { useOrganizations } from '@/hooks/useOrganizations';
import { supabase } from '@/lib/supabase';

interface VehicleRecord {
  id: string;
  plate_number: string;
  zone_id: string;
  zone?: { id: string; name: string; organization_id: string; day_visit_only: boolean; self_contained_required: boolean; merged_into_zone_id: string | null };
  organization_id: string;
  organization?: { id: string; name: string };
  recorded_at: string;
  recorded_by: string;
  recorded_by_user?: { first_name: string; last_name: string };
  is_self_contained: boolean;
  is_compliant: boolean;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  evidence_photos: string[];
  notes: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  behavioral_flags: string[];
  requires_followup: boolean;
  followup_reason: string | null;
  followup_priority: string | null;
  weather_conditions: string | null;
  plate_input_method: string | null;
  homeless_claimed: boolean;
  homeless_confirmed: boolean | null;
  homeless_confirmed_by: string | null;
  homeless_confirmed_at: string | null;
}

export function VehicleManagement() {
  const { user } = useAuthStore();
  const { data: zones = [] } = useZones();
  const { data: organizations = [] } = useOrganizations();

  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<VehicleRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Bulk selection
  const [selectedVehicles, setSelectedVehicles] = useState<Set<string>>(new Set());
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [bulkAction, setBulkAction] = useState<'copy' | 'move'>('move');
  const [bulkTargetZone, setBulkTargetZone] = useState<string>('');
  const [bulkTargetOrg, setBulkTargetOrg] = useState<string>('');
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // Filters
  const [filterOrg, setFilterOrg] = useState<string>('all');
  const [filterZone, setFilterZone] = useState<string>('all');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [filterPlate, setFilterPlate] = useState<string>('');
  const [filterCompliance, setFilterCompliance] = useState<string>('all');
  const [filterHomeless, setFilterHomeless] = useState<string>('all');

  // Edit dialog
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRecord | null>(null);

  // Delete dialog
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [vehicleToDelete, setVehicleToDelete] = useState<VehicleRecord | null>(null);

  // View details dialog
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewingVehicle, setViewingVehicle] = useState<VehicleRecord | null>(null);
  
  // Vehicle observations (when viewing details)
  const [vehicleObservations, setVehicleObservations] = useState<any[]>([]);
  const [canonicalVehicle, setCanonicalVehicle] = useState<any>(null);
  const [isLoadingObservations, setIsLoadingObservations] = useState(false);

  // Load vehicles
  const loadVehicles = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('vehicle_records')
        .select(`
          *,
          zone:zones(id, name, organization_id, day_visit_only, self_contained_required, merged_into_zone_id),
          organization:organizations(id, name),
          recorded_by_user:user_profiles!recorded_by(first_name, last_name)
        `)
        .order('recorded_at', { ascending: false });

      // Filter by organization for non-master users
      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id);
      }

      const { data, error } = await query;

      if (error) throw error;

      setVehicles(data || []);
      setFilteredVehicles(data || []);
    } catch (error: any) {
      toast.error('Failed to load vehicles: ' + (error.message || 'Unknown error'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadVehicles();
  }, [user?.id, user?.organization_id, user?.role]); // Added dependencies to useEffect

  // Apply filters
  useEffect(() => {
    let filtered = [...vehicles];

    // Organization filter
    if (filterOrg !== 'all') {
      filtered = filtered.filter(v => v.organization_id === filterOrg);
    }

    // Zone filter
    if (filterZone !== 'all') {
      filtered = filtered.filter(v => v.zone_id === filterZone);
    }

    // Plate search
    if (filterPlate) {
      filtered = filtered.filter(v =>
        v.plate_number.toLowerCase().includes(filterPlate.toLowerCase())
      );
    }

    // Compliance filter
    if (filterCompliance === 'compliant') {
      filtered = filtered.filter(v => v.is_compliant);
    } else if (filterCompliance === 'non-compliant') {
      filtered = filtered.filter(v => !v.is_compliant);
    }

    // Homeless filter
    if (filterHomeless === 'claimed') {
      filtered = filtered.filter(v => v.homeless_claimed);
    } else if (filterHomeless === 'pending') {
      filtered = filtered.filter(v => v.homeless_claimed && v.homeless_confirmed === null);
    } else if (filterHomeless === 'confirmed') {
      filtered = filtered.filter(v => v.homeless_claimed && v.homeless_confirmed === true);
    } else if (filterHomeless === 'declined') {
      filtered = filtered.filter(v => v.homeless_claimed && v.homeless_confirmed === false);
    }

    // Date range filter
    if (filterStartDate) {
      const startDate = new Date(filterStartDate);
      startDate.setHours(0, 0, 0, 0);
      filtered = filtered.filter(v => new Date(v.recorded_at) >= startDate);
    }

    if (filterEndDate) {
      const endDate = new Date(filterEndDate);
      endDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(v => new Date(v.recorded_at) <= endDate);
    }

    setFilteredVehicles(filtered);
  }, [vehicles, filterOrg, filterZone, filterPlate, filterCompliance, filterStartDate, filterEndDate, filterHomeless]);

  const clearFilters = () => {
    setFilterOrg('all');
    setFilterZone('all');
    setFilterPlate('');
    setFilterCompliance('all');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterHomeless('all');
  };

  const hasActiveFilters = filterOrg !== 'all' || filterZone !== 'all' || filterPlate !== '' || 
    filterCompliance !== 'all' || filterStartDate !== '' || filterEndDate !== '' || filterHomeless !== 'all';

  const toggleVehicleSelection = (vehicleId: string) => {
    const newSelection = new Set(selectedVehicles);
    if (newSelection.has(vehicleId)) {
      newSelection.delete(vehicleId);
    } else {
      newSelection.add(vehicleId);
    }
    setSelectedVehicles(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedVehicles.size === filteredVehicles.length) {
      setSelectedVehicles(new Set());
    } else {
      setSelectedVehicles(new Set(filteredVehicles.map(v => v.id)));
    }
  };

  const handleBulkAction = (action: 'copy' | 'move') => {
    if (selectedVehicles.size === 0) {
      toast.error('No vehicles selected');
      return;
    }
    setBulkAction(action);
    setShowBulkDialog(true);
  };

  const executeBulkAction = async () => {
    if (!bulkTargetZone) {
      toast.error('Please select a target zone');
      return;
    }

    const targetZone = zones.find(z => z.id === bulkTargetZone);
    if (!targetZone) {
      toast.error('Target zone not found');
      return;
    }

    const targetOrgId = user?.role === 'master' && bulkTargetOrg ? bulkTargetOrg : targetZone.organization_id;

    setIsBulkProcessing(true);
    try {
      const selectedVehiclesList = vehicles.filter(v => selectedVehicles.has(v.id));

      if (bulkAction === 'move') {
        // Move: Update existing records
        for (const vehicle of selectedVehiclesList) {
          const { error } = await supabase
            .from('vehicle_records')
            .update({
              zone_id: bulkTargetZone,
              organization_id: targetOrgId,
            })
            .eq('id', vehicle.id);

          if (error) throw error;
        }

        toast.success(`Moved ${selectedVehicles.size} vehicle(s) to ${targetZone.name}`);
      } else {
        // Copy: Create duplicate records
        const recordsToCopy = selectedVehiclesList.map(vehicle => ({
          organization_id: targetOrgId,
          zone_id: bulkTargetZone,
          plate_number: vehicle.plate_number,
          is_self_contained: vehicle.is_self_contained,
          is_compliant: vehicle.is_compliant,
          recorded_at: new Date().toISOString(),
          recorded_by: user?.id,
          gps_latitude: vehicle.gps_latitude, // Corrected property name from location_lat
          gps_longitude: vehicle.gps_longitude, // Corrected property name from location_lng
          vehicle_make: vehicle.vehicle_make,
          vehicle_model: vehicle.vehicle_model,
          vehicle_color: vehicle.vehicle_color,
          evidence_photos: vehicle.evidence_photos,
          notes: `Copied from ${vehicle.zone?.name}. Original notes: ${vehicle.notes || 'None'}`,
          behavioral_flags: vehicle.behavioral_flags,
          requires_followup: vehicle.requires_followup,
          followup_reason: vehicle.followup_reason,
          followup_priority: vehicle.followup_priority,
          weather_conditions: vehicle.weather_conditions,
          plate_input_method: vehicle.plate_input_method,
          homeless_claimed: vehicle.homeless_claimed,
        }));

        const { error } = await supabase
          .from('vehicle_records')
          .insert(recordsToCopy);

        if (error) throw error;

        toast.success(`Copied ${selectedVehicles.size} vehicle(s) to ${targetZone.name}`);
      }

      setSelectedVehicles(new Set());
      setShowBulkDialog(false);
      setBulkTargetZone('');
      setBulkTargetOrg('');
      await loadVehicles();
    } catch (error: any) {
      console.error('Bulk action failed:', error);
      toast.error('Failed to complete bulk action: ' + (error.message || 'Unknown error'));
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const openEditDialog = (vehicle: VehicleRecord) => {
    setEditingVehicle({ ...vehicle });
    setIsEditDialogOpen(true);
  };

  const handleUpdateVehicle = async () => {
    if (!editingVehicle) return;

    try {
      // Get the organization_id from the selected zone
      const selectedZone = zones.find(z => z.id === editingVehicle.zone_id);
      if (!selectedZone) {
        toast.error('Selected zone not found');
        return;
      }

      const oldOrgId = vehicles.find(v => v.id === editingVehicle.id)?.organization_id;
      const newOrgId = selectedZone.organization_id;
      const orgChanged = oldOrgId !== newOrgId;

      console.log('🔄 Updating vehicle record:');
      console.log('  - Vehicle ID:', editingVehicle.id);
      console.log('  - Old zone:', vehicles.find(v => v.id === editingVehicle.id)?.zone?.name);
      console.log('  - New zone:', selectedZone.name);
      console.log('  - Old org:', oldOrgId);
      console.log('  - New org:', newOrgId);
      console.log('  - Organization changed:', orgChanged);

      // Perform the update without selecting (to avoid RLS issues when moving to different org)
      const { error } = await supabase
        .from('vehicle_records')
        .update({
          plate_number: editingVehicle.plate_number,
          zone_id: editingVehicle.zone_id,
          organization_id: selectedZone.organization_id, // ✅ Update organization when zone changes
          is_self_contained: editingVehicle.is_self_contained,
          is_compliant: editingVehicle.is_compliant,
          vehicle_make: editingVehicle.vehicle_make,
          vehicle_model: editingVehicle.vehicle_model,
          vehicle_color: editingVehicle.vehicle_color,
          notes: editingVehicle.notes,
          requires_followup: editingVehicle.requires_followup,
          followup_reason: editingVehicle.followup_reason,
          followup_priority: editingVehicle.followup_priority,
        })
        .eq('id', editingVehicle.id);

      if (error) throw error;

      console.log('✅ Vehicle updated successfully');

      // Check if the updated vehicle should still be visible to this user
      const willBeVisible = user?.role === 'master' || newOrgId === user?.organization_id;
      
      if (!willBeVisible && orgChanged) {
        const orgName = organizations.find(o => o.id === newOrgId)?.name || 'another organization';
        toast.success(`Vehicle moved to ${selectedZone.name} (${orgName}). Record no longer visible as it's in a different organization.`);
      } else {
        toast.success('Vehicle record updated successfully');
      }

      setIsEditDialogOpen(false);
      setEditingVehicle(null);
      
      // Force a fresh reload
      await loadVehicles();
    } catch (error: any) {
      console.error('❌ Failed to update vehicle:', error);
      toast.error('Failed to update vehicle: ' + (error.message || 'Unknown error'));
    }
  };

  const handleDeleteVehicle = async () => {
    if (!vehicleToDelete) return;

    try {
      const { error } = await supabase
        .from('vehicle_records')
        .delete()
        .eq('id', vehicleToDelete.id);

      if (error) throw error;

      toast.success('Vehicle record deleted successfully');
      setIsDeleteDialogOpen(false);
      setVehicleToDelete(null);
      loadVehicles();
    } catch (error: any) {
      toast.error('Failed to delete vehicle: ' + (error.message || 'Unknown error'));
    }
  };

  const exportToCSV = () => {
    const headers = [
      'Plate Number',
      'Zone',
      'Organization',
      'Recorded At',
      'Recorded By',
      'Self-Contained',
      'Compliant',
      'Make',
      'Model',
      'Color',
      'Notes',
    ];

    const csvData = filteredVehicles.map(v => [
      v.plate_number,
      v.zone?.name || '',
      v.organization?.name || '',
      new Date(v.recorded_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }),
      v.recorded_by_user ? `${v.recorded_by_user.first_name} ${v.recorded_by_user.last_name}` : '',
      v.is_self_contained ? 'Yes' : 'No',
      v.is_compliant ? 'Yes' : 'No',
      v.vehicle_make || '',
      v.vehicle_model || '',
      v.vehicle_color || '',
      (v.notes || '').replace(/\n/g, ' '),
    ]);

    const csv = [headers, ...csvData].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vehicles_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported to CSV');
  };

  const getComplianceStatus = (vehicle: VehicleRecord) => {
    const recordTime = new Date(vehicle.recorded_at);
    const recordTimeNZ = new Date(recordTime.toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
    const recordHour = recordTimeNZ.getHours();
    const violations: string[] = [];

    const isOvernightStay = recordHour >= 21 || recordHour < 5;

    if (vehicle.zone?.day_visit_only && isOvernightStay) {
      violations.push('Day-visit-only zone: Recorded during overnight hours');
    }

    if (vehicle.zone?.self_contained_required && !vehicle.is_self_contained) {
      violations.push('Zone requires self-contained vehicles');
    }

    return {
      isCompliant: violations.length === 0,
      violations,
      isOvernightStay,
    };
  };

  // Filter zones by selected organization
  const availableZones = filterOrg !== 'all'
    ? zones.filter(z => z.organization_id === filterOrg)
    : zones;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">Vehicle Management</h2>
          <p className="text-muted-foreground">
            View and manage all recorded vehicle records
          </p>
          {selectedVehicles.size > 0 && (
            <Badge variant="secondary" className="mt-1">
              {selectedVehicles.size} vehicle(s) selected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedVehicles.size > 0 && (
            <>
              <Button onClick={() => handleBulkAction('copy')} variant="outline">
                <Car className="h-4 w-4 mr-2" />
                Copy to Zone
              </Button>
              <Button onClick={() => handleBulkAction('move')} variant="outline">
                <MapPin className="h-4 w-4 mr-2" />
                Move to Zone
              </Button>
            </>
          )}
          <Button onClick={exportToCSV} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
            {/* Organization Filter */}
            {user?.role === 'master' && (
              <div className="space-y-2">
                <Label className="text-xs">Organization</Label>
                <Select value={filterOrg} onValueChange={setFilterOrg}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Organizations</SelectItem>
                    {organizations.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Zone Filter */}
            <div className="space-y-2">
              <Label className="text-xs">Zone</Label>
              <Select value={filterZone} onValueChange={setFilterZone}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Zones</SelectItem>
                  {availableZones.filter(z => !z.merged_into_zone_id).map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Plate Search */}
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

            {/* Compliance Filter */}
            <div className="space-y-2">
              <Label className="text-xs">Compliance</Label>
              <Select value={filterCompliance} onValueChange={setFilterCompliance}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="compliant">Compliant</SelectItem>
                  <SelectItem value="non-compliant">Non-Compliant</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Homeless Status Filter */}
            <div className="space-y-2">
              <Label className="text-xs">Homeless Status</Label>
              <Select value={filterHomeless} onValueChange={setFilterHomeless}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="claimed">Any Claim</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Start Date */}
            <div className="space-y-2">
              <Label className="text-xs">Start Date</Label>
              <div className="relative">
                <Calendar className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label className="text-xs">End Date</Label>
              <div className="relative">
                <Calendar className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>
          </div>

          {hasActiveFilters && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Filter className="h-4 w-4" />
              <span>
                Showing {filteredVehicles.length} of {vehicles.length} vehicles
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Vehicle Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading vehicles...</div>
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
                      <input
                        type="checkbox"
                        checked={selectedVehicles.size === filteredVehicles.length && filteredVehicles.length > 0}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 cursor-pointer"
                      />
                    </TableHead>
                    <TableHead>Plate Number</TableHead>
                    <TableHead>Zone</TableHead>
                    {user?.role === 'master' && <TableHead>Organization</TableHead>}
                    <TableHead>Recorded At</TableHead>
                    <TableHead>Self-Contained</TableHead>
                    <TableHead>Compliance</TableHead>
                    <TableHead>Homeless Status</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVehicles.map((vehicle) => {
                    const compliance = getComplianceStatus(vehicle);
                    const recordTimeNZ = new Date(vehicle.recorded_at).toLocaleString('en-NZ', {
                      timeZone: 'Pacific/Auckland',
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });

                    return (
                      <TableRow
                        key={vehicle.id}
                        className="cursor-pointer hover:bg-muted/50"
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedVehicles.has(vehicle.id)}
                            onChange={() => toggleVehicleSelection(vehicle.id)}
                            className="h-4 w-4 cursor-pointer"
                          />
                        </TableCell>
                        <TableCell
                          className="font-medium"
                          onClick={async () => {
                            setViewingVehicle(vehicle);
                            setIsLoadingObservations(true);
                            setIsViewDialogOpen(true);
                            
                            // Fetch canonical vehicle and all observations for this plate
                            try {
                              // Get canonical vehicle
                              const { data: canonicalData, error: canonicalError } = await supabase
                                .from('canonical_vehicles')
                                .select('*')
                                .eq('plate_number', vehicle.plate_number)
                                .single();
                              
                              if (!canonicalError && canonicalData) {
                                setCanonicalVehicle(canonicalData);
                                
                                // Get all observations for this vehicle
                                const { data: obsData, error: obsError } = await supabase
                                  .from('vehicle_observations')
                                  .select(`
                                    *,
                                    zone:zones(name),
                                    organization:organizations(name),
                                    recorded_by_user:user_profiles!vehicle_observations_recorded_by_fkey(first_name, last_name)
                                  `)
                                  .eq('vehicle_id', canonicalData.vehicle_id)
                                  .order('recorded_at', { ascending: false });
                                
                                if (!obsError) {
                                  setVehicleObservations(obsData || []);
                                }
                              }
                            } catch (error) {
                              console.error('Failed to load vehicle details:', error);
                            } finally {
                              setIsLoadingObservations(false);
                            }
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <VehicleProfilePhoto 
                              plateNumber={vehicle.plate_number} 
                              size="sm"
                              className="flex-shrink-0"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{vehicle.plate_number}</span>
                              </div>
                              {vehicle.vehicle_make && vehicle.vehicle_model && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {vehicle.vehicle_make} {vehicle.vehicle_model}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell
                          onClick={async () => {
                            setViewingVehicle(vehicle);
                            setIsLoadingObservations(true);
                            setIsViewDialogOpen(true);
                            
                            // Fetch canonical vehicle and all observations for this plate
                            try {
                              // Get canonical vehicle
                              const { data: canonicalData, error: canonicalError } = await supabase
                                .from('canonical_vehicles')
                                .select('*')
                                .eq('plate_number', vehicle.plate_number)
                                .single();
                              
                              if (!canonicalError && canonicalData) {
                                setCanonicalVehicle(canonicalData);
                                
                                // Get all observations for this vehicle
                                const { data: obsData, error: obsError } = await supabase
                                  .from('vehicle_observations')
                                  .select(`
                                    *,
                                    zone:zones(name),
                                    organization:organizations(name),
                                    recorded_by_user:user_profiles!vehicle_observations_recorded_by_fkey(first_name, last_name)
                                  `)
                                  .eq('vehicle_id', canonicalData.vehicle_id)
                                  .order('recorded_at', { ascending: false });
                                
                                if (!obsError) {
                                  setVehicleObservations(obsData || []);
                                }
                              }
                            } catch (error) {
                              console.error('Failed to load vehicle details:', error);
                            } finally {
                              setIsLoadingObservations(false);
                            }
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            {vehicle.zone?.name || '-'}
                          </div>
                        </TableCell>
                        {user?.role === 'master' && (
                          <TableCell
                            onClick={() => {
                              setViewingVehicle(vehicle);
                              setIsViewDialogOpen(true);
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              {vehicle.organization?.name || '-'}
                            </div>
                          </TableCell>
                        )}
                        <TableCell
                          onClick={async () => {
                            setViewingVehicle(vehicle);
                            setIsLoadingObservations(true);
                            setIsViewDialogOpen(true);
                            
                            // Fetch canonical vehicle and all observations for this plate
                            try {
                              // Get canonical vehicle
                              const { data: canonicalData, error: canonicalError } = await supabase
                                .from('canonical_vehicles')
                                .select('*')
                                .eq('plate_number', vehicle.plate_number)
                                .single();
                              
                              if (!canonicalError && canonicalData) {
                                setCanonicalVehicle(canonicalData);
                                
                                // Get all observations for this vehicle
                                const { data: obsData, error: obsError } = await supabase
                                  .from('vehicle_observations')
                                  .select(`
                                    *,
                                    zone:zones(name),
                                    organization:organizations(name),
                                    recorded_by_user:user_profiles!vehicle_observations_recorded_by_fkey(first_name, last_name)
                                  `)
                                  .eq('vehicle_id', canonicalData.vehicle_id)
                                  .order('recorded_at', { ascending: false });
                                
                                if (!obsError) {
                                  setVehicleObservations(obsData || []);
                                }
                              }
                            } catch (error) {
                              console.error('Failed to load vehicle details:', error);
                            } finally {
                              setIsLoadingObservations(false);
                            }
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            {recordTimeNZ}
                          </div>
                          {compliance.isOvernightStay && (
                            <Badge variant="outline" className="mt-1 bg-blue-500/10 text-blue-500 text-xs">
                              <Moon className="h-3 w-3 mr-1" />
                              Overnight
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell
                          onClick={async () => {
                            setViewingVehicle(vehicle);
                            setIsLoadingObservations(true);
                            setIsViewDialogOpen(true);
                            
                            // Fetch canonical vehicle and all observations for this plate
                            try {
                              // Get canonical vehicle
                              const { data: canonicalData, error: canonicalError } = await supabase
                                .from('canonical_vehicles')
                                .select('*')
                                .eq('plate_number', vehicle.plate_number)
                                .single();
                              
                              if (!canonicalError && canonicalData) {
                                setCanonicalVehicle(canonicalData);
                                
                                // Get all observations for this vehicle
                                const { data: obsData, error: obsError } = await supabase
                                  .from('vehicle_observations')
                                  .select(`
                                    *,
                                    zone:zones(name),
                                    organization:organizations(name),
                                    recorded_by_user:user_profiles!vehicle_observations_recorded_by_fkey(first_name, last_name)
                                  `)
                                  .eq('vehicle_id', canonicalData.vehicle_id)
                                  .order('recorded_at', { ascending: false });
                                
                                if (!obsError) {
                                  setVehicleObservations(obsData || []);
                                }
                              }
                            } catch (error) {
                              console.error('Failed to load vehicle details:', error);
                            } finally {
                              setIsLoadingObservations(false);
                            }
                          }}
                        >
                          {vehicle.is_self_contained ? (
                            <Badge variant="outline" className="bg-green-500/10 text-green-500">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Yes
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-500/10 text-red-500">
                              <XCircle className="h-3 w-3 mr-1" />
                              No
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell
                          onClick={async () => {
                            setViewingVehicle(vehicle);
                            setIsLoadingObservations(true);
                            setIsViewDialogOpen(true);
                            
                            // Fetch canonical vehicle and all observations for this plate
                            try {
                              // Get canonical vehicle
                              const { data: canonicalData, error: canonicalError } = await supabase
                                .from('canonical_vehicles')
                                .select('*')
                                .eq('plate_number', vehicle.plate_number)
                                .single();
                              
                              if (!canonicalError && canonicalData) {
                                setCanonicalVehicle(canonicalData);
                                
                                // Get all observations for this vehicle
                                const { data: obsData, error: obsError } = await supabase
                                  .from('vehicle_observations')
                                  .select(`
                                    *,
                                    zone:zones(name),
                                    organization:organizations(name),
                                    recorded_by_user:user_profiles!vehicle_observations_recorded_by_fkey(first_name, last_name)
                                  `)
                                  .eq('vehicle_id', canonicalData.vehicle_id)
                                  .order('recorded_at', { ascending: false });
                                
                                if (!obsError) {
                                  setVehicleObservations(obsData || []);
                                }
                              }
                            } catch (error) {
                              console.error('Failed to load vehicle details:', error);
                            } finally {
                              setIsLoadingObservations(false);
                            }
                          }}
                        >
                          {compliance.isCompliant ? (
                            <Badge variant="outline" className="bg-green-500/10 text-green-500">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Compliant
                            </Badge>
                          ) : (
                            <div className="space-y-1">
                              <Badge variant="outline" className="bg-red-500/10 text-red-500">
                                <XCircle className="h-3 w-3 mr-1" />
                                Non-Compliant
                              </Badge>
                              {vehicle.requires_followup && (
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-600">
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  Follow-up
                                </Badge>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell
                          onClick={async () => {
                            setViewingVehicle(vehicle);
                            setIsLoadingObservations(true);
                            setIsViewDialogOpen(true);
                            
                            // Fetch canonical vehicle and all observations for this plate
                            try {
                              // Get canonical vehicle
                              const { data: canonicalData, error: canonicalError } = await supabase
                                .from('canonical_vehicles')
                                .select('*')
                                .eq('plate_number', vehicle.plate_number)
                                .single();
                              
                              if (!canonicalError && canonicalData) {
                                setCanonicalVehicle(canonicalData);
                                
                                // Get all observations for this vehicle
                                const { data: obsData, error: obsError } = await supabase
                                  .from('vehicle_observations')
                                  .select(`
                                    *,
                                    zone:zones(name),
                                    organization:organizations(name),
                                    recorded_by_user:user_profiles!vehicle_observations_recorded_by_fkey(first_name, last_name)
                                  `)
                                  .eq('vehicle_id', canonicalData.vehicle_id)
                                  .order('recorded_at', { ascending: false });
                                
                                if (!obsError) {
                                  setVehicleObservations(obsData || []);
                                }
                              }
                            } catch (error) {
                              console.error('Failed to load vehicle details:', error);
                            } finally {
                              setIsLoadingObservations(false);
                            }
                          }}
                        >
                          {vehicle.homeless_claimed ? (
                            <div className="space-y-1">
                              {vehicle.homeless_confirmed === null && (
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 text-xs">
                                  Pending Review
                                </Badge>
                              )}
                              {vehicle.homeless_confirmed === true && (
                                <Badge variant="outline" className="bg-green-500/10 text-green-500 text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Confirmed
                                </Badge>
                              )}
                              {vehicle.homeless_confirmed === false && (
                                <Badge variant="outline" className="bg-red-500/10 text-red-500 text-xs">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Declined
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell
                          onClick={async () => {
                            setViewingVehicle(vehicle);
                            setIsLoadingObservations(true);
                            setIsViewDialogOpen(true);
                            
                            // Fetch canonical vehicle and all observations for this plate
                            try {
                              // Get canonical vehicle
                              const { data: canonicalData, error: canonicalError } = await supabase
                                .from('canonical_vehicles')
                                .select('*')
                                .eq('plate_number', vehicle.plate_number)
                                .single();
                              
                              if (!canonicalError && canonicalData) {
                                setCanonicalVehicle(canonicalData);
                                
                                // Get all observations for this vehicle
                                const { data: obsData, error: obsError } = await supabase
                                  .from('vehicle_observations')
                                  .select(`
                                    *,
                                    zone:zones(name),
                                    organization:organizations(name),
                                    recorded_by_user:user_profiles!vehicle_observations_recorded_by_fkey(first_name, last_name)
                                  `)
                                  .eq('vehicle_id', canonicalData.vehicle_id)
                                  .order('recorded_at', { ascending: false });
                                
                                if (!obsError) {
                                  setVehicleObservations(obsData || []);
                                }
                              }
                            } catch (error) {
                              console.error('Failed to load vehicle details:', error);
                            } finally {
                              setIsLoadingObservations(false);
                            }
                          }}
                        >
                          {vehicle.recorded_by_user ? (
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              {vehicle.recorded_by_user.first_name} {vehicle.recorded_by_user.last_name}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditDialog(vehicle);
                              }}
                              title="Edit Vehicle"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setVehicleToDelete(vehicle);
                                setIsDeleteDialogOpen(true);
                              }}
                              title="Delete Vehicle"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Details Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <VehicleProfilePhoto 
                plateNumber={viewingVehicle?.plate_number || ''} 
                size="sm"
              />
              {viewingVehicle?.plate_number}
            </DialogTitle>
            <DialogDescription>
              Complete vehicle details and observation history
            </DialogDescription>
          </DialogHeader>
          {viewingVehicle && (
            <div className="space-y-4 py-4">
              {/* Vehicle Profile Photo */}
              <div className="flex justify-center">
                <VehicleProfilePhoto 
                  plateNumber={viewingVehicle.plate_number} 
                  size="lg"
                  showMetadata={true}
                />
              </div>
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Zone</Label>
                  <p className="text-sm font-medium">{viewingVehicle.zone?.name || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Organization</Label>
                  <p className="text-sm font-medium">{viewingVehicle.organization?.name || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Recorded At</Label>
                  <p className="text-sm font-medium">
                    {new Date(viewingVehicle.recorded_at).toLocaleString('en-NZ', {
                      timeZone: 'Pacific/Auckland',
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Recorded By</Label>
                  <p className="text-sm font-medium">
                    {viewingVehicle.recorded_by_user
                      ? `${viewingVehicle.recorded_by_user.first_name} ${viewingVehicle.recorded_by_user.last_name}`
                      : '-'}
                  </p>
                </div>
              </div>

              {/* Vehicle Details */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Make</Label>
                  <p className="text-sm font-medium">{viewingVehicle.vehicle_make || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Model</Label>
                  <p className="text-sm font-medium">{viewingVehicle.vehicle_model || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Color</Label>
                  <p className="text-sm font-medium">{viewingVehicle.vehicle_color || '-'}</p>
                </div>
              </div>

              {/* Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Self-Contained</Label>
                  <div className="mt-1">
                    {viewingVehicle.is_self_contained ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-500">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Yes
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-red-500/10 text-red-500">
                        <XCircle className="h-3 w-3 mr-1" />
                        No
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Compliance</Label>
                  <div className="mt-1">
                    {getComplianceStatus(viewingVehicle).isCompliant ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-500">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Compliant
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-red-500/10 text-red-500">
                        <XCircle className="h-3 w-3 mr-1" />
                        Non-Compliant
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* GPS Location */}
              {viewingVehicle.gps_latitude && viewingVehicle.gps_longitude && (
                <div>
                  <Label className="text-xs text-muted-foreground">GPS Location</Label>
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-sm font-medium">
                      {viewingVehicle.gps_latitude.toFixed(6)}, {viewingVehicle.gps_longitude.toFixed(6)}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(
                        `https://www.google.com/maps?q=${viewingVehicle.gps_latitude},${viewingVehicle.gps_longitude}`,
                        '_blank'
                      )}
                    >
                      <MapPin className="h-4 w-4 mr-2" />
                      Open in Google Maps
                    </Button>
                  </div>
                </div>
              )}

              {/* Input Method */}
              {viewingVehicle.plate_input_method && (
                <div>
                  <Label className="text-xs text-muted-foreground">Plate Input Method</Label>
                  <Badge variant="outline" className="mt-1">
                    {viewingVehicle.plate_input_method.toUpperCase()}
                  </Badge>
                </div>
              )}

              {/* Homeless Status */}
              {viewingVehicle.homeless_claimed && (
                <div className="p-3 border rounded-lg bg-amber-500/5 border-amber-500/20">
                  <Label className="text-xs text-muted-foreground">Homeless Status</Label>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Claim Status:</span>
                      {viewingVehicle.homeless_confirmed === null && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600">
                          Pending Admin Review
                        </Badge>
                      )}
                      {viewingVehicle.homeless_confirmed === true && (
                        <Badge variant="outline" className="bg-green-500/10 text-green-500">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Confirmed by Admin
                        </Badge>
                      )}
                      {viewingVehicle.homeless_confirmed === false && (
                        <Badge variant="outline" className="bg-red-500/10 text-red-500">
                          <XCircle className="h-3 w-3 mr-1" />
                          Declined by Admin
                        </Badge>
                      )}
                    </div>
                    {viewingVehicle.homeless_confirmed_at && (
                      <p className="text-xs text-muted-foreground">
                        Reviewed: {new Date(viewingVehicle.homeless_confirmed_at).toLocaleDateString('en-NZ', {
                          timeZone: 'Pacific/Auckland',
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Behavioral Flags */}
              {viewingVehicle.behavioral_flags && viewingVehicle.behavioral_flags.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Behavioral Flags</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {viewingVehicle.behavioral_flags.map((flag, i) => (
                      <Badge key={i} variant="outline" className="bg-red-500/10 text-red-500">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {flag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Follow-up */}
              {viewingVehicle.requires_followup && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded">
                  <Label className="text-xs text-amber-600 font-semibold">Follow-up Required</Label>
                  <p className="text-sm mt-1">{viewingVehicle.followup_reason || '-'}</p>
                  {viewingVehicle.followup_priority && (
                    <Badge variant="outline" className="mt-2 bg-amber-500/10 text-amber-600">
                      Priority: {viewingVehicle.followup_priority.toUpperCase()}
                    </Badge>
                  )}
                </div>
              )}

              {/* Vehicle Photo Gallery with AI Selection */}
              <VehiclePhotoGallery 
                plateNumber={viewingVehicle.plate_number}
                showAISelection={true}
                className="mt-6"
              />

              {/* Notes */}
              {viewingVehicle.notes && (
                <div>
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <div className="mt-1 p-3 bg-muted/50 rounded text-sm whitespace-pre-wrap">
                    {viewingVehicle.notes}
                  </div>
                </div>
              )}
              
              {/* Canonical Vehicle Summary */}
              {canonicalVehicle && (
                <div className="mt-6 p-4 border-2 border-blue-500/20 bg-blue-500/5 rounded-lg">
                  <h4 className="font-semibold text-sm text-blue-700 dark:text-blue-400 mb-3 flex items-center gap-2">
                    <Car className="h-4 w-4" />
                    Vehicle History Summary
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <Label className="text-xs text-muted-foreground">First Seen</Label>
                      <p className="font-medium">
                        {new Date(canonicalVehicle.first_seen_at).toLocaleDateString('en-NZ', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Last Seen</Label>
                      <p className="font-medium">
                        {new Date(canonicalVehicle.last_seen_at).toLocaleDateString('en-NZ', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Total Observations</Label>
                      <p className="font-medium text-lg">{canonicalVehicle.total_observations}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Status</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {canonicalVehicle.is_flagged && (
                          <Badge variant="outline" className="bg-red-500/10 text-red-500 text-xs">
                            Flagged
                          </Badge>
                        )}
                        {canonicalVehicle.is_homeless && (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 text-xs">
                            Homeless
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* All Observations */}
              <div className="mt-6">
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  All Observations ({vehicleObservations.length})
                </h4>
                {isLoadingObservations ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Loading observations...
                  </div>
                ) : vehicleObservations.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No observations found for this vehicle
                  </p>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {vehicleObservations.map((obs, index) => (
                      <div
                        key={obs.observation_id}
                        className="p-3 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              #{vehicleObservations.length - index}
                            </Badge>
                            <span className="text-xs font-medium">
                              {new Date(obs.recorded_at).toLocaleString('en-NZ', {
                                timeZone: 'Pacific/Auckland',
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {obs.is_compliant ? (
                              <Badge variant="outline" className="bg-green-500/10 text-green-500 text-xs">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Compliant
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-red-500/10 text-red-500 text-xs">
                                <XCircle className="h-3 w-3 mr-1" />
                                Non-Compliant
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Zone:</span>
                            <span className="ml-1 font-medium">{obs.zone?.name || '-'}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Recorded by:</span>
                            <span className="ml-1 font-medium">
                              {obs.recorded_by_user
                                ? `${obs.recorded_by_user.first_name} ${obs.recorded_by_user.last_name}`
                                : '-'}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Self-Contained:</span>
                            <span className="ml-1 font-medium">
                              {obs.is_self_contained ? 'Yes' : 'No'}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Organization:</span>
                            <span className="ml-1 font-medium">{obs.organization?.name || '-'}</span>
                          </div>
                        </div>
                        {obs.gps_latitude && obs.gps_longitude && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3 inline mr-1" />
                            {obs.gps_latitude.toFixed(6)}, {obs.gps_longitude.toFixed(6)}
                          </div>
                        )}
                        {obs.notes && (
                          <div className="mt-2 p-2 bg-background/50 rounded text-xs text-muted-foreground">
                            {obs.notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={() => {
              setIsViewDialogOpen(false);
              if (viewingVehicle) openEditDialog(viewingVehicle);
            }}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Vehicle Record</DialogTitle>
            <DialogDescription>
              Update vehicle information and compliance status
            </DialogDescription>
          </DialogHeader>
          {editingVehicle && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plate Number *</Label>
                  <Input
                    value={editingVehicle.plate_number}
                    onChange={(e) =>
                      setEditingVehicle({ ...editingVehicle, plate_number: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Zone *</Label>
                  <Select
                    value={editingVehicle.zone_id}
                    onValueChange={(value) =>
                      setEditingVehicle({ ...editingVehicle, zone_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {zones.filter(z => !z.merged_into_zone_id).map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>
                          {zone.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Make</Label>
                  <Input
                    value={editingVehicle.vehicle_make || ''}
                    onChange={(e) =>
                      setEditingVehicle({ ...editingVehicle, vehicle_make: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Model</Label>
                  <Input
                    value={editingVehicle.vehicle_model || ''}
                    onChange={(e) =>
                      setEditingVehicle({ ...editingVehicle, vehicle_model: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Color</Label>
                  <Input
                    value={editingVehicle.vehicle_color || ''}
                    onChange={(e) =>
                      setEditingVehicle({ ...editingVehicle, vehicle_color: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Self-Contained</Label>
                  <Switch
                    checked={editingVehicle.is_self_contained}
                    onCheckedChange={(checked) =>
                      setEditingVehicle({ ...editingVehicle, is_self_contained: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Compliant</Label>
                  <Switch
                    checked={editingVehicle.is_compliant}
                    onCheckedChange={(checked) =>
                      setEditingVehicle({ ...editingVehicle, is_compliant: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Requires Follow-up</Label>
                  <Switch
                    checked={editingVehicle.requires_followup}
                    onCheckedChange={(checked) =>
                      setEditingVehicle({ ...editingVehicle, requires_followup: checked })
                    }
                  />
                </div>
              </div>

              {editingVehicle.requires_followup && (
                <div className="space-y-3 p-3 border rounded-lg">
                  <div className="space-y-2">
                    <Label>Follow-up Reason</Label>
                    <Textarea
                      value={editingVehicle.followup_reason || ''}
                      onChange={(e) =>
                        setEditingVehicle({ ...editingVehicle, followup_reason: e.target.value })
                      }
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select
                      value={editingVehicle.followup_priority || 'medium'}
                      onValueChange={(value) =>
                        setEditingVehicle({ ...editingVehicle, followup_priority: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={editingVehicle.notes || ''}
                  onChange={(e) =>
                    setEditingVehicle({ ...editingVehicle, notes: e.target.value })
                  }
                  rows={4}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateVehicle}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Action Dialog */}
      <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {bulkAction === 'copy' ? <Copy className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
              {bulkAction === 'copy' ? 'Copy' : 'Move'} Vehicles to Zone
            </DialogTitle>
            <DialogDescription>
              {bulkAction === 'copy'
                ? `Copy ${selectedVehicles.size} vehicle(s) to a different zone. Original records will remain unchanged.`
                : `Move ${selectedVehicles.size} vehicle(s) to a different zone. This will update the zone for all selected records.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Organization Selector (Master only) */}
            {user?.role === 'master' && (
              <div className="space-y-2">
                <Label>Target Organization</Label>
                <Select value={bulkTargetOrg} onValueChange={setBulkTargetOrg}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select organization" />
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
            )}

            {/* Zone Selector */}
            <div className="space-y-2">
              <Label>Target Zone *</Label>
              <Select value={bulkTargetZone} onValueChange={setBulkTargetZone}>
                <SelectTrigger>
                  <SelectValue placeholder="Select zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones
                    .filter(z => {
                      // Filter zones by selected organization (if master user)
                      if (user?.role === 'master' && bulkTargetOrg) {
                        return z.organization_id === bulkTargetOrg && !z.merged_into_zone_id;
                      }
                      return !z.merged_into_zone_id;
                    })
                    .map((zone) => (
                      <SelectItem key={zone.id} value={zone.id}>
                        {zone.name}
                        {user?.role === 'master' && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({organizations.find(o => o.id === zone.organization_id)?.name})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preview */}
            <div className="p-3 bg-muted/50 rounded text-sm space-y-1">
              <p className="font-medium">Selected Vehicles:</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {Array.from(selectedVehicles)
                  .slice(0, 10)
                  .map((vehicleId) => {
                    const vehicle = vehicles.find(v => v.id === vehicleId);
                    return vehicle ? (
                      <Badge key={vehicleId} variant="secondary" className="text-xs">
                        {vehicle.plate_number}
                      </Badge>
                    ) : null;
                  })}
                {selectedVehicles.size > 10 && (
                  <Badge variant="outline" className="text-xs">
                    +{selectedVehicles.size - 10} more
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowBulkDialog(false);
                setBulkTargetZone('');
                setBulkTargetOrg('');
              }}
              disabled={isBulkProcessing}
            >
              Cancel
            </Button>
            <Button onClick={executeBulkAction} disabled={!bulkTargetZone || isBulkProcessing}>
              {isBulkProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {bulkAction === 'copy' ? <Copy className="h-4 w-4 mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                  {bulkAction === 'copy' ? 'Copy' : 'Move'} Vehicles
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Vehicle Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the record for{' '}
              <strong>{vehicleToDelete?.plate_number}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteVehicle}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete Record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
