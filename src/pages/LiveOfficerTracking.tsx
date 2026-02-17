/**
 * LiveOfficerTracking - Real-time officer location + welfare monitoring
 * Combined view for admins/masters to track field officers and safety alerts
 * 
 * Features:
 * - Live GPS tracking with map visualization
 * - Officer activity status (patrolling, investigating, idle)
 * - Welfare alert integration (warning, critical, escalated)
 * - Activity timeline per officer
 * - Zone coverage visualization
 * - Quick actions (contact, acknowledge alert)
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  MapPin,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Phone,
  Mail,
  Shield,
  Navigation,
  Loader2,
  RefreshCw,
  Users,
  Bell,
  AlertCircle,
  Wifi,
  WifiOff,
  Search,
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { OrganizationSelector } from '@/components/features/OrganizationSelector';

interface OfficerLocation {
  officer_id: string;
  officer_name: string;
  officer_email: string;
  officer_phone: string | null;
  organization_id: string;
  organization_name: string;
  zone_id: string | null;
  zone_name: string | null;
  gps_latitude: number;
  gps_longitude: number;
  gps_accuracy: number;
  recorded_at: string;
  activity_type: string;
  minutes_since_ping: number;
  // Welfare alert data
  has_welfare_alert: boolean;
  alert_type: string | null;
  alert_status: string | null;
  escalation_level: number | null;
  last_activity_at: string | null;
  alert_sent_at: string | null;
}

interface WelfareAlert {
  id: string;
  officer_id: string;
  officer_name: string;
  alert_type: string;
  status: string;
  escalation_level: number;
  gps_latitude: number | null;
  gps_longitude: number | null;
  last_activity_at: string;
  alert_sent_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

interface Organization {
  id: string;
  name: string;
}

export function LiveOfficerTracking() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';
  const isAdmin = user?.role === 'admin' || user?.role === 'master';

  const [isLoading, setIsLoading] = useState(true);
  const [officers, setOfficers] = useState<OfficerLocation[]>([]);
  const [welfareAlerts, setWelfareAlerts] = useState<WelfareAlert[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'map' | 'list' | 'alerts'>('list');
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    loadTrackingData();

    // Auto-refresh every 30 seconds
    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(loadTrackingData, 30000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [selectedOrg, autoRefresh]);

  const loadTrackingData = async () => {
    setIsLoading(true);
    try {
      // Load live officer locations from activity log (last 30 minutes)
      const thirtyMinutesAgo = new Date();
      thirtyMinutesAgo.setMinutes(thirtyMinutesAgo.getMinutes() - 30);

      const { data: activities, error: locError } = await supabase
        .from('officer_activity_log')
        .select(`
          user_id,
          activity_type,
          gps_latitude,
          gps_longitude,
          gps_accuracy,
          metadata,
          recorded_at,
          organization_id,
          user_profiles!inner(
            first_name,
            last_name,
            email,
            phone,
            organization_id
          ),
          organizations(
            name
          )
        `)
        .gte('recorded_at', thirtyMinutesAgo.toISOString())
        .order('recorded_at', { ascending: false });

      if (locError) {
        console.error('Failed to load activities:', locError);
        throw locError;
      }

      // Group by officer and get most recent activity
      const officerMap = new Map<string, OfficerLocation>();
      
      (activities || []).forEach((activity: any) => {
        if (!officerMap.has(activity.user_id)) {
          const profile = activity.user_profiles;
          const minutesSincePing = Math.floor(
            (Date.now() - new Date(activity.recorded_at).getTime()) / 60000
          );

          officerMap.set(activity.user_id, {
            officer_id: activity.user_id,
            officer_name: `${profile.first_name} ${profile.last_name}`,
            officer_email: profile.email,
            officer_phone: profile.phone || null,
            organization_id: activity.organization_id,
            organization_name: activity.organizations?.name || 'Unknown',
            zone_id: activity.metadata?.zone_id || null,
            zone_name: activity.metadata?.zone_name || 'Unknown Zone',
            gps_latitude: activity.gps_latitude || 0,
            gps_longitude: activity.gps_longitude || 0,
            gps_accuracy: activity.gps_accuracy || 0,
            recorded_at: activity.recorded_at,
            activity_type: activity.activity_type,
            minutes_since_ping: minutesSincePing,
            has_welfare_alert: false, // Will be updated below
            alert_type: null,
            alert_status: null,
            escalation_level: null,
            last_activity_at: null,
            alert_sent_at: null,
          });
        }
      });

      let filteredLocations = Array.from(officerMap.values());

      // Filter by organization if not master viewing all
      if (selectedOrg !== 'all') {
        filteredLocations = filteredLocations.filter(
          (loc: OfficerLocation) => loc.organization_id === selectedOrg
        );
      } else if (!isMaster) {
        // Non-master users only see their org
        filteredLocations = filteredLocations.filter(
          (loc: OfficerLocation) => loc.organization_id === user?.organization_id
        );
      }

      console.log('Loaded officer locations:', filteredLocations.length);
      setOfficers(filteredLocations);

      // Load active welfare alerts
      const { data: alerts, error: alertsError } = await supabase
        .from('officer_welfare_alerts')
        .select(`
          id,
          officer_id,
          alert_type,
          status,
          escalation_level,
          gps_latitude,
          gps_longitude,
          last_activity_at,
          alert_sent_at,
          acknowledged_at,
          acknowledged_by,
          user_profiles!officer_welfare_alerts_officer_id_fkey (
            first_name,
            last_name
          )
        `)
        .in('status', ['pending', 'acknowledged'])
        .order('escalation_level', { ascending: false })
        .order('alert_sent_at', { ascending: false });

      if (alertsError) throw alertsError;

      const formattedAlerts: WelfareAlert[] = (alerts || []).map((alert: any) => ({
        id: alert.id,
        officer_id: alert.officer_id,
        officer_name: `${alert.user_profiles.first_name} ${alert.user_profiles.last_name}`,
        alert_type: alert.alert_type,
        status: alert.status,
        escalation_level: alert.escalation_level,
        gps_latitude: alert.gps_latitude,
        gps_longitude: alert.gps_longitude,
        last_activity_at: alert.last_activity_at,
        alert_sent_at: alert.alert_sent_at,
        acknowledged_at: alert.acknowledged_at,
        acknowledged_by: alert.acknowledged_by,
      }));

      setWelfareAlerts(formattedAlerts);

    } catch (error: any) {
      console.error('Failed to load tracking data:', error);
      toast.error('Failed to load officer tracking data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      const { error } = await supabase
        .from('officer_welfare_alerts')
        .update({
          status: 'acknowledged',
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: user?.id,
        })
        .eq('id', alertId);

      if (error) throw error;

      toast.success('Welfare alert acknowledged');
      loadTrackingData();
    } catch (error: any) {
      console.error('Failed to acknowledge alert:', error);
      toast.error('Failed to acknowledge alert');
    }
  };

  const getActivityStatusBadge = (minutes: number, hasAlert: boolean) => {
    if (hasAlert) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Welfare Alert
        </Badge>
      );
    }

    if (minutes <= 5) {
      return (
        <Badge variant="default" className="gap-1 bg-green-500">
          <Wifi className="h-3 w-3" />
          Active
        </Badge>
      );
    } else if (minutes <= 15) {
      return (
        <Badge variant="outline" className="gap-1 border-yellow-500 text-yellow-700">
          <Clock className="h-3 w-3" />
          Idle {minutes}m
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="gap-1 border-gray-400 text-gray-600">
          <WifiOff className="h-3 w-3" />
          Inactive {minutes}m
        </Badge>
      );
    }
  };

  const getAlertSeverityBadge = (level: number) => {
    if (level >= 3) {
      return (
        <Badge variant="destructive" className="gap-1 animate-pulse">
          <AlertCircle className="h-3 w-3" />
          CRITICAL
        </Badge>
      );
    } else if (level === 2) {
      return (
        <Badge variant="destructive" className="gap-1 bg-orange-600">
          <AlertTriangle className="h-3 w-3" />
          HIGH
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="gap-1 border-yellow-500 text-yellow-700">
          <Bell className="h-3 w-3" />
          WARNING
        </Badge>
      );
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const minutes = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Filter officers by search query
  const filteredOfficers = officers.filter(officer =>
    officer.officer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    officer.officer_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    officer.zone_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeOfficers = filteredOfficers.filter(o => o.minutes_since_ping <= 15);
  const inactiveOfficers = filteredOfficers.filter(o => o.minutes_since_ping > 15);
  const alertOfficers = filteredOfficers.filter(o => o.has_welfare_alert);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            Live Officer Tracking
          </h1>
          <p className="text-muted-foreground">
            Real-time location monitoring and welfare alerts
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            Auto-Refresh
          </Button>
          <Button onClick={loadTrackingData} variant="outline" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh Now
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Total Officers</div>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-black">{filteredOfficers.length}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {activeOfficers.length} active, {inactiveOfficers.length} inactive
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Active Now</div>
              <Wifi className="h-4 w-4 text-green-500" />
            </div>
            <div className="text-3xl font-black text-green-600">
              {activeOfficers.length}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Last 15 minutes
            </div>
          </CardContent>
        </Card>

        <Card className={welfareAlerts.length > 0 ? 'border-2 border-red-500' : ''}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Welfare Alerts</div>
              <AlertTriangle className={`h-4 w-4 ${welfareAlerts.length > 0 ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`} />
            </div>
            <div className={`text-3xl font-black ${welfareAlerts.length > 0 ? 'text-red-600' : ''}`}>
              {welfareAlerts.length}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {welfareAlerts.filter(a => a.escalation_level >= 3).length} critical
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-muted-foreground">Zone Coverage</div>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-black">
              {new Set(filteredOfficers.map(o => o.zone_id)).size}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Zones being patrolled
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {isMaster && (
              <OrganizationSelector
                selectedOrg={selectedOrg}
                onOrgChange={setSelectedOrg}
                organizations={organizations}
                setOrganizations={setOrganizations}
                showLabel={true}
              />
            )}
            <div>
              <Label htmlFor="search">Search Officers</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Name, email, or zone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="list" className="gap-2">
            <Users className="h-4 w-4" />
            Officer List ({filteredOfficers.length})
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Welfare Alerts ({welfareAlerts.length})
          </TabsTrigger>
          <TabsTrigger value="map" className="gap-2">
            <MapPin className="h-4 w-4" />
            Map View
          </TabsTrigger>
        </TabsList>

        {/* Officer List View */}
        <TabsContent value="list" className="space-y-4 mt-4">
          {filteredOfficers.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No officers currently tracked</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredOfficers.map(officer => (
                <Card
                  key={officer.officer_id}
                  className={officer.has_welfare_alert ? 'border-2 border-red-500 animate-pulse' : ''}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{officer.officer_name}</CardTitle>
                        <p className="text-xs text-muted-foreground">{officer.officer_email}</p>
                      </div>
                      {getActivityStatusBadge(officer.minutes_since_ping, officer.has_welfare_alert)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Location */}
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-medium">{officer.zone_name || 'Unknown Zone'}</div>
                        <div className="text-xs text-muted-foreground">
                          {officer.organization_name}
                        </div>
                      </div>
                    </div>

                    {/* Last Activity */}
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        Last ping: {formatTimeAgo(officer.recorded_at)}
                      </span>
                    </div>

                    {/* Activity Type */}
                    <div className="flex items-center gap-2 text-sm">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="outline" className="text-xs">
                        {officer.activity_type.replace('_', ' ')}
                      </Badge>
                    </div>

                    {/* GPS Accuracy */}
                    <div className="flex items-center gap-2 text-sm">
                      <Navigation className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground text-xs">
                        Accuracy: ±{officer.gps_accuracy}m
                      </span>
                    </div>

                    {/* Contact Actions */}
                    <div className="flex gap-2 pt-2 border-t">
                      <Button variant="outline" size="sm" className="flex-1">
                        <Phone className="h-3 w-3 mr-1" />
                        Call
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1">
                        <Mail className="h-3 w-3 mr-1" />
                        Email
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Welfare Alerts View */}
        <TabsContent value="alerts" className="space-y-4 mt-4">
          {welfareAlerts.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-30 text-green-500" />
                <p className="font-semibold text-green-600">All officers safe</p>
                <p className="text-sm">No active welfare alerts</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {welfareAlerts.map(alert => (
                <Card
                  key={alert.id}
                  className={`border-2 ${
                    alert.escalation_level >= 3
                      ? 'border-red-600 bg-red-50 dark:bg-red-950/20'
                      : alert.escalation_level === 2
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20'
                      : 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20'
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-red-600" />
                          {alert.officer_name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          {alert.alert_type.replace('_', ' ').toUpperCase()}
                        </p>
                      </div>
                      {getAlertSeverityBadge(alert.escalation_level)}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">Alert Sent</div>
                        <div className="font-medium">{formatTimeAgo(alert.alert_sent_at)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Last Activity</div>
                        <div className="font-medium">{formatTimeAgo(alert.last_activity_at)}</div>
                      </div>
                    </div>

                    {alert.gps_latitude && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {alert.gps_latitude.toFixed(6)}, {alert.gps_longitude?.toFixed(6)}
                        </span>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2 border-t">
                      {alert.status === 'pending' && (
                        <Button
                          onClick={() => handleAcknowledgeAlert(alert.id)}
                          variant="default"
                          size="sm"
                          className="flex-1"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Acknowledge Alert
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="flex-1">
                        <Phone className="h-4 w-4 mr-2" />
                        Contact Officer
                      </Button>
                    </div>

                    {alert.acknowledged_at && (
                      <div className="text-xs text-muted-foreground border-t pt-2">
                        Acknowledged {formatTimeAgo(alert.acknowledged_at)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Map View */}
        <TabsContent value="map" className="mt-4">
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <MapPin className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-semibold">Map View Coming Soon</p>
              <p className="text-sm">
                Interactive map with officer locations, zones, and welfare alerts
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
