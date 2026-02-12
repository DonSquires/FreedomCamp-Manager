/**
 * Field Officer Portal - Mobile-First Interface Optimized for Vertical Screens
 * Includes: Scanning, Incident Creation, H&S Reporting, Vehicle Details, Offline Queue, Session Persistence
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
  ChevronRight,
  AlertCircle,
  List,
  Settings,
  ArrowLeft,
  Loader2,
  Download,
  Archive,
  LayoutDashboard,
  History as HistoryIcon,
  Menu,
  X,
  Shield,
  FileText,
  AlertTriangle,
  Fingerprint,
  RefreshCw,
  Activity,
  Wrench,
} from 'lucide-react';
import { JDSLogo } from '@/components/layout/JDSLogo';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { isOnline, getQueueStats } from '@/lib/pwa';
import { PlateCapture } from '@/components/features/PlateCapture';
import { ArrowLeftRight } from 'lucide-react';
import { SessionList, SessionScan } from '@/components/features/SessionList';
import { ScannedVehiclesList } from '@/components/features/ScannedVehiclesList';
import { MyIncidentReportsList } from '@/components/features/MyIncidentReportsList';
import { FieldInvestigationWork } from './FieldInvestigationWork';
import { VehicleEditDrawer } from '@/components/features/VehicleEditDrawer';
import { MaintenanceReportForm } from '@/components/features/MaintenanceReportForm';
import { IncidentCreationForm } from '@/components/features/IncidentCreationForm';
import { HSReportingForm } from '@/components/features/HSReportingForm';
import { VehicleDetailsView } from '@/components/features/VehicleDetailsView';
import { OfflineQueueView } from '@/components/features/OfflineQueueView';
import { NotificationPermissionDialog } from '@/components/features/NotificationPermissionDialog';
import {
  saveSession,
  loadSession,
  clearSession,
  downloadFile,
  getSessionDuration,
} from '@/lib/sessionPersistence';
import {
  exportFullSessionCSV,
  exportFullSessionJSON,
} from '@/lib/fullExport';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { UpdateNotification } from '@/components/features/UpdateNotification';
import { NotificationCenter } from '@/components/features/NotificationCenter';
import { OfficerWelfareWarningModal } from '@/components/features/OfficerWelfareWarningModal';
import { PWAInstallPrompt } from '@/components/features/PWAInstallPrompt';
import { PWAUpdateNotification } from '@/components/features/PWAUpdateNotification';
import { DarkModeToggle } from '@/components/features/DarkModeToggle';
import { isBiometricAvailable, hasBiometricCredential, registerBiometric, removeBiometricCredential } from '@/lib/biometric';
import { APP_VERSION, isUpdateAvailable } from '@/constants/version';
import { getStoredVersion, storeVersion, checkForUpdates } from '@/lib/pwa';
import { isMobile } from '@/lib/design-system';
import { pushNotificationManager } from '@/lib/pushNotifications';
import { useOfficerWelfareMonitor } from '@/hooks/useOfficerWelfareMonitor';
import { KeepScreenAwake, useAutoWakeLock } from '@/components/features/KeepScreenAwake';
import { OrganizationSelector } from '@/components/features/OrganizationSelector';

interface FieldOfficerPortalProps {
  onLogout: () => void;
}

export function FieldOfficerPortal({ onLogout }: FieldOfficerPortalProps) {
  const { user } = useAuthStore();
  const [online, setOnline] = useState(true);
  const [queuedScans, setQueuedScans] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentView, setCurrentView] = useState<'dashboard' | 'scanning' | 'history' | 'scanned_vehicles' | 'my_incidents' | 'investigations' | 'settings'>('dashboard');
  const [selectedZone, setSelectedZone] = useState<{ id: string; name: string; orgId: string } | null>(null);
  const [availableZones, setAvailableZones] = useState<{ id: string; name: string; organization_id: string }[]>([]);
  const [isLoadingZones, setIsLoadingZones] = useState(true);
  const [sessionScans, setSessionScans] = useState<SessionScan[]>([]);
  const [todayScansCount, setTodayScansCount] = useState(0);
  const [myScansCount, setMyScansCount] = useState(0); // Scans by current user only
  const [todayComplianceRate, setTodayComplianceRate] = useState(0);
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  
  // Master organization filter
  const isMasterUser = user?.role === 'master';
  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>('all');
  const [orgSelectorOrganizations, setOrgSelectorOrganizations] = useState<{ id: string; name: string }[]>([]);

  // Biometric login state
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);
  const [isEnrollingBiometric, setIsEnrollingBiometric] = useState(false);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Scanning mode state
  const [scanningMode, setScanningMode] = useState<'manual' | 'driving'>('manual');
  const [isDrivingMode, setIsDrivingMode] = useState(false);
  
  // Keep screen awake during active patrol
  const { isActive: isWakeLockActive, setIsActive: setWakeLockActive } = useAutoWakeLock(
    currentView === 'scanning'
  );

  // PWA install state
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isPWAInstallable, setIsPWAInstallable] = useState(false);
  const [isPWAInstalled, setIsPWAInstalled] = useState(false);

  // Update notification state
  const [showUpdateNotification, setShowUpdateNotification] = useState(false);

  // Notification permission dialog state
  const [showPermissionDialog, setShowPermissionDialog] = useState(false);
  const [permissionReason, setPermissionReason] = useState('');
  const [permissionResolve, setPermissionResolve] = useState<((value: boolean) => void) | null>(null);

  // Officer welfare monitoring
  const {
    warning: welfareWarning,
    isOffline: welfareOffline,
    isMonitoringPaused,
    queuedActivities,
    syncProgress,
    recordVehicleScan,
    recordGPSUpdate,
    acknowledgeWarning,
    gpsPingInterval,
  } = useOfficerWelfareMonitor();

  // Modal states
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [showHSForm, setShowHSForm] = useState(false);
  const [showVehicleDetails, setShowVehicleDetails] = useState(false);
  const [showOfflineQueue, setShowOfflineQueue] = useState(false);
  const [showEditDrawer, setShowEditDrawer] = useState(false);
  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false);
  const [selectedScan, setSelectedScan] = useState<SessionScan | null>(null);

  // Check biometric availability on mount
  useEffect(() => {
    setBiometricAvailable(isBiometricAvailable());
    if (user?.email) {
      setHasBiometric(hasBiometricCredential(user.email));
    }
  }, [user?.email]);

  // Request push notification permission on mount (for welfare monitoring)
  useEffect(() => {    if (user?.id && 'Notification' in window && Notification.permission === 'default') {
      // Request permission after a short delay to avoid overwhelming on first load
      const timer = setTimeout(() => {
        pushNotificationManager.requestPermission(
          'FreedomCamp Manager needs notification permission to alert you for welfare checks when the app is in the background.'
        ).then(granted => {
          if (granted) {
            console.log('✅ Push notifications enabled for welfare monitoring');
          } else {
            console.log('⚠️ Push notifications denied - welfare alerts may not work when app is backgrounded');
            toast.warning('Push notifications disabled - welfare alerts may not work in background');
          }
        });
      }, 3000); // 3 second delay after portal loads
      
      return () => clearTimeout(timer);
    }
  }, [user?.id]);

  // Setup PWA install prompt listener
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsPWAInstallable(true);
      console.log('✅ PWA install prompt ready');
    };

    const handleAppInstalled = () => {
      setIsPWAInstalled(true);
      setIsPWAInstallable(false);
      setDeferredPrompt(null);
      console.log('✅ PWA installed successfully');
      toast.success('App installed to home screen!');
    };

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsPWAInstalled(true);
      console.log('✅ PWA already installed');
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Setup notification permission dialog callback
  useEffect(() => {
    // Set custom permission request handler
    pushNotificationManager.setPermissionRequestCallback(async (reason: string) => {
      return new Promise<boolean>((resolve) => {
        setPermissionReason(reason);
        setPermissionResolve(() => resolve);
        setShowPermissionDialog(true);
      });
    });
  }, []);

  // Check for updates on mobile (on mount)
  useEffect(() => {
    if (isMobile()) {
      const storedVersion = getStoredVersion();
      
      if (!storedVersion) {
        // First time running, just store current version
        storeVersion(APP_VERSION);
        console.log('📱 First run - version set to:', APP_VERSION);
      } else if (isUpdateAvailable(storedVersion, APP_VERSION)) {
        // New version available
        console.log('🔄 Update available:', storedVersion, '→', APP_VERSION);
        setShowUpdateNotification(true);
      } else {
        console.log('✅ App is up to date:', APP_VERSION);
        // Check for service worker updates in background
        checkForUpdates();
      }
    }

    // Listen for service worker updates
    const handleUpdateAvailable = () => {
      console.log('🔄 Service worker update detected');
      setShowUpdateNotification(true);
    };

    window.addEventListener('app-update-available', handleUpdateAvailable);
    
    return () => {
      window.removeEventListener('app-update-available', handleUpdateAvailable);
    };
  }, []);

  // Load session on mount
  useEffect(() => {
    const savedSession = loadSession();
    if (savedSession) {
      setSessionScans(savedSession.scans);
      setTodayScansCount(savedSession.totalScans);
      setTodayComplianceRate(savedSession.complianceRate);
      console.log('✅ Restored session:', savedSession);
    }
  }, []);

  // Load today's scan count from database (all scans, retain 24h restriction)
  useEffect(() => {
    const loadTodayStats = async () => {
      if (!user?.id) return;

      try {
        const twentyFourHoursAgo = new Date();
        twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

        // Get current user's scans from last 24 hours (NEW SCHEMA: vehicle_observations_v2)
        const { count: myCount } = await supabase
          .from('vehicle_observations_v2')
          .select('*', { count: 'exact', head: true })
          .eq('recorded_by', user.id)
          .gte('recorded_at', twentyFourHoursAgo.toISOString());

        setMyScansCount(myCount || 0);
      } catch (error) {
        console.error('Failed to load today stats:', error);
      }
    };

    loadTodayStats();
    
    // Refresh every 5 minutes
    const interval = setInterval(loadTodayStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // Save session on updates
  useEffect(() => {
    if (sessionScans.length > 0) {
      saveSession(sessionScans);
    }
  }, [sessionScans]);

  // Load available zones on mount (runs once)
  useEffect(() => {
    const loadZones = async () => {
      setIsLoadingZones(true);
      try {
        console.log('🔄 Loading zones for user:', user?.id);
        
        // Query without .single() to handle potential duplicates gracefully
        const { data: profiles, error: profileError } = await supabase
          .from('user_profiles')
          .select('organization_id, role, email')
          .eq('id', user?.id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (profileError) {
          console.error('❌ Profile fetch error:', profileError);
          toast.error('Failed to load user profile: ' + profileError.message);
          return;
        }

        if (!profiles || profiles.length === 0) {
          console.error('❌ No profile found for user:', user?.id);
          toast.error('User profile not found - please contact admin');
          return;
        }

        const profile = profiles[0];
        console.log('👤 User profile:', profile);

        if (!profile.organization_id) {
          console.error('❌ No organization_id in profile:', profile);
          toast.error('User organization not found - please contact admin');
          return;
        }

        console.log('🏢 Loading zones for organization:', profile.organization_id);
        
        // Load zones with geometry for geofence detection
        const { data: zones, error } = await supabase
          .from('zones')
          .select('id, name, organization_id, geometry, location_lat, location_lng, is_active')
          .eq('organization_id', profile.organization_id)
          .eq('is_active', true)
          .order('name');

        console.log('📍 Zones query result:', { zones, error });
        
        if (error) {
          console.error('❌ Failed to load zones:', error);
          toast.error('Failed to load zones: ' + error.message);
          return;
        }

        if (!zones) {
          console.error('❌ Zones query returned null');
          toast.error('Failed to load zones - no data returned');
          return;
        }
        
        console.log('✅ Loaded zones:', zones.length, zones.map(z => z.name));

        if (zones && zones.length > 0) {
          // ✅ FIX: Don't add virtual "Other Location" - only use real zones from database
          // Virtual zones break PlateCapture because they have invalid UUIDs
          const finalZones = [...zones];
          
          setAvailableZones(finalZones);
          
          // STICKY ZONE CHECK: Check for existing sticky zone first
          const { getStickyZone } = await import('@/lib/geofence');
          const stickyZone = getStickyZone();
          
          if (stickyZone) {
            // Verify sticky zone still exists in loaded zones
            const matchingZone = finalZones.find(z => z.id === stickyZone.zoneId);
            if (matchingZone) {
              setSelectedZone({
                id: matchingZone.id,
                name: matchingZone.name,
                orgId: matchingZone.organization_id,
              });
              console.log('📌 Restored sticky zone:', matchingZone.name);
              return; // Use sticky zone, skip GPS detection
            } else {
              console.log('🧹 Sticky zone no longer valid, clearing...');
              const { clearStickyZone } = await import('@/lib/geofence');
              clearStickyZone();
            }
          }
          
          // ✅ AUTO ZONE SELECTION: Wait for GPS-based detection
          // Don't auto-select first zone here - let GPS detection handle it
          // If GPS is not available or detection fails, the GPS effect will fallback to first zone
          console.log('⏳ Waiting for GPS-based zone detection or fallback...');
        } else {
          console.warn('⚠️ No active zones found for organization:', profile.organization_id);
          console.warn('⚠️ This means either:');
          console.warn('   1. No zones have been created for this organization');
          console.warn('   2. All zones are marked as inactive');
          console.warn('   3. RLS policies are blocking access');
          toast.warning('No zones configured - please contact your admin to set up zones');
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
  }, [user?.id]); // ✅ Only runs once on mount

  // Check online status
  useEffect(() => {
    const checkOnline = () => {
      const status = isOnline();
      setOnline(status);
      
      if (!status) {
        getQueueStats().then(stats => {
          setQueuedScans(stats.total);
        });
      }
    };

    checkOnline();
    const interval = setInterval(checkOnline, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update clock
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // ✅ AUTO ZONE SELECTION: GPS-based detection with smart fallback
  useEffect(() => {
    // Only run if zones are loaded and we don't have a zone selected yet
    if (availableZones.length === 0 || selectedZone) return;

    const autoDetectZone = async () => {
      // If no GPS yet, wait for it (timeout after 5 seconds)
      if (!gpsLocation) {
        console.log('⏳ Waiting for GPS to determine zone...');
        
        // Set timeout to fallback to first zone if GPS takes too long
        const timeoutId = setTimeout(() => {
          if (!selectedZone && availableZones.length > 0) {
            setSelectedZone({
              id: availableZones[0].id,
              name: availableZones[0].name,
              orgId: availableZones[0].organization_id,
            });
            console.log('⏰ GPS timeout - using first zone as fallback:', availableZones[0].name);
          }
        }, 5000);
        
        return () => clearTimeout(timeoutId);
      }

      // GPS available - check accuracy
      if (gpsLocation.accuracy >= 100) {
        console.log('⚠️ GPS accuracy too low for zone detection:', Math.round(gpsLocation.accuracy) + 'm');
        // Fallback to first zone with poor GPS
        if (availableZones.length > 0) {
          setSelectedZone({
            id: availableZones[0].id,
            name: availableZones[0].name,
            orgId: availableZones[0].organization_id,
          });
          console.log('📍 Using first zone (poor GPS accuracy):', availableZones[0].name);
        }
        return;
      }

      // Good GPS - attempt zone detection
      const { findZoneByLocation, setStickyZone } = await import('@/lib/geofence');
      const detectedZone = findZoneByLocation(
        { lat: gpsLocation.lat, lng: gpsLocation.lng },
        availableZones
      );
      
      if (detectedZone) {
        setSelectedZone({
          id: detectedZone.id,
          name: detectedZone.name,
          orgId: detectedZone.organization_id,
        });
        setStickyZone(detectedZone);
        console.log('✅ Auto-detected zone via GPS:', detectedZone.name);
      } else {
        // Outside all geofences - use first zone as fallback
        if (availableZones.length > 0) {
          setSelectedZone({
            id: availableZones[0].id,
            name: availableZones[0].name,
            orgId: availableZones[0].organization_id,
          });
          console.log('📍 Outside all geofences - using first zone:', availableZones[0].name);
        }
      }
    };

    autoDetectZone();
  }, [availableZones.length, gpsLocation, selectedZone]);

  // ✅ BATCH 3: STREAMLINED GPS TRACKING - Single interval handles all GPS operations
  useEffect(() => {
    if (availableZones.length === 0) return; // Wait for zones to load

    let gpsInterval: any = null;

    const checkAndUpdateZone = async (latitude: number, longitude: number, accuracy: number) => {
      if (accuracy >= 100) {
        console.log('⚠️ GPS accuracy too low for zone detection:', Math.round(accuracy) + 'm');
        return;
      }

      const { verifyStickyZone, findZoneByLocation, setStickyZone, clearStickyZone, getStickyZone } = await import('@/lib/geofence');
      
      const stickyZone = getStickyZone();
      
      if (!stickyZone) {
        console.log('📍 No sticky zone - detecting current location zone...');
        const detectedZone = findZoneByLocation(
          { lat: latitude, lng: longitude },
          availableZones
        );
        
        if (detectedZone) {
          setSelectedZone(prev => {
            if (prev?.id === detectedZone.id) return prev;
            
            if (detectedZone.name !== 'Other Location') {
              setStickyZone(detectedZone);
              console.log('✅ Entered zone:', detectedZone.name);
            } else {
              clearStickyZone();
              console.log('📍 Outside all geofenced areas - set to "Other Location"');
            }
            
            return {
              id: detectedZone.id,
              name: detectedZone.name,
              orgId: detectedZone.organization_id,
            };
          });
        } else {
          const otherLocation = availableZones.find(z => z.name === 'Other Location');
          if (otherLocation) {
            setSelectedZone({
              id: otherLocation.id,
              name: otherLocation.name,
              orgId: otherLocation.organization_id,
            });
            clearStickyZone();
            console.log('📍 No zone detected - set to "Other Location"');
          }
        }
        return;
      }
      
      const isStillInZone = verifyStickyZone(
        { lat: latitude, lng: longitude },
        availableZones
      );
      
      if (!isStillInZone) {
        console.log('🚶 Officer left zone, detecting new zone...');
        
        const newZone = findZoneByLocation(
          { lat: latitude, lng: longitude },
          availableZones
        );
        
        if (newZone) {
          setSelectedZone(prev => {
            if (prev?.id === newZone.id) return prev;
            
            setStickyZone(newZone);
            console.log('✅ Zone changed:', newZone.name);
            
            return {
              id: newZone.id,
              name: newZone.name,
              orgId: newZone.organization_id,
            };
          });
        } else {
          // Officer left all geofenced zones - keep current zone (don't switch to invalid virtual zone)
          console.log('📍 Officer outside all geofences - keeping current zone');
        }
      }
    };

    const performGPSUpdate = () => {
      if (!navigator.geolocation) return;

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          console.log(`📍 GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`);
          
          if (accuracy < 100) {
            setGpsLocation({ lat: latitude, lng: longitude, accuracy });
            await checkAndUpdateZone(latitude, longitude, accuracy);
            
            // Record welfare ping
            console.log(`💓 Welfare ping recorded`);
            recordGPSUpdate(latitude, longitude, accuracy);
          } else {
            console.log(`⏭️ GPS accuracy too low: ${Math.round(accuracy)}m - skipping update`);
          }
        },
        (error) => {
          console.warn('GPS error:', error.message);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    };

    // ✅ STREAMLINED: Single interval at welfare ping rate
    // Handles: GPS update + Zone check + Welfare monitoring
    console.log(`✅ Starting streamlined GPS tracking (${gpsPingInterval}s interval)`);
    performGPSUpdate(); // Initial update
    gpsInterval = setInterval(performGPSUpdate, gpsPingInterval * 1000);

    return () => {
      if (gpsInterval) {
        clearInterval(gpsInterval);
        console.log('🔴 GPS tracking stopped');
      }
    };
  }, [recordGPSUpdate, availableZones, gpsPingInterval]);



  const handlePlateDetected = (data: any) => {
    // ✅ STAGE 1: Validate input data structure
    if (!data || typeof data !== 'object') {
      console.error('❌ STAGE 1 FAILED: Invalid data object received:', data);
      toast.error('Invalid scan data received');
      return;
    }

    // ✅ STAGE 2: Validate zone selection
    if (!selectedZone) {
      console.error('❌ STAGE 2 FAILED: No zone selected - cannot record scan');
      toast.error('Zone not selected - please select a zone before scanning');
      return;
    }

    // ✅ STAGE 3: Validate critical fields
    if (!data.plateNumber || typeof data.plateNumber !== 'string') {
      console.error('❌ STAGE 3 FAILED: Invalid or missing plate number:', data);
      toast.error('Invalid scan data - missing or invalid plate number');
      return;
    }

    // ✅ STAGE 4: Create scan object with validated data
    let newScan: SessionScan;
    try {
      newScan = {
        id: data.observationId || `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        plateNumber: String(data.plateNumber).trim().toUpperCase(),
        zoneName: String(selectedZone.name),
        zoneId: String(selectedZone.id),
        organizationId: String(selectedZone.orgId),
        timestamp: new Date(),
        isCompliant: Boolean(data.isCompliant ?? true),
        isFlagged: Boolean(data.isFlagged ?? false),
        vehicleMake: data.vehicleMake ? String(data.vehicleMake) : undefined,
        vehicleModel: data.vehicleModel ? String(data.vehicleModel) : undefined,
        vehicleColor: data.vehicleColor ? String(data.vehicleColor) : undefined,
        vehicleId: data.vehicleId || undefined,
        observationId: data.observationId || undefined,
        gpsAccuracy: data.gpsLocation?.accuracy ? Number(data.gpsLocation.accuracy) : undefined,
        priorObservationsCount: data.priorObservationsCount ? Number(data.priorObservationsCount) : undefined,
        detectionMethod: data.detectionMethod || 'unknown',
      };
    } catch (error) {
      console.error('❌ STAGE 4 FAILED: Error creating scan object:', error, data);
      toast.error('Failed to process scan data');
      return;
    }
    
    // ✅ STAGE 5: Final validation before state update
    if (!newScan || typeof newScan !== 'object' || !newScan.plateNumber || !newScan.id) {
      console.error('❌ STAGE 5 FAILED: Invalid scan object created:', newScan);
      toast.error('Failed to record scan - invalid data structure');
      return;
    }
    
    // ✅ STAGE 6: Add to state with immutable update
    try {
      setSessionScans((prev) => {
        // Ensure prev is always an array
        const validPrev = Array.isArray(prev) ? prev.filter(s => s && typeof s === 'object' && s.plateNumber) : [];
        return [newScan, ...validPrev];
      });
      console.log('✅ ALL STAGES PASSED: Scan added successfully:', newScan.plateNumber);
    } catch (error) {
      console.error('❌ STAGE 6 FAILED: Error updating state:', error);
      toast.error('Failed to save scan');
      return;
    }
    
    // Update stats
    setTodayScansCount((prev) => prev + 1);
    const compliantCount = sessionScans.filter(s => s.isCompliant).length + (newScan.isCompliant ? 1 : 0);
    const totalCount = sessionScans.length + 1;
    setTodayComplianceRate(Math.round((compliantCount / totalCount) * 100));
    
    toast.success(`Plate ${data.plateNumber} detected with ${Math.round(data.confidence * 100)}% confidence`);
    
    // Record vehicle scan activity for welfare monitoring
    recordVehicleScan();
    
    // Record GPS if available
    if (data.gpsLocation?.latitude && data.gpsLocation?.longitude) {
      recordGPSUpdate(
        data.gpsLocation.latitude,
        data.gpsLocation.longitude,
        data.gpsLocation.accuracy || 0
      );
    }
    
    // ❌ REMOVED: Automatic navigation back to dashboard
    // User must manually navigate - stay on scanning screen
  };

  const handleViewDetails = (scanId: string) => {
    const scan = sessionScans.find(s => s.id === scanId);
    if (scan && scan.vehicleId) {
      setSelectedScan(scan);
      setShowVehicleDetails(true);
    } else {
      toast.error('Vehicle details not available');
    }
  };

  const handleSelectScan = (scan: SessionScan) => {
    setSelectedScan(scan);
    setShowEditDrawer(true);
  };

  const handleUpdateScan = (updatedScan: SessionScan) => {
    setSessionScans(prev => 
      prev.map(s => s.id === updatedScan.id ? updatedScan : s)
    );
  };

  const handleCreateIncident = (scanId: string) => {
    const scan = sessionScans.find(s => s.id === scanId);
    if (scan) {
      setSelectedScan(scan);
      setShowIncidentForm(true);
    }
  };

  const handleReportHS = (scanId: string) => {
    const scan = sessionScans.find(s => s.id === scanId);
    if (scan) {
      setSelectedScan(scan);
      setShowHSForm(true);
    }
  };

  const handleExportCSV = async () => {
    try {
      toast.loading('Exporting complete data with photos...');
      const csv = await exportFullSessionCSV(sessionScans);
      const filename = `freedom_camp_export_${new Date().toISOString().split('T')[0]}_${Date.now()}.csv`;
      downloadFile(csv, filename, 'text/csv');
      toast.success(`Exported ${sessionScans.length} records with full data and photos`);
    } catch (error: any) {
      console.error('Export failed:', error);
      toast.error('Failed to export session: ' + error.message);
    }
  };

  const handleExportJSON = async () => {
    try {
      toast.loading('Exporting complete data with photos...');
      const json = await exportFullSessionJSON(sessionScans);
      const filename = `freedom_camp_export_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
      downloadFile(json, filename, 'application/json');
      toast.success(`Exported ${sessionScans.length} records with full data and photos`);
    } catch (error: any) {
      console.error('Export failed:', error);
      toast.error('Failed to export session: ' + error.message);
    }
  };

  const handleClearSession = () => {
    if (!confirm('Clear session history? This will remove all scans from the list.')) {
      return;
    }
    clearSession();
    setSessionScans([]);
    setTodayScansCount(0);
    setTodayComplianceRate(0);
    toast.success('Session cleared');
  };

  // Render main content based on view
  const renderMainContent = () => {
    if (currentView === 'scanning' && selectedZone) {
      // FULL SCREEN SCANNING - No split screen
      return (
        <div className="fixed inset-0 bg-background">
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

    if (currentView === 'history') {
      return (
        <div className="space-y-4 pb-20">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <HistoryIcon className="h-5 w-5" />
                Session History ({sessionScans.length} scans)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sessionScans.length > 0 ? (
                <>
                  <SessionList
                    scans={sessionScans}
                    onViewDetails={handleViewDetails}
                    onCreateIncident={handleCreateIncident}
                    onReportHS={handleReportHS}
                    onDeleteScan={(scanId) => {
                      setSessionScans(prev => prev.filter(s => s.id !== scanId));
                    }}
                  />
                  <div className="mt-6 grid grid-cols-3 gap-3">
                    <Button
                      variant="outline"
                      onClick={handleExportCSV}
                      className="h-16 flex flex-col items-center justify-center gap-1.5 touch-manipulation"
                    >
                      <Download className="h-5 w-5" />
                      <span className="text-xs font-medium">CSV</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleExportJSON}
                      className="h-16 flex flex-col items-center justify-center gap-1.5 touch-manipulation"
                    >
                      <Download className="h-5 w-5" />
                      <span className="text-xs font-medium">JSON</span>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleClearSession}
                      className="h-16 flex flex-col items-center justify-center gap-1.5 text-red-500 touch-manipulation"
                    >
                      <Archive className="h-5 w-5" />
                      <span className="text-xs font-medium">Clear</span>
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-16 text-muted-foreground">
                  <HistoryIcon className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p className="text-base">No scans in this session yet</p>
                  <p className="text-sm mt-2">Start scanning to build your session history</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    if (currentView === 'scanned_vehicles') {
      return (
        <div className="space-y-4 pb-20">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <List className="h-5 w-5" />
                Scanned Vehicles ({sessionScans.length} active)
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-2">
                📱 Records available for 24 hours from scan time
              </p>
            </CardHeader>
            <CardContent>
              {sessionScans.length > 0 ? (
                <ScannedVehiclesList
                  scans={sessionScans}
                  onSelectScan={handleSelectScan}
                  selectedScanId={selectedScan?.id}
                />
              ) : (
                <div className="text-center py-16 text-muted-foreground">
                  <List className="h-16 w-16 mx-auto mb-4 opacity-20" />
                  <p className="text-base">No scanned vehicles</p>
                  <p className="text-sm mt-2">Scanned vehicles appear here for 24 hours</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    if (currentView === 'my_incidents') {
      return (
        <div className="space-y-4 pb-20">
          <MyIncidentReportsList />
        </div>
      );
    }

    if (currentView === 'investigations') {
      return (
        <div className="space-y-4 pb-20">
          <FieldInvestigationWork />
        </div>
      );
    }

    if (currentView === 'settings') {
      return (
        <div className="space-y-4 pb-20">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Dark Mode Toggle */}
              <DarkModeToggle variant="full" />

              {/* Biometric Login Management */}
              {biometricAvailable && (
                <div className="space-y-3 pt-4 border-t">
                  <h3 className="font-semibold text-base text-foreground">Biometric Login</h3>
                  <p className="text-sm text-muted-foreground">
                    🔐 Use fingerprint or Face ID for faster, more secure login
                  </p>
                  
                  {hasBiometric ? (
                    <div className="space-y-3">
                      <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                        <div className="flex items-start gap-3">
                          <Fingerprint className="h-5 w-5 text-green-600 mt-0.5" />
                          <div>
                            <p className="text-sm font-semibold text-green-900 dark:text-green-100">
                              Biometric Login Enabled
                            </p>
                            <p className="text-xs text-green-700 dark:text-green-200 mt-1">
                              You can now use your fingerprint or Face ID to log in
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      <Button
                        variant="destructive"
                        className="w-full h-12 touch-manipulation"
                        onClick={async () => {
                          if (!user?.email) return;
                          try {
                            removeBiometricCredential(user.email);
                            setHasBiometric(false);
                            toast.success('Biometric login disabled');
                          } catch (error: any) {
                            toast.error('Failed to disable biometric login');
                          }
                        }}
                      >
                        Disable Biometric Login
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="p-4 bg-muted rounded-lg border">
                        <p className="text-sm text-muted-foreground">
                          Biometric login is not set up. Enable it for faster and more secure access.
                        </p>
                      </div>
                      
                      <Button
                        className="w-full h-12 bg-primary hover:bg-primary/90 touch-manipulation"
                        disabled={isEnrollingBiometric}
                        onClick={async () => {
                          if (!user?.email || !user?.first_name) return;
                          setIsEnrollingBiometric(true);
                          try {
                            const credential = await registerBiometric(
                              user.email,
                              `${user.first_name} ${user.last_name || ''}`
                            );
                            if (credential) {
                              setHasBiometric(true);
                              toast.success('✅ Biometric login enabled!');
                            } else {
                              toast.error('Failed to enable biometric login');
                            }
                          } catch (error: any) {
                            toast.error(error.message || 'Failed to enable biometric login');
                          } finally {
                            setIsEnrollingBiometric(false);
                          }
                        }}
                      >
                        {isEnrollingBiometric ? (
                          <>
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                            Setting up...
                          </>
                        ) : (
                          <>
                            <Fingerprint className="h-5 w-5 mr-2" />
                            Enable Biometric Login
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* PWA Installation Section */}
              <div className="space-y-3 pt-4 border-t">
                <h3 className="font-semibold text-base">Mobile App Installation</h3>
                <p className="text-sm text-muted-foreground">
                  Install this app on your device's home screen for faster access and offline functionality.
                </p>
                
                {isPWAInstalled ? (
                  <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                    <div className="flex items-start gap-3">
                      <Shield className="h-5 w-5 text-green-600 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-green-900 dark:text-green-100">
                          App Installed
                        </p>
                        <p className="text-xs text-green-700 dark:text-green-200 mt-1">
                          This app is installed on your home screen. Version {APP_VERSION}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : isPWAInstallable ? (
                  <Button
                    onClick={async () => {
                      if (!deferredPrompt) {
                        toast.error('Installation prompt not available');
                        return;
                      }

                      try {
                        // Show the install prompt
                        deferredPrompt.prompt();
                        
                        // Wait for the user's response
                        const { outcome } = await deferredPrompt.userChoice;
                        
                        if (outcome === 'accepted') {
                          console.log('✅ User accepted the install prompt');
                          toast.success('Installing app...');
                        } else {
                          console.log('❌ User dismissed the install prompt');
                          toast.info('Installation cancelled');
                        }
                        
                        // Clear the prompt
                        setDeferredPrompt(null);
                        setIsPWAInstallable(false);
                      } catch (error) {
                        console.error('Install prompt error:', error);
                        toast.error('Failed to show install prompt');
                      }
                    }}
                    className="w-full h-16 text-base font-bold bg-primary hover:bg-primary/90 touch-manipulation"
                  >
                    <Download className="h-5 w-5 mr-2" />
                    Install App to Home Screen
                  </Button>
                ) : (
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground">
                          Installation Not Available
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          This app may already be installed, or your browser doesn't support installation.
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          For iOS Safari: Tap Share → Add to Home Screen
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* App Information */}
              <div className="space-y-3 pt-4 border-t">
                <h3 className="font-semibold text-base">App Information</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Version:</span>
                    <span className="font-mono font-semibold">{APP_VERSION}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant="outline" className="bg-white dark:bg-gray-900">
                      {isPWAInstalled ? 'Installed' : 'Web App'}
                    </Badge>
                  </div>
                </div>
                
                {/* Check for Updates Button */}
                <Button
                  className="w-full h-12 mt-3 touch-manipulation"
                  variant="outline"
                  onClick={async () => {
                    toast.loading('Checking for updates...');
                    
                    try {
                      // Check for service worker updates
                      const updateAvailable = await checkForUpdates();
                      
                      if (updateAvailable) {
                        toast.success('Update available! Refreshing app...');
                        setTimeout(() => {
                          window.location.reload();
                        }, 1000);
                      } else {
                        toast.success(`You're running the latest version (${APP_VERSION})`);
                      }
                    } catch (error: any) {
                      console.error('Update check failed:', error);
                      toast.error('Failed to check for updates');
                    }
                  }}
                >
                  <RefreshCw className="h-5 w-5 mr-2" />
                  Check for Updates
                </Button>
              </div>

              {/* User Information */}
              <div className="space-y-3 pt-4 border-t">
                <h3 className="font-semibold text-base">User Information</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-semibold">{user?.first_name} {user?.last_name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Email:</span>
                    <span className="font-mono text-xs">{user?.email}</span>
                  </div>
                  <div className="flex items-center justify-between">
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

    // Dashboard view (default) - Optimized for vertical mobile
    return (
      <div className="space-y-5 pb-20">
        {/* Offline Queue Alert */}
        {!online && queuedScans > 0 && (
          <Card
            className="border-amber-500 bg-amber-50 dark:bg-amber-950/20 cursor-pointer active:scale-[0.98] transition-transform"
            onClick={() => setShowOfflineQueue(true)}
          >
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-6 w-6 text-amber-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-amber-900 dark:text-amber-100">
                    Offline Mode
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-200 mt-1">
                    {queuedScans} scan{queuedScans !== 1 ? 's' : ''} queued for sync
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-300 mt-2">
                    Tap to view and retry
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Welfare Monitoring Status (Offline) */}
        {isMonitoringPaused && (
          <Card className="border-2 border-blue-500/50 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950 dark:to-cyan-950">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <Shield className="h-6 w-6 text-blue-600 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-blue-900 dark:text-blue-100">
                    Welfare Monitoring Paused
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-200 mt-1">
                    Server-side welfare checks paused while offline
                  </p>
                  {queuedActivities > 0 && (
                    <p className="text-xs text-blue-600 dark:text-blue-300 mt-2">
                      📦 {queuedActivities} GPS update{queuedActivities !== 1 ? 's' : ''} queued for sync
                    </p>
                  )}
                  <p className="text-xs text-blue-600 dark:text-blue-300 mt-2">
                    ✅ Monitoring will resume automatically when connection returns
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Batch Sync Progress Indicator */}
        {syncProgress.total > 0 && (
          <Card className="border-2 border-green-500/50 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <Loader2 className="h-6 w-6 text-green-600 mt-0.5 shrink-0 animate-spin" />
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-green-900 dark:text-green-100">
                    Syncing Offline Activities
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-200 mt-1">
                    {syncProgress.current} of {syncProgress.total} activities synced
                  </p>
                  <div className="w-full bg-green-200 dark:bg-green-800 rounded-full h-2 mt-2">
                    <div 
                      className="bg-green-600 dark:bg-green-400 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* User Info Card - Mobile Optimized */}
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span className="text-xl font-bold text-primary">
                  {user?.first_name?.[0]}{user?.last_name?.[0]}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-base truncate">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="text-sm text-muted-foreground capitalize">
                  {user?.role?.replace('_', ' ')} Officer
                </p>
              </div>
              <Badge variant="outline" className="bg-white dark:bg-gray-900 shrink-0">
                Active
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Primary Action: Start Scanning - Larger for mobile */}
        <Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl flex items-center gap-2">
              <Camera className="h-6 w-6 text-green-600" />
              Vehicle Scanning
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-base text-muted-foreground leading-relaxed">
              Scan vehicle plates with AI recognition and real-time compliance checking
            </p>
            
            <Button
              onClick={() => {
                if (!selectedZone) {
                  toast.error('No zone selected - please wait for zones to load');
                  return;
                }
                setCurrentView('scanning');
              }}
              disabled={isLoadingZones || !selectedZone}
              className="w-full h-20 text-xl font-bold bg-green-600 hover:bg-green-700 disabled:opacity-50 touch-manipulation active:scale-[0.98] transition-transform"
              size="lg"
            >
              {isLoadingZones ? (
                <>
                  <Loader2 className="h-7 w-7 mr-3 animate-spin" />
                  Loading Zones...
                </>
              ) : (
                <>
                  <Camera className="h-7 w-7 mr-3" />
                  Start Scanning
                  <ChevronRight className="h-7 w-7 ml-3" />
                </>
              )}
            </Button>

            {/* Zone Selector - Larger touch target with better contrast */}
            {!isLoadingZones && availableZones.length > 0 ? (
              <div className="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg border-2 border-gray-300 dark:border-gray-600">
                <label className="text-sm font-bold text-gray-900 dark:text-white mb-2 block">
                  Current Zone:
                </label>
                <select
                  value={selectedZone?.id || ''}
                  onChange={(e) => {
                    const zone = availableZones.find(z => z.id === e.target.value);
                    if (zone) {
                      setSelectedZone({
                        id: zone.id,
                        name: zone.name,
                        orgId: zone.organization_id,
                      });
                    }
                  }}
                  className="w-full p-3 rounded-lg border-2 border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-900 text-base font-bold text-gray-900 dark:text-white touch-manipulation focus:border-green-600 focus:ring-2 focus:ring-green-600"
                >
                  {availableZones.map(zone => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : !isLoadingZones && availableZones.length === 0 ? (
              <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border-2 border-amber-300 dark:border-amber-600">
                <p className="text-sm text-amber-900 dark:text-amber-100 font-semibold">
                  ⚠️ No zones available
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-200 mt-1">
                  Please contact your admin to set up zones for your organization
                </p>
              </div>
            ) : null}

            {/* Quick Stats - Larger for mobile */}
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="p-4 bg-white/70 dark:bg-gray-900/70 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Today's Scans</p>
                <p className="text-3xl font-black text-green-700">{myScansCount}</p>
                <p className="text-xs text-muted-foreground mt-1">Vehicles</p>
              </div>
              <div className="p-4 bg-white/70 dark:bg-gray-900/70 rounded-lg text-center">
                <p className="text-xs text-muted-foreground mb-1">Compliance</p>
                <p className="text-3xl font-black text-green-700">{todayComplianceRate}%</p>
                <p className="text-xs text-muted-foreground mt-1">Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Export Actions - Prominent */}
        {sessionScans.length > 0 && (
          <Card className="border-2 border-green-500/30 bg-green-50/50 dark:bg-green-950/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-green-900 dark:text-green-100">
                <Download className="h-5 w-5" />
                📥 Export Session Data
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={handleExportCSV}
                  variant="outline"
                  className="h-16 flex flex-col items-center justify-center gap-1.5 bg-white dark:bg-gray-900 hover:bg-green-50 hover:border-green-500 touch-manipulation"
                >
                  <Download className="h-6 w-6 text-green-600" />
                  <span className="text-sm font-bold">CSV Export</span>
                  <span className="text-xs text-muted-foreground">{sessionScans.length} scans</span>
                </Button>
                <Button
                  onClick={handleExportJSON}
                  variant="outline"
                  className="h-16 flex flex-col items-center justify-center gap-1.5 bg-white dark:bg-gray-900 hover:bg-green-50 hover:border-green-500 touch-manipulation"
                >
                  <Download className="h-6 w-6 text-blue-600" />
                  <span className="text-sm font-bold">JSON Export</span>
                  <span className="text-xs text-muted-foreground">Full data</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Session List */}
        {sessionScans.length > 0 && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <HistoryIcon className="h-5 w-5" />
                    Recent Scans
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentView('history')}
                    className="touch-manipulation"
                  >
                    View All
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SessionList
                  scans={sessionScans.slice(0, 3)}
                  onViewDetails={handleViewDetails}
                  onCreateIncident={handleCreateIncident}
                  onReportHS={handleReportHS}
                  onDeleteScan={(scanId) => {
                    setSessionScans(prev => prev.filter(s => s.id !== scanId));
                  }}
                />
              </CardContent>
            </Card>

            {/* Session Summary - Better mobile spacing */}
            <Card className="border-blue-500/30 bg-blue-50 dark:bg-blue-950/20">
              <CardContent className="p-5">
                <p className="text-sm text-blue-900 dark:text-blue-100 leading-relaxed">
                  📊 <strong>Session:</strong> {getSessionDuration()} min • {sessionScans.length} scans • {sessionScans.filter(s => s.isFlagged).length} flagged • {Array.from(new Set(sessionScans.map(s => s.zoneName))).length} zones
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-72 flex flex-col border-r bg-card
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Sidebar Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <JDSLogo size="sm" />
              <h1 className="text-xl font-bold">Field Patrol</h1>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden touch-manipulation"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="mt-3">
            <p className="text-sm text-muted-foreground truncate">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-xs text-muted-foreground capitalize">
              {user?.role} Officer
            </p>
          </div>
          
          {/* Portal Switcher - Only visible for admins */}
          {(user?.role === 'admin' || user?.role === 'master') && (
            <div className="mt-4">
              <Button
                variant="outline"
                className="w-full justify-start h-10 text-sm bg-primary/10 hover:bg-primary/20 border-primary/30 touch-manipulation"
                onClick={() => {
                  const { setPreferredPortal } = useAuthStore.getState();
                  setPreferredPortal('admin');
                  window.location.reload();
                }}
              >
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Switch to Admin Portal
              </Button>
            </div>
          )}
        </div>

        {/* Navigation - Larger touch targets */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <Button
            variant={currentView === 'dashboard' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base touch-manipulation"
            onClick={() => {
              setCurrentView('dashboard');
              setSidebarOpen(false);
            }}
          >
            <LayoutDashboard className="h-5 w-5 mr-3" />
            Dashboard
          </Button>
          
          {currentView === 'scanning' && (
            <div className="px-3 py-2">
              <KeepScreenAwake 
                isActive={isWakeLockActive}
                onToggle={setWakeLockActive}
              />
            </div>
          )}

          <Button
            variant={currentView === 'scanning' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base touch-manipulation"
            onClick={() => {
              if (!selectedZone) {
                toast.error('No zone selected - please wait for zones to load');
                return;
              }
              setCurrentView('scanning');
              setSidebarOpen(false);
            }}
            disabled={isLoadingZones || !selectedZone}
          >
            <Camera className="h-5 w-5 mr-3" />
            Scan Vehicle
          </Button>

          <Button
            variant={currentView === 'history' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base touch-manipulation"
            onClick={() => {
              setCurrentView('history');
              setSidebarOpen(false);
            }}
          >
            <HistoryIcon className="h-5 w-5 mr-3" />
            Session History
            {sessionScans.length > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {sessionScans.length}
              </Badge>
            )}
          </Button>

          <Button
            variant={currentView === 'scanned_vehicles' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base touch-manipulation"
            onClick={() => {
              setCurrentView('scanned_vehicles');
              setSidebarOpen(false);
            }}
          >
            <List className="h-5 w-5 mr-3" />
            Scanned Vehicles
            {sessionScans.length > 0 && (
              <Badge variant="secondary" className="ml-auto">
                {sessionScans.length}
              </Badge>
            )}
          </Button>

          <Button
            variant={currentView === 'my_incidents' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base touch-manipulation"
            onClick={() => {
              setCurrentView('my_incidents');
              setSidebarOpen(false);
            }}
          >
            <AlertTriangle className="h-5 w-5 mr-3" />
            My Incidents
          </Button>

          {/* Standalone Report Creation */}
          <div className="pt-4 border-t mt-4">
            <p className="px-3 text-xs font-semibold text-muted-foreground mb-2">Create Reports</p>
            
            <Button
              variant="ghost"
              className="w-full justify-start h-12 text-base touch-manipulation"
              onClick={() => {
                // Create temporary scan for standalone report
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
                  isSelfContained: false,
                  isHomeless: false,
                  hasHSIssue: false,
                  requiresFollowup: false,
                };
                setSelectedScan(tempScan);
                setShowIncidentForm(true);
                setSidebarOpen(false);
              }}
            >
              <FileText className="h-5 w-5 mr-3" />
              New Incident
            </Button>

            <Button
              variant="ghost"
              className="w-full justify-start h-12 text-base touch-manipulation"
              onClick={() => {
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
                  isSelfContained: false,
                  isHomeless: false,
                  hasHSIssue: false,
                  requiresFollowup: false,
                };
                setSelectedScan(tempScan);
                setShowHSForm(true);
                setSidebarOpen(false);
              }}
            >
              <Activity className="h-5 w-5 mr-3" />
              New H&S Report
            </Button>

            <Button
              variant="ghost"
              className="w-full justify-start h-12 text-base touch-manipulation"
              onClick={() => {
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
                  isSelfContained: false,
                  isHomeless: false,
                  hasHSIssue: false,
                  requiresFollowup: false,
                };
                setSelectedScan(tempScan);
                setShowMaintenanceForm(true);
                setSidebarOpen(false);
              }}
            >
              <Wrench className="h-5 w-5 mr-3" />
              New Maintenance
            </Button>
          </div>

          <Button
            variant={currentView === 'investigations' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base touch-manipulation"
            onClick={() => {
              setCurrentView('investigations');
              setSidebarOpen(false);
            }}
          >
            <FileText className="h-5 w-5 mr-3" />
            Investigation Jobs
          </Button>

          <Button
            variant={currentView === 'settings' ? 'default' : 'ghost'}
            className="w-full justify-start h-12 text-base touch-manipulation"
            onClick={() => {
              setCurrentView('settings');
              setSidebarOpen(false);
            }}
          >
            <Settings className="h-5 w-5 mr-3" />
            Settings
          </Button>

          {/* Install App Widget Option */}
          {!isPWAInstalled && isPWAInstallable && (
            <Button
              variant="ghost"
              className="w-full justify-start h-12 text-base bg-primary/10 hover:bg-primary/20 text-primary hover:text-primary touch-manipulation"
              onClick={async () => {
                setSidebarOpen(false);
                if (!deferredPrompt) {
                  toast.error('Installation prompt not available');
                  return;
                }

                try {
                  // Show the install prompt
                  deferredPrompt.prompt();
                  
                  // Wait for the user's response
                  const { outcome } = await deferredPrompt.userChoice;
                  
                  if (outcome === 'accepted') {
                    console.log('✅ User accepted the install prompt');
                    toast.success('Installing app...');
                  } else {
                    console.log('❌ User dismissed the install prompt');
                    toast.info('Installation cancelled');
                  }
                  
                  // Clear the prompt
                  setDeferredPrompt(null);
                  setIsPWAInstallable(false);
                } catch (error) {
                  console.error('Install prompt error:', error);
                  toast.error('Failed to show install prompt');
                }
              }}
            >
              <Download className="h-5 w-5 mr-3" />
              Install App Widget
            </Button>
          )}

          <Button
            variant="ghost"
            className="w-full justify-start h-12 text-base touch-manipulation"
            onClick={() => {
              setShowOfflineQueue(true);
              setSidebarOpen(false);
            }}
          >
            <List className="h-5 w-5 mr-3" />
            Offline Queue
            {queuedScans > 0 && (
              <Badge variant="destructive" className="ml-auto">
                {queuedScans}
              </Badge>
            )}
          </Button>

          {/* Status Indicators - Better mobile spacing */}
          <div className="pt-6 border-t mt-6">
            <div className="px-3 py-2 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status:</span>
                <div className="flex items-center gap-2">
                  {online ? (
                    <>
                      <Wifi className="h-4 w-4 text-green-500" />
                      <span className="text-green-600 font-medium">Online</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-4 w-4 text-amber-500" />
                      <span className="text-amber-600 font-medium">Offline</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Time:</span>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span className="font-medium">
                    {currentTime.toLocaleTimeString('en-NZ', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Pacific/Auckland',
                    })}
                  </span>
                </div>
              </div>
              {selectedZone && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Zone:</span>
                  <span className="font-medium text-primary truncate text-right" title={selectedZone.name}>
                    {selectedZone.name}
                  </span>
                </div>
              )}
            </div>
          </div>
        </nav>

        {/* Logout Button - Larger for mobile */}
        <div className="p-4 border-t">
          <Button
            variant="ghost"
            className="w-full justify-start h-12 text-base text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 touch-manipulation"
            onClick={onLogout}
          >
            <LogOut className="h-5 w-5 mr-3" />
            Logout
          </Button>
        </div>
      </div>

      {/* Main Content - Split Screen Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Side: Main Content Area */}
        <div className="flex-1 overflow-y-auto">
        {/* Mobile Header with Menu Toggle */}
        <div className="sticky top-0 z-30 lg:hidden bg-background/95 backdrop-blur-sm border-b">
          <div className="flex items-center justify-between p-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="h-10 w-10 touch-manipulation"
            >
              <Menu className="h-6 w-6" />
            </Button>
            <h1 className="text-lg font-bold">Field Patrol</h1>
            <NotificationCenter />
          </div>
        </div>

        {/* Desktop Header with Notification Center */}
        <div className="hidden lg:flex sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b items-center justify-between p-4">
          <h1 className="text-2xl font-bold">Field Patrol</h1>
          <NotificationCenter />
        </div>

        {/* Content Area - Optimized padding for mobile */}
        <div className="p-4 md:p-6 max-w-2xl mx-auto">
          {renderMainContent()}
        </div>
      </div>

      {/* Right Side: Scanned Vehicles List - Hidden on mobile, visible on desktop, hidden in settings */}
      {currentView !== 'settings' && (
        <div className="hidden lg:block w-96 border-l bg-muted/30 overflow-hidden">
          <ScannedVehiclesList
            scans={sessionScans}
            onSelectScan={handleSelectScan}
            selectedScanId={selectedScan?.id}
          />
        </div>
      )}
    </div>

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
          }}
        />
      )}

      {showVehicleDetails && selectedScan && (
        <VehicleDetailsView
          scan={selectedScan}
          onClose={() => {
            setShowVehicleDetails(false);
            setSelectedScan(null);
          }}
        />
      )}

      {showOfflineQueue && (
        <OfflineQueueView
          onClose={() => setShowOfflineQueue(false)}
        />
      )}

      {/* Edit Drawer */}
      {showEditDrawer && selectedScan && (
        <VehicleEditDrawer
          scan={selectedScan}
          onClose={() => {
            setShowEditDrawer(false);
            setSelectedScan(null);
          }}
          onUpdate={handleUpdateScan}
          onCreateIncident={() => {
            console.log('🔄 Opening Incident form for scan:', selectedScan.plateNumber);
            setShowIncidentForm(true);
            setShowEditDrawer(false);
          }}
          onCreateHSReport={() => {
            console.log('🔄 Opening H&S form for scan:', selectedScan.plateNumber);
            setShowHSForm(true);
            setShowEditDrawer(false);
          }}
          onCreateMaintenanceReport={() => {
            console.log('🔄 Opening Maintenance form for scan:', selectedScan.plateNumber);
            setShowMaintenanceForm(true);
            setShowEditDrawer(false);
          }}
        />
      )}

      {/* Maintenance Report Form */}
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
            toast.success('Maintenance report created successfully');
          }}
        />
      )}

      {/* Notification Permission Dialog */}
      <NotificationPermissionDialog
        open={showPermissionDialog}
        reason={permissionReason}
        onAllow={() => {
          setShowPermissionDialog(false);
          if (permissionResolve) {
            permissionResolve(true);
          }
        }}
        onDeny={() => {
          setShowPermissionDialog(false);
          if (permissionResolve) {
            permissionResolve(false);
          }
        }}
      />

      {/* Update Notification - Mobile Only */}
      {showUpdateNotification && isMobile() && (
        <UpdateNotification
          onDismiss={() => {
            setShowUpdateNotification(false);
            // Update stored version to prevent showing again
            storeVersion(APP_VERSION);
          }}
        />
      )}

      {/* Officer Welfare Warning Modal */}
      <OfficerWelfareWarningModal
        warning={welfareWarning}
        isOffline={welfareOffline}
        isMonitoringPaused={isMonitoringPaused}
        onAcknowledge={acknowledgeWarning}
      />

      {/* PWA Install Prompt - Shows on mobile when not installed */}
      <PWAInstallPrompt />

      {/* PWA Update Notification - Shows when new version available */}
      <PWAUpdateNotification />
    </div>
  );
}
