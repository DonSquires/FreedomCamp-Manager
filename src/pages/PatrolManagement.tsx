/**
 * PatrolManagement - Manage patrol schedules and assignments
 * Schedule patrols, assign officers, track completion
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Shield,
  Calendar,
  MapPin,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Edit,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface Patrol {
  id: string;
  organization_id: string;
  organization_name: string;
  zone_id: string;
  zone_name: string;
  patrol_date: string;
  shift: string;
  assigned_to: string | null;
  officer_name: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  status: string;
  notes: string | null;
}

export function PatrolManagement() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [isLoading, setIsLoading] = useState(true);
  const [patrols, setPatrols] = useState<Patrol[]>([]);
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);
  const [officers, setOfficers] = useState<{ id: string; name: string }[]>([]);
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().split('T')[0]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    zone_id: '',
    patrol_date: new Date().toISOString().split('T')[0],
    shift: 'day',
    assigned_to: 'unassigned',
  });

  useEffect(() => {
    loadZones();
    loadOfficers();
  }, []);

  useEffect(() => {
    loadPatrols();
  }, [dateFilter, statusFilter]);

  const loadZones = async () => {
    try {
      let query = supabase
        .from('zones')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (!isMaster) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        if (profile?.organization_id) {
          query = query.eq('organization_id', profile.organization_id);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      setZones(data || []);
    } catch (error: any) {
      console.error('Failed to load zones:', error);
      toast.error('Failed to load zones');
    }
  };

  const loadOfficers = async () => {
    try {
      let query = supabase
        .from('user_profiles')
        .select('id, first_name, last_name')
        .eq('is_active', true)
        .in('role', ['officer', 'admin'])
        .order('first_name');

      if (!isMaster) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        if (profile?.organization_id) {
          query = query.eq('organization_id', profile.organization_id);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      setOfficers(
        (data || []).map(o => ({
          id: o.id,
          name: `${o.first_name} ${o.last_name}`,
        }))
      );
    } catch (error: any) {
      console.error('Failed to load officers:', error);
      toast.error('Failed to load officers');
    }
  };

  const loadPatrols = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('patrols')
        .select(`
          id,
          organization_id,
          zone_id,
          patrol_date,
          shift,
          assigned_to,
          checked_in_at,
          completed_at,
          status,
          notes,
          zones(name),
          organizations(name),
          user_profiles!patrols_assigned_to_fkey(first_name, last_name)
        `)
        .gte('patrol_date', dateFilter)
        .order('patrol_date', { ascending: true })
        .order('shift', { ascending: true });

      if (!isMaster) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        if (profile?.organization_id) {
          query = query.eq('organization_id', profile.organization_id);
        }
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const mappedPatrols: Patrol[] = (data || []).map((p: any) => ({
        id: p.id,
        organization_id: p.organization_id,
        organization_name: p.organizations?.name || 'Unknown',
        zone_id: p.zone_id,
        zone_name: p.zones?.name || 'Unknown',
        patrol_date: p.patrol_date,
        shift: p.shift,
        assigned_to: p.assigned_to,
        officer_name: p.user_profiles
          ? `${p.user_profiles.first_name} ${p.user_profiles.last_name}`
          : null,
        checked_in_at: p.checked_in_at,
        completed_at: p.completed_at,
        status: p.status,
        notes: p.notes,
      }));

      setPatrols(mappedPatrols);
    } catch (error: any) {
      console.error('Failed to load patrols:', error);
      toast.error('Failed to load patrols');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.zone_id || !formData.patrol_date) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSaving(true);
    try {
      let orgId = null;

      if (!isMaster) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        orgId = profile?.organization_id || null;
      } else {
        const { data: zone } = await supabase
          .from('zones')
          .select('organization_id')
          .eq('id', formData.zone_id)
          .single();

        orgId = zone?.organization_id || null;
      }

      const { error } = await supabase.from('patrols').insert({
        organization_id: orgId,
        zone_id: formData.zone_id,
        patrol_date: formData.patrol_date,
        shift: formData.shift,
        assigned_to: formData.assigned_to === 'unassigned' ? null : formData.assigned_to,
        status: 'scheduled',
      });

      if (error) throw error;

      toast.success('Patrol scheduled successfully');
      setShowCreateModal(false);
      setFormData({
        zone_id: '',
        patrol_date: new Date().toISOString().split('T')[0],
        shift: 'day',
        assigned_to: 'unassigned',
      });
      await loadPatrols();
    } catch (error: any) {
      console.error('Failed to create patrol:', error);
      toast.error('Failed to schedule patrol');
    } finally {
      setIsSaving(false);
    }
  };

  const stats = {
    total: patrols.length,
    scheduled: patrols.filter(p => p.status === 'scheduled').length,
    inProgress: patrols.filter(p => p.status === 'in_progress').length,
    completed: patrols.filter(p => p.status === 'completed').length,
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
            <Shield className="h-8 w-8 text-blue-600" />
            Patrol Management
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Schedule and manage patrol assignments
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Schedule Patrol
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-blue-600 dark:text-blue-400">{stats.total}</div>
            <div className="text-sm font-semibold text-blue-900 dark:text-blue-100 mt-2">Total Patrols</div>
          </CardContent>
        </Card>

        <Card className="border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-amber-600 dark:text-amber-400">{stats.scheduled}</div>
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-100 mt-2">Scheduled</div>
          </CardContent>
        </Card>

        <Card className="border-2 border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-purple-600 dark:text-purple-400">{stats.inProgress}</div>
            <div className="text-sm font-semibold text-purple-900 dark:text-purple-100 mt-2">In Progress</div>
          </CardContent>
        </Card>

        <Card className="border-2 border-green-200 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-green-600 dark:text-green-400">{stats.completed}</div>
            <div className="text-sm font-semibold text-green-900 dark:text-green-100 mt-2">Completed</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-2 border-gray-200 dark:border-gray-700">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-700 dark:text-gray-200 font-semibold">Date From</Label>
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="mt-1 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <Label className="text-gray-700 dark:text-gray-200 font-semibold">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="mt-1 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Patrols List */}
      <Card className="border-2 border-gray-200 dark:border-gray-700">
        <CardHeader className="bg-gray-50 dark:bg-gray-800">
          <CardTitle className="text-lg text-gray-900 dark:text-white">
            Patrols ({patrols.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : patrols.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <Shield className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p>No patrols scheduled</p>
            </div>
          ) : (
            <div className="space-y-3">
              {patrols.map(patrol => (
                <div
                  key={patrol.id}
                  className="p-4 border-2 border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge
                          variant={
                            patrol.status === 'completed'
                              ? 'default'
                              : patrol.status === 'in_progress'
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {patrol.status === 'completed' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {patrol.status.replace('_', ' ').toUpperCase()}
                        </Badge>
                        <Badge variant="outline">
                          {patrol.shift.toUpperCase()}
                        </Badge>
                      </div>
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                        {patrol.zone_name}
                      </h3>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-1 text-gray-600 dark:text-gray-300 mb-1">
                        <Calendar className="h-4 w-4" />
                        Date
                      </div>
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {new Date(patrol.patrol_date).toLocaleDateString('en-NZ')}
                      </div>
                    </div>
                    <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-1 text-gray-600 dark:text-gray-300 mb-1">
                        <User className="h-4 w-4" />
                        Officer
                      </div>
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {patrol.officer_name || 'Unassigned'}
                      </div>
                    </div>
                    {patrol.checked_in_at && (
                      <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-1 text-gray-600 dark:text-gray-300 mb-1">
                          <Clock className="h-4 w-4" />
                          Check-in
                        </div>
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {new Date(patrol.checked_in_at).toLocaleTimeString('en-NZ', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    )}
                    {patrol.completed_at && (
                      <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-1 text-gray-600 dark:text-gray-300 mb-1">
                          <CheckCircle2 className="h-4 w-4" />
                          Completed
                        </div>
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {new Date(patrol.completed_at).toLocaleTimeString('en-NZ', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Patrol Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-xl text-gray-900 dark:text-white">
              Schedule New Patrol
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label className="text-gray-700 dark:text-gray-200 font-semibold">Zone</Label>
              <Select
                value={formData.zone_id}
                onValueChange={(v) => setFormData({ ...formData, zone_id: v })}
              >
                <SelectTrigger className="mt-1 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white">
                  <SelectValue placeholder="Select zone..." />
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

            <div>
              <Label className="text-gray-700 dark:text-gray-200 font-semibold">Date</Label>
              <Input
                type="date"
                value={formData.patrol_date}
                onChange={(e) => setFormData({ ...formData, patrol_date: e.target.value })}
                className="mt-1 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <Label className="text-gray-700 dark:text-gray-200 font-semibold">Shift</Label>
              <Select
                value={formData.shift}
                onValueChange={(v) => setFormData({ ...formData, shift: v })}
              >
                <SelectTrigger className="mt-1 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day Shift</SelectItem>
                  <SelectItem value="night">Night Shift</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-gray-700 dark:text-gray-200 font-semibold">Assign Officer (Optional)</Label>
              <Select
                value={formData.assigned_to}
                onValueChange={(v) => setFormData({ ...formData, assigned_to: v })}
              >
                <SelectTrigger className="mt-1 bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white">
                  <SelectValue placeholder="Select officer..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {officers.map(officer => (
                    <SelectItem key={officer.id} value={officer.id}>
                      {officer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateModal(false)}
              disabled={isSaving}
              className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSaving ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scheduling...</>
              ) : (
                'Schedule Patrol'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
