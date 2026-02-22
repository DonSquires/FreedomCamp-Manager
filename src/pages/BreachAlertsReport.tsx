/**
 * Breach Alerts Report
 * 
 * Shows all breach alerts with:
 * - Manual data entry capability for historical breaches
 * - Enact enforcement action on any breach
 * - Filter by zone, date, status
 * - Export capabilities
 * - Evidence trail for consecutive/overstay breaches
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
  User,
} from 'lucide-react';
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
  photo_url: string | null;
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

  // Evidence trail modal
  const [evidenceTrailOpen, setEvidenceTrailOpen] = useState(false);
  const [evidenceTrailData, setEvidenceTrailData] = useState<any[]>([]);
  const [loadingEvidenceTrail, setLoadingEvidenceTrail] = useState(false);

  useEffect(() => {
    loadBreachAlerts();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [breachAlerts, filterZone, filterStatus, filterBreachType, searchPlate]);

  const loadBreachAlerts = async () => {
    setIsLoading(true);
    try {
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
          zones(name)
        `)
        .order('created_at', { ascending: false });

      if (user?.role !== 'master') {
        query = query.eq('organization_id', user?.organization_id || '');
      }

      const { data, error } = await query;

      if (error) throw error;

      // Fetch vehicle data for all unique plates
      const uniquePlates = [...new Set(data?.map(b => b.plate_number) || [])];
      const { data: vehicleData } = await supabase
        .from('canonical_vehicles')
        .select('plate_number, make, model, colour, homeless_status, is_flagged')
        .in('plate_number', uniquePlates);

      const vehicleMap = new Map(
        (vehicleData || []).map(v => [v.plate_number, v])
      );

      // Fetch observation photos for all observation IDs
      const observationIds = data?.filter(b => b.observation_id).map(b => b.observation_id) || [];
      const { data: observationData } = await supabase
        .from('observations')
        .select('id, photo_url')
        .in('id', observationIds);

      const observationMap = new Map(
        (observationData || []).map(o => [o.id, o])
      );

      const enrichedData = (data || []).map(breach => {
        const vehicle = vehicleMap.get(breach.plate_number);
        const observation = breach.observation_id ? observationMap.get(breach.observation_id) : null;
        return {
          ...breach,
          zone_name: (breach.zones as any)?.name || 'Unknown',
          vehicle_make: vehicle?.make || null,
          vehicle_model: vehicle?.model || null,
          vehicle_color: vehicle?.colour || null,
          homeless_status: vehicle?.homeless_status || null,
          is_flagged: vehicle?.is_flagged || false,
          photo_url: observation?.photo_url || null,
          enforcement_assigned: false,
        };
      });

      setBreachAlerts(enrichedData);
      console.log('✅ Loaded', enrichedData.length, 'breach alerts');

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

  const loadEvidenceTrail = async (breach: BreachAlert) => {
    setLoadingEvidenceTrail(true);
    setEvidenceTrailOpen(true);
    try {
      let dateRangeStart = new Date();
      if (breach.breach_type === 'consecutive_days' || breach.breach_type === 'overstay') {
        dateRangeStart.setDate(dateRangeStart.getDate() - 7);
      } else if (breach.breach_type === 'nights_exceeded') {
        dateRangeStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      }

      const { data: observations, error: obsError } = await supabase
        .from('observations')
        .select(`
          *,
          user_profiles!observations_recorded_by_fkey(first_name, last_name),
          zones(name)
        `)
        .eq('plate_number', breach.plate_number)
        .eq('zone_id', breach.zone_id)
        .gte('recorded_at', dateRangeStart.toISOString())
        .order('recorded_at', { ascending: true });

      if (obsError) throw obsError;

      const enrichedObs = (observations || []).map((obs) => ({
        ...obs,
        officer_name: (obs.user_profiles as any)
          ? `${(obs.user_profiles as any).first_name} ${(obs.user_profiles as any).last_name}`
          : 'Unknown',
        zone_name: (obs.zones as any)?.name || 'Unknown',
      }));

      setEvidenceTrailData(enrichedObs);
    } catch (error: any) {
      console.error('Failed to load evidence trail:', error);
      toast.error('Failed to load evidence trail');
    } finally {
      setLoadingEvidenceTrail(false);
    }
  };

  const handleAddManualBreach = async () => {
    if (!newBreachForm.plate_number || !newBreachForm.zone_id) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const orgId = user?.role === 'master' 
        ? zones.find(z => z.id === newBreachForm.zone_id)?.organization_id
        : user?.organization_id;

      if (!orgId) {
        toast.error('Organization not found');
        return;
      }

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

  const formatBreachProof = (breachDetails: any, breachType: string) => {
    if (!breachDetails) return 'No proof recorded';

    const proofItems: string[] = [];

    // Extract violation reasons if present
    if (breachDetails.violation_reasons && Array.isArray(breachDetails.violation_reasons)) {
      const reasons = breachDetails.violation_reasons.map((r: string) => {
        if (r === 'not_self_contained') return 'Vehicle not self-contained';
        if (r === 'nights_exceeded') return 'Monthly nights limit exceeded';
        if (r === 'consecutive_exceeded') return 'Consecutive nights exceeded';
        if (r === 'unauthorized_zone') return 'Unauthorized zone';
        return r.replace(/_/g, ' ');
      });
      proofItems.push(...reasons);
    }

    if (breachType === 'nights_exceeded' || breachType === 'overstay') {
      if (breachDetails.nights_stayed !== undefined) {
        proofItems.push(`${breachDetails.nights_stayed} nights this month`);
      }
      if (breachDetails.max_nights !== undefined) {
        proofItems.push(`Limit: ${breachDetails.max_nights} nights`);
      }
      if (breachDetails.consecutive_nights !== undefined) {
        proofItems.push(`${breachDetails.consecutive_nights} consecutive`);
      }
    }

    if (breachType === 'consecutive_days') {
      if (breachDetails.consecutive_nights !== undefined) {
        proofItems.push(`${breachDetails.consecutive_nights} consecutive nights`);
      }
      if (breachDetails.max_consecutive !== undefined) {
        proofItems.push(`Limit: ${breachDetails.max_consecutive}`);
      }
    }

    if (breachType === 'no_self_contained') {
      if (breachDetails.required_sc !== undefined) {
        proofItems.push(`Self-contained: ${breachDetails.required_sc ? 'Required' : 'Not required'}`);
      }
      if (breachDetails.has_sc !== undefined) {
        proofItems.push(`Vehicle has SC: ${breachDetails.has_sc ? 'Yes' : 'No'}`);
      }
      // Default message for no_self_contained if no other data
      if (proofItems.length === 0) {
        proofItems.push('Zone requires self-contained certification');
      }
    }

    // Add evaluation date in human-friendly format
    if (breachDetails.evaluated_at) {
      try {
        const detectedDate = new Date(breachDetails.evaluated_at);
        proofItems.push(`Evaluated: ${detectedDate.toLocaleDateString('en-NZ', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}`);
      } catch {}
    }

    if (breachDetails.rule_applied) {
      proofItems.push(`Rule: ${breachDetails.rule_applied}`);
    }

    if (breachDetails.matrix_version) {
      proofItems.push(`Policy Version: ${breachDetails.matrix_version}`);
    }

    if (breachDetails.notes) {
      proofItems.push(`Notes: ${breachDetails.notes}`);
    }

    return proofItems.length > 0 ? proofItems.join(' • ') : 'Breach detected - details pending';
  };

  const loadVehicleDetails = async (plateNumber: string) => {
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
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'master';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <AdminNavigationMenu />
      <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
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
                    <TableHead className="min-w-[300px]">Breach Proof</TableHead>
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
                        {breach.photo_url ? (
                          <img
                            onClick={() => {
                              setCurrentPhoto(breach.photo_url!);
                              setPhotoViewerOpen(true);
                            }}
                            src={breach.photo_url}
                            alt="Evidence"
                            className="w-24 h-16 object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              const parent = (e.target as HTMLImageElement).parentElement;
                              if (parent) {
                                parent.innerHTML = '<div class="w-24 h-16 bg-muted rounded border flex items-center justify-center"><svg class="h-6 w-6 text-muted-foreground opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>';
                              }
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
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">
                            {formatBreachProof(breach.breach_details, breach.breach_type)}
                          </div>
                          {(breach.breach_type === 'consecutive_days' || 
                            breach.breach_type === 'nights_exceeded' || 
                            breach.breach_type === 'overstay') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                loadEvidenceTrail(breach);
                              }}
                              className="h-7 text-xs gap-1"
                            >
                              <FileText className="h-3 w-3" />
                              View Evidence Trail
                            </Button>
                          )}
                        </div>
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
                            onClick={(e) => {
                              e.stopPropagation();
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

      {/* Evidence Trail Modal */}
      <Dialog open={evidenceTrailOpen} onOpenChange={setEvidenceTrailOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <FileText className="h-6 w-6 text-blue-600" />
              Evidence Trail - Complete Audit History
            </DialogTitle>
            <DialogDescription>
              All observations that contributed to this breach violation
            </DialogDescription>
          </DialogHeader>

          {loadingEvidenceTrail ? (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
              <p className="text-muted-foreground mt-3">Loading evidence trail...</p>
            </div>
          ) : evidenceTrailData.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30" />
              <p className="font-medium">No observations found</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              <Card className="border-2 border-blue-500 bg-blue-50/50">
                <CardContent className="p-4">
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-blue-600">{evidenceTrailData.length}</div>
                      <div className="text-xs text-muted-foreground">Total Observations</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-purple-600">
                        {evidenceTrailData.filter(o => o.is_compliant === false).length}
                      </div>
                      <div className="text-xs text-muted-foreground">Non-Compliant</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-600">
                        {evidenceTrailData.filter(o => o.is_compliant === true).length}
                      </div>
                      <div className="text-xs text-muted-foreground">Compliant</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-amber-600">
                        {new Set(evidenceTrailData.map(o => o.recorded_by)).size}
                      </div>
                      <div className="text-xs text-muted-foreground">Different Officers</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                {evidenceTrailData.map((obs, idx) => (
                  <Card 
                    key={obs.id} 
                    className={cn(
                      'border-l-4',
                      obs.is_compliant === false ? 'border-l-red-500 bg-red-50/30' : 'border-l-green-500'
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="flex gap-4">
                        <div className="shrink-0">
                          {obs.photo_url ? (
                            <img
                              src={obs.photo_url}
                              alt={`Evidence ${idx + 1}`}
                              className="w-32 h-24 object-cover rounded border-2 cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => {
                                setCurrentPhoto(obs.photo_url);
                                setPhotoViewerOpen(true);
                              }}
                            />
                          ) : (
                            <div className="w-32 h-24 bg-muted rounded border-2 flex items-center justify-center">
                              <ImageIcon className="h-8 w-8 text-muted-foreground opacity-30" />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 space-y-2">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="font-mono">
                                  #{idx + 1}
                                </Badge>
                                <span className="font-bold text-lg">{obs.plate_number}</span>
                                {obs.is_compliant === false && (
                                  <Badge variant="destructive" className="gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    BREACH
                                  </Badge>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {obs.zone_name}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold">
                                {new Date(obs.recorded_at).toLocaleDateString('en-NZ', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {new Date(obs.recorded_at).toLocaleTimeString('en-NZ', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div className="flex items-center gap-2 p-2 bg-white rounded border">
                              <User className="h-4 w-4 text-blue-600" />
                              <div>
                                <div className="text-muted-foreground">Officer</div>
                                <div className="font-semibold">{obs.officer_name}</div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 p-2 bg-white rounded border">
                              <MapPin className="h-4 w-4 text-green-600" />
                              <div>
                                <div className="text-muted-foreground">GPS</div>
                                <div className="font-semibold font-mono">
                                  {obs.gps_latitude?.toFixed(4)}, {obs.gps_longitude?.toFixed(4)}
                                </div>
                              </div>
                            </div>

                            {obs.nights_stayed_this_month !== undefined && (
                              <div className="flex items-center gap-2 p-2 bg-white rounded border">
                                <Clock className="h-4 w-4 text-purple-600" />
                                <div>
                                  <div className="text-muted-foreground">Monthly Count</div>
                                  <div className="font-semibold">{obs.nights_stayed_this_month} nights</div>
                                </div>
                              </div>
                            )}

                            {obs.consecutive_nights !== undefined && (
                              <div className="flex items-center gap-2 p-2 bg-white rounded border">
                                <Calendar className="h-4 w-4 text-amber-600" />
                                <div>
                                  <div className="text-muted-foreground">Consecutive</div>
                                  <div className="font-semibold">{obs.consecutive_nights} nights</div>
                                </div>
                              </div>
                            )}
                          </div>

                          {obs.officer_notes && (
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm">
                              <div className="font-semibold text-amber-900 mb-1">Officer Notes:</div>
                              <div className="text-amber-800">{obs.officer_notes}</div>
                            </div>
                          )}

                          {obs.breach_reason && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                              <div className="font-semibold text-red-900 mb-1">Breach Reason:</div>
                              <div className="text-red-800">{obs.breach_reason}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setEvidenceTrailOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                toast.info('Export feature coming soon');
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Export Evidence Pack
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Other modals remain unchanged */}
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
                {selectedBreach.breach_details && (
                  <div className="text-xs text-muted-foreground mt-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded border border-amber-200 dark:border-amber-800">
                    <strong className="text-amber-900 dark:text-amber-200">Proof:</strong>{' '}
                    {formatBreachProof(selectedBreach.breach_details, selectedBreach.breach_type)}
                  </div>
                )}
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
                            <span className="font-semibold">{selectedVehicleDetails.make || '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Model:</span>
                            <span className="font-semibold">{selectedVehicleDetails.model || '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Color:</span>
                            <span className="font-semibold">{selectedVehicleDetails.colour || '-'}</span>
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
    </div>
  );
}
