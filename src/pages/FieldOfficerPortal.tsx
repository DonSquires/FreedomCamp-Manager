/**
 * Field Officer Portal - Streamlined Professional Mobile Interface
 * Rebuilt for optimal field operations with clean workflow
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Camera,
  Wifi,
  WifiOff,
  Clock,
  LogOut,
  AlertCircle,
  Loader2,
  MapPin,
  Calendar,
  TrendingUp,
  Plus,
  FileText,
  Activity,
  Wrench,
  List,
  Settings,
  Shield,
  ChevronRight,
  Menu,
  X,
  Zap,
} from 'lucide-react';
import { JDSLogo } from '@/components/layout/JDSLogo';
import { useAuthStore } from '@/stores/authStore';
import { isOnline } from '@/lib/pwa';
import { PlateCapture } from '@/components/features/PlateCapture';
import { SessionScan } from '@/components/features/SessionList';
import { VehicleEditDrawer } from '@/components/features/VehicleEditDrawer';
import { IncidentCreationForm } from '@/components/features/IncidentCreationForm';
import { HSReportingForm } from '@/components/features/HSReportingForm';
import { MaintenanceReportForm } from '@/components/features/MaintenanceReportForm';
import { FieldInvestigationWork } from './FieldInvestigationWork';
import { MyIncidentReportsList } from '@/components/features/MyIncidentReportsList';
import { ZoomScanQueue } from '@/components/features/ZoomScanQueue';
import { OfficerWelfareWarningModal } from '@/components/features/OfficerWelfareWarningModal';
import { DarkModeToggle } from '@/components/features/DarkModeToggle';
import { NetworkStatusBar } from '@/components/features/NetworkStatusBar';
import { KeepScreenAwake } from '@/components/features/KeepScreenAwake';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useOfficerWelfareMonitor } from '@/hooks/useOfficerWelfareMonitor';
import { cn } from '@/lib/utils';

interface FieldOfficerPortalProps {
  onLogout: () => void;
}

type ViewMode = 'dashboard' | 'scanning' | 'zoom_scan' | 'reports' | 'history' | 'settings';

export function FieldOfficerPortal({ onLogout }: FieldOfficerPortalProps) {
  const { user } = useAuthStore();
  const [online, setOnline] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Zone state
  const [selectedZone, setSelectedZone] = useState<{ id: string; name: string; orgId: string } | null>(null);
  const [availableZones, setAvailableZones] = useState<{ id: string; name: string; organization_id: string }[]>([]);
  const [isLoadingZones, setIsLoadingZones] = useState(true);
  
  // Stats state
  const [todayScans, setTodayScans] = useState(0);
  const [last24hScans, setLast24hScans] = useState(0);
  const [complianceRate, setComplianceRate] = useState(0);
  const [investigationStats, setInvestigationStats] = useState({
    assigned: 0,
    inProgress: 0,
    urgent: 0,
  });
  
  // Patrol state
  const [currentPatrol, setCurrentPatrol] = useState<any>(null);
  
  // Session scans
  const [sessionScans, setSessionScans] = useState<SessionScan[]>([]);
  
  // Modal states
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [showHSForm, setShowHSForm] = useState(false);
  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false);
  const [showEditDrawer, setShowEditDrawer] = useState(false);
  const [selectedScan, setSelectedScan] = useState<SessionScan | null>(null);
  const [showReportsMenu, setShowReportsMenu] = useState(false);
  
  // GPS location
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  
  // Officer welfare monitoring
  const {
    warning: welfareWarning,
    isOffline: welfareOffline,
    recordVehicleScan,
    recordGPSUpdate,
    acknowledgeWarning,
  } = useOfficerWelfareMonitor();

  // Check online status
  useEffect(() => {
    const checkOnline = () => setOnline(isOnline());
    checkOnline();
    const interval = setInterval(checkOnline, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update clock
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Load zones on mount
  useEffect(() => {
    const loadZones = async () => {
      setIsLoadingZones(true);
      try {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (!profiles || profiles.length === 0) {
          toast.error('User profile not found');
          return;
        }

        const profile = profiles[0];
        if (!profile.organization_id) {
          toast.error('User organization not found');
          return;
        }

        const { data: zones, error } = await supabase
          .from('zones')
          .select('id, name, organization_id')
          .eq('organization_id', profile.organization_id)
          .eq('is_active', true)
          .order('name');

        if (error) {
          toast.error('Failed to load zones');
          return;
        }

        if (zones && zones.length > 0) {
          setAvailableZones(zones);
          setSelectedZone({
            id: zones[0].id,
            name: zones[0].name,
            orgId: zones[0].organization_id,
          });
        } else {
          toast.warning('No zones configured');
        }
      } catch (error: any) {
        console.error('Zone loading error:', error);
        toast.error('Failed to load zones');
      } finally {
        setIsLoadingZones(false);
      }
    };

    if (user?.id) {
      loadZones();
    }
  }, [user?.id]);

  // Initialize GPS tracking
  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setGpsLocation({ lat: latitude, lng: longitude, accuracy });
        recordGPSUpdate(latitude, longitude, accuracy);
      },
      (error) => console.warn('GPS error:', error),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [recordGPSUpdate]);

  // Load today's stats
  useEffect(() => {
    const loadStats = async () => {
      if (!user?.id) return;

      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        // Today's scans
        const { count: todayCount } = await supabase
          .from('vehicle_observations_v2')
          .select('*', { count: 'exact', head: true })
          .eq('recorded_by', user.id)
          .gte('recorded_at', today.toISOString());

        // Last 24h scans
        const { count: last24h } = await supabase
          .from('vehicle_observations_v2')
          .select('*', { count: 'exact', head: true })
          .eq('recorded_by', user.id)
          .gte('recorded_at', twentyFourHoursAgo.toISOString());

        // Compliance rate (today)
        const { data: todayObs } = await supabase
          .from('vehicle_observations_v2')
          .select('is_compliant')
          .eq('recorded_by', user.id)
          .gte('recorded_at', today.toISOString());

        const compliant = todayObs?.filter(o => o.is_compliant).length || 0;
        const total = todayObs?.length || 0;
        const rate = total > 0 ? Math.round((compliant / total) * 100) : 0;

        setTodayScans(todayCount || 0);
        setLast24hScans(last24h || 0);
        setComplianceRate(rate);
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    };

    loadStats();
    const interval = setInterval(loadStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // Load investigation stats
  useEffect(() => {
    const loadInvestigationStats = async () => {
      if (!user?.id) return;

      try {
        const { count: assignedCount } = await supabase
          .from('investigation_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_to', user.id)
          .eq('status', 'assigned');

        const { count: inProgressCount } = await supabase
          .from('investigation_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_to', user.id)
          .eq('status', 'in_progress');

        const { count: urgentCount } = await supabase
          .from('investigation_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_to', user.id)
          .in('status', ['assigned', 'in_progress'])
          .eq('priority', 'urgent');

        setInvestigationStats({
          assigned: assignedCount || 0,
          inProgress: inProgressCount || 0,
          urgent: urgentCount || 0,
        });
      } catch (error) {
        console.error('Failed to load investigation stats:', error);
      }
    };

    loadInvestigationStats();
    const interval = setInterval(loadInvestigationStats, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // Load current patrol
  useEffect(() => {
    const loadPatrol = async () => {
      if (!user?.id || !selectedZone) return;

      try {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabase
          .from('patrols')
          .select('*')
          .eq('assigned_to', user.id)
          .eq('zone_id', selectedZone.id)
          .eq('patrol_date', today)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        setCurrentPatrol(data);
      } catch (error) {
        // No patrol found - normal
        setCurrentPatrol(null);
      }
    };

    loadPatrol();
  }, [user?.id, selectedZone?.id]);

  const handlePlateDetected = (data: any) => {
    const newScan: SessionScan = {
      id: data.observationId || `scan-${Date.now()}`,
      plateNumber: data.plateNumber,
      zoneName: selectedZone?.name || '',
      zoneId: selectedZone?.id || '',
      organizationId: selectedZone?.orgId || '',
      timestamp: new Date(),
      isCompliant: data.isCompliant ?? true,
      isFlagged: data.isFlagged ?? false,
      vehicleMake: data.vehicleMake,
      vehicleModel: data.vehicleModel,
      vehicleColor: data.vehicleColor,
      vehicleId: data.vehicleId,
      observationId: data.observationId,
      detectionMethod: data.detectionMethod,
    };

    setSessionScans(prev => [newScan, ...prev]);
    recordVehicleScan();
    
    // Auto-return to dashboard after scan
    setCurrentView('dashboard');
  };

  const handleCreateReport = (type: 'incident' | 'hs' | 'maintenance') => {
    const tempScan: SessionScan = {
      id: `temp-${Date.now()}`,
      plateNumber: '',
      zoneName: selectedZone?.name || '',
      zoneId: selectedZone?.id || '',
      organizationId: selectedZone?.orgId || '',
      timestamp: new Date(),
      isCompliant: true,
      isFlagged: false,
      detectionMethod: 'manual',
    };
    
    setSelectedScan(tempScan);
    setShowReportsMenu(false);
    
    switch (type) {
      case 'incident':
        setShowIncidentForm(true);
        break;
      case 'hs':
        setShowHSForm(true);
        break;
      case 'maintenance':
        setShowMaintenanceForm(true);
        break;
    }
  };

  const renderContent = () => {
    if (currentView === 'scanning' && selectedZone) {
      return (
        <div className="fixed inset-0 bg-background z-50">
          <PlateCapture
            zoneId={selectedZone.id}
            zoneName={selectedZone.name}
            organizationId={selectedZone.orgId}
            onPlateDetected={handlePlateDetected}
            onCancel={() => setCurrentView('dashboard')}
          />
        </div>
      );
    }

    if (currentView === 'zoom_scan' && selectedZone) {
      return (
        <div className="fixed inset-0 bg-background z-50">
          <ZoomScanQueue
            zoneId={selectedZone.id}
            zoneName={selectedZone.name}
            organizationId={selectedZone.orgId}
            onCancel={() => setCurrentView('dashboard')}
          />
        </div>
      );
    }

    if (currentView === 'reports') {
      return (
        <div className="space-y-4 pb-20">
          <MyIncidentReportsList />
        </div>
      );
    }

    if (currentView === 'history') {
      return (
        <div className="space-y-4 pb-20">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Scans</CardTitle>
            </CardHeader>
            <CardContent>
              {sessionScans.length > 0 ? (
                <div className="space-y-2">
                  {sessionScans.map(scan => (
                    <div
                      key={scan.id}
                      onClick={() => {
                        setSelectedScan(scan);
                        setShowEditDrawer(true);
                      }}
                      className="p-4 border rounded-lg hover:bg-muted cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-lg">{scan.plateNumber}</p>
                          <p className="text-sm text-muted-foreground">
                            {scan.vehicleMake} {scan.vehicleModel}
                          </p>
                        </div>
                        <Badge variant={scan.isCompliant ? 'default' : 'destructive'}>
                          {scan.isCompliant ? 'Compliant' : 'Non-Compliant'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <List className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p>No scans yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    if (currentView === 'settings') {
      return (
        <div className="space-y-4 pb-20">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <DarkModeToggle variant="full" />
              
              <div className="pt-4 border-t">
                <h3 className="font-semibold mb-2">User Information</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-semibold">{user?.first_name} {user?.last_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Role:</span>
                    <span className="font-semibold capitalize">{user?.role?.replace('_', ' ')}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Dashboard view (default)
    return (
      <div className="space-y-5 pb-20">
        {/* Network Status */}
        <NetworkStatusBar />

        {/* Current Zone & Patrol */}
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardContent className="p-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  <span className="font-semibold">{selectedZone?.name || 'No Zone'}</span>
                </div>
                <Badge variant={online ? 'default' : 'destructive'}>
                  {online ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
                  {online ? 'Online' : 'Offline'}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                {currentTime.toLocaleString('en-NZ', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Pacific/Auckland',
                })}
              </div>

              {currentPatrol && (
                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Patrol Status:</span>
                    <Badge variant={currentPatrol.checked_in_at ? 'default' : 'secondary'}>
                      {currentPatrol.checked_in_at ? 'Checked In' : 'Scheduled'}
                    </Badge>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Primary Action: Start Scanning */}
        <Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl flex items-center gap-2">
              <Camera className="h-6 w-6 text-green-600" />
              Vehicle Scanning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-base text-muted-foreground">
              Scan vehicle plates with AI recognition and compliance checking
            </p>
            
            <Button
              onClick={() => setCurrentView('scanning')}
              disabled={isLoadingZones || !selectedZone}
              className="w-full h-20 text-xl font-bold bg-green-600 hover:bg-green-700"
              size="lg"
            >
              {isLoadingZones ? (
                <>
                  <Loader2 className="h-7 w-7 mr-3 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Camera className="h-7 w-7 mr-3" />
                  Start Scanning
                  <ChevronRight className="h-7 w-7 ml-3" />
                </>
              )}
            </Button>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="p-3 bg-white/70 dark:bg-gray-900/70 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Today</p>
                <p className="text-2xl font-black text-green-700">{todayScans}</p>
              </div>
              <div className="p-3 bg-white/70 dark:bg-gray-900/70 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">24h</p>
                <p className="text-2xl font-black text-green-700">{last24hScans}</p>
              </div>
              <div className="p-3 bg-white/70 dark:bg-gray-900/70 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Rate</p>
                <p className="text-2xl font-black text-green-700">{complianceRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Investigation Jobs */}
        {(investigationStats.assigned > 0 || investigationStats.inProgress > 0) && (
          <Card className="border-2 border-purple-500/30 bg-purple-50/50 dark:bg-purple-950/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-purple-900 dark:text-purple-100">
                <FileText className="h-5 w-5" />
                Investigation Jobs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-white dark:bg-gray-900 rounded-lg text-center border-2 border-purple-200 dark:border-purple-700">
                  <p className="text-2xl font-black text-purple-700 dark:text-purple-300">
                    {investigationStats.assigned}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">New</p>
                </div>
                <div className="p-3 bg-white dark:bg-gray-900 rounded-lg text-center border-2 border-purple-200 dark:border-purple-700">
                  <p className="text-2xl font-black text-purple-700 dark:text-purple-300">
                    {investigationStats.inProgress}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Active</p>
                </div>
                <div className="p-3 bg-white dark:bg-gray-900 rounded-lg text-center border-2 border-red-200 dark:border-red-700">
                  <p className="text-2xl font-black text-red-700 dark:text-red-300">
                    {investigationStats.urgent}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Urgent</p>
                </div>
              </div>

              <Button
                onClick={() => setCurrentView('dashboard')} // TODO: Add investigation view
                className="w-full h-14 text-base font-bold bg-purple-600 hover:bg-purple-700"
              >
                <FileText className="h-5 w-5 mr-2" />
                Open Jobs
                <ChevronRight className="h-5 w-5 ml-2" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Recent Activity */}
        {sessionScans.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Recent Activity</span>
                <Button variant="ghost" size="sm" onClick={() => setCurrentView('history')}>
                  View All
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sessionScans.slice(0, 3).map(scan => (
                  <div
                    key={scan.id}
                    className="p-3 border rounded-lg hover:bg-muted cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedScan(scan);
                      setShowEditDrawer(true);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{scan.plateNumber}</span>
                      <Badge variant={scan.isCompliant ? 'default' : 'destructive'} className="text-xs">
                        {scan.isCompliant ? 'OK' : 'Issue'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 flex flex-col border-r bg-card transition-transform duration-200",
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <JDSLogo size="sm" />
              <h1 className="text-xl font-bold">Field Portal</h1>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-2 truncate">
            {user?.first_name} {user?.last_name}
          </p>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <Button
            variant={currentView === 'dashboard' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base"
            onClick={() => {
              setCurrentView('dashboard');
              setSidebarOpen(false);
            }}
          >
            <TrendingUp className="h-5 w-5 mr-3" />
            Dashboard
          </Button>

          <Button
            variant={currentView === 'scanning' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base"
            onClick={() => {
              setCurrentView('scanning');
              setSidebarOpen(false);
            }}
            disabled={!selectedZone}
          >
            <Camera className="h-5 w-5 mr-3" />
            Scan Vehicle
          </Button>

          <Button
            variant={currentView === 'zoom_scan' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base"
            onClick={() => {
              setCurrentView('zoom_scan');
              setSidebarOpen(false);
            }}
            disabled={!selectedZone}
          >
            <Zap className="h-5 w-5 mr-3" />
            Zoom Scan
          </Button>

          <Button
            variant={currentView === 'reports' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base"
            onClick={() => {
              setCurrentView('reports');
              setSidebarOpen(false);
            }}
          >
            <FileText className="h-5 w-5 mr-3" />
            My Reports
          </Button>

          <Button
            variant={currentView === 'history' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base"
            onClick={() => {
              setCurrentView('history');
              setSidebarOpen(false);
            }}
          >
            <List className="h-5 w-5 mr-3" />
            History
            {sessionScans.length > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {sessionScans.length}
              </Badge>
            )}
          </Button>

          <Button
            variant={currentView === 'settings' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base"
            onClick={() => {
              setCurrentView('settings');
              setSidebarOpen(false);
            }}
          >
            <Settings className="h-5 w-5 mr-3" />
            Settings
          </Button>
        </nav>

        <div className="p-4 border-t">
          <Button
            variant="ghost"
            className="w-full justify-start h-12 text-base text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
            onClick={onLogout}
          >
            <LogOut className="h-5 w-5 mr-3" />
            Logout
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <div className="border-b bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between p-4">
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-6 w-6" />
            </Button>
            <h1 className="text-lg font-bold">Field Portal</h1>
            <div className="w-10" />
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 max-w-2xl mx-auto w-full">
          {renderContent()}
        </div>

        {/* Bottom Navigation - 5 TABS */}
        <div className="border-t bg-background/95 backdrop-blur-sm">
          <div className="grid grid-cols-5 gap-1 p-2 max-w-3xl mx-auto">
            <Button
              variant={currentView === 'dashboard' ? 'default' : 'ghost'}
              className="h-16 flex flex-col items-center justify-center gap-1"
              onClick={() => setCurrentView('dashboard')}
            >
              <TrendingUp className="h-5 w-5" />
              <span className="text-xs">Dashboard</span>
            </Button>
            
            <Button
              variant={currentView === 'scanning' ? 'default' : 'ghost'}
              className="h-16 flex flex-col items-center justify-center gap-1"
              onClick={() => setCurrentView('scanning')}
              disabled={!selectedZone}
            >
              <Camera className="h-5 w-5" />
              <span className="text-xs">Scan</span>
            </Button>

            <Button
              variant={currentView === 'zoom_scan' ? 'default' : 'ghost'}
              className={cn(
                "h-16 flex flex-col items-center justify-center gap-1",
                currentView === 'zoom_scan' && "bg-gradient-to-br from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white"
              )}
              onClick={() => setCurrentView('zoom_scan')}
              disabled={!selectedZone}
            >
              <Zap className="h-5 w-5" />
              <span className="text-xs font-bold">Zoom</span>
            </Button>
            
            <Button
              variant={currentView === 'reports' ? 'default' : 'ghost'}
              className="h-16 flex flex-col items-center justify-center gap-1"
              onClick={() => setCurrentView('reports')}
            >
              <FileText className="h-5 w-5" />
              <span className="text-xs">Reports</span>
            </Button>
            
            <Button
              variant={currentView === 'history' ? 'default' : 'ghost'}
              className="h-16 flex flex-col items-center justify-center gap-1 relative"
              onClick={() => setCurrentView('history')}
            >
              <List className="h-5 w-5" />
              <span className="text-xs">History</span>
              {sessionScans.length > 0 && (
                <Badge variant="secondary" className="absolute top-1 right-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                  {sessionScans.length}
                </Badge>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Floating Action Button for Quick Reports */}
      {currentView === 'dashboard' && (
        <div className="fixed bottom-24 right-6 z-30">
          {showReportsMenu && (
            <div className="absolute bottom-16 right-0 space-y-2 mb-2">
              <Button
                onClick={() => handleCreateReport('incident')}
                className="w-full h-14 bg-red-600 hover:bg-red-700 shadow-lg"
              >
                <AlertCircle className="h-5 w-5 mr-2" />
                Incident
              </Button>
              <Button
                onClick={() => handleCreateReport('hs')}
                className="w-full h-14 bg-orange-600 hover:bg-orange-700 shadow-lg"
              >
                <Activity className="h-5 w-5 mr-2" />
                H&S Report
              </Button>
              <Button
                onClick={() => handleCreateReport('maintenance')}
                className="w-full h-14 bg-blue-600 hover:bg-blue-700 shadow-lg"
              >
                <Wrench className="h-5 w-5 mr-2" />
                Maintenance
              </Button>
            </div>
          )}
          
          <Button
            size="lg"
            onClick={() => setShowReportsMenu(!showReportsMenu)}
            className="h-16 w-16 rounded-full shadow-2xl bg-primary hover:bg-primary/90"
          >
            <Plus className={cn("h-8 w-8 transition-transform", showReportsMenu && "rotate-45")} />
          </Button>
        </div>
      )}

      {/* Modals */}
      {showIncidentForm && selectedScan && (
        <IncidentCreationForm
          scan={selectedScan}
          onClose={() => {
            setShowIncidentForm(false);
            setSelectedScan(null);
          }}
          onSuccess={() => {
            setShowIncidentForm(false);
            setSelectedScan(null);
            toast.success('Incident report created');
          }}
        />
      )}

      {showHSForm && selectedScan && (
        <HSReportingForm
          scan={selectedScan}
          onClose={() => {
            setShowHSForm(false);
            setSelectedScan(null);
          }}
          onSuccess={() => {
            setShowHSForm(false);
            setSelectedScan(null);
            toast.success('H&S report created');
          }}
        />
      )}

      {showMaintenanceForm && selectedScan && (
        <MaintenanceReportForm
          scan={selectedScan}
          onClose={() => {
            setShowMaintenanceForm(false);
            setSelectedScan(null);
          }}
          onSuccess={() => {
            setShowMaintenanceForm(false);
            setSelectedScan(null);
            toast.success('Maintenance report created');
          }}
        />
      )}

      {showEditDrawer && selectedScan && (
        <VehicleEditDrawer
          scan={selectedScan}
          onClose={() => {
            setShowEditDrawer(false);
            setSelectedScan(null);
          }}
          onUpdate={(updated) => {
            setSessionScans(prev => prev.map(s => s.id === updated.id ? updated : s));
            setShowEditDrawer(false);
          }}
          onCreateIncident={() => {
            setShowEditDrawer(false);
            setShowIncidentForm(true);
          }}
          onCreateHSReport={() => {
            setShowEditDrawer(false);
            setShowHSForm(true);
          }}
          onCreateMaintenanceReport={() => {
            setShowEditDrawer(false);
            setShowMaintenanceForm(true);
          }}
        />
      )}

      {/* Welfare Warning Modal - Overlays Everything */}
      <OfficerWelfareWarningModal
        warning={welfareWarning}
        isOffline={welfareOffline}
        isMonitoringPaused={false}
        onAcknowledge={acknowledgeWarning}
      />

      {/* Keep Screen Awake */}
      <KeepScreenAwake isActive={currentView === 'scanning' || currentView === 'zoom_scan'} />
    </div>
  );
}
