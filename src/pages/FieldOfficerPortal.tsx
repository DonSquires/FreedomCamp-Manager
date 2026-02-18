/**
 * Field Officer Portal - Streamlined Professional Mobile Interface
 * Rebuilt for optimal field operations with clean workflow
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
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
  RefreshCw,
  Edit,
  Trash2,
  CheckCircle2,
  Flag,
  Home,
  Maximize,
  Minimize,
  ArrowLeft,
  ArrowRight,
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
import { PlateScanner } from '@/components/features/PlateScanner';
import { OfficerWelfareWarningModal } from '@/components/features/OfficerWelfareWarningModal';
import { DarkModeToggle } from '@/components/features/DarkModeToggle';
import { NetworkStatusBar } from '@/components/features/NetworkStatusBar';
import { KeepScreenAwake } from '@/components/features/KeepScreenAwake';
import { UpdateManager } from '@/components/features/UpdateManager';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useOfficerWelfareMonitor } from '@/hooks/useOfficerWelfareMonitor';
import { useGlobalLocationTracking } from '@/hooks/useGlobalLocationTracking';
import { cn } from '@/lib/utils';

interface FieldOfficerPortalProps {
  onLogout: () => void;
}

type ViewMode = 'dashboard' | 'scanning' | 'zoom_scan' | 'plate_scanner' | 'reports' | 'history' | 'settings';

export function FieldOfficerPortal({ onLogout }: FieldOfficerPortalProps) {
  const { user } = useAuthStore();
  const [online, setOnline] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Zone state
  const [selectedZone, setSelectedZone] = useState<{ id: string; name: string; orgId: string; enforcementWorkflow?: string } | null>(null);
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
  const [patrols, setPatrols] = useState<any[]>([]);
  
  // Enforcement state
  const [enforcementActions, setEnforcementActions] = useState<any[]>([]);
  
  // Session scans
  const [sessionScans, setSessionScans] = useState<SessionScan[]>([]);
  const [sessionScansLoading, setSessionScansLoading] = useState(true);
  
  // Modal states
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [showHSForm, setShowHSForm] = useState(false);
  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false);
  const [showEditDrawer, setShowEditDrawer] = useState(false);
  const [selectedScan, setSelectedScan] = useState<SessionScan | null>(null);
  const [showReportsMenu, setShowReportsMenu] = useState(false);
  
  // Full-screen scan detail modal
  const [showScanDetail, setShowScanDetail] = useState(false);
  const [scanToDelete, setScanToDelete] = useState<SessionScan | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Update check state
  const [triggerUpdateCheck, setTriggerUpdateCheck] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  
  // GPS location
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  
  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Navigation history
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  
  // Officer welfare monitoring
  const {
    warning: welfareWarning,
    isOffline: welfareOffline,
    recordVehicleScan,
    recordGPSUpdate,
    acknowledgeWarning,
  } = useOfficerWelfareMonitor();

  // ✅ Global GPS Location Tracking (LEGAL COMPLIANCE)
  const {
    currentLocation,
    currentZone: autoDetectedZone,
    isTracking,
    setIsTracking,
    gpsError,
    updateActivity,
  } = useGlobalLocationTracking(
    user?.id || null,
    user?.organization_id || null
  );

  // ✅ AUTO-UPDATE SELECTED ZONE when GPS geofence detection changes
  useEffect(() => {
    if (!autoDetectedZone) {
      // GPS shows we're outside all geofences - set to "Other Location" zone
      const loadOtherLocationZone = async () => {
        if (!user?.organization_id) return;
        
        try {
          // Check if "Other Location" zone exists
          const { data: otherZone } = await supabase
            .from('zones')
            .select('id, name, organization_id, enforcement_workflow:organizations(enforcement_workflow)')
            .eq('organization_id', user.organization_id)
            .eq('zone_type', 'fallback')
            .ilike('name', '%Other Location%')
            .single();
          
          if (otherZone) {
            setSelectedZone({
              id: otherZone.id,
              name: otherZone.name,
              orgId: otherZone.organization_id,
              enforcementWorkflow: (otherZone.enforcement_workflow as any)?.enforcement_workflow || 'admin_first',
            });
            console.log('📍 Auto-set zone to: Other Location (outside geofences)');
          }
        } catch (error) {
          console.warn('⚠️ Could not load Other Location zone:', error);
        }
      };
      
      loadOtherLocationZone();
    } else {
      // GPS detected a specific zone - auto-update selected zone
      const loadZoneDetails = async () => {
        try {
          const { data: zone } = await supabase
            .from('zones')
            .select('id, name, organization_id, enforcement_workflow:organizations(enforcement_workflow)')
            .eq('id', autoDetectedZone.id)
            .single();
          
          if (zone) {
            setSelectedZone({
              id: zone.id,
              name: zone.name,
              orgId: zone.organization_id,
              enforcementWorkflow: (zone.enforcement_workflow as any)?.enforcement_workflow || 'admin_first',
            });
            console.log('📍 Auto-set zone to:', zone.name, '(GPS geofence detected)');
            toast.info(`Zone updated: ${zone.name}`);
          }
        } catch (error) {
          console.warn('⚠️ Could not load zone details:', error);
        }
      };
      
      loadZoneDetails();
    }
  }, [autoDetectedZone, user?.organization_id]);

  // Auto-enter fullscreen on mount and restore preference
  useEffect(() => {
    const enterFullscreen = async () => {
      try {
        // Check if fullscreen preference is enabled
        const fullscreenPref = localStorage.getItem('field_officer_fullscreen');
        if (fullscreenPref !== 'false') {
          // Default to true if not set
          if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
            setIsFullscreen(true);
            localStorage.setItem('field_officer_fullscreen', 'true');
          }
        } else {
          setIsFullscreen(false);
        }
      } catch (error) {
        console.warn('Fullscreen not supported or denied:', error);
      }
    };

    enterFullscreen();

    // Listen for fullscreen changes
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);
      localStorage.setItem('field_officer_fullscreen', isNowFullscreen ? 'true' : 'false');
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.warn('Fullscreen toggle failed:', error);
      toast.error('Fullscreen not supported on this device');
    }
  };

  // Navigation handlers
  const handleGoBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    }
  };

  const handleGoForward = () => {
    window.history.forward();
  };

  // Monitor navigation state
  useEffect(() => {
    const updateNavState = () => {
      setCanGoBack(window.history.length > 1);
      setCanGoForward(false); // Browser doesn't expose forward history length
    };

    updateNavState();
    window.addEventListener('popstate', updateNavState);
    return () => window.removeEventListener('popstate', updateNavState);
  }, []);

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
          
          // Fetch organization enforcement workflow
          const { data: orgData } = await supabase
            .from('organizations')
            .select('enforcement_workflow')
            .eq('id', profile.organization_id)
            .single();
          
          setSelectedZone({
            id: zones[0].id,
            name: zones[0].name,
            orgId: zones[0].organization_id,
            enforcementWorkflow: orgData?.enforcement_workflow || 'admin_first',
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

  // Sync global GPS tracking with local state
  useEffect(() => {
    if (currentLocation) {
      setGpsLocation({
        lat: currentLocation.latitude,
        lng: currentLocation.longitude,
        accuracy: currentLocation.accuracy || 10,
      });
    }
  }, [currentLocation]);

  // ✅ UPDATE activity when user changes views
  useEffect(() => {
    if (!user?.id) return;

    const zoneId = selectedZone?.id || autoDetectedZone?.id;

    if (currentView === 'scanning' || currentView === 'zoom_scan') {
      updateActivity({
        type: 'scanning',
        details: `Active ${currentView === 'zoom_scan' ? 'zoom ' : ''}scanning`,
        zone_id: zoneId,
      });
    } else if (currentView === 'reports') {
      updateActivity({
        type: 'reporting',
        details: 'Reviewing reports',
        zone_id: zoneId,
      });
    } else if (currentView === 'history') {
      updateActivity({
        type: 'administrative',
        details: 'Viewing scan history',
        zone_id: zoneId,
      });
    } else {
      updateActivity({
        type: 'idle',
        details: 'Dashboard view',
        zone_id: zoneId,
      });
    }
  }, [currentView, selectedZone, autoDetectedZone, user?.id, updateActivity]);

  // Load session scans on mount
  useEffect(() => {
    const loadSessionScans = async () => {
      if (!user?.id) return;
      
      setSessionScansLoading(true);
      try {
        // Load last 24h scans from database
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
        
        const { data, error } = await supabase
          .from('vehicle_observations_v2')
          .select(`
            observation_id,
            plate_number,
            vehicle_make,
            vehicle_model,
            vehicle_color,
            recorded_at,
            is_compliant,
            is_breach,
            has_homeless_claim,
            zones(id, name, organization_id)
          `)
          .eq('recorded_by', user.id)
          .gte('recorded_at', twentyFourHoursAgo.toISOString())
          .order('recorded_at', { ascending: false });
        
        if (error) throw error;
        
        const scans: SessionScan[] = (data || []).map(obs => ({
          id: obs.observation_id,
          plateNumber: obs.plate_number,
          zoneName: (obs.zones as any)?.name || 'Unknown',
          zoneId: (obs.zones as any)?.id || '',
          organizationId: (obs.zones as any)?.organization_id || '',
          timestamp: new Date(obs.recorded_at),
          isCompliant: obs.is_compliant,
          isFlagged: obs.is_breach,
          vehicleMake: obs.vehicle_make,
          vehicleModel: obs.vehicle_model,
          vehicleColor: obs.vehicle_color,
          observationId: obs.observation_id,
          detectionMethod: 'alpr',
          isSelfContained: false,
          isHomeless: obs.has_homeless_claim,
          hasHSIssue: false,
          requiresFollowup: false,
        }));
        
        setSessionScans(scans);
        console.log(`✅ Loaded ${scans.length} session scans from database`);
      } catch (error: any) {
        console.error('Failed to load session scans:', error);
        toast.error('Failed to load scan history');
      } finally {
        setSessionScansLoading(false);
      }
    };
    
    loadSessionScans();
    
    // Reload every 30 seconds
    const interval = setInterval(loadSessionScans, 30000);
    return () => clearInterval(interval);
  }, [user?.id]);

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

  // Load patrols
  useEffect(() => {
    const loadPatrols = async () => {
      if (!user?.id) return;

      try {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await supabase
          .from('patrols')
          .select('*, zones(name)')
          .eq('assigned_to', user.id)
          .gte('patrol_date', today)
          .order('patrol_date', { ascending: true })
          .limit(5);

        setPatrols(data || []);
        
        // Set current patrol for selected zone
        const zonePatrol = data?.find(p => p.zone_id === selectedZone?.id && p.patrol_date === today);
        setCurrentPatrol(zonePatrol || null);
      } catch (error) {
        console.error('Failed to load patrols:', error);
      }
    };

    loadPatrols();
    const interval = setInterval(loadPatrols, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.id, selectedZone?.id]);
  
  // Load enforcement actions
  useEffect(() => {
    const loadEnforcement = async () => {
      if (!user?.id) return;

      try {
        const { data } = await supabase
          .from('enforcement_actions')
          .select('*, zones(name)')
          .eq('assigned_to', user.id)
          .in('status', ['pending', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(5);

        setEnforcementActions(data || []);
      } catch (error) {
        console.error('Failed to load enforcement actions:', error);
      }
    };

    loadEnforcement();
    const interval = setInterval(loadEnforcement, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.id]);

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
    
    // Reload scans list to show the new scan
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const canEditDelete = (scan: SessionScan) => {
    const hoursSinceScan = (Date.now() - new Date(scan.timestamp).getTime()) / (1000 * 60 * 60);
    return hoursSinceScan < 24;
  };

  const getHoursRemaining = (scan: SessionScan) => {
    const hoursSinceScan = (Date.now() - new Date(scan.timestamp).getTime()) / (1000 * 60 * 60);
    return Math.max(0, 24 - hoursSinceScan);
  };

  const handleDeleteScan = async () => {
    if (!scanToDelete?.observationId) return;
    
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('vehicle_observations_v2')
        .delete()
        .eq('observation_id', scanToDelete.observationId);
      
      if (error) throw error;
      
      setSessionScans(prev => prev.filter(s => s.id !== scanToDelete.id));
      toast.success('Scan deleted successfully');
      setShowDeleteConfirm(false);
      setScanToDelete(null);
      setShowScanDetail(false);
      setSelectedScan(null);
    } catch (error: any) {
      console.error('Failed to delete scan:', error);
      toast.error('Failed to delete scan: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
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
            enforcementWorkflow={selectedZone.enforcementWorkflow || 'admin_first'}
            onCancel={() => setCurrentView('dashboard')}
          />
        </div>
      );
    }

    if (currentView === 'plate_scanner') {
      return (
        <div className="fixed inset-0 bg-background z-50">
          <PlateScanner onExit={() => setCurrentView('dashboard')} />
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
                  {sessionScans.map(scan => {
                    const editable = canEditDelete(scan);
                    const hoursLeft = getHoursRemaining(scan);
                    
                    return (
                      <div
                        key={scan.id}
                        onClick={() => {
                          setSelectedScan(scan);
                          setShowScanDetail(true);
                        }}
                        className={cn(
                          "p-4 border-2 rounded-lg cursor-pointer transition-all hover:shadow-md",
                          scan.isFlagged && "border-red-500 bg-red-50 dark:bg-red-950/20",
                          !scan.isFlagged && !scan.isCompliant && "border-amber-500 bg-amber-50 dark:bg-amber-950/20",
                          !scan.isFlagged && scan.isCompliant && scan.isHomeless && "border-cyan-500 bg-cyan-50 dark:bg-cyan-950/20",
                          !scan.isFlagged && scan.isCompliant && !scan.isHomeless && "border-green-500 bg-green-50 dark:bg-green-950/20"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="shrink-0 mt-1">
                            {scan.isFlagged ? (
                              <Flag className="h-5 w-5 text-red-600" />
                            ) : !scan.isCompliant ? (
                              <AlertCircle className="h-5 w-5 text-amber-600" />
                            ) : scan.isHomeless ? (
                              <Home className="h-5 w-5 text-cyan-600" />
                            ) : (
                              <CheckCircle2 className="h-5 w-5 text-green-600" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="font-mono text-xl font-black">{scan.plateNumber}</p>
                                {scan.vehicleMake && (
                                  <p className="text-sm text-muted-foreground">
                                    {scan.vehicleColor} {scan.vehicleMake} {scan.vehicleModel}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                {scan.isFlagged ? (
                                  <Badge variant="destructive" className="text-xs">🚩 Flagged</Badge>
                                ) : !scan.isCompliant ? (
                                  <Badge className="bg-amber-500 text-xs">⚠️ Breach</Badge>
                                ) : scan.isHomeless ? (
                                  <Badge className="bg-cyan-500 text-xs">🏕️ Homeless</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-green-600 text-xs">✓ OK</Badge>
                                )}
                                {editable && hoursLeft > 0 && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    ⏱️ {Math.floor(hoursLeft)}h left
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                              {scan.zoneName} • {new Date(scan.timestamp).toLocaleString('en-NZ', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
              
              {/* Check for Updates */}
              {/* Fullscreen Toggle */}
              <div className="pt-4 border-t">
                <h3 className="font-semibold mb-3">Display Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {isFullscreen ? (
                        <Minimize className="h-5 w-5 text-primary" />
                      ) : (
                        <Maximize className="h-5 w-5 text-muted-foreground" />
                      )}
                      <div>
                        <p className="font-medium">Fullscreen Mode</p>
                        <p className="text-xs text-muted-foreground">
                          {isFullscreen ? 'App in fullscreen' : 'Exit for normal view'}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant={isFullscreen ? "default" : "outline"}
                      size="sm"
                      onClick={toggleFullscreen}
                    >
                      {isFullscreen ? 'Exit' : 'Enter'}
                    </Button>
                  </div>
                </div>
              </div>
              
              <div className="pt-4 border-t">
                <h3 className="font-semibold mb-3">App Updates</h3>
                <Button
                  onClick={() => {
                    setIsCheckingUpdates(true);
                    setTriggerUpdateCheck(true);
                  }}
                  disabled={isCheckingUpdates}
                  className="w-full h-14 text-base"
                  variant="outline"
                >
                  {isCheckingUpdates ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-3 animate-spin" />
                      Checking for Updates...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-5 w-5 mr-3" />
                      Check for Updates
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Current version: v{(() => {
                    try {
                      const { APP_VERSION } = require('@/constants/version');
                      return APP_VERSION;
                    } catch {
                      return 'Unknown';
                    }
                  })()}
                </p>
              </div>
              
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

              <div className="space-y-2">
                <Button
                  onClick={() => {
                    setCurrentView('dashboard');
                    // Open FieldInvestigationWork component
                    window.location.hash = 'investigations';
                  }}
                  className="w-full h-14 text-base font-bold bg-purple-600 hover:bg-purple-700"
                >
                  <FileText className="h-5 w-5 mr-2" />
                  Open Jobs
                  <ChevronRight className="h-5 w-5 ml-2" />
                </Button>

                {/* Admin View Button - Only for admin_officer role */}
                {user?.role === 'admin_officer' && (
                  <Button
                    onClick={() => {
                      window.location.href = '/admin?tab=investigation-jobs';
                    }}
                    variant="outline"
                    className="w-full h-12 text-sm"
                  >
                    <Shield className="h-4 w-4 mr-2" />
                    View in Admin Portal
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Patrols Section */}
        <Card className="border-2 border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-blue-900 dark:text-blue-100">
              <Calendar className="h-5 w-5" />
              My Patrols
            </CardTitle>
          </CardHeader>
          <CardContent>
            {patrols.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-semibold">No Patrols Assigned</p>
                <p className="text-xs mt-1">You don't have any upcoming patrols</p>
              </div>
            ) : (
              <div className="space-y-3">
                {patrols.slice(0, 3).map((patrol) => (
                  <div
                    key={patrol.id}
                    className="p-3 bg-white dark:bg-gray-900 rounded-lg border-2 border-blue-200 dark:border-blue-700"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-bold text-sm">{patrol.zones?.name || 'Unknown Zone'}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(patrol.patrol_date).toLocaleDateString('en-NZ', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                          })} • {patrol.shift}
                        </p>
                      </div>
                      <Badge variant={patrol.checked_in_at ? 'default' : 'secondary'} className="text-xs">
                        {patrol.checked_in_at ? '✓ Checked In' : 'Scheduled'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Enforcement Actions Section */}
        <Card className="border-2 border-red-500/30 bg-red-50/50 dark:bg-red-950/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-red-900 dark:text-red-100">
              <Shield className="h-5 w-5" />
              Enforcement Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {enforcementActions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Shield className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-semibold">No Enforcement Jobs</p>
                <p className="text-xs mt-1">You don't have any pending enforcement actions</p>
              </div>
            ) : (
              <div className="space-y-3">
                {enforcementActions.slice(0, 3).map((action) => (
                  <div
                    key={action.id}
                    className="p-3 bg-white dark:bg-gray-900 rounded-lg border-2 border-red-200 dark:border-red-700"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-bold text-sm">{action.plate_number || 'Vehicle'}</p>
                        <p className="text-xs text-muted-foreground">
                          {action.zones?.name} • {action.action_type?.replace('_', ' ')}
                        </p>
                      </div>
                      <Badge variant="destructive" className="text-xs">
                        {action.status}
                      </Badge>
                    </div>
                  </div>
                ))}

                {/* Admin View Button - Only for admin_officer role */}
                {user?.role === 'admin_officer' && (
                  <Button
                    onClick={() => {
                      window.location.href = '/admin?tab=enforcement-hub';
                    }}
                    variant="outline"
                    className="w-full h-12 text-sm mt-2"
                  >
                    <Shield className="h-4 w-4 mr-2" />
                    Manage All in Admin Portal
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

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
            Zoom Scan (Old)
          </Button>

          <Button
            variant={currentView === 'plate_scanner' ? 'default' : 'ghost'}
            className={cn(
              "w-full justify-start h-12 text-base font-bold",
              currentView === 'plate_scanner' && "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
            )}
            onClick={() => {
              setCurrentView('plate_scanner');
              setSidebarOpen(false);
            }}
          >
            <Camera className="h-5 w-5 mr-3" />
            Plate Scanner 🆕
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
        {currentView !== 'scanning' && currentView !== 'zoom_scan' && (
          <>
            {/* Mobile Header */}
            <div className="border-b bg-background/95 backdrop-blur-sm">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
                    <Menu className="h-6 w-6" />
                  </Button>
                  {/* Navigation Buttons */}
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={handleGoBack}
                    disabled={!canGoBack}
                    className="h-9 w-9"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={handleGoForward}
                    className="h-9 w-9"
                  >
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </div>
                <h1 className="text-lg font-bold">Field Portal</h1>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={toggleFullscreen}
                  className="h-9 w-9"
                >
                  {isFullscreen ? (
                    <Minimize className="h-5 w-5" />
                  ) : (
                    <Maximize className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Content Area - Full screen for dashboard */}
        <div className={cn(
          "flex-1 overflow-y-auto",
          currentView === 'dashboard' ? "p-4 w-full" : "p-4 max-w-2xl mx-auto w-full"
        )}>
          {renderContent()}
        </div>

        {/* Bottom Navigation - 5 TABS */}
        {currentView !== 'scanning' && currentView !== 'zoom_scan' && (
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
              variant={currentView === 'plate_scanner' ? 'default' : 'ghost'}
              className={cn(
                "h-16 flex flex-col items-center justify-center gap-1",
                currentView === 'plate_scanner' && "bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
              )}
              onClick={() => setCurrentView('plate_scanner')}
            >
              <Camera className="h-5 w-5" />
              <span className="text-xs font-bold">Scanner</span>
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
        )}
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
      
      {/* Update Manager - Manual Check */}
      {triggerUpdateCheck && (
        <UpdateManager
          manualCheck={true}
          onManualCheckComplete={() => {
            setTriggerUpdateCheck(false);
            setIsCheckingUpdates(false);
          }}
        />
      )}
      
      {/* Full-Screen Scan Detail Modal */}
      <Dialog open={showScanDetail} onOpenChange={setShowScanDetail}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-2xl">
              {selectedScan?.isFlagged ? (
                <><Flag className="h-7 w-7 text-red-600" />Flagged Vehicle</>
              ) : !selectedScan?.isCompliant ? (
                <><AlertCircle className="h-7 w-7 text-amber-600" />Non-Compliant Vehicle</>
              ) : selectedScan?.isHomeless ? (
                <><Home className="h-7 w-7 text-cyan-600" />Homeless Vehicle</>
              ) : (
                <><CheckCircle2 className="h-7 w-7 text-green-600" />Compliant Vehicle</>
              )}
            </DialogTitle>
            <DialogDescription>
              Complete scan details and edit options
            </DialogDescription>
          </DialogHeader>

          {selectedScan && (
            <div className="space-y-4">
              {/* Vehicle Information */}
              <div className={cn(
                "p-4 rounded-lg border-2",
                selectedScan.isFlagged && "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700",
                !selectedScan.isFlagged && !selectedScan.isCompliant && "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700",
                !selectedScan.isFlagged && selectedScan.isCompliant && selectedScan.isHomeless && "bg-cyan-50 dark:bg-cyan-950/30 border-cyan-300 dark:border-cyan-700",
                !selectedScan.isFlagged && selectedScan.isCompliant && !selectedScan.isHomeless && "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700"
              )}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-mono text-2xl font-black">{selectedScan.plateNumber}</h3>
                  {selectedScan.isFlagged ? (
                    <Badge variant="destructive">🚩 Flagged</Badge>
                  ) : !selectedScan.isCompliant ? (
                    <Badge className="bg-amber-500">⚠️ Breach</Badge>
                  ) : selectedScan.isHomeless ? (
                    <Badge className="bg-cyan-500">🏕️ Homeless (FC Exempt)</Badge>
                  ) : (
                    <Badge variant="outline" className="text-green-600">✓ Compliant</Badge>
                  )}
                </div>
                
                {selectedScan.vehicleMake && (
                  <p className="text-sm mb-3">
                    <strong>Vehicle:</strong> {selectedScan.vehicleColor} {selectedScan.vehicleMake} {selectedScan.vehicleModel}
                  </p>
                )}

                <div className="bg-white dark:bg-gray-900 p-3 rounded border">
                  <p className="text-sm"><strong>Zone:</strong> {selectedScan.zoneName}</p>
                  <p className="text-sm mt-1">
                    <strong>Scanned:</strong> {new Date(selectedScan.timestamp).toLocaleString('en-NZ', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Pacific/Auckland',
                    })}
                  </p>
                  {selectedScan.detectionMethod && (
                    <p className="text-sm mt-1">
                      <strong>Method:</strong> {selectedScan.detectionMethod === 'alpr' ? 'ALPR Recognition' : 'Manual Entry'}
                    </p>
                  )}
                </div>
              </div>

              {/* Edit Window Timer */}
              {canEditDelete(selectedScan) ? (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-300 dark:border-blue-700">
                  <div className="flex items-center gap-2 text-sm text-blue-900 dark:text-blue-100">
                    <Clock className="h-4 w-4" />
                    <span>
                      <strong>{Math.floor(getHoursRemaining(selectedScan))} hours remaining</strong> to edit or delete this scan
                    </span>
                  </div>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1 ml-6">
                    Field officers can modify their scans within 24 hours of creation
                  </p>
                </div>
              ) : (
                <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-600">
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <Shield className="h-4 w-4" />
                    <span>
                      <strong>Edit window expired</strong> - This scan is now locked for data integrity
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 ml-6">
                    Scans older than 24 hours cannot be modified
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {selectedScan && canEditDelete(selectedScan) ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowScanDetail(false);
                    setShowEditDrawer(true);
                  }}
                  className="flex-1"
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Details
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setShowScanDetail(false);
                    setScanToDelete(selectedScan);
                    setShowDeleteConfirm(true);
                  }}
                  className="flex-1"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Scan
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setShowScanDetail(false)}
                className="w-full"
              >
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scan?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this scan? This action cannot be undone.
              <br /><br />
              <strong>Plate:</strong> {scanToDelete?.plateNumber}
              <br />
              <strong>Zone:</strong> {scanToDelete?.zoneName}
              <br />
              <strong>Time:</strong> {scanToDelete && new Date(scanToDelete.timestamp).toLocaleString('en-NZ')}
              <br /><br />
              <em className="text-xs text-muted-foreground">
                Note: Deletion will be logged for audit purposes.
              </em>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setScanToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteScan}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Scan
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
