/**
 * Officer Welfare Alerts Dashboard
 * Real-time monitoring of officer welfare checks with clickable GPS locations
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Heart,
  AlertTriangle,
  Phone,
  MapPin,
  ExternalLink,
  CheckCircle2,
  Clock,
  Loader2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface WelfareAlert {
  id: string;
  officer_id: string;
  officer_name: string;
  officer_phone: string | null;
  alert_type: string;
  status: string;
  escalation_level: number;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_accuracy: number | null;
  last_activity_at: string;
  alert_sent_at: string;
  escalated_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export function OfficerWelfareAlerts() {
  const { user } = useAuthStore();

  const [isLoading, setIsLoading] = useState(true);
  const [alerts, setAlerts] = useState<WelfareAlert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<WelfareAlert | null>(null);
  const [showAcknowledgeDialog, setShowAcknowledgeDialog] = useState(false);
  const [acknowledgementNotes, setAcknowledgementNotes] = useState('');
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  useEffect(() => {
    loadAlerts();

    // Subscribe to real-time updates
    const subscription = supabase
      .channel('welfare_alerts_channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'officer_welfare_alerts',
        },
        () => {
          loadAlerts();
        }
      )
      .subscribe();

    // Refresh every 30 seconds
    const interval = setInterval(loadAlerts, 30000);

    return () => {
      subscription.unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const loadAlerts = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('officer_welfare_alerts')
        .select('*')
        .eq('status', 'pending')
        .order('escalation_level', { ascending: false })
        .order('alert_sent_at', { ascending: true });

      if (user?.role !== 'master') {
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
      setAlerts(data || []);

    } catch (error: any) {
      console.error('Failed to load welfare alerts:', error);
      toast.error('Failed to load welfare alerts');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenGoogleMaps = (alert: WelfareAlert) => {
    if (!alert.gps_latitude || !alert.gps_longitude) {
      toast.error('GPS location not available');
      return;
    }

    const mapsUrl = `https://www.google.com/maps?q=${alert.gps_latitude},${alert.gps_longitude}`;
    window.open(mapsUrl, '_blank');
    
    // Log the click
    toast.success(`Opening Google Maps for ${alert.officer_name}`);
  };

  const handleCallOfficer = (alert: WelfareAlert) => {
    if (!alert.officer_phone) {
      toast.error('Officer phone number not available');
      return;
    }

    // Open phone dialer
    window.location.href = `tel:${alert.officer_phone}`;
    
    toast.info(`Calling ${alert.officer_name}...`);
  };

  const handleAcknowledge = (alert: WelfareAlert) => {
    setSelectedAlert(alert);
    setShowAcknowledgeDialog(true);
  };

  const handleConfirmAcknowledge = async () => {
    if (!selectedAlert) return;

    setIsAcknowledging(true);
    try {
      const { error } = await supabase
        .from('officer_welfare_alerts')
        .update({
          status: 'acknowledged',
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id,
          acknowledgement_notes: acknowledgementNotes,
        })
        .eq('id', selectedAlert.id);

      if (error) throw error;

      toast.success(`Welfare check acknowledged for ${selectedAlert.officer_name}`);
      
      setShowAcknowledgeDialog(false);
      setSelectedAlert(null);
      setAcknowledgementNotes('');
      
      await loadAlerts();

    } catch (error: any) {
      console.error('Failed to acknowledge alert:', error);
      toast.error('Failed to acknowledge alert: ' + error.message);
    } finally {
      setIsAcknowledging(false);
    }
  };

  const getAlertBadge = (level: number) => {
    switch (level) {
      case 1:
        return <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 border-blue-300">Initial Check</Badge>;
      case 2:
        return <Badge className="bg-amber-500 text-white">High Priority</Badge>;
      case 3:
        return <Badge className="bg-red-600 text-white animate-pulse">CRITICAL</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const getTimeAgo = (timestamp: string) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins === 1) return '1 minute ago';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return '1 hour ago';
    return `${diffHours} hours ago`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
          <Heart className="h-8 w-8 text-red-600" />
          Officer Welfare Alerts
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mt-1">
          Real-time monitoring of officer safety and welfare checks
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-2 border-blue-200 bg-white dark:bg-gray-900">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-blue-600 dark:text-blue-400">
              {alerts.filter(a => a.escalation_level === 1).length}
            </div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white mt-2">
              Initial Checks
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-amber-200 bg-white dark:bg-gray-900">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-amber-600 dark:text-amber-400">
              {alerts.filter(a => a.escalation_level === 2).length}
            </div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white mt-2">
              High Priority
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-red-200 bg-white dark:bg-gray-900">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-red-600 dark:text-red-400 animate-pulse">
              {alerts.filter(a => a.escalation_level === 3).length}
            </div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white mt-2">
              CRITICAL
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-green-200 bg-white dark:bg-gray-900">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-green-600 dark:text-green-400">
              {alerts.length}
            </div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white mt-2">
              Total Active
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts List */}
      <Card className="border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900">
        <CardHeader className="bg-gray-100 dark:bg-gray-800 border-b-2 border-gray-300 dark:border-gray-600">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Active Welfare Checks
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <Heart className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-base">No active welfare checks</p>
              <p className="text-sm mt-2">All officers are reporting normally</p>
            </div>
          ) : (
            <div className="space-y-4">
              {alerts.map(alert => (
                <div
                  key={alert.id}
                  className={`p-5 border-2 rounded-lg transition-colors ${
                    alert.escalation_level === 3
                      ? 'border-red-500 bg-red-100 dark:bg-red-900/50 animate-pulse'
                      : alert.escalation_level === 2
                      ? 'border-amber-500 bg-amber-100 dark:bg-amber-900/50'
                      : 'border-blue-500 bg-blue-100 dark:bg-blue-900/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        {getAlertBadge(alert.escalation_level)}
                        <h3 className="font-bold text-xl text-gray-900 dark:text-white">
                          {alert.officer_name}
                        </h3>
                      </div>
                      {alert.officer_phone && (
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          📞 {alert.officer_phone}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-sm text-gray-600 dark:text-gray-300">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {getTimeAgo(alert.alert_sent_at)}
                      </div>
                      {alert.last_activity_at && (
                        <div className="mt-1">
                          Last activity: {getTimeAgo(alert.last_activity_at)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* GPS Location */}
                  {alert.gps_latitude && alert.gps_longitude && (
                    <div className="p-3 bg-white dark:bg-gray-900 rounded border border-gray-300 dark:border-gray-600 mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          Last Known Location
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300 font-mono">
                        {alert.gps_latitude.toFixed(6)}, {alert.gps_longitude.toFixed(6)}
                        {alert.gps_accuracy && ` (±${Math.round(alert.gps_accuracy)}m)`}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Button
                      onClick={() => handleCallOfficer(alert)}
                      disabled={!alert.officer_phone}
                      className="bg-green-600 hover:bg-green-700 h-14"
                    >
                      <Phone className="h-5 w-5 mr-2" />
                      Call Officer
                    </Button>

                    <Button
                      onClick={() => handleOpenGoogleMaps(alert)}
                      disabled={!alert.gps_latitude || !alert.gps_longitude}
                      variant="outline"
                      className="h-14 border-2"
                    >
                      <MapPin className="h-5 w-5 mr-2" />
                      Open Maps
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </Button>

                    <Button
                      onClick={() => handleAcknowledge(alert)}
                      className="bg-blue-600 hover:bg-blue-700 h-14"
                    >
                      <CheckCircle2 className="h-5 w-5 mr-2" />
                      Acknowledge
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Acknowledge Dialog */}
      <Dialog open={showAcknowledgeDialog} onOpenChange={setShowAcknowledgeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-blue-600" />
              Acknowledge Welfare Check
            </DialogTitle>
            <DialogDescription>
              {selectedAlert && (
                <>
                  Confirming welfare check for <strong>{selectedAlert.officer_name}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 block mb-2">
                Notes (optional)
              </label>
              <Textarea
                value={acknowledgementNotes}
                onChange={(e) => setAcknowledgementNotes(e.target.value)}
                placeholder="Add notes about the welfare check (e.g., spoke to officer, confirmed safe, etc.)"
                rows={4}
                className="w-full"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAcknowledgeDialog(false);
                setAcknowledgementNotes('');
              }}
              disabled={isAcknowledging}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAcknowledge}
              disabled={isAcknowledging}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isAcknowledging ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Acknowledging...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Confirm Acknowledgement
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
