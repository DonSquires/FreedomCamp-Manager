/**
 * HomelessSupport - Manage homeless vehicle claims and confirmations
 * 
 * Features:
 * - View all vehicles with homeless status (claimed or confirmed)
 * - Confirm or decline homeless claims
 * - Revoke homeless status
 * - Search and filter capabilities
 * - Full notes and history tracking
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Home,
  Search,
  Edit,
  CheckCircle2,
  XCircle,
  Loader2,
  Calendar,
  User,
  RefreshCw,
  AlertCircle,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface HomelessVehicle {
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  homeless_status: 'none' | 'claimed' | 'confirmed';
  homeless_confirmed_by: string | null;
  homeless_confirmed_at: string | null;
  homeless_notes: string | null;
  last_seen_at: string;
  total_observations: number;
  profile_photo: string | null;
  confirmer?: {
    first_name: string;
    last_name: string;
  };
}

export function HomelessSupport() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'master';

  const [isLoading, setIsLoading] = useState(true);
  const [vehicles, setVehicles] = useState<HomelessVehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<HomelessVehicle[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<HomelessVehicle | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [editStatus, setEditStatus] = useState<'confirmed' | 'declined' | 'revoked'>('confirmed');
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => {
    loadHomelessVehicles();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [vehicles, searchQuery, statusFilter]);

  const loadHomelessVehicles = async () => {
    setIsLoading(true);
    try {
      // Get all vehicles with homeless status (claimed or confirmed)
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .in('homeless_status', ['claimed', 'confirmed'])
        .order('last_seen_at', { ascending: false });

      if (error) throw error;

      // Get confirmer details separately
      const vehiclesWithConfirmer = await Promise.all(
        (data || []).map(async (vehicle: any) => {
          if (vehicle.homeless_confirmed_by) {
            const { data: confirmer } = await supabase
              .from('user_profiles')
              .select('first_name, last_name')
              .eq('id', vehicle.homeless_confirmed_by)
              .single();

            return { ...vehicle, confirmer };
          }
          return vehicle;
        })
      );

      setVehicles(vehiclesWithConfirmer);
      console.log('✅ Loaded', vehiclesWithConfirmer.length, 'homeless vehicles');
    } catch (error: any) {
      console.error('Failed to load homeless vehicles:', error);
      toast.error('Failed to load homeless records');
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...vehicles];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        v =>
          v.plate_number?.toLowerCase().includes(query) ||
          v.vehicle_make?.toLowerCase().includes(query) ||
          v.vehicle_model?.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter === 'confirmed') {
      filtered = filtered.filter(v => v.homeless_status === 'confirmed');
    } else if (statusFilter === 'claimed') {
      filtered = filtered.filter(v => v.homeless_status === 'claimed');
    }

    setFilteredVehicles(filtered);
  };

  const openEditModal = (vehicle: HomelessVehicle) => {
    setSelectedVehicle(vehicle);
    setEditStatus(vehicle.homeless_status === 'confirmed' ? 'confirmed' : 'declined');
    setEditNotes(vehicle.homeless_notes || '');
    setShowEditModal(true);
  };

  const handleSave = async () => {
    if (!selectedVehicle) return;

    setIsSaving(true);
    try {
      const updates: any = {
        homeless_notes: editNotes.trim() || null,
      };

      if (editStatus === 'confirmed') {
        updates.homeless_status = 'confirmed';
        updates.homeless_confirmed_by = user?.id;
        updates.homeless_confirmed_at = new Date().toISOString();
      } else if (editStatus === 'declined') {
        updates.homeless_status = 'claimed';
        updates.homeless_confirmed_by = user?.id;
        updates.homeless_confirmed_at = new Date().toISOString();
      } else if (editStatus === 'revoked') {
        updates.homeless_status = 'none';
        updates.homeless_confirmed_by = user?.id;
        updates.homeless_confirmed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('canonical_vehicles')
        .update(updates)
        .eq('plate_number', selectedVehicle.plate_number);

      if (error) throw error;

      toast.success('Homeless status updated successfully');
      setShowEditModal(false);
      await loadHomelessVehicles();
    } catch (error: any) {
      console.error('Failed to update homeless status:', error);
      toast.error('Failed to update status');
    } finally {
      setIsSaving(false);
    }
  };

  const exportToCSV = () => {
    if (filteredVehicles.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = [
      'Plate Number',
      'Make',
      'Model',
      'Year',
      'Color',
      'Status',
      'Total Observations',
      'Last Seen',
      'Confirmed By',
      'Confirmed At',
      'Notes',
    ];

    const rows = filteredVehicles.map(v => [
      v.plate_number,
      v.vehicle_make || '',
      v.vehicle_model || '',
      v.vehicle_year?.toString() || '',
      v.vehicle_color || '',
      v.homeless_status,
      v.total_observations.toString(),
      new Date(v.last_seen_at).toLocaleDateString('en-NZ'),
      v.confirmer ? `${v.confirmer.first_name} ${v.confirmer.last_name}` : '',
      v.homeless_confirmed_at ? new Date(v.homeless_confirmed_at).toLocaleDateString('en-NZ') : '',
      v.homeless_notes || '',
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `homeless-vehicles-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Export complete');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Home className="h-8 w-8 text-cyan-600" />
            Homeless Support
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage homeless vehicle claims and confirmations
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadHomelessVehicles} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button variant="outline" onClick={exportToCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-2 border-primary/20">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search plate number, make, model..."
                  className="pl-10"
                />
              </div>
            </div>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="claimed">Pending Review</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground mb-2">
              Total Homeless Vehicles
            </div>
            <div className="text-4xl font-bold">
              {vehicles.length}
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-green-200 bg-green-50 dark:bg-green-950/30">
          <CardContent className="p-6">
            <div className="text-sm text-green-700 dark:text-green-300 mb-2">
              Confirmed
            </div>
            <div className="text-4xl font-bold text-green-600">
              {vehicles.filter(v => v.homeless_status === 'confirmed').length}
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-amber-200 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="p-6">
            <div className="text-sm text-amber-700 dark:text-amber-300 mb-2">
              Pending Review
            </div>
            <div className="text-4xl font-bold text-amber-600">
              {vehicles.filter(v => v.homeless_status === 'claimed').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vehicles List */}
      <Card>
        <CardHeader>
          <CardTitle>
            Homeless Vehicles ({filteredVehicles.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Home className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p>No homeless vehicles found</p>
              {vehicles.length > 0 && searchQuery && (
                <Button variant="outline" size="sm" onClick={() => setSearchQuery('')} className="mt-4">
                  Clear Search
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredVehicles.map(vehicle => (
                <Card
                  key={vehicle.plate_number}
                  className={`border-2 ${
                    vehicle.homeless_status === 'confirmed'
                      ? 'border-green-200 bg-green-50 dark:bg-green-950/20'
                      : 'border-amber-200 bg-amber-50 dark:bg-amber-950/20'
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Photo */}
                      {vehicle.profile_photo && (
                        <div className="w-24 h-20 rounded-lg overflow-hidden border-2 flex-shrink-0">
                          <img
                            src={vehicle.profile_photo}
                            alt={vehicle.plate_number}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-xl font-mono font-bold">
                            {vehicle.plate_number}
                          </h3>
                          <Badge
                            variant={vehicle.homeless_status === 'confirmed' ? 'default' : 'secondary'}
                            className={
                              vehicle.homeless_status === 'confirmed'
                                ? 'gap-1 bg-green-600'
                                : 'gap-1 bg-amber-600'
                            }
                          >
                            {vehicle.homeless_status === 'confirmed' ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                Confirmed
                              </>
                            ) : (
                              <>
                                <AlertCircle className="h-3 w-3" />
                                Pending Review
                              </>
                            )}
                          </Badge>
                        </div>

                        <p className="text-sm text-muted-foreground mb-3">
                          {vehicle.vehicle_color && `${vehicle.vehicle_color} `}
                          {vehicle.vehicle_make} {vehicle.vehicle_model}
                          {vehicle.vehicle_year && ` (${vehicle.vehicle_year})`}
                        </p>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="p-3 bg-background rounded border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-1">
                              <Calendar className="h-4 w-4" />
                              Last Seen
                            </div>
                            <div className="font-semibold">
                              {new Date(vehicle.last_seen_at).toLocaleDateString('en-NZ')}
                            </div>
                          </div>
                          <div className="p-3 bg-background rounded border">
                            <div className="text-muted-foreground mb-1">
                              Total Observations
                            </div>
                            <div className="font-semibold">
                              {vehicle.total_observations}
                            </div>
                          </div>
                        </div>

                        {vehicle.homeless_status === 'confirmed' && vehicle.confirmer && (
                          <div className="mt-3 p-3 bg-green-100 dark:bg-green-950/40 rounded border border-green-300 dark:border-green-800">
                            <div className="flex items-center gap-2 text-sm text-green-900 dark:text-green-100">
                              <User className="h-4 w-4" />
                              Confirmed by {vehicle.confirmer.first_name} {vehicle.confirmer.last_name} on{' '}
                              {vehicle.homeless_confirmed_at && new Date(vehicle.homeless_confirmed_at).toLocaleDateString('en-NZ')}
                            </div>
                          </div>
                        )}

                        {vehicle.homeless_notes && (
                          <div className="mt-3 p-3 bg-background rounded border">
                            <div className="text-xs font-semibold text-muted-foreground mb-1">
                              Notes:
                            </div>
                            <p className="text-sm whitespace-pre-wrap">
                              {vehicle.homeless_notes}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      {isAdmin && (
                        <div className="flex-shrink-0">
                          <Button
                            onClick={() => openEditModal(vehicle)}
                            variant="outline"
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            Update
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Update Homeless Status
            </DialogTitle>
            <DialogDescription>
              {selectedVehicle?.plate_number} - {selectedVehicle?.vehicle_make} {selectedVehicle?.vehicle_model}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Status */}
            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={editStatus} onValueChange={(v: any) => setEditStatus(v)}>
                <SelectTrigger id="status" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">✅ Confirm as Homeless</SelectItem>
                  <SelectItem value="declined">⚠️ Decline Claim (Keep as Claimed)</SelectItem>
                  <SelectItem value="revoked">❌ No Longer Homeless</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Add notes about this homeless claim..."
                className="mt-1 min-h-32"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditModal(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
