/**
 * UnifiedAlertQueue - Priority-based alert system with full audit trail
 * 
 * Features:
 * - Priority-based alert display (Critical → Low)
 * - Mandatory acknowledgement for critical alerts
 * - Background notification integration
 * - Full audit trail
 * - Works even when app is backgrounded
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  X,
  Eye,
  FileText,
  Shield,
  Users,
  MapPin,
  Clock,
  Loader2,
  ChevronRight,
  Info,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface AlertQueueItem {
  id: string;
  alert_type: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  details: any;
  vehicle_id: string | null;
  zone_id: string | null;
  person_id: string | null;
  observation_id: string | null;
  status: 'pending' | 'acknowledged' | 'actioned' | 'expired';
  requires_acknowledgement: boolean;
  can_dismiss: boolean;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledgement_notes: string | null;
  // Joined data
  zone_name?: string;
  vehicle_plate?: string;
}

interface AlertAcknowledgement {
  id: string;
  alert_id: string;
  user_id: string;
  acknowledged_at: string;
  acknowledgement_type: 'dismissed' | 'actioned' | 'escalated' | 'resolved';
  notes: string | null;
  action_taken: string | null;
  officer_name: string;
}

interface UnifiedAlertQueueProps {
  userId?: string;
  organizationId?: string;
  showAuditTrail?: boolean;
}

export function UnifiedAlertQueue({
  userId,
  organizationId,
  showAuditTrail = false,
}: UnifiedAlertQueueProps) {
  const [alerts, setAlerts] = useState<AlertQueueItem[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<AlertQueueItem | null>(null);
  const [showAcknowledgeModal, setShowAcknowledgeModal] = useState(false);
  const [acknowledgements, setAcknowledgements] = useState<AlertAcknowledgement[]>([]);
  
  // Acknowledgement form state
  const [ackType, setAckType] = useState<'dismissed' | 'actioned' | 'escalated' | 'resolved'>('actioned');
  const [ackNotes, setAckNotes] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  useEffect(() => {
    loadAlerts();
    
    // Set up realtime subscription
    const channel = supabase
      .channel('alert_queue_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'alert_queue',
          filter: userId ? `user_id=eq.${userId}` : undefined,
        },
        (payload) => {
          console.log('Alert queue change:', payload);
          loadAlerts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, organizationId]);

  const loadAlerts = async () => {
    setIsLoading(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      let query = supabase
        .from('alert_queue')
        .select(`
          *,
          zones(name),
          canonical_vehicles(plate_number)
        `)
        .eq('user_id', userId || user.user.id)
        .eq('status', 'pending')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      const mapped = (data || []).map((alert: any) => ({
        ...alert,
        zone_name: alert.zones?.name,
        vehicle_plate: alert.canonical_vehicles?.plate_number,
      }));

      // Sort by priority (critical first)
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      mapped.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      setAlerts(mapped);
    } catch (error: any) {
      console.error('Failed to load alerts:', error);
      toast.error('Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  };

  const loadAuditTrail = async (alertId: string) => {
    setIsLoadingAudit(true);
    try {
      const { data, error } = await supabase
        .from('alert_acknowledgements')
        .select(`
          *,
          user_profiles(first_name, last_name)
        `)
        .eq('alert_id', alertId)
        .order('acknowledged_at', { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map((ack: any) => ({
        ...ack,
        officer_name: `${ack.user_profiles?.first_name} ${ack.user_profiles?.last_name}`,
      }));

      setAcknowledgements(mapped);
    } catch (error: any) {
      console.error('Failed to load audit trail:', error);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const handleAcknowledge = (alert: AlertQueueItem) => {
    setSelectedAlert(alert);
    if (showAuditTrail) {
      loadAuditTrail(alert.id);
    }
    
    // Pre-select action type based on alert
    if (!alert.can_dismiss) {
      setAckType('actioned'); // Critical alerts must be actioned
    } else if (alert.priority === 'high') {
      setAckType('actioned');
    } else {
      setAckType('dismissed');
    }
    
    setAckNotes('');
    setActionTaken('');
    setShowAcknowledgeModal(true);
  };

  const handleSubmitAcknowledgement = async () => {
    if (!selectedAlert) return;

    // Validation for critical alerts
    if (!selectedAlert.can_dismiss && ackType === 'dismissed') {
      toast.error('Critical alerts cannot be dismissed - must take action');
      return;
    }

    if (!selectedAlert.can_dismiss && !actionTaken.trim()) {
      toast.error('Critical alerts require action details');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error('Not authenticated');

      // Create acknowledgement record (audit trail)
      const { error: ackError } = await supabase
        .from('alert_acknowledgements')
        .insert({
          alert_id: selectedAlert.id,
          user_id: user.user.id,
          acknowledgement_type: ackType,
          notes: ackNotes.trim() || null,
          action_taken: actionTaken.trim() || null,
        });

      if (ackError) throw ackError;

      // Update alert status
      const newStatus = ackType === 'actioned' || ackType === 'resolved' ? 'actioned' : 'acknowledged';
      
      const { error: updateError } = await supabase
        .from('alert_queue')
        .update({
          status: newStatus,
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user.user.id,
          acknowledgement_notes: ackNotes.trim() || null,
        })
        .eq('id', selectedAlert.id);

      if (updateError) throw updateError;

      toast.success(
        ackType === 'dismissed' 
          ? 'Alert dismissed' 
          : ackType === 'escalated' 
          ? 'Alert escalated to admin' 
          : 'Alert acknowledged and actioned'
      );

      await loadAlerts();
      setShowAcknowledgeModal(false);
      setSelectedAlert(null);
    } catch (error: any) {
      console.error('Failed to acknowledge alert:', error);
      toast.error('Failed to acknowledge alert: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'critical':
        return <Badge variant="destructive" className="animate-pulse">CRITICAL</Badge>;
      case 'high':
        return <Badge variant="destructive">HIGH</Badge>;
      case 'medium':
        return <Badge variant="default">MEDIUM</Badge>;
      case 'low':
        return <Badge variant="secondary">LOW</Badge>;
      default:
        return <Badge variant="outline">{priority.toUpperCase()}</Badge>;
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'breach_detected':
      case 'homeless_in_breach':
        return <AlertTriangle className="h-5 w-5 text-orange-600" />;
      case 'flagged_vehicle':
        return <AlertTriangle className="h-5 w-5 text-red-600" />;
      case 'hs_issue':
        return <Shield className="h-5 w-5 text-red-600" />;
      case 'welfare_critical':
      case 'welfare_warning':
        return <Users className="h-5 w-5 text-red-600" />;
      case 'duplicate_scan':
        return <FileText className="h-5 w-5 text-yellow-600" />;
      case 'homeless_fc_exempt':
        return <Info className="h-5 w-5 text-amber-600" />;
      default:
        return <Bell className="h-5 w-5 text-blue-600" />;
    }
  };

  const getAlertTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      breach_detected: 'Breach Detected',
      homeless_in_breach: 'Homeless in Breach',
      homeless_fc_exempt: 'Homeless (FC Exempt)',
      flagged_vehicle: 'Flagged Vehicle',
      hs_issue: 'H&S Issue',
      welfare_critical: 'Critical Welfare',
      welfare_warning: 'Welfare Warning',
      duplicate_scan: 'Duplicate Scan',
      new_vehicle: 'New Vehicle',
      compliant_scan: 'Compliant Scan',
    };
    return labels[type] || type;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Loading alerts...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Alert Queue ({alerts.length})
            </CardTitle>
            {alerts.length > 0 && (
              <Badge variant="destructive" className="animate-pulse">
                {alerts.filter(a => a.priority === 'critical').length} CRITICAL
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {alerts.length === 0 ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                No pending alerts. All clear! 🎉
              </AlertDescription>
            </Alert>
          ) : (
            alerts.map((alert) => (
              <Card
                key={alert.id}
                className={cn(
                  'transition-all',
                  alert.priority === 'critical' && 'border-red-500 border-2 shadow-lg',
                  alert.priority === 'high' && 'border-orange-500',
                  !alert.can_dismiss && 'bg-red-50 dark:bg-red-950/20'
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      {getAlertIcon(alert.alert_type)}
                    </div>
                    
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {getPriorityBadge(alert.priority)}
                            <Badge variant="outline">
                              {getAlertTypeLabel(alert.alert_type)}
                            </Badge>
                            {!alert.can_dismiss && (
                              <Badge variant="destructive">
                                🔒 REQUIRES ACTION
                              </Badge>
                            )}
                          </div>
                          <h3 className="font-bold text-lg">{alert.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            {alert.message}
                          </p>
                        </div>
                      </div>

                      {/* Alert Metadata */}
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {alert.vehicle_plate && (
                          <div className="flex items-center gap-1">
                            <FileText className="h-3 w-3" />
                            {alert.vehicle_plate}
                          </div>
                        )}
                        {alert.zone_name && (
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {alert.zone_name}
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(alert.created_at).toLocaleString('en-NZ', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="flex gap-2 pt-2">
                        <Button
                          onClick={() => handleAcknowledge(alert)}
                          variant={alert.priority === 'critical' ? 'destructive' : 'default'}
                          size="sm"
                          className="w-full"
                        >
                          {!alert.can_dismiss ? (
                            <>
                              <Shield className="h-3 w-3 mr-2" />
                              Take Action (Required)
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-3 w-3 mr-2" />
                              Acknowledge
                            </>
                          )}
                          <ChevronRight className="h-3 w-3 ml-auto" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>

      {/* Acknowledgement Modal */}
      <Dialog open={showAcknowledgeModal} onOpenChange={setShowAcknowledgeModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedAlert && getAlertIcon(selectedAlert.alert_type)}
              Acknowledge Alert
            </DialogTitle>
          </DialogHeader>

          {selectedAlert && (
            <div className="space-y-4 py-4">
              {/* Alert Summary */}
              <div className="border rounded-lg p-4 bg-muted/30 space-y-2">
                <div className="flex items-center gap-2">
                  {getPriorityBadge(selectedAlert.priority)}
                  <Badge variant="outline">
                    {getAlertTypeLabel(selectedAlert.alert_type)}
                  </Badge>
                </div>
                <h3 className="font-bold text-lg">{selectedAlert.title}</h3>
                <p className="text-sm">{selectedAlert.message}</p>
                
                {!selectedAlert.can_dismiss && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Critical Alert:</strong> This alert cannot be dismissed. You must take action and document what was done.
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Acknowledgement Type */}
              <div>
                <Label>Action Type</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {selectedAlert.can_dismiss && (
                    <Button
                      variant={ackType === 'dismissed' ? 'default' : 'outline'}
                      onClick={() => setAckType('dismissed')}
                      disabled={!selectedAlert.can_dismiss}
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Dismiss
                    </Button>
                  )}
                  <Button
                    variant={ackType === 'actioned' ? 'default' : 'outline'}
                    onClick={() => setAckType('actioned')}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Actioned
                  </Button>
                  <Button
                    variant={ackType === 'escalated' ? 'default' : 'outline'}
                    onClick={() => setAckType('escalated')}
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Escalate
                  </Button>
                  <Button
                    variant={ackType === 'resolved' ? 'default' : 'outline'}
                    onClick={() => setAckType('resolved')}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Resolved
                  </Button>
                </div>
              </div>

              {/* Action Details (required for critical alerts) */}
              {(ackType === 'actioned' || ackType === 'resolved') && (
                <div>
                  <Label htmlFor="action_taken">
                    Action Taken {!selectedAlert.can_dismiss && '*'}
                  </Label>
                  <Textarea
                    id="action_taken"
                    value={actionTaken}
                    onChange={(e) => setActionTaken(e.target.value)}
                    placeholder="Describe what action was taken to address this alert..."
                    rows={3}
                    required={!selectedAlert.can_dismiss}
                  />
                </div>
              )}

              {/* Optional Notes */}
              <div>
                <Label htmlFor="ack_notes">Additional Notes (Optional)</Label>
                <Textarea
                  id="ack_notes"
                  value={ackNotes}
                  onChange={(e) => setAckNotes(e.target.value)}
                  placeholder="Any additional notes or context..."
                  rows={2}
                />
              </div>

              {/* Audit Trail (if enabled) */}
              {showAuditTrail && (
                <div className="border-t pt-4">
                  <h4 className="font-bold mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Audit Trail
                  </h4>
                  {isLoadingAudit ? (
                    <div className="text-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    </div>
                  ) : acknowledgements.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No previous acknowledgements</p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {acknowledgements.map((ack) => (
                        <div key={ack.id} className="text-xs bg-muted/30 rounded p-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{ack.officer_name}</span>
                            <Badge variant="outline" className="text-xs">
                              {ack.acknowledgement_type}
                            </Badge>
                          </div>
                          <div className="text-muted-foreground">
                            {new Date(ack.acknowledged_at).toLocaleString('en-NZ')}
                          </div>
                          {ack.action_taken && (
                            <p className="mt-1">Action: {ack.action_taken}</p>
                          )}
                          {ack.notes && (
                            <p className="mt-1 italic">Notes: {ack.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAcknowledgeModal(false);
                setSelectedAlert(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitAcknowledgement}
              disabled={isSubmitting || (!selectedAlert?.can_dismiss && !actionTaken.trim())}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Submit Acknowledgement
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
