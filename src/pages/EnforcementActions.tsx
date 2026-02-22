/**
 * Enforcement Actions - Complete Enforcement Management System
 * 
 * Features:
 * - Breach alerts requiring enforcement
 * - Assigned enforcement jobs with officer assignment
 * - Completed enforcement history
 * - Record enforcement action (admin quick-create)
 * - Integration with canonical vehicles and breach_alerts
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Shield,
  AlertTriangle,
  UserPlus,
  CheckCircle2,
  XCircle,
  Plus,
  RefreshCw,
  Loader2,
  Car,
  MapPin,
  Clock,
  User,
  FileText,
  Home,
  Flag,
  Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { useUsers } from '@/hooks/useUsers';
import { useZones } from '@/hooks/useZones';
import { supabase } from '@/lib/supabase';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';

interface BreachAlert {
  id: string;
  plate_number: string;
  zone_id: string;
  zone_name: string;
  organization_id: string;
  breach_type: string;
  status: string;
  created_at: string;
  observation_id: string | null;
  photo_url: string | null;
  homeless_status: string | null;
  is_flagged: boolean;
}

interface EnforcementJob {
  id: string;
  plate_number: string;
  zone_id: string;
  zone_name: string;
  action_type: string;
  breach_status: string;
  assigned_to: string | null;
  assigned_at: string | null;
  completed_at: string | null;
  completion_outcome: string | null;
  notes: string | null;
  assigned_officer: { first_name: string; last_name: string } | null;
}

export default function EnforcementActions() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: users = [] } = useUsers();
  const { data: zones = [] } = useZones();

  const [activeTab, setActiveTab] = useState<'breaches' | 'jobs' | 'completed'>('breaches');
  const [isLoading, setIsLoading] = useState(false);

  const [breachAlerts, setBreachAlerts] = useState<BreachAlert[]>([]);
  const [enforcementJobs, setEnforcementJobs] = useState<EnforcementJob[]>([]);
  const [completedJobs, setCompletedJobs] = useState<EnforcementJob[]>([]);

  // Dialogs
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const [selectedBreach, setSelectedBreach] = useState<BreachAlert | null>(null);
  const [selectedJob, setSelectedJob] = useState<EnforcementJob | null>(null);

  // Forms
  const [assignForm, setAssignForm] = useState({
    officer_id: '',
    action_type: 'warning' as 'warning' | 'notice' | 'tow',
    notes: '',
  });

  const [completeForm, setCompleteForm] = useState({
    outcome: 'completed' as 'completed' | 'not_on_site' | 'cancelled',
    notes: '',
  });

  const [createForm, setCreateForm] = useState({
    plate_number: '',
    zone_id: '',
    action_type: 'warning' as 'warning' | 'notice' | 'tow',
    officer_id: '',
    notes: '',
    completion_outcome: 'completed' as 'completed' | 'not_on_site',
    completion_notes: '',
  });

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'breaches') {
        await loadBreachAlerts();
      } else if (activeTab === 'jobs') {
        await loadEnforcementJobs();
      } else if (activeTab === 'completed') {
        await loadCompletedJobs();
      }
    } catch (error: any) {
      console.error('Failed to load data:', error);
      toast.error('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const loadBreachAlerts = async () => {
    let query = supabase
      .from('breach_alerts')
      .select(`
        *,
        zones(name),
        observations(photo_url),
        canonical_vehicles(homeless_status, is_flagged)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (user?.role !== 'master') {
      query = query.eq('organization_id', user?.organization_id || '');
    }

    const { data, error } = await query;

    if (error) throw error;

    setBreachAlerts(
      (data || []).map((b) => ({
        ...b,
        zone_name: (b.zones as any)?.name || 'Unknown',
        photo_url: (b.observations as any)?.photo_url || null,
        homeless_status: (b.canonical_vehicles as any)?.homeless_status || null,
        is_flagged: (b.canonical_vehicles as any)?.is_flagged || false,
      }))
    );
  };

  const loadEnforcementJobs = async () => {
    let query = supabase
      .from('enforcement_actions')
      .select(`
        *,
        zones(name),
        user_profiles!enforcement_actions_assigned_to_fkey(first_name, last_name)
      `)
      .in('breach_status', ['assigned', 'in_progress'])
      .not('assigned_to', 'is', null)
      .order('assigned_at', { ascending: false });

    if (user?.role !== 'master') {
      query = query.eq('organization_id', user?.organization_id || '');
    }

    const { data, error } = await query;

    if (error) throw error;

    setEnforcementJobs(
      (data || []).map((j) => ({
        ...j,
        zone_name: (j.zones as any)?.name || 'Unknown',
        assigned_officer: j.user_profiles || null,
      }))
    );
  };

  const loadCompletedJobs = async () => {
    let query = supabase
      .from('enforcement_actions')
      .select(`
        *,
        zones(name),
        user_profiles!enforcement_actions_assigned_to_fkey(first_name, last_name)
      `)
      .in('breach_status', ['completed', 'not_on_site', 'cancelled'])
      .order('completed_at', { ascending: false })
      .limit(100);

    if (user?.role !== 'master') {
      query = query.eq('organization_id', user?.organization_id || '');
    }

    const { data, error } = await query;

    if (error) throw error;

    setCompletedJobs(
      (data || []).map((j) => ({
        ...j,
        zone_name: (j.zones as any)?.name || 'Unknown',
        assigned_officer: j.user_profiles || null,
      }))
    );
  };

  const handleAssignOfficer = async () => {
    if (!selectedBreach || !assignForm.officer_id) {
      toast.error('Please select an officer');
      return;
    }

    try {
      const { error } = await supabase.from('enforcement_actions').insert({
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

      // Update breach alert status
      await supabase
        .from('breach_alerts')
        .update({ status: 'enforcing' })
        .eq('id', selectedBreach.id);

      toast.success('Officer assigned successfully');
      setIsAssignDialogOpen(false);
      setSelectedBreach(null);
      setAssignForm({ officer_id: '', action_type: 'warning', notes: '' });
      loadData();
    } catch (error: any) {
      console.error('Failed to assign officer:', error);
      toast.error('Failed to assign officer');
    }
  };

  const handleCompleteJob = async () => {
    if (!selectedJob) return;

    try {
      const { error } = await supabase
        .from('enforcement_actions')
        .update({
          breach_status: completeForm.outcome,
          completion_outcome: completeForm.outcome,
          completion_notes: completeForm.notes || null,
          completed_by: user?.id,
          completed_at: new Date().toISOString(),
          status: completeForm.outcome === 'completed' ? 'delivered' : 'pending',
        })
        .eq('id', selectedJob.id);

      if (error) throw error;

      toast.success('Job completed successfully');
      setIsCompleteDialogOpen(false);
      setSelectedJob(null);
      setCompleteForm({ outcome: 'completed', notes: '' });
      loadData();
    } catch (error: any) {
      console.error('Failed to complete job:', error);
      toast.error('Failed to complete job');
    }
  };

  const handleCreateEnforcement = async () => {
    if (!createForm.plate_number || !createForm.zone_id) {
      toast.error('Please enter plate number and select zone');
      return;
    }

    try {
      const selectedZone = zones.find((z) => z.id === createForm.zone_id);
      if (!selectedZone) {
        toast.error('Invalid zone selected');
        return;
      }

      const { error } = await supabase.from('enforcement_actions').insert({
        organization_id: selectedZone.organization_id,
        zone_id: createForm.zone_id,
        plate_number: createForm.plate_number.toUpperCase().trim(),
        action_type: createForm.action_type,
        breach_status: createForm.completion_outcome,
        user_id: user?.id || '',
        recorded_at: new Date().toISOString(),
        status: createForm.completion_outcome === 'completed' ? 'delivered' : 'pending',
        notes: createForm.notes || null,
        completion_outcome: createForm.completion_outcome,
        completion_notes: createForm.completion_notes || null,
        completed_by: user?.id,
        completed_at: new Date().toISOString(),
        assigned_to: createForm.officer_id || null,
        assigned_by: createForm.officer_id ? user?.id : null,
        assigned_at: createForm.officer_id ? new Date().toISOString() : null,
      });

      if (error) throw error;

      toast.success('Enforcement action recorded successfully');
      setIsCreateDialogOpen(false);
      setCreateForm({
        plate_number: '',
        zone_id: '',
        action_type: 'warning',
        officer_id: '',
        notes: '',
        completion_outcome: 'completed',
        completion_notes: '',
      });
      loadData();
    } catch (error: any) {
      console.error('Failed to create enforcement:', error);
      toast.error('Failed to create enforcement action');
    }
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { label: string; className: string }> = {
      pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700 border-amber-300' },
      assigned: { label: 'Assigned', className: 'bg-blue-100 text-blue-700 border-blue-300' },
      in_progress: { label: 'In Progress', className: 'bg-purple-100 text-purple-700 border-purple-300' },
      completed: { label: 'Completed', className: 'bg-green-100 text-green-700 border-green-300' },
      not_on_site: { label: 'Not On Site', className: 'bg-gray-100 text-gray-700 border-gray-300' },
      cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border-gray-300' },
    };

    const badge = badges[status] || badges.pending;

    return <Badge variant="outline" className={badge.className}>{badge.label}</Badge>;
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'master';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <AdminNavigationMenu />
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Shield className="h-8 w-8 text-blue-600" />
              Enforcement Management
            </h1>
            <p className="text-muted-foreground mt-1">
              Breach alerts, job assignment, and enforcement tracking
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadData} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          {isAdmin && (
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Record Enforcement Action
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Active Breaches</div>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <div className="text-3xl font-bold text-red-600">{breachAlerts.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Assigned Jobs</div>
              <User className="h-5 w-5 text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-blue-600">{enforcementJobs.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Completed</div>
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div className="text-3xl font-bold text-green-600">{completedJobs.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="breaches" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Breaches ({breachAlerts.length})
          </TabsTrigger>
          <TabsTrigger value="jobs" className="gap-2">
            <User className="h-4 w-4" />
            Active Jobs ({enforcementJobs.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Completed
          </TabsTrigger>
        </TabsList>

        {/* Breach Alerts Tab */}
        <TabsContent value="breaches" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Breach Alerts Requiring Enforcement</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Compliance violations needing officer assignment
              </p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
                  <p className="text-muted-foreground">Loading breach alerts...</p>
                </div>
              ) : breachAlerts.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500 opacity-50" />
                  <p className="font-medium">No pending breaches</p>
                  <p className="text-sm text-muted-foreground">All breaches are assigned or resolved</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Photo</TableHead>
                        <TableHead>Plate</TableHead>
                        <TableHead>Zone</TableHead>
                        <TableHead>Breach Type</TableHead>
                        <TableHead>Flags</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {breachAlerts.map((breach) => (
                        <TableRow
                          key={breach.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigate(`/admin/vehicles?plate=${breach.plate_number}`)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {breach.photo_url ? (
                              <img
                                src={breach.photo_url}
                                alt="Evidence"
                                className="w-24 h-16 object-cover rounded border"
                              />
                            ) : (
                              <div className="w-24 h-16 bg-muted rounded border flex items-center justify-center">
                                <ImageIcon className="h-6 w-6 text-muted-foreground opacity-30" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/admin/vehicles?plate=${breach.plate_number}`);
                              }}
                              className="font-mono font-bold text-lg hover:text-blue-600 transition-colors flex items-center gap-2"
                            >
                              <Car className="h-4 w-4 text-muted-foreground" />
                              {breach.plate_number}
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              {breach.zone_name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="destructive">{breach.breach_type.replace(/_/g, ' ')}</Badge>
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
                              <Clock className="h-3 w-3" />
                              {new Date(breach.created_at).toLocaleDateString('en-NZ')}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {isAdmin && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
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
                      ))}
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
              <CardTitle>Active Enforcement Jobs</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Assigned work for field officers
              </p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
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
                        <TableHead>Assigned</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {enforcementJobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="font-mono font-bold">{job.plate_number}</TableCell>
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
                            {job.assigned_at ? new Date(job.assigned_at).toLocaleDateString('en-NZ') : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            {job.assigned_to === user?.id && (
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
              <CardTitle>Completed Enforcement Actions</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Historical records of finished enforcement work
              </p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
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
                        <TableHead>Action</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Completed</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {completedJobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="font-mono font-bold">{job.plate_number}</TableCell>
                          <TableCell>{job.zone_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{job.action_type}</Badge>
                          </TableCell>
                          <TableCell>{getStatusBadge(job.breach_status)}</TableCell>
                          <TableCell>
                            {job.completed_at ? new Date(job.completed_at).toLocaleDateString('en-NZ') : '-'}
                          </TableCell>
                          <TableCell>
                            <div className="max-w-xs truncate text-sm text-muted-foreground">
                              {job.notes || '-'}
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

      {/* Assign Officer Dialog */}
      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Officer to Breach</DialogTitle>
            <DialogDescription>
              {selectedBreach && `Plate: ${selectedBreach.plate_number} • Zone: ${selectedBreach.zone_name}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Assign To Officer *</Label>
              <Select value={assignForm.officer_id} onValueChange={(v) => setAssignForm({ ...assignForm, officer_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select officer" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter((u) => u.role === 'officer' || u.role === 'admin')
                    .map((officer) => (
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
                value={assignForm.action_type}
                onValueChange={(v: any) => setAssignForm({ ...assignForm, action_type: v })}
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
                value={assignForm.notes}
                onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                placeholder="Special instructions for the officer..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAssignOfficer}>Assign Officer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complete Job Dialog */}
      <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Enforcement Job</DialogTitle>
            <DialogDescription>
              {selectedJob && `Plate: ${selectedJob.plate_number} • Zone: ${selectedJob.zone_name}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Outcome</Label>
              <Select
                value={completeForm.outcome}
                onValueChange={(v: any) => setCompleteForm({ ...completeForm, outcome: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="not_on_site">Not On Site</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Completion Notes</Label>
              <Textarea
                value={completeForm.notes}
                onChange={(e) => setCompleteForm({ ...completeForm, notes: e.target.value })}
                placeholder="Details about the completion..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCompleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCompleteJob}>Complete Job</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Enforcement Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record Enforcement Action</DialogTitle>
            <DialogDescription>Create and complete an enforcement action record</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Plate Number *</Label>
                <Input
                  value={createForm.plate_number}
                  onChange={(e) => setCreateForm({ ...createForm, plate_number: e.target.value.toUpperCase() })}
                  placeholder="ABC123"
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label>Zone *</Label>
                <Select value={createForm.zone_id} onValueChange={(v) => setCreateForm({ ...createForm, zone_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones
                      .filter((z) => user?.role === 'master' || z.organization_id === user?.organization_id)
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
                  value={createForm.action_type}
                  onValueChange={(v: any) => setCreateForm({ ...createForm, action_type: v })}
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
                <Label>Officer (Optional)</Label>
                <Select
                  value={createForm.officer_id || undefined}
                  onValueChange={(v) => setCreateForm({ ...createForm, officer_id: v || '' })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select officer (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {users
                      .filter((u) => u.role === 'officer' || u.role === 'admin')
                      .map((officer) => (
                        <SelectItem key={officer.id} value={officer.id}>
                          {officer.first_name} {officer.last_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                placeholder="Details about the enforcement action..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select
                  value={createForm.completion_outcome}
                  onValueChange={(v: any) => setCreateForm({ ...createForm, completion_outcome: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="not_on_site">Not On Site</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Completion Notes</Label>
                <Input
                  value={createForm.completion_notes}
                  onChange={(e) => setCreateForm({ ...createForm, completion_notes: e.target.value })}
                  placeholder="Outcome details..."
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateEnforcement}
              disabled={!createForm.plate_number || !createForm.zone_id}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Record Enforcement Action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
