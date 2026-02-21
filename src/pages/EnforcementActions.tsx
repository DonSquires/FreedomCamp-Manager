/**
 * Enforcement Actions - Complete Breach & Job Management
 * 
 * Features:
 * - Active Breaches Tab: All unresolved overstayers/violators
 * - Enforcement Jobs Tab: Assigned work for officers
 * - Completed Tab: Historical enforcement records
 * - Job Assignment: Admin assigns officer to handle breach
 * - Job Completion: Officer completes with outcome (completed/not_on_site)
 * - Enforcement Tally: Tracks count on canonical_vehicles
 * - Flagged Vehicle Creation: Create warnings during enforcement (NZ Privacy Act compliant)
 * - Create Enforcement Action: Admin can record completed enforcement actions from start to finish
 * - Integration: Links from dashboard/breach alerts to create jobs
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MultiPhotoUpload } from '@/components/features/MultiPhotoUpload';
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
import { EnforcementGuardModal } from '@/components/features/EnforcementGuardModal';
import {
  Shield,
  AlertTriangle,
  User,
  Clock,
  Car,
  MapPin,
  CheckCircle2,
  XCircle,
  Loader2,
  UserPlus,
  PlayCircle,
  Home,
  Flag,
  FileText,
  Ban,
  Plus,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { VehicleCard } from '@/components/features/VehicleCard';
import { useUsers } from '@/hooks/useUsers';
import { useZones } from '@/hooks/useZones';
import { supabase } from '@/lib/supabase';

interface ActiveBreach {
  plate_number: string;
  zone_id: string;
  zone_name: string;
  organization_id: string;
  total_observations: number;
  breach_count: number;
  last_breach_date: string;
  last_breach_type: string;
  homeless_status: string;
  is_flagged: boolean;
  consecutive_nights: number;
  nights_stayed: number;
  max_allowed_consecutive: number;
  max_allowed_monthly: number;
  has_active_enforcement: boolean;
  enforcement_status: string;
}

interface EnforcementJob {
  id: string;
  plate_number: string;
  zone_id: string;
  zone_name: string;
  organization_id: string;
  action_type: string;
  breach_status: string;
  assigned_to: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  completion_outcome: string | null;
  completion_notes: string | null;
  notes: string | null;
  recorded_at: string;
  assigned_officer: { first_name: string; last_name: string } | null;
  assigned_by_user: { first_name: string; last_name: string } | null;
}

export function EnforcementActions() {
  const { user } = useAuthStore();
  const { data: users = [] } = useUsers();
  const { data: zones = [] } = useZones();

  const [activeTab, setActiveTab] = useState('breaches');
  const [isLoading, setIsLoading] = useState(false);
  const [activeBreaches, setActiveBreaches] = useState<ActiveBreach[]>([]);
  const [enforcementJobs, setEnforcementJobs] = useState<EnforcementJob[]>([]);
  const [completedJobs, setCompletedJobs] = useState<EnforcementJob[]>([]);

  // Dialogs
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [isCreateEnforcementOpen, setIsCreateEnforcementOpen] = useState(false);
  const [selectedBreach, setSelectedBreach] = useState<ActiveBreach | null>(null);
  const [selectedJob, setSelectedJob] = useState<EnforcementJob | null>(null);

  // Enforcement guard state
  const [isEnforcementGuardOpen, setIsEnforcementGuardOpen] = useState(false);
  const [enforcementCheckResult, setEnforcementCheckResult] = useState<any>(null);
  const [pendingObservationId, setPendingObservationId] = useState<string | null>(null);

  // Form data with flagged vehicle options
  const [assignForm, setAssignForm] = useState({
    officer_id: '',
    action_type: 'warning' as 'warning' | 'notice' | 'tow' | 'other',
    notes: '',
    photos: [] as string[],
    createFlaggedVehicle: false,
    flaggedPriority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    flaggedReason: '',
    confirmedHomeless: false,
  });

  const [completeForm, setCompleteForm] = useState({
    outcome: 'completed' as 'completed' | 'not_on_site' | 'cancelled',
    notes: '',
    photos: [] as string[],
    createFlaggedVehicle: false,
    flaggedPriority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    flaggedReason: '',
    confirmedHomeless: false,
  });

  // Create enforcement form
  const [createEnforcementForm, setCreateEnforcementForm] = useState({
    plate_number: '',
    zone_id: '',
    action_type: 'warning' as 'warning' | 'notice' | 'tow' | 'other',
    assigned_to: '',
    delivery_method: 'hand_delivered' as 'hand_delivered' | 'windscreen' | 'posted' | 'email' | 'other',
    recipient_name: '',
    recipient_email: '',
    location_lat: '',
    location_lng: '',
    notes: '',
    completion_outcome: 'completed' as 'completed' | 'not_on_site' | 'cancelled',
    completion_notes: '',
    photos: [] as string[],
    createFlaggedVehicle: false,
    flaggedPriority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    flaggedReason: '',
    confirmedHomeless: false,
  });

  // Load data on mount and tab change
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load active breaches
      if (activeTab === 'breaches') {
        // Query observations with breach status (is_compliant = false means breach)
        let query = supabase
          .from('observations')
          .select(`
            plate_number,
            zone_id,
            organization_id,
            is_compliant,
            breach_type,
            breach_reason,
            nights_stayed_this_month,
            consecutive_nights,
            recorded_at,
            zones (name)
          `)
          .eq('is_compliant', false)
          .gte('recorded_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .order('recorded_at', { ascending: false });

        if (user?.role !== 'master') {
          query = query.eq('organization_id', user?.organization_id || '');
        }

        const { data: observations, error } = await query;

        if (error) throw error;

        // Get plate numbers to fetch vehicle data
        const plateNumbers = [...new Set((observations || []).map(o => o.plate_number))];
        
        // Fetch vehicle data separately
        let vehicleData: any[] = [];
        if (plateNumbers.length > 0) {
          const { data: vehicles, error: vehiclesError } = await supabase
            .from('canonical_vehicles')
            .select('plate_number, homeless_status, is_flagged')
            .in('plate_number', plateNumbers);

          if (vehiclesError) {
            console.error('Failed to load vehicle data:', vehiclesError);
          } else {
            vehicleData = vehicles || [];
          }
        }

        const vehicleMap = new Map(vehicleData.map(v => [v.plate_number, v]));

        // Group by plate + zone to get active breaches
        const breachMap = new Map<string, any>();
        
        (observations || []).forEach(obs => {
          const key = `${obs.plate_number}-${obs.zone_id}`;
          const vehicle = vehicleMap.get(obs.plate_number);
          
          if (!breachMap.has(key)) {
            breachMap.set(key, {
              plate_number: obs.plate_number,
              zone_id: obs.zone_id,
              zone_name: (obs.zones as any)?.name || 'Unknown',
              organization_id: obs.organization_id,
              total_observations: 0,
              breach_count: 0,
              last_breach_date: obs.recorded_at,
              last_breach_type: obs.breach_type || 'overstay',
              homeless_status: vehicle?.homeless_status || null,
              is_flagged: vehicle?.is_flagged || false,
              consecutive_nights: obs.consecutive_nights || 0,
              nights_stayed: obs.nights_stayed_this_month || 0,
              max_allowed_consecutive: 3, // Default from zone rules
              max_allowed_monthly: 28, // Default from zone rules
              has_active_enforcement: false,
              enforcement_status: null,
            });
          }
          const breach = breachMap.get(key);
          breach.total_observations++;
          if (!obs.is_compliant) breach.breach_count++;
        });

        const breaches = Array.from(breachMap.values());

        // Check enforcement status for each breach
        await Promise.all(breaches.map(async (breach) => {
          const { data: enforcement } = await supabase
            .from('enforcement_actions')
            .select('breach_status')
            .eq('plate_number', breach.plate_number)
            .eq('zone_id', breach.zone_id)
            .in('breach_status', ['active', 'assigned', 'in_progress'])
            .limit(1)
            .maybeSingle();

          if (enforcement) {
            breach.has_active_enforcement = true;
            breach.enforcement_status = enforcement.breach_status;
          }
        }));

        setActiveBreaches(breaches);
      }

      // Load enforcement jobs (active and in-progress)
      if (activeTab === 'jobs') {
        let query = supabase
          .from('enforcement_actions')
          .select(`
            *,
            zone:zones(name),
            assigned_officer:user_profiles!enforcement_actions_assigned_to_fkey(first_name, last_name),
            assigned_by_user:user_profiles!enforcement_actions_assigned_by_fkey(first_name, last_name)
          `)
          .in('breach_status', ['active', 'assigned', 'in_progress'])
          .order('assigned_at', { ascending: false, nullsFirst: false });

        if (user?.role !== 'master') {
          query = query.eq('organization_id', user?.organization_id || '');
        }

        const { data, error } = await query;
        if (error) throw error;

        setEnforcementJobs((data || []).map(j => ({
          ...j,
          zone_name: (j.zone as any)?.name || 'Unknown',
          assigned_officer: j.assigned_officer,
          assigned_by_user: j.assigned_by_user,
        })));
      }

      // Load completed jobs
      if (activeTab === 'completed') {
        let query = supabase
          .from('enforcement_actions')
          .select(`
            *,
            zone:zones(name),
            assigned_officer:user_profiles!enforcement_actions_assigned_to_fkey(first_name, last_name),
            completed_by_user:user_profiles!enforcement_actions_completed_by_fkey(first_name, last_name)
          `)
          .in('breach_status', ['completed', 'not_on_site', 'cancelled'])
          .order('completed_at', { ascending: false })
          .limit(100);

        if (user?.role !== 'master') {
          query = query.eq('organization_id', user?.organization_id || '');
        }

        const { data, error } = await query;
        if (error) throw error;

        setCompletedJobs((data || []).map(j => ({
          ...j,
          zone_name: (j.zone as any)?.name || 'Unknown',
          assigned_officer: j.assigned_officer,
        })));
      }

    } catch (error: any) {
      console.error('Failed to load enforcement data:', error);
      toast.error('Failed to load data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Reload when tab changes
  useEffect(() => {
    loadData();
  }, [activeTab]);

  // Create flagged vehicle record (NZ Privacy Act compliant)
  const createFlaggedVehicleRecord = async (
    plateNumber: string,
    organizationId: string,
    reason: string,
    priority: 'low' | 'medium' | 'high' | 'urgent',
    confirmedHomeless: boolean
  ) => {
    try {
      // Check if vehicle is already flagged by this organization
      const { data: existing } = await supabase
        .from('flagged_vehicles')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('plate_number', plateNumber)
        .eq('is_active', true)
        .maybeSingle();

      if (existing) {
        toast.info('Vehicle is already flagged by your organization');
        return;
      }

      // Create flagged vehicle record
      // NOTE: NZ Privacy Act Compliance:
      // - Warning (plate number, priority) is visible globally for officer safety (RLS: officers_view_all_flagged_vehicles_for_safety)
      // - Detailed information (reason, notes, contact) only accessible to the organization that created it (RLS: org_users_select_flagged_vehicles)
      const { error } = await supabase
        .from('flagged_vehicles')
        .insert({
          organization_id: organizationId,
          plate_number: plateNumber,
          priority,
          notes: reason || 'Flagged during enforcement action',
          confirmed_homeless: confirmedHomeless,
          is_active: true,
          created_by: user?.id,
          date_recorded: new Date().toISOString().split('T')[0],
        });

      if (error) throw error;

      console.log('✅ Flagged vehicle record created (privacy-compliant):', plateNumber);
    } catch (error: any) {
      console.error('Failed to create flagged vehicle:', error);
      throw error;
    }
  };

  // Check if observation is enforceable
  const checkEnforceability = async (observationId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.rpc('is_observation_enforceable', {
        obs_id: observationId
      });

      if (error) {
        console.error('Enforcement check failed:', error);
        toast.error('Failed to verify observation enforceability');
        return false;
      }

      if (!data?.enforceable) {
        setEnforcementCheckResult(data);
        setIsEnforcementGuardOpen(true);
        return false;
      }

      return true;
    } catch (error: any) {
      console.error('Enforcement check error:', error);
      toast.error('Enforcement verification failed');
      return false;
    }
  };

  // Assign officer to breach
  const handleAssignOfficer = async () => {
    if (!selectedBreach || !assignForm.officer_id) {
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
          action_type: assignForm.action_type,
          breach_status: 'assigned',
          assigned_to: assignForm.officer_id,
          assigned_by: user?.id,
          assigned_at: new Date().toISOString(),
          notes: assignForm.notes || null,
          user_id: user?.id || '',
          recorded_at: new Date().toISOString(),
          status: 'pending',
        });

      if (error) throw error;

      // Create flagged vehicle if requested
      if (assignForm.createFlaggedVehicle) {
        await createFlaggedVehicleRecord(
          selectedBreach.plate_number,
          selectedBreach.organization_id,
          assignForm.flaggedReason,
          assignForm.flaggedPriority,
          assignForm.confirmedHomeless
        );
      }

      toast.success('Officer assigned successfully' + (assignForm.createFlaggedVehicle ? ' and vehicle flagged' : ''));
      setIsAssignDialogOpen(false);
      setSelectedBreach(null);
      setAssignForm({ 
        officer_id: '', 
        action_type: 'warning', 
        notes: '', 
        photos: [],
        createFlaggedVehicle: false,
        flaggedPriority: 'medium',
        flaggedReason: '',
        confirmedHomeless: false,
      });
      loadData();

    } catch (error: any) {
      console.error('Failed to assign officer:', error);
      toast.error('Failed to assign officer: ' + error.message);
    }
  };

  // Complete enforcement job
  const handleCompleteJob = async () => {
    if (!selectedJob) return;

    try {
      const updates: any = {
        breach_status: completeForm.outcome === 'completed' ? 'completed' : 
                       completeForm.outcome === 'not_on_site' ? 'not_on_site' : 'cancelled',
        completion_outcome: completeForm.outcome,
        completion_notes: completeForm.notes || null,
        completed_by: user?.id,
        completed_at: new Date().toISOString(),
      };

      // If completed successfully, update delivery status
      if (completeForm.outcome === 'completed') {
        updates.status = 'delivered';
        updates.delivered_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('enforcement_actions')
        .update(updates)
        .eq('id', selectedJob.id);

      if (error) throw error;

      // Create flagged vehicle if requested
      if (completeForm.createFlaggedVehicle) {
        await createFlaggedVehicleRecord(
          selectedJob.plate_number,
          selectedJob.organization_id,
          completeForm.flaggedReason,
          completeForm.flaggedPriority,
          completeForm.confirmedHomeless
        );
      }

      const outcomeMessage = 
        completeForm.outcome === 'completed' ? 'Enforcement action completed' :
        completeForm.outcome === 'not_on_site' ? 'Marked as vehicle not on site' :
        'Job cancelled';

      toast.success(outcomeMessage + (completeForm.createFlaggedVehicle ? ' and vehicle flagged' : ''));
      setIsCompleteDialogOpen(false);
      setSelectedJob(null);
      setCompleteForm({ 
        outcome: 'completed', 
        notes: '', 
        photos: [],
        createFlaggedVehicle: false,
        flaggedPriority: 'medium',
        flaggedReason: '',
        confirmedHomeless: false,
      });
      loadData();

    } catch (error: any) {
      console.error('Failed to complete job:', error);
      toast.error('Failed to complete job: ' + error.message);
    }
  };

  // Create and complete enforcement action in one step
  const handleCreateEnforcement = async () => {
    if (!createEnforcementForm.plate_number || !createEnforcementForm.zone_id) {
      toast.error('Please enter plate number and select zone');
      return;
    }

    try {
      // Find the selected zone to get organization_id
      const selectedZone = zones.find(z => z.id === createEnforcementForm.zone_id);
      if (!selectedZone) {
        toast.error('Invalid zone selected');
        return;
      }

      const enforcementData: any = {
        organization_id: selectedZone.organization_id,
        zone_id: createEnforcementForm.zone_id,
        plate_number: createEnforcementForm.plate_number.toUpperCase().trim(),
        action_type: createEnforcementForm.action_type,
        breach_status: createEnforcementForm.completion_outcome,
        user_id: user?.id || '',
        recorded_at: new Date().toISOString(),
        status: createEnforcementForm.completion_outcome === 'completed' ? 'delivered' : 'pending',
        notes: createEnforcementForm.notes || null,
        completion_outcome: createEnforcementForm.completion_outcome,
        completion_notes: createEnforcementForm.completion_notes || null,
        completed_by: user?.id,
        completed_at: new Date().toISOString(),
      };

      // Add assignment details if officer selected
      if (createEnforcementForm.assigned_to) {
        enforcementData.assigned_to = createEnforcementForm.assigned_to;
        enforcementData.assigned_by = user?.id;
        enforcementData.assigned_at = new Date().toISOString();
      }

      // Add delivery details if provided
      if (createEnforcementForm.delivery_method) {
        enforcementData.delivery_method = createEnforcementForm.delivery_method;
      }
      if (createEnforcementForm.recipient_name) {
        enforcementData.recipient_name = createEnforcementForm.recipient_name;
      }
      if (createEnforcementForm.recipient_email) {
        enforcementData.recipient_email = createEnforcementForm.recipient_email;
      }

      // Add GPS location if provided
      if (createEnforcementForm.location_lat && createEnforcementForm.location_lng) {
        enforcementData.location_lat = parseFloat(createEnforcementForm.location_lat);
        enforcementData.location_lng = parseFloat(createEnforcementForm.location_lng);
      }

      // Add photos if provided
      if (createEnforcementForm.photos.length > 0) {
        enforcementData.attachments = createEnforcementForm.photos.map(url => ({ url, type: 'photo' }));
      }

      const { error } = await supabase
        .from('enforcement_actions')
        .insert(enforcementData);

      if (error) throw error;

      // Create flagged vehicle if requested
      if (createEnforcementForm.createFlaggedVehicle) {
        await createFlaggedVehicleRecord(
          createEnforcementForm.plate_number.toUpperCase().trim(),
          selectedZone.organization_id,
          createEnforcementForm.flaggedReason,
          createEnforcementForm.flaggedPriority,
          createEnforcementForm.confirmedHomeless
        );
      }

      const selectedZoneName = selectedZone.name;
      toast.success(
        `Enforcement action recorded for ${createEnforcementForm.plate_number} at ${selectedZoneName}` +
        (createEnforcementForm.createFlaggedVehicle ? ' and vehicle flagged' : '')
      );
      
      setIsCreateEnforcementOpen(false);
      setCreateEnforcementForm({
        plate_number: '',
        zone_id: '',
        action_type: 'warning',
        assigned_to: '',
        delivery_method: 'hand_delivered',
        recipient_name: '',
        recipient_email: '',
        location_lat: '',
        location_lng: '',
        notes: '',
        completion_outcome: 'completed',
        completion_notes: '',
        photos: [],
        createFlaggedVehicle: false,
        flaggedPriority: 'medium',
        flaggedReason: '',
        confirmedHomeless: false,
      });
      loadData();

    } catch (error: any) {
      console.error('Failed to create enforcement action:', error);
      toast.error('Failed to create enforcement action: ' + error.message);
    }
  };

  const getBreachSeverity = (breach: ActiveBreach) => {
    const consecutiveExcess = breach.consecutive_nights - breach.max_allowed_consecutive;
    const monthlyExcess = breach.nights_stayed - breach.max_allowed_monthly;
    const maxExcess = Math.max(consecutiveExcess, monthlyExcess);

    if (maxExcess >= 7) return { label: 'Critical', className: 'bg-red-600 text-white' };
    if (maxExcess >= 3) return { label: 'High', className: 'bg-orange-500 text-white' };
    return { label: 'Medium', className: 'bg-amber-500 text-white' };
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { label: string; className: string; icon: any }> = {
      active: { label: 'Active', className: 'bg-red-100 text-red-700 border-red-300', icon: AlertTriangle },
      assigned: { label: 'Assigned', className: 'bg-blue-100 text-blue-700 border-blue-300', icon: UserPlus },
      in_progress: { label: 'In Progress', className: 'bg-amber-100 text-amber-700 border-amber-300', icon: PlayCircle },
      completed: { label: 'Completed', className: 'bg-green-100 text-green-700 border-green-300', icon: CheckCircle2 },
      not_on_site: { label: 'Not On Site', className: 'bg-gray-100 text-gray-700 border-gray-300', icon: Ban },
      cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-300', icon: XCircle },
    };

    const badge = badges[status] || badges.active;
    const Icon = badge.icon;

    return (
      <Badge variant="outline" className={`gap-1 ${badge.className}`}>
        <Icon className="h-3 w-3" />
        {badge.label}
      </Badge>
    );
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'master';
  const isOfficer = !!user?.id;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
              <Shield className="h-8 w-8 text-primary" />
              Enforcement Management
            </h2>
            <p className="text-muted-foreground">
              Active breaches, job assignment, and enforcement tracking
            </p>
          </div>
          {isAdmin && (
            <Button 
              onClick={() => setIsCreateEnforcementOpen(true)} 
              size="lg" 
              className="gap-2 shrink-0 w-full sm:w-auto"
            >
              <Plus className="h-5 w-5" />
              Record Enforcement Action
            </Button>
          )}
        </div>
        
        {/* Mobile Quick Action Button - Fixed at top on small screens */}
        {isAdmin && (
          <div className="sm:hidden">
            <Button 
              onClick={() => setIsCreateEnforcementOpen(true)} 
              size="lg" 
              className="w-full gap-2"
              variant="default"
            >
              <Plus className="h-5 w-5" />
              Record Enforcement Action
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid">
          <TabsTrigger value="breaches" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Active Breaches
          </TabsTrigger>
          <TabsTrigger value="jobs" className="gap-2">
            <User className="h-4 w-4" />
            Enforcement Jobs
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Completed
          </TabsTrigger>
        </TabsList>

        {/* Active Breaches Tab */}
        <TabsContent value="breaches" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Current Breaches & Overstayers</CardTitle>
                <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">Loading active breaches...</p>
                </div>
              ) : activeBreaches.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500 opacity-50" />
                  <p className="font-medium">No active breaches</p>
                  <p className="text-sm text-muted-foreground">All vehicles are in compliance</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plate</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Stay Info</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Flags</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeBreaches.map((breach, index) => {
                        const severity = getBreachSeverity(breach);
                        return (
                          <TableRow key={index}>
                            <TableCell>
                              <VehicleCard
                                plateNumber={breach.plate_number}
                                isFlagged={breach.is_flagged}
                                isHomeless={breach.homeless_status === 'confirmed'}
                                isBreach={true}
                                size="sm"
                                showPhoto={true}
                                showDetails={false}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                                {breach.zone_name}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge className={severity.className}>{severity.label}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm space-y-1">
                                <div className="flex items-center gap-2">
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span className={breach.consecutive_nights > breach.max_allowed_consecutive ? 'text-red-600 font-semibold' : ''}>
                                    {breach.consecutive_nights}/{breach.max_allowed_consecutive} consecutive
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span className={breach.nights_stayed > breach.max_allowed_monthly ? 'text-red-600 font-semibold' : ''}>
                                    {breach.nights_stayed}/{breach.max_allowed_monthly} monthly
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {breach.has_active_enforcement 
                                ? getStatusBadge(breach.enforcement_status || 'active')
                                : <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300">No Action</Badge>
                              }
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
                            <TableCell className="text-right">
                              {isAdmin && !breach.has_active_enforcement && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setSelectedBreach(breach);
                                    setIsAssignDialogOpen(true);
                                  }}
                                  className="gap-1"
                                >
                                  <UserPlus className="h-3 w-3" />
                                  Assign Officer
                                </Button>
                              )}
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
        </TabsContent>

        {/* Enforcement Jobs Tab */}
        <TabsContent value="jobs" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Assigned Enforcement Jobs</CardTitle>
                <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">Loading jobs...</p>
                </div>
              ) : enforcementJobs.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                  <p className="font-medium">No active jobs</p>
                  <p className="text-sm text-muted-foreground">No enforcement jobs currently assigned</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plate</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead>Action Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Assigned To</TableHead>
                        <TableHead>Assigned At</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {enforcementJobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell>
                            <VehicleCard
                              plateNumber={job.plate_number}
                              size="sm"
                              showPhoto={true}
                              showDetails={false}
                            />
                          </TableCell>
                          <TableCell>{job.zone_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{job.action_type}</Badge>
                          </TableCell>
                          <TableCell>{getStatusBadge(job.breach_status)}</TableCell>
                          <TableCell>
                            {job.assigned_officer 
                              ? `${job.assigned_officer.first_name} ${job.assigned_officer.last_name}`
                              : '-'}
                          </TableCell>
                          <TableCell>
                            {job.assigned_at 
                              ? new Date(job.assigned_at).toLocaleDateString('en-NZ')
                              : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            {(isOfficer && job.assigned_to === user?.id) && (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSelectedJob(job);
                                  setIsCompleteDialogOpen(true);
                                }}
                                className="gap-1"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Complete
                              </Button>
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
        </TabsContent>

        {/* Completed Tab */}
        <TabsContent value="completed" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Completed Enforcement Actions</CardTitle>
                <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">Loading completed jobs...</p>
                </div>
              ) : completedJobs.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                  <p className="font-medium">No completed jobs</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plate</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead>Action Type</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Completed By</TableHead>
                        <TableHead>Completed At</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {completedJobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell>
                            <VehicleCard
                              plateNumber={job.plate_number}
                              size="sm"
                              showPhoto={true}
                              showDetails={false}
                            />
                          </TableCell>
                          <TableCell>{job.zone_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{job.action_type}</Badge>
                          </TableCell>
                          <TableCell>{getStatusBadge(job.breach_status)}</TableCell>
                          <TableCell>
                            {job.completed_by ? 'Officer' : '-'}
                          </TableCell>
                          <TableCell>
                            {job.completed_at 
                              ? new Date(job.completed_at).toLocaleDateString('en-NZ')
                              : '-'}
                          </TableCell>
                          <TableCell>
                            <div className="max-w-xs truncate text-sm text-muted-foreground">
                              {job.completion_notes || '-'}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Enforcement Action Dialog - NEW FEATURE */}
      {/* Enforcement Guard Modal */}
      <EnforcementGuardModal
        open={isEnforcementGuardOpen}
        onClose={() => {
          setIsEnforcementGuardOpen(false);
          setEnforcementCheckResult(null);
          setPendingObservationId(null);
        }}
        checkResult={enforcementCheckResult}
      />

      <Dialog open={isCreateEnforcementOpen} onOpenChange={setIsCreateEnforcementOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Enforcement Action</DialogTitle>
            <DialogDescription>
              Create and complete an enforcement action record from start to finish
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Basic Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Plate Number *</Label>
                <Input
                  value={createEnforcementForm.plate_number}
                  onChange={(e) => setCreateEnforcementForm({ ...createEnforcementForm, plate_number: e.target.value.toUpperCase() })}
                  placeholder="ABC123"
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label>Zone *</Label>
                <Select 
                  value={createEnforcementForm.zone_id} 
                  onValueChange={(value) => setCreateEnforcementForm({ ...createEnforcementForm, zone_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones
                      .filter(z => user?.role === 'master' || z.organization_id === user?.organization_id)
                      .map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>
                          {zone.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Action Type</Label>
                <Select 
                  value={createEnforcementForm.action_type} 
                  onValueChange={(value: any) => setCreateEnforcementForm({ ...createEnforcementForm, action_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="notice">Notice to Vacate</SelectItem>
                    <SelectItem value="tow">Tow Request</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Officer Issuing (Optional)</Label>
                <Select 
                  value={createEnforcementForm.assigned_to || undefined}
                  onValueChange={(value) => setCreateEnforcementForm({ ...createEnforcementForm, assigned_to: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None (select to assign)" />
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
            </div>

            {/* Delivery Details */}
            <div className="space-y-3 p-4 border-2 rounded-lg bg-muted/30">
              <p className="font-semibold text-sm">Delivery Details</p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Delivery Method</Label>
                  <Select 
                    value={createEnforcementForm.delivery_method} 
                    onValueChange={(value: any) => setCreateEnforcementForm({ ...createEnforcementForm, delivery_method: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hand_delivered">Hand Delivered</SelectItem>
                      <SelectItem value="windscreen">Placed on Windscreen</SelectItem>
                      <SelectItem value="posted">Posted to Address</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Recipient Name (Optional)</Label>
                  <Input
                    value={createEnforcementForm.recipient_name}
                    onChange={(e) => setCreateEnforcementForm({ ...createEnforcementForm, recipient_name: e.target.value })}
                    placeholder="Owner/occupant name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Recipient Email (Optional)</Label>
                <Input
                  type="email"
                  value={createEnforcementForm.recipient_email}
                  onChange={(e) => setCreateEnforcementForm({ ...createEnforcementForm, recipient_email: e.target.value })}
                  placeholder="owner@example.com"
                />
              </div>
            </div>

            {/* Location */}
            <div className="space-y-3 p-4 border-2 rounded-lg bg-muted/30">
              <p className="font-semibold text-sm flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                GPS Location (Optional)
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Latitude</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={createEnforcementForm.location_lat}
                    onChange={(e) => setCreateEnforcementForm({ ...createEnforcementForm, location_lat: e.target.value })}
                    placeholder="-41.270634"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Longitude</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={createEnforcementForm.location_lng}
                    onChange={(e) => setCreateEnforcementForm({ ...createEnforcementForm, location_lng: e.target.value })}
                    placeholder="173.283966"
                  />
                </div>
              </div>
            </div>

            {/* Initial Notes */}
            <div className="space-y-2">
              <Label>Action Notes</Label>
              <Textarea
                value={createEnforcementForm.notes}
                onChange={(e) => setCreateEnforcementForm({ ...createEnforcementForm, notes: e.target.value })}
                placeholder="Details about the enforcement action..."
                rows={3}
              />
            </div>

            {/* Completion Details */}
            <div className="space-y-3 p-4 border-2 border-green-200 dark:border-green-800 rounded-lg bg-green-50 dark:bg-green-950/20">
              <p className="font-semibold text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Completion Details
              </p>
              
              <div className="space-y-2">
                <Label>Outcome *</Label>
                <Select 
                  value={createEnforcementForm.completion_outcome} 
                  onValueChange={(value: any) => setCreateEnforcementForm({ ...createEnforcementForm, completion_outcome: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="completed">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        Completed Successfully
                      </div>
                    </SelectItem>
                    <SelectItem value="not_on_site">
                      <div className="flex items-center gap-2">
                        <Ban className="h-4 w-4 text-gray-600" />
                        Vehicle Not On Site
                      </div>
                    </SelectItem>
                    <SelectItem value="cancelled">
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-600" />
                        Cancelled
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Completion Notes</Label>
                <Textarea
                  value={createEnforcementForm.completion_notes}
                  onChange={(e) => setCreateEnforcementForm({ ...createEnforcementForm, completion_notes: e.target.value })}
                  placeholder="Additional details about completion..."
                  rows={2}
                />
              </div>
            </div>

            {/* Flag Vehicle Option */}
            {createEnforcementForm.completion_outcome === 'completed' && (
              <div className="space-y-3 p-4 border-2 border-amber-200 dark:border-amber-800 rounded-lg bg-amber-50 dark:bg-amber-950/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="create-flag-vehicle"
                      checked={createEnforcementForm.createFlaggedVehicle}
                      onCheckedChange={(checked) => setCreateEnforcementForm({ ...createEnforcementForm, createFlaggedVehicle: checked })}
                    />
                    <Label htmlFor="create-flag-vehicle" className="font-semibold cursor-pointer">
                      🚩 Flag this vehicle for all officers
                    </Label>
                  </div>
                </div>
                
                {createEnforcementForm.createFlaggedVehicle && (
                  <div className="space-y-3 pl-6 border-l-2 border-amber-300">
                    <p className="text-xs text-muted-foreground">
                      ⚠️ NZ Privacy Act Compliance: Warning visible to all organizations for officer safety. 
                      Detailed information only accessible to your organization.
                    </p>
                    
                    <div className="space-y-2">
                      <Label>Priority Level *</Label>
                      <Select 
                        value={createEnforcementForm.flaggedPriority} 
                        onValueChange={(value: any) => setCreateEnforcementForm({ ...createEnforcementForm, flaggedPriority: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low - Minor Issue</SelectItem>
                          <SelectItem value="medium">Medium - Watch Closely</SelectItem>
                          <SelectItem value="high">High - Serious Concern</SelectItem>
                          <SelectItem value="urgent">Urgent - Immediate Attention</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Reason for Flagging *</Label>
                      <Textarea
                        value={createEnforcementForm.flaggedReason}
                        onChange={(e) => setCreateEnforcementForm({ ...createEnforcementForm, flaggedReason: e.target.value })}
                        placeholder="e.g., Repeated violations, aggressive behavior, safety concern..."
                        rows={2}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id="create-homeless"
                        checked={createEnforcementForm.confirmedHomeless}
                        onCheckedChange={(checked) => setCreateEnforcementForm({ ...createEnforcementForm, confirmedHomeless: checked })}
                      />
                      <Label htmlFor="create-homeless" className="text-sm cursor-pointer">
                        Confirmed Homeless Status (FC Act Exempt)
                      </Label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Evidence Photos */}
            <MultiPhotoUpload
              photos={createEnforcementForm.photos}
              onPhotosChange={(photos) => setCreateEnforcementForm({ ...createEnforcementForm, photos })}
              maxPhotos={5}
              label="Evidence Photos (Optional)"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateEnforcementOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleCreateEnforcement}
              disabled={!createEnforcementForm.plate_number || !createEnforcementForm.zone_id}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Record Enforcement Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Officer Dialog */}
      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Enforcement Job</DialogTitle>
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
                  Stay: {selectedBreach.consecutive_nights}/{selectedBreach.max_allowed_consecutive} consecutive, 
                  {selectedBreach.nights_stayed}/{selectedBreach.max_allowed_monthly} monthly
                </div>
              </div>

              <div className="space-y-2">
                <Label>Assign To Officer *</Label>
                <Select value={assignForm.officer_id} onValueChange={(value) => setAssignForm({ ...assignForm, officer_id: value })}>
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
                <Select value={assignForm.action_type} onValueChange={(value: any) => setAssignForm({ ...assignForm, action_type: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="notice">Notice to Vacate</SelectItem>
                    <SelectItem value="tow">Tow Request</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Instructions/Notes</Label>
                <Textarea
                  value={assignForm.notes}
                  onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                  placeholder="Special instructions for the officer..."
                  rows={3}
                />
              </div>

              {/* Flag Vehicle Option */}
              <div className="space-y-3 p-4 border-2 border-amber-200 dark:border-amber-800 rounded-lg bg-amber-50 dark:bg-amber-950/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="assign-flag-vehicle"
                      checked={assignForm.createFlaggedVehicle}
                      onCheckedChange={(checked) => setAssignForm({ ...assignForm, createFlaggedVehicle: checked })}
                    />
                    <Label htmlFor="assign-flag-vehicle" className="font-semibold cursor-pointer">
                      🚩 Flag this vehicle for all officers
                    </Label>
                  </div>
                </div>
                
                {assignForm.createFlaggedVehicle && (
                  <div className="space-y-3 pl-6 border-l-2 border-amber-300">
                    <p className="text-xs text-muted-foreground">
                      ⚠️ NZ Privacy Act Compliance: Warning visible to all organizations for officer safety. 
                      Detailed information only accessible to your organization.
                    </p>
                    
                    <div className="space-y-2">
                      <Label>Priority Level *</Label>
                      <Select 
                        value={assignForm.flaggedPriority} 
                        onValueChange={(value: any) => setAssignForm({ ...assignForm, flaggedPriority: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low - Minor Issue</SelectItem>
                          <SelectItem value="medium">Medium - Watch Closely</SelectItem>
                          <SelectItem value="high">High - Serious Concern</SelectItem>
                          <SelectItem value="urgent">Urgent - Immediate Attention</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Reason for Flagging *</Label>
                      <Textarea
                        value={assignForm.flaggedReason}
                        onChange={(e) => setAssignForm({ ...assignForm, flaggedReason: e.target.value })}
                        placeholder="e.g., Repeated violations, aggressive behavior, safety concern..."
                        rows={2}
                      />
                      <p className="text-xs text-muted-foreground">
                        This reason will only be visible to your organization
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id="assign-homeless"
                        checked={assignForm.confirmedHomeless}
                        onCheckedChange={(checked) => setAssignForm({ ...assignForm, confirmedHomeless: checked })}
                      />
                      <Label htmlFor="assign-homeless" className="text-sm cursor-pointer">
                        Confirmed Homeless Status (FC Act Exempt)
                      </Label>
                    </div>
                  </div>
                )}
              </div>

              <MultiPhotoUpload
                photos={assignForm.photos}
                onPhotosChange={(photos) => setAssignForm({ ...assignForm, photos })}
                maxPhotos={5}
                label="Evidence Photos (Optional)"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAssignOfficer}>Assign Officer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Job Dialog */}
      <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Complete Enforcement Job</DialogTitle>
            <DialogDescription>
              Record the outcome of this enforcement action
            </DialogDescription>
          </DialogHeader>
          {selectedJob && (
            <div className="space-y-4 py-4">
              <div className="p-3 bg-muted/50 rounded-lg space-y-1">
                <div className="text-sm font-medium">Vehicle: {selectedJob.plate_number}</div>
                <div className="text-sm text-muted-foreground">Zone: {selectedJob.zone_name}</div>
                <div className="text-sm text-muted-foreground">Action: {selectedJob.action_type}</div>
              </div>

              <div className="space-y-2">
                <Label>Outcome *</Label>
                <Select value={completeForm.outcome} onValueChange={(value: any) => setCompleteForm({ ...completeForm, outcome: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="completed">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        Completed Successfully
                      </div>
                    </SelectItem>
                    <SelectItem value="not_on_site">
                      <div className="flex items-center gap-2">
                        <Ban className="h-4 w-4 text-gray-600" />
                        Vehicle Not On Site
                      </div>
                    </SelectItem>
                    <SelectItem value="cancelled">
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-red-600" />
                        Cancelled
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {completeForm.outcome === 'completed' && 'Enforcement action was delivered/completed successfully'}
                  {completeForm.outcome === 'not_on_site' && 'Vehicle was no longer at the location - breach auto-closed'}
                  {completeForm.outcome === 'cancelled' && 'Job was cancelled without completion'}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Completion Notes</Label>
                <Textarea
                  value={completeForm.notes}
                  onChange={(e) => setCompleteForm({ ...completeForm, notes: e.target.value })}
                  placeholder="Any additional details about the completion..."
                  rows={3}
                />
              </div>

              {/* Flag Vehicle Option - Only show if completed successfully */}
              {completeForm.outcome === 'completed' && (
                <div className="space-y-3 p-4 border-2 border-amber-200 dark:border-amber-800 rounded-lg bg-amber-50 dark:bg-amber-950/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="complete-flag-vehicle"
                        checked={completeForm.createFlaggedVehicle}
                        onCheckedChange={(checked) => setCompleteForm({ ...completeForm, createFlaggedVehicle: checked })}
                      />
                      <Label htmlFor="complete-flag-vehicle" className="font-semibold cursor-pointer">
                        🚩 Flag this vehicle for all officers
                      </Label>
                    </div>
                  </div>
                  
                  {completeForm.createFlaggedVehicle && (
                    <div className="space-y-3 pl-6 border-l-2 border-amber-300">
                      <p className="text-xs text-muted-foreground">
                        ⚠️ NZ Privacy Act Compliance: Warning visible to all organizations for officer safety. 
                        Detailed information only accessible to your organization.
                      </p>
                      
                      <div className="space-y-2">
                        <Label>Priority Level *</Label>
                        <Select 
                          value={completeForm.flaggedPriority} 
                          onValueChange={(value: any) => setCompleteForm({ ...completeForm, flaggedPriority: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low - Minor Issue</SelectItem>
                            <SelectItem value="medium">Medium - Watch Closely</SelectItem>
                            <SelectItem value="high">High - Serious Concern</SelectItem>
                            <SelectItem value="urgent">Urgent - Immediate Attention</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Reason for Flagging *</Label>
                        <Textarea
                          value={completeForm.flaggedReason}
                          onChange={(e) => setCompleteForm({ ...completeForm, flaggedReason: e.target.value })}
                          placeholder="e.g., Repeated violations, aggressive behavior, safety concern..."
                          rows={2}
                        />
                        <p className="text-xs text-muted-foreground">
                          This reason will only be visible to your organization
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Switch
                          id="complete-homeless"
                          checked={completeForm.confirmedHomeless}
                          onCheckedChange={(checked) => setCompleteForm({ ...completeForm, confirmedHomeless: checked })}
                        />
                        <Label htmlFor="complete-homeless" className="text-sm cursor-pointer">
                          Confirmed Homeless Status (FC Act Exempt)
                        </Label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <MultiPhotoUpload
                photos={completeForm.photos}
                onPhotosChange={(photos) => setCompleteForm({ ...completeForm, photos })}
                maxPhotos={5}
                label="Completion Evidence Photos"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCompleteDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCompleteJob}>Complete Job</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
