/**
 * Breach Alerts Report
 * 
 * Shows all breach alerts with:
 * - Manual data entry capability for historical breaches
 * - Enact enforcement action on any breach
 * - Filter by zone, date, status
 * - Export capabilities
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Plus,
  Shield,
  Download,
  Filter,
  RefreshCw,
  Loader2,
  MapPin,
  Car,
  Calendar,
  Clock,
  Home,
  Flag,
  FileText,
  X,
  UserPlus,
  Image as ImageIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useZones } from '@/hooks/useZones';
import { useUsers } from '@/hooks/useUsers';
import { supabase } from '@/lib/supabase';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';
import { cn } from '@/lib/utils';

interface BreachAlert {
  id: string;
  organization_id: string;
  zone_id: string;
  zone_name: string;
  plate_number: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  breach_type: string;
  breach_details: any;
  status: string;
  notification_sent: boolean;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
  observation_id: string | null;
  homeless_status: string | null;
  is_flagged: boolean;
  enforcement_assigned: boolean;
}

interface NewBreachForm {
  plate_number: string;
  zone_id: string;
  breach_type: 'overstay' | 'consecutive_days' | 'nights_exceeded' | 'no_self_contained' | 'unauthorized_zone';
  notes: string;
}

export default function BreachAlertsReport() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: zones = [] } = useZones();
  const { data: users = [] } = useUsers();

  const [isLoading, setIsLoading] = useState(false);
  const [breachAlerts, setBreachAlerts] = useState<BreachAlert[]>([]);
  const [filteredAlerts, setFilteredAlerts] = useState<BreachAlert[]>([]);

  // Filters
  const [filterZone, setFilterZone] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterBreachType, setFilterBreachType] = useState<string>('all');
  const [searchPlate, setSearchPlate] = useState('');

  // Dialogs
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEnforceDialogOpen, setIsEnforceDialogOpen] = useState(false);
  const [selectedBreach, setSelectedBreach] = useState<BreachAlert | null>(null);

  // Forms
  const [newBreachForm, setNewBreachForm] = useState<NewBreachForm>({
    plate_number: '',
    zone_id: '',
    breach_type: 'overstay',
    notes: '',
  });

  const [enforceForm, setEnforceForm] = useState({
    officer_id: '',
    action_type: 'warning' as 'warning' | 'notice' | 'tow',
    notes: '',
  });

  // Photo viewer
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [currentPhoto, setCurrentPhoto] = useState<string>('');

  // Vehicle detail modal
  const [vehicleDetailOpen, setVehicleDetailOpen] = useState(false);
  const [selectedVehicleDetails, setSelectedVehicleDetails] = useState<any>(null);
  const [loadingVehicleDetails, setLoadingVehicleDetails] = useState(false);

  useEffect(() => {
    loadBreachAlerts();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [breachAlerts, filterZone, filterStatus, filterBreachType, searchPlate]);

  const loadBreachAlerts = async () => {
    setIsLoading(true);
    try {
      // OPTIMIZED: Single query with all joins - no loops, no separate fetches
      let query = supabase
        .from('breach_alerts')
        .select(`
          id,
          plate_number,
          zone_id,
          organization_id,
          breach_type,
          breach_details,
          status,
          created_at,
          observation_id,
          zones!inner(name),
          observations(photo_url),
          canonical_vehicles(vehicle_make, vehicle_model, vehicle_color, homeless_status, is_flagged)
        `)
        .order('created_at', { ascending: false });

      // Filter by organization if not master
      if (user?.role !== 'master') {
        query = query.eq('organization_id', user?.organization_id || '');
      }

      const { data, error } = await query;

      if (error) throw error;

      // Map to expected format - all data already joined
      const enrichedData = (data || []).map(breach => ({
        ...breach,
        zone_name: (breach.zones as any)?.name || 'Unknown',
        vehicle_make: (breach.canonical_vehicles as any)?.vehicle_make || null,
        vehicle_model: (breach.canonical_vehicles as any)?.vehicle_model || null,
        vehicle_color: (breach.canonical_vehicles as any)?.vehicle_color || null,
        homeless_status: (breach.canonical_vehicles as any)?.homeless_status || null,
        is_flagged: (breach.canonical_vehicles as any)?.is_flagged || false,
        enforcement_assigned: false, // Will be computed client-side if needed
      }));

      setBreachAlerts(enrichedData);
      console.log('✅ Loaded', enrichedData.length, 'breach alerts (optimized)');

    } catch (error: any) {
      console.error('❌ Failed to load breach alerts:', error);
      toast.error('Failed to load breach alerts: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...breachAlerts];

    if (filterZone !== 'all') {
      filtered = filtered.filter(b => b.zone_id === filterZone);
    }

    if (filterStatus !== 'all') {
      filtered = filtered.filter(b => b.status === filterStatus);
    }

    if (filterBreachType !== 'all') {
      filtered = filtered.filter(b => b.breach_type === filterBreachType);
    }

    if (searchPlate.trim()) {
      const search = searchPlate.toUpperCase().trim();
      filtered = filtered.filter(b => b.plate_number.toUpperCase().includes(search));
    }

    setFilteredAlerts(filtered);
  };

  const handleAddManualBreach = async () => {
    if (!newBreachForm.plate_number || !newBreachForm.zone_id) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      // Get organization ID
      const orgId = user?.role === 'master' 
        ? zones.find(z => z.id === newBreachForm.zone_id)?.organization_id
        : user?.organization_id;

      if (!orgId) {
        toast.error('Organization not found');
        return;
      }

      // Insert breach alert
      const { error } = await supabase
        .from('breach_alerts')
        .insert({
          organization_id: orgId,
          zone_id: newBreachForm.zone_id,
          plate_number: newBreachForm.plate_number.toUpperCase().trim(),
          breach_type: newBreachForm.breach_type,
          breach_details: {
            manually_added: true,
            notes: newBreachForm.notes || null,
            added_by: user?.id,
          },
          status: 'pending',
          notification_sent: false,
        });

      if (error) throw error;

      toast.success('Manual breach alert created successfully');
      setIsAddDialogOpen(false);
      setNewBreachForm({
        plate_number: '',
        zone_id: '',
        breach_type: 'overstay',
        notes: '',
      });
      loadBreachAlerts();

    } catch (error: any) {
      console.error('❌ Failed to create breach:', error);
      toast.error('Failed to create breach: ' + error.message);
    }
  };

  const handleEnactEnforcement = async () => {
    if (!selectedBreach || !enforceForm.officer_id) {
      toast.error('Please select an officer');
      return;
    }

    try {
      // Create enforcement action
      const { error } = await supabase
        .from('enforcement_actions')
        .insert({
          organization_id: selectedBreach.organization_id,
          zone_id: selectedBreach.zone_id,
          plate_number: selectedBreach.plate_number,
          action_type: enforceForm.action_type,
          breach_status: 'assigned',
          assigned_to: enforceForm.officer_id,
          assigned_by: user?.id,
          assigned_at: new Date().toISOString(),
          notes: enforceForm.notes || null,
          user_id: user?.id || '',
          recorded_at: new Date().toISOString(),
          status: 'pending',
        });

      if (error) throw error;

      // Update breach alert status
      await supabase
        .from('breach_alerts')
        .update({ status: 'enforcing' })
        .eq('id', selectedBreach.id);

      toast.success('Enforcement action created successfully');
      setIsEnforceDialogOpen(false);
      setSelectedBreach(null);
      setEnforceForm({ officer_id: '', action_type: 'warning', notes: '' });
      loadBreachAlerts();

    } catch (error: any) {
      console.error('❌ Failed to enact enforcement:', error);
      toast.error('Failed to enact enforcement: ' + error.message);
    }
  };

  const exportToCSV = () => {
    if (filteredAlerts.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = [
      'Plate Number',
      'Zone',
      'Breach Type',
      'Status',
      'Created At',
      'Notification Sent',
      'Enforcement Assigned',
    ];

    const rows = filteredAlerts.map(breach => [
      breach.plate_number,
      breach.zone_name,
      breach.breach_type.replace(/_/g, ' '),
      breach.status,
      new Date(breach.created_at).toLocaleString('en-NZ'),
      breach.notification_sent ? 'Yes' : 'No',
      breach.enforcement_assigned ? 'Yes' : 'No',
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `breach-alerts-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Report exported successfully');
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { label: string; className: string }> = {
      pending: { label: 'Pending Admin', className: 'bg-amber-100 text-amber-700 border-amber-300' },
      auto_assigned: { label: 'Auto-Assigned', className: 'bg-purple-100 text-purple-700 border-purple-300' },
      enforcing: { label: 'Enforcing', className: 'bg-blue-100 text-blue-700 border-blue-300' },
      admin_review: { label: 'Admin Review', className: 'bg-cyan-100 text-cyan-700 border-cyan-300' },
      resolved: { label: 'Resolved', className: 'bg-green-100 text-green-700 border-green-300' },
      dismissed: { label: 'Dismissed', className: 'bg-gray-100 text-gray-700 border-gray-300' },
    };

    const badge = badges[status] || badges.pending;

    return (
      <Badge variant="outline" className={badge.className}>
        {badge.label}
      </Badge>
    );
  };

  const getBreachTypeBadge = (type: string) => {
    const badges: Record<string, { label: string; className: string }> = {
      overstay: { label: 'Overstay', className: 'bg-red-100 text-red-700' },
      consecutive_days: { label: 'Consecutive Days', className: 'bg-orange-100 text-orange-700' },
      nights_exceeded: { label: 'Monthly Limit', className: 'bg-amber-100 text-amber-700' },
      no_self_contained: { label: 'No Self-Contained', className: 'bg-purple-100 text-purple-700' },
      unauthorized_zone: { label: 'Unauthorized Zone', className: 'bg-pink-100 text-pink-700' },
    };

    const badge = badges[type] || { label: type, className: 'bg-gray-100 text-gray-700' };

    return (
      <Badge className={badge.className}>
        {badge.label}
      </Badge>
    );
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'master';

  return (
    <div className="space-y-6">
      {/* Header with Hamburger Menu */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <AdminNavigationMenu />
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-red-600" />
              Breach Alerts Report
            </h1>
            <p className="text-muted-foreground mt-1">
              All compliance breaches and overstayers requiring attention
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadBreachAlerts} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button variant="outline" onClick={exportToCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          {isAdmin && (
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Manual Breach
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Total Breaches</div>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="text-3xl font-bold">{breachAlerts.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Pending</div>
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div className="text-3xl font-bold text-amber-600">
              {breachAlerts.filter(b => b.status === 'pending').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Enforcing</div>
              <Shield className="h-5 w-5 text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-blue-600">
              {breachAlerts.filter(b => b.status === 'enforcing').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Resolved</div>
              <Shield className="h-5 w-5 text-green-500" />
            </div>
            <div className="text-3xl font-bold text-green-600">
              {breachAlerts.filter(b => b.status === 'resolved').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Search Plate</Label>
              <Input
                placeholder="ABC123..."
                value={searchPlate}
                onChange={(e) => setSearchPlate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Zone</Label>
              <Select value={filterZone} onValueChange={setFilterZone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Zones</SelectItem>
                  {zones.map(zone => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending Admin</SelectItem>
                  <SelectItem value="auto_assigned">Auto-Assigned</SelectItem>
                  <SelectItem value="enforcing">Enforcing</SelectItem>
                  <SelectItem value="admin_review">Admin Review</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="dismissed">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Breach Type</Label>
              <Select value={filterBreachType} onValueChange={setFilterBreachType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="overstay">Overstay</SelectItem>
                  <SelectItem value="consecutive_days">Consecutive Days</SelectItem>
                  <SelectItem value="nights_exceeded">Monthly Limit</SelectItem>
                  <SelectItem value="no_self_contained">No Self-Contained</SelectItem>
                  <SelectItem value="unauthorized_zone">Unauthorized Zone</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {(searchPlate || filterZone !== 'all' || filterStatus !== 'all' || filterBreachType !== 'all') && (
            <div className="mt-4 flex items-center gap-2">
              <Badge variant="outline">
                Showing {filteredAlerts.length} of {breachAlerts.length} breaches
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchPlate('');
                  setFilterZone('all');
                  setFilterStatus('all');
                  setFilterBreachType('all');
                }}
                className="gap-1"
              >
                <X className="h-3 w-3" />
                Clear Filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Breach Alerts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Breach Alerts ({filteredAlerts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
              <p className="text-muted-foreground">Loading breach alerts...</p>
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30" />
              <p className="font-medium">No breach alerts found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {breachAlerts.length > 0 
                  ? 'Try adjusting your filters'
                  : 'All vehicles are in compliance'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Photo</TableHead>
                    <TableHead>Plate Number</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Breach Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlerts.map((breach) => (
                    <TableRow 
                      key={breach.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={(e) => {
                        e.stopPropagation();
                        loadVehicleDetails(breach.plate_number);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {breach.observation_id ? (
                          <img
                            onClick={() => {
                              const photoUrl = `https://xbfnlzmpumthnjmtqufp.supabase.co/storage/v1/object/public/evidence/${breach.plate_number}`;
                              setCurrentPhoto(photoUrl);
                              setPhotoViewerOpen(true);
                            }}
                            src={`https://xbfnlzmpumthnjmtqufp.supabase.co/storage/v1/object/public/evidence/${breach.plate_number}`}
                            alt="Evidence"
                            className="w-24 h-16 object-cover rounded border cursor-pointer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="w-24 h-16 bg-muted rounded border flex items-center justify-center"><svg class="h-6 w-6 text-muted-foreground opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>';
                            }}
                          />
                        ) : (
                          <div className="w-24 h-16 bg-muted rounded border flex items-center justify-center">
                            <ImageIcon className="h-6 w-6 text-muted-foreground opacity-30" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => {
                        e.stopPropagation();
                        loadVehicleDetails(breach.plate_number);
                      }}
                          className="flex items-center gap-2 font-mono font-bold text-lg hover:text-blue-600 transition-colors"
                        >
                          <Car className="h-4 w-4 text-muted-foreground" />
                          {breach.plate_number}
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {breach.vehicle_make || breach.vehicle_model 
                            ? `${breach.vehicle_make || ''} ${breach.vehicle_model || ''}`.trim()
                            : '-'}
                        </div>
                        {breach.vehicle_color && (
                          <div className="text-xs text-muted-foreground">{breach.vehicle_color}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          {breach.zone_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getBreachTypeBadge(breach.breach_type)}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(breach.status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {breach.is_flagged && (
                            <Badge variant="outline" className="gap-1 bg-red-50 text-red-700 border-red-300">
                              <Flag className="h-3 w-3" />
                              Flagged
                            </Badge>
                          )}
                          {breach.homeless_status === 'confirmed' && (
                            <Badge variant="outline" className="gap-1 bg-cyan-50 text-cyan-700 border-cyan-300">
                              <Home className="h-3 w-3" />
                              Exempt
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {new Date(breach.created_at).toLocaleDateString('en-NZ')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {isAdmin && !breach.enforcement_assigned && breach.status !== 'resolved' && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedBreach(breach);
                              setIsEnforceDialogOpen(true);
                            }}
                            className="gap-1"
                          >
                            <UserPlus className="h-3 w-3" />
                            Enact Enforcement
                          </Button>
                        )}
                        {breach.enforcement_assigned && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700">
                            Enforcement Assigned
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Manual Breach Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manual Breach Alert</DialogTitle>
            <DialogDescription>
              Manually record a breach alert for historical or special cases
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Plate Number *</Label>
              <Input
                placeholder="ABC123"
                value={newBreachForm.plate_number}
                onChange={(e) => setNewBreachForm({ ...newBreachForm, plate_number: e.target.value })}
                className="uppercase"
              />
            </div>

            <div className="space-y-2">
              <Label>Zone *</Label>
              <Select 
                value={newBreachForm.zone_id} 
                onValueChange={(value) => setNewBreachForm({ ...newBreachForm, zone_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map(zone => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Breach Type *</Label>
              <Select 
                value={newBreachForm.breach_type} 
                onValueChange={(value: any) => setNewBreachForm({ ...newBreachForm, breach_type: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overstay">Overstay</SelectItem>
                  <SelectItem value="consecutive_days">Consecutive Days Exceeded</SelectItem>
                  <SelectItem value="nights_exceeded">Monthly Nights Exceeded</SelectItem>
                  <SelectItem value="no_self_contained">No Self-Contained</SelectItem>
                  <SelectItem value="unauthorized_zone">Unauthorized Zone</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Any additional details..."
                value={newBreachForm.notes}
                onChange={(e) => setNewBreachForm({ ...newBreachForm, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddManualBreach}>Add Breach</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enact Enforcement Dialog */}
      <Dialog open={isEnforceDialogOpen} onOpenChange={setIsEnforceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enact Enforcement Action</DialogTitle>
            <DialogDescription>
              Assign an officer to handle this breach
            </DialogDescription>
          </DialogHeader>
          {selectedBreach && (
            <div className="space-y-4 py-4">
              <div className="p-3 bg-muted/50 rounded-lg space-y-1">
                <div className="text-sm font-medium">Vehicle: {selectedBreach.plate_number}</div>
                <div className="text-sm text-muted-foreground">Zone: {selectedBreach.zone_name}</div>
                <div className="text-sm text-muted-foreground">
                  Breach: {selectedBreach.breach_type.replace(/_/g, ' ')}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Assign To Officer *</Label>
                <Select 
                  value={enforceForm.officer_id} 
                  onValueChange={(value) => setEnforceForm({ ...enforceForm, officer_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select officer" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.filter(u => u.role === 'officer' || u.role === 'admin').map((officer) => (
                      <SelectItem key={officer.id} value={officer.id}>
                        {officer.first_name} {officer.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Action Type</Label>
                <Select 
                  value={enforceForm.action_type} 
                  onValueChange={(value: any) => setEnforceForm({ ...enforceForm, action_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="notice">Notice to Vacate</SelectItem>
                    <SelectItem value="tow">Tow Request</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Instructions/Notes</Label>
                <Textarea
                  value={enforceForm.notes}
                  onChange={(e) => setEnforceForm({ ...enforceForm, notes: e.target.value })}
                  placeholder="Special instructions for the officer..."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEnforceDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEnactEnforcement}>Assign Officer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo Viewer Modal */}
      <Dialog open={photoViewerOpen} onOpenChange={setPhotoViewerOpen}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black">
          <div className="relative">
            <img
              src={currentPhoto}
              alt="Evidence photo"
              className="w-full h-auto max-h-[90vh] object-contain"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setPhotoViewerOpen(false)}
              className="absolute top-4 right-4 text-white hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vehicle Detail Modal */}
      <Dialog open={vehicleDetailOpen} onOpenChange={setVehicleDetailOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-2xl">
              <Car className="h-7 w-7 text-purple-600" />
              {selectedVehicleDetails?.plate_number}
            </DialogTitle>
          </DialogHeader>
          {loadingVehicleDetails ? (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            </div>
          ) : selectedVehicleDetails && (
            <div className="space-y-6">
              <Card>
                <CardContent className="p-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold mb-3">Vehicle Details</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Make:</span>
                            <span className="font-semibold">{selectedVehicleDetails.vehicle_make || '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Model:</span>
                            <span className="font-semibold">{selectedVehicleDetails.vehicle_model || '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Color:</span>
                            <span className="font-semibold">{selectedVehicleDetails.vehicle_color || '-'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold mb-3">Statistics</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3 bg-muted rounded">
                            <div className="text-xs text-muted-foreground">Observations</div>
                            <div className="font-bold text-2xl">{selectedVehicleDetails.total_observations || 0}</div>
                          </div>
                          <div className="p-3 bg-muted rounded">
                            <div className="text-xs text-muted-foreground">Breaches</div>
                            <div className="font-bold text-2xl text-red-600">{selectedVehicleDetails.total_breaches || 0}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setVehicleDetailOpen(false)} variant="outline">
                  Close
                </Button>
                <Button onClick={() => {
                  setVehicleDetailOpen(false);
                  navigate(`/admin/vehicles?plate=${selectedVehicleDetails.plate_number}`);
                }}>
                  View Full Profile
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );

  async function loadVehicleDetails(plateNumber: string) {
    setLoadingVehicleDetails(true);
    setVehicleDetailOpen(true);
    try {
      const { data, error } = await supabase
        .from('canonical_vehicles')
        .select('*')
        .eq('plate_number', plateNumber)
        .single();

      if (error) throw error;
      setSelectedVehicleDetails(data);
    } catch (error: any) {
      console.error('Failed to load vehicle details:', error);
      toast.error('Failed to load vehicle details');
    } finally {
      setLoadingVehicleDetails(false);
    }
  }
}
