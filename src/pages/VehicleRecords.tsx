/**
 * Vehicle Records - Canonical vehicle management and viewing
 * 
 * Features:
 * - Search and filter canonical vehicles
 * - View observation history
 * - Edit vehicle details
 * - Photo upload and analysis
 * - Homeless and flagged status management
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Car,
  Search,
  RefreshCw,
  Loader2,
  Eye,
  Home,
  Flag,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Filter,
  X,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface CanonicalVehicle {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  self_contained: boolean;
  self_contained_expiry: string | null;
  homeless_status: 'none' | 'claimed' | 'confirmed';
  is_flagged: boolean;
  flagged_priority: string | null;
  flagged_reason: string | null;
  profile_photo: string | null;
  total_observations: number;
  total_breaches: number;
  first_seen_at: string;
  last_seen_at: string;
}

export function VehicleRecords() {
  const { user } = useAuthStore();

  const [vehicles, setVehicles] = useState<CanonicalVehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<CanonicalVehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [searchPlate, setSearchPlate] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // View dialog
  const [selectedVehicle, setSelectedVehicle] = useState<CanonicalVehicle | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);

  useEffect(() => {
    loadVehicles();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [vehicles, searchPlate, filterStatus]);

  const loadVehicles = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .order('last_seen_at', { ascending: false });

      if (error) throw error;

      setVehicles(data || []);
      setFilteredVehicles(data || []);
      console.log(`✅ Loaded ${data?.length || 0} vehicles`);
    } catch (error: any) {
      console.error('Failed to load vehicles:', error);
      toast.error('Failed to load vehicles');
      setVehicles([]);
      setFilteredVehicles([]);
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...vehicles];

    // Search filter
    if (searchPlate) {
      filtered = filtered.filter(v =>
        v.plate_number.toLowerCase().includes(searchPlate.toLowerCase())
      );
    }

    // Status filter
    if (filterStatus === 'homeless') {
      filtered = filtered.filter(v => v.homeless_status === 'confirmed');
    } else if (filterStatus === 'flagged') {
      filtered = filtered.filter(v => v.is_flagged);
    } else if (filterStatus === 'breach') {
      filtered = filtered.filter(v => v.total_breaches > 0);
    }

    setFilteredVehicles(filtered);
  };

  const clearFilters = () => {
    setSearchPlate('');
    setFilterStatus('all');
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
      'Total Observations',
      'Total Breaches',
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
      v.total_observations.toString(),
      v.total_breaches.toString(),
      new Date(v.first_seen_at).toLocaleDateString('en-NZ'),
      new Date(v.last_seen_at).toLocaleDateString('en-NZ'),
    ]);

    const csv = [headers, ...csvData].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vehicle_records_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported to CSV');
  };

  const getStatusBadge = (vehicle: CanonicalVehicle) => {
    if (vehicle.is_flagged) {
      return (
        <Badge variant="destructive" className="gap-1">
          <Flag className="h-3 w-3" />
          FLAGGED
        </Badge>
      );
    }
    if (vehicle.homeless_status === 'confirmed') {
      return (
        <Badge className="gap-1 bg-cyan-600">
          <Home className="h-3 w-3" />
          HOMELESS
        </Badge>
      );
    }
    if (vehicle.total_breaches > 0) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {vehicle.total_breaches} BREACH{vehicle.total_breaches !== 1 ? 'ES' : ''}
        </Badge>
      );
    }
    return (
      <Badge className="gap-1 bg-green-600">
        <CheckCircle2 className="h-3 w-3" />
        COMPLIANT
      </Badge>
    );
  };

  const handleViewVehicle = (vehicle: CanonicalVehicle) => {
    setSelectedVehicle(vehicle);
    setIsViewDialogOpen(true);
  };

  const hasActiveFilters = searchPlate !== '' || filterStatus !== 'all';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Car className="h-8 w-8 text-primary" />
            Vehicle Records
          </h1>
          <p className="text-muted-foreground mt-1">
            Canonical vehicle database - one record per plate
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportToCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button onClick={loadVehicles} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Search Plate Number</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Enter plate number..."
                  value={searchPlate}
                  onChange={(e) => setSearchPlate(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Status Filter</Label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-3 py-2 border rounded-md bg-background"
              >
                <option value="all">All Vehicles</option>
                <option value="flagged">Flagged Only</option>
                <option value="homeless">Homeless Only</option>
                <option value="breach">With Breaches Only</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Vehicles</div>
            <div className="text-3xl font-bold">{vehicles.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Flagged</div>
            <div className="text-3xl font-bold text-red-600">
              {vehicles.filter(v => v.is_flagged).length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Homeless</div>
            <div className="text-3xl font-bold text-cyan-600">
              {vehicles.filter(v => v.homeless_status === 'confirmed').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">With Breaches</div>
            <div className="text-3xl font-bold text-orange-600">
              {vehicles.filter(v => v.total_breaches > 0).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vehicle List */}
      <Card>
        <CardHeader>
          <CardTitle>
            Vehicles ({filteredVehicles.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Car className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No vehicles found</p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters} className="mt-4">
                  Clear Filters
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredVehicles.map((vehicle) => (
                <Card
                  key={vehicle.plate_number}
                  className="cursor-pointer hover:shadow-lg transition-all"
                  onClick={() => handleViewVehicle(vehicle)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {vehicle.profile_photo && (
                        <div className="w-24 h-20 rounded-lg overflow-hidden border-2 flex-shrink-0">
                          <img
                            src={vehicle.profile_photo}
                            alt={vehicle.plate_number}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}

                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge variant="outline" className="font-mono text-base px-3 py-1">
                            {vehicle.plate_number}
                          </Badge>
                          {getStatusBadge(vehicle)}
                          {vehicle.self_contained && (
                            <Badge variant="outline" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Self-Contained
                            </Badge>
                          )}
                        </div>

                        <div className="grid grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className="text-xs text-muted-foreground">Vehicle</div>
                            <div className="font-medium">
                              {vehicle.vehicle_make || 'Unknown'} {vehicle.vehicle_model || ''}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Observations</div>
                            <div className="font-bold text-lg">{vehicle.total_observations}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground">Last Seen</div>
                            <div className="text-xs">
                              {new Date(vehicle.last_seen_at).toLocaleDateString('en-NZ')}
                            </div>
                          </div>
                          <div className="flex items-center justify-end">
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4 mr-2" />
                              View Details
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <Car className="h-6 w-6" />
              Vehicle: {selectedVehicle?.plate_number}
            </DialogTitle>
          </DialogHeader>

          {selectedVehicle && (
            <div className="space-y-6">
              {/* Photo */}
              {selectedVehicle.profile_photo && (
                <div className="w-full rounded-lg overflow-hidden border-2">
                  <img
                    src={selectedVehicle.profile_photo}
                    alt={selectedVehicle.plate_number}
                    className="w-full object-cover"
                  />
                </div>
              )}

              {/* Vehicle Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Vehicle Information</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Plate Number</Label>
                      <div className="font-mono font-bold text-lg">{selectedVehicle.plate_number}</div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Make / Model</Label>
                      <div className="font-semibold">
                        {selectedVehicle.vehicle_make || 'Unknown'} {selectedVehicle.vehicle_model || ''}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Year / Color</Label>
                      <div className="font-semibold">
                        {selectedVehicle.vehicle_year || '?'} / {selectedVehicle.vehicle_color || '?'}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Self-Contained</Label>
                      <Badge variant={selectedVehicle.self_contained ? 'default' : 'destructive'}>
                        {selectedVehicle.self_contained ? 'Yes' : 'No'}
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Total Observations</Label>
                      <div className="font-bold text-lg">{selectedVehicle.total_observations}</div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Total Breaches</Label>
                      <div className="font-bold text-lg text-red-600">{selectedVehicle.total_breaches}</div>
                    </div>
                  </div>

                  {/* Status Badges */}
                  <div className="mt-4 pt-4 border-t flex flex-wrap gap-2">
                    {selectedVehicle.is_flagged && (
                      <Badge variant="destructive" className="gap-1">
                        <Flag className="h-3 w-3" />
                        FLAGGED - {selectedVehicle.flagged_priority}
                      </Badge>
                    )}
                    {selectedVehicle.homeless_status === 'confirmed' && (
                      <Badge className="gap-1 bg-cyan-600">
                        <Home className="h-3 w-3" />
                        HOMELESS (Confirmed)
                      </Badge>
                    )}
                    {selectedVehicle.homeless_status === 'claimed' && (
                      <Badge className="gap-1 bg-cyan-500">
                        <Home className="h-3 w-3" />
                        HOMELESS (Claimed)
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Flagged Details */}
              {selectedVehicle.is_flagged && selectedVehicle.flagged_reason && (
                <Card className="border-red-500 bg-red-50 dark:bg-red-950/30">
                  <CardHeader>
                    <CardTitle className="text-lg text-red-700 dark:text-red-300">
                      Flagged Vehicle Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs font-bold text-red-700">Reason:</Label>
                        <div className="text-sm">{selectedVehicle.flagged_reason}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
