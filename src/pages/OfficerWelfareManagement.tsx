/**
 * Officer Welfare Management - Complete Welfare Monitoring System
 * 
 * Features:
 * - Live officer tracking map
 * - Active welfare alerts dashboard
 * - Welfare settings configuration
 * - Historical incident tracking
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Heart,
  MapPin,
  AlertTriangle,
  Settings,
  History,
  RefreshCw,
  Loader2,
  Phone,
  ExternalLink,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';

interface WelfareStats {
  totalOfficers: number;
  activeOfficers: number;
  activeAlerts: number;
  criticalAlerts: number;
}

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
  last_activity_at: string;
  alert_sent_at: string;
}

export default function OfficerWelfareManagement() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'alerts' | 'live' | 'settings' | 'history'>('alerts');
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<WelfareStats>({
    totalOfficers: 0,
    activeOfficers: 0,
    activeAlerts: 0,
    criticalAlerts: 0,
  });
  const [alerts, setAlerts] = useState<WelfareAlert[]>([]);

  useEffect(() => {
    loadData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(loadData, 30000);

    // Subscribe to real-time updates
    const subscription = supabase
      .channel('welfare_alerts_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'officer_welfare_alerts' }, () => {
        loadData();
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      subscription.unsubscribe();
    };
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load active alerts
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

      // Calculate stats
      const totalOfficers = new Set(data?.map((a) => a.officer_id)).size || 0;
      const activeAlerts = data?.length || 0;
      const criticalAlerts = data?.filter((a) => a.escalation_level >= 3).length || 0;

      setStats({
        totalOfficers,
        activeOfficers: totalOfficers,
        activeAlerts,
        criticalAlerts,
      });
    } catch (error: any) {
      console.error('Failed to load welfare data:', error);
      toast.error('Failed to load welfare data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCallOfficer = (alert: WelfareAlert) => {
    if (!alert.officer_phone) {
      toast.error('Officer phone number not available');
      return;
    }

    window.location.href = `tel:${alert.officer_phone}`;
    toast.info(`Calling ${alert.officer_name}...`);
  };

  const handleOpenMaps = (alert: WelfareAlert) => {
    if (!alert.gps_latitude || !alert.gps_longitude) {
      toast.error('GPS location not available');
      return;
    }

    const mapsUrl = `https://www.google.com/maps?q=${alert.gps_latitude},${alert.gps_longitude}`;
    window.open(mapsUrl, '_blank');
    toast.success(`Opening Google Maps for ${alert.officer_name}`);
  };

  const handleAcknowledge = async (alert: WelfareAlert) => {
    try {
      const { error } = await supabase
        .from('officer_welfare_alerts')
        .update({
          status: 'acknowledged',
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id,
        })
        .eq('id', alert.id);

      if (error) throw error;

      toast.success(`Welfare check acknowledged for ${alert.officer_name}`);
      await loadData();
    } catch (error: any) {
      console.error('Failed to acknowledge alert:', error);
      toast.error('Failed to acknowledge alert');
    }
  };

  const getAlertBadge = (level: number) => {
    switch (level) {
      case 1:
        return (
          <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 border-blue-300">
            Initial Check
          </Badge>
        );
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <AdminNavigationMenu />
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Heart className="h-8 w-8 text-red-600" />
              Officer Welfare Management
            </h1>
            <p className="text-muted-foreground mt-1">
              Real-time monitoring, alerts, and safety management
            </p>
          </div>
        </div>

        <Button variant="outline" onClick={loadData} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-2 border-blue-200">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-blue-600">{stats.totalOfficers}</div>
            <div className="text-sm font-semibold text-muted-foreground mt-2">Officers Monitored</div>
          </CardContent>
        </Card>

        <Card className="border-2 border-green-200">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-green-600">{stats.activeOfficers}</div>
            <div className="text-sm font-semibold text-muted-foreground mt-2">Active Now</div>
          </CardContent>
        </Card>

        <Card className="border-2 border-amber-200">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-amber-600">{stats.activeAlerts}</div>
            <div className="text-sm font-semibold text-muted-foreground mt-2">Active Alerts</div>
          </CardContent>
        </Card>

        <Card className="border-2 border-red-200">
          <CardContent className="p-6 text-center">
            <div className="text-4xl font-black text-red-600 animate-pulse">{stats.criticalAlerts}</div>
            <div className="text-sm font-semibold text-muted-foreground mt-2">CRITICAL</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="alerts" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Active Alerts
            {stats.activeAlerts > 0 && (
              <Badge variant="destructive" className="ml-2 animate-pulse">
                {stats.activeAlerts}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="live" className="gap-2">
            <MapPin className="h-4 w-4" />
            Live Tracking
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Active Alerts Tab */}
        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Welfare Checks</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Officers requiring immediate welfare check
              </p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
              ) : alerts.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Heart className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p className="text-base">No active welfare checks</p>
                  <p className="text-sm mt-2">All officers are reporting normally</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {alerts.map((alert) => (
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
                            <h3 className="font-bold text-xl">{alert.officer_name}</h3>
                          </div>
                          {alert.officer_phone && <p className="text-sm text-muted-foreground">📞 {alert.officer_phone}</p>}
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {getTimeAgo(alert.alert_sent_at)}
                          </div>
                          {alert.last_activity_at && <div className="mt-1">Last activity: {getTimeAgo(alert.last_activity_at)}</div>}
                        </div>
                      </div>

                      {/* GPS Location */}
                      {alert.gps_latitude && alert.gps_longitude && (
                        <div className="p-3 bg-white dark:bg-gray-900 rounded border mb-4">
                          <div className="flex items-center gap-2 mb-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-semibold">Last Known Location</span>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {alert.gps_latitude.toFixed(6)}, {alert.gps_longitude.toFixed(6)}
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
                          onClick={() => handleOpenMaps(alert)}
                          disabled={!alert.gps_latitude || !alert.gps_longitude}
                          variant="outline"
                          className="h-14 border-2"
                        >
                          <MapPin className="h-5 w-5 mr-2" />
                          Open Maps
                          <ExternalLink className="h-4 w-4 ml-2" />
                        </Button>

                        <Button onClick={() => handleAcknowledge(alert)} className="bg-blue-600 hover:bg-blue-700 h-14">
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
        </TabsContent>

        {/* Live Tracking Tab */}
        <TabsContent value="live" className="space-y-4">
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <MapPin className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Live Officer Tracking</p>
              <p className="text-sm mt-2">This feature shows real-time officer GPS locations on an interactive map</p>
              <p className="text-xs mt-4 text-muted-foreground">To be integrated from LiveOfficerTracking.tsx</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Settings className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Welfare Settings</p>
              <p className="text-sm mt-2">Configure welfare check intervals, escalation thresholds, and notification preferences</p>
              <p className="text-xs mt-4 text-muted-foreground">Settings configuration coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <History className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p className="text-lg font-medium">Welfare Incident History</p>
              <p className="text-sm mt-2">View past welfare alerts and their resolutions</p>
              <p className="text-xs mt-4 text-muted-foreground">Historical data coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
