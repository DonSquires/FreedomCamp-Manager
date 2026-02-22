/**
 * DriftDashboard - Compliance Matrix Drift Detection & Remediation
 * Real-time monitoring of matrix version changes and affected observations
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  TrendingDown,
  Filter,
  FileText,
  Loader2,
  Eye,
  XCircle,
} from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';

interface DriftEvent {
  id: string;
  zone_id: string;
  organization_id: string;
  zone_name: string;
  organization_name: string;
  matrix_version_from: number;
  matrix_version_to: number;
  observations_affected: number;
  compliance_changed: number;
  criteria_changed: Record<string, { old: any; new: any }>;
  detected_at: string;
  detected_by: string;
  status: 'pending' | 'reviewed' | 'acknowledged';
  remediation_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export function DriftDashboard() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [filterZone, setFilterZone] = useState<string>('all');
  const [filterOrg, setFilterOrg] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [selectedEvent, setSelectedEvent] = useState<DriftEvent | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [remediationNotes, setRemediationNotes] = useState('');

  // Fetch drift events
  const { data: driftEvents, isLoading, refetch } = useQuery({
    queryKey: ['drift_events', filterZone, filterOrg, filterStatus],
    queryFn: async () => {
      let query = supabase
        .from('drift_events')
        .select(`
          *,
          zone:zones(name),
          organization:organizations(name),
          detected_by_user:user_profiles!drift_events_detected_by_fkey(first_name, last_name),
          reviewed_by_user:user_profiles!drift_events_reviewed_by_fkey(first_name, last_name)
        `)
        .order('detected_at', { ascending: false });

      if (filterZone !== 'all') {
        query = query.eq('zone_id', filterZone);
      }
      if (filterOrg !== 'all') {
        query = query.eq('organization_id', filterOrg);
      }
      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((event: any) => ({
        id: event.id,
        zone_id: event.zone_id,
        organization_id: event.organization_id,
        zone_name: event.zone?.name || 'Unknown Zone',
        organization_name: event.organization?.name || 'Unknown Org',
        matrix_version_from: event.matrix_version_from,
        matrix_version_to: event.matrix_version_to,
        observations_affected: event.observations_affected,
        compliance_changed: event.compliance_changed,
        criteria_changed: event.criteria_changed,
        detected_at: event.detected_at,
        detected_by: event.detected_by,
        status: event.status,
        remediation_notes: event.remediation_notes,
        reviewed_at: event.reviewed_at,
        reviewed_by: event.reviewed_by,
      }));
    },
  });

  // Fetch zones for filter
  const { data: zones } = useQuery({
    queryKey: ['zones_for_drift'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('zones')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch organizations for filter
  const { data: organizations } = useQuery({
    queryKey: ['organizations_for_drift'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  // Real-time subscription for new drift events
  useEffect(() => {
    const channel = supabase
      .channel('drift_events_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'drift_events',
        },
        () => {
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  // Acknowledge drift mutation
  const acknowledgeMutation = useMutation({
    mutationFn: async ({ eventId, notes }: { eventId: string; notes: string }) => {
      const { error } = await supabase
        .from('drift_events')
        .update({
          status: 'acknowledged',
          remediation_notes: notes,
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id,
        })
        .eq('id', eventId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('✅ Drift event acknowledged');
      queryClient.invalidateQueries({ queryKey: ['drift_events'] });
      setShowDetailDialog(false);
      setSelectedEvent(null);
      setRemediationNotes('');
    },
    onError: (error: any) => {
      toast.error('Failed to acknowledge: ' + error.message);
    },
  });

  // Re-run recalculation mutation
  const rerunMutation = useMutation({
    mutationFn: async (event: DriftEvent) => {
      const { data, error } = await supabase.functions.invoke('recalculate-compliance-v2', {
        body: {
          scope: 'ZONE',
          zoneIds: [event.zone_id],
          dateRangeStart: null,
          dateRangeEnd: null,
          performedBy: user?.id,
        },
      });

      if (error) {
        // Extract actual error message from Edge Function
        let errorMessage = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500;
            const textContent = await error.context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`;
          } catch {
            errorMessage = error.message || 'Failed to read response';
          }
        }
        throw new Error(errorMessage);
      }
      return data;
    },
    onSuccess: () => {
      toast.success('✅ Recalculation started - check Admin Recalculation page for progress');
      setShowDetailDialog(false);
    },
    onError: (error: any) => {
      toast.error('Failed to start recalculation: ' + error.message);
    },
  });

  // Calculate severity
  const getSeverity = (event: DriftEvent): 'critical' | 'warning' | 'info' => {
    if (event.compliance_changed > 10) return 'critical';
    if (event.compliance_changed > 0) return 'warning';
    return 'info';
  };

  // Get severity badge
  const getSeverityBadge = (severity: 'critical' | 'warning' | 'info') => {
    const config = {
      critical: { variant: 'destructive' as const, label: 'CRITICAL', icon: XCircle },
      warning: { variant: 'default' as const, label: 'WARNING', icon: AlertTriangle },
      info: { variant: 'secondary' as const, label: 'INFO', icon: CheckCircle2 },
    };

    const { variant, label, icon: Icon } = config[severity];
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </Badge>
    );
  };

  const filteredEvents = driftEvents?.filter((event) => {
    if (filterSeverity !== 'all') {
      const severity = getSeverity(event);
      if (severity !== filterSeverity) return false;
    }
    return true;
  });

  const stats = {
    total: filteredEvents?.length || 0,
    pending: filteredEvents?.filter(e => e.status === 'pending').length || 0,
    critical: filteredEvents?.filter(e => getSeverity(e) === 'critical').length || 0,
    totalObservationsAffected: filteredEvents?.reduce((sum, e) => sum + e.observations_affected, 0) || 0,
  };

  return (
    <ResponsiveContainer maxWidth="2xl" padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <TrendingDown className="h-8 w-8 text-amber-500" />
            Drift Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor compliance matrix changes and affected observations
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Total Events</p>
              <p className="text-3xl font-black">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Pending Review</p>
              <p className="text-3xl font-black text-amber-600">{stats.pending}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Critical</p>
              <p className="text-3xl font-black text-red-600">{stats.critical}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Obs. Affected</p>
              <p className="text-3xl font-black">{stats.totalObservationsAffected}</p>
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
              <div>
                <Label htmlFor="filter-zone" className="text-xs">Zone</Label>
                <Select value={filterZone} onValueChange={setFilterZone}>
                  <SelectTrigger id="filter-zone" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Zones</SelectItem>
                    {zones?.map((zone) => (
                      <SelectItem key={zone.id} value={zone.id}>
                        {zone.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="filter-org" className="text-xs">Organization</Label>
                <Select value={filterOrg} onValueChange={setFilterOrg}>
                  <SelectTrigger id="filter-org" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Organizations</SelectItem>
                    {organizations?.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="filter-status" className="text-xs">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger id="filter-status" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="filter-severity" className="text-xs">Severity</Label>
                <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                  <SelectTrigger id="filter-severity" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severity</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Drift Events List */}
        <div className="space-y-3">
          {isLoading ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Loading drift events...</p>
              </CardContent>
            </Card>
          ) : filteredEvents && filteredEvents.length > 0 ? (
            filteredEvents.map((event) => {
              const severity = getSeverity(event);
              return (
                <Card
                  key={event.id}
                  className={`cursor-pointer hover:border-primary transition-all ${
                    severity === 'critical'
                      ? 'border-red-500/30 bg-red-500/5'
                      : severity === 'warning'
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : ''
                  }`}
                  onClick={() => {
                    setSelectedEvent(event);
                    setShowDetailDialog(true);
                  }}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getSeverityBadge(severity)}
                          <Badge variant="outline">{event.status.toUpperCase()}</Badge>
                        </div>
                        <h3 className="font-semibold text-lg mb-1">
                          {event.zone_name} • Version {event.matrix_version_from} → {event.matrix_version_to}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-3">
                          {event.organization_name}
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">Observations Affected</p>
                            <p className="font-semibold">{event.observations_affected}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Compliance Changed</p>
                            <p className="font-semibold text-amber-600">{event.compliance_changed}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Detected</p>
                            <p className="font-semibold">
                              {new Date(event.detected_at).toLocaleDateString('en-NZ', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
                <p className="text-sm text-muted-foreground">
                  No drift events found with current filters
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Detail Dialog */}
        <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Drift Event Details</DialogTitle>
              <DialogDescription>
                Review criteria changes and take remediation action
              </DialogDescription>
            </DialogHeader>

            {selectedEvent && (
              <div className="space-y-4 py-4">
                {/* Event Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Zone</p>
                    <p className="font-semibold">{selectedEvent.zone_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Organization</p>
                    <p className="font-semibold">{selectedEvent.organization_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Matrix Version</p>
                    <p className="font-semibold">
                      {selectedEvent.matrix_version_from} → {selectedEvent.matrix_version_to}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge>{selectedEvent.status.toUpperCase()}</Badge>
                  </div>
                </div>

                {/* Criteria Changes */}
                <div>
                  <h4 className="font-semibold mb-2">Criteria Changes</h4>
                  <div className="space-y-2">
                    {Object.entries(selectedEvent.criteria_changed).map(([key, change]) => (
                      <div key={key} className="p-3 bg-muted/50 rounded-lg border">
                        <p className="text-sm font-semibold capitalize mb-1">
                          {key.replace(/_/g, ' ')}
                        </p>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="text-red-600 line-through">
                            {JSON.stringify(change.old)}
                          </span>
                          <span>→</span>
                          <span className="text-green-600 font-semibold">
                            {JSON.stringify(change.new)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Impact */}
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Impact</AlertTitle>
                  <AlertDescription>
                    <p className="text-sm mt-1">
                      {selectedEvent.observations_affected} observation{selectedEvent.observations_affected !== 1 ? 's' : ''} affected
                    </p>
                    <p className="text-sm">
                      {selectedEvent.compliance_changed} compliance status{selectedEvent.compliance_changed !== 1 ? 'es' : ''} changed
                    </p>
                  </AlertDescription>
                </Alert>

                {/* Remediation Notes */}
                {selectedEvent.status === 'pending' && (
                  <div>
                    <Label htmlFor="remediation-notes">Remediation Notes</Label>
                    <textarea
                      id="remediation-notes"
                      value={remediationNotes}
                      onChange={(e) => setRemediationNotes(e.target.value)}
                      placeholder="Document actions taken or planned remediation..."
                      className="w-full mt-1 p-3 border rounded-md min-h-[100px]"
                    />
                  </div>
                )}

                {selectedEvent.remediation_notes && (
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">Remediation Notes</p>
                    <p className="text-sm">{selectedEvent.remediation_notes}</p>
                    {selectedEvent.reviewed_at && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Reviewed {new Date(selectedEvent.reviewed_at).toLocaleString('en-NZ')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="flex-col gap-2">
              {selectedEvent?.status === 'pending' && (
                <>
                  <Button
                    onClick={() => rerunMutation.mutate(selectedEvent)}
                    disabled={rerunMutation.isPending}
                    variant="default"
                    className="w-full"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${rerunMutation.isPending ? 'animate-spin' : ''}`} />
                    Re-run Recalculation
                  </Button>
                  <Button
                    onClick={() => acknowledgeMutation.mutate({ eventId: selectedEvent.id, notes: remediationNotes })}
                    disabled={acknowledgeMutation.isPending}
                    variant="outline"
                    className="w-full"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Acknowledge & Close
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ResponsiveContainer>
  );
}
