/**
 * PlateCapture Component - Unified plate scanning interface
 * Supports camera capture (mobile) and manual entry (desktop/fallback)
 * 
 * Camera Access Implementation Following Web Standards:
 * 1. Request permission via getUserMedia (user gesture required)
 * 2. Enumerate devices after permission granted
 * 3. Validate deviceId before using in constraints
 * 4. Graceful fallback if specific camera fails
 * 5. HTTPS/secure context enforcement
 */

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Slider } from '@/components/ui/slider';
import {
  Camera,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  FileText,
  X,
  ZoomIn,
  ZoomOut,
  Zap,
  ZapOff,
  Video,
  Trash2,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { isMobile } from '@/lib/design-system';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useNotifications, type Notification } from '@/hooks/useNotifications';
import { NotificationCenter } from './NotificationCenter';
import { VehicleEditDrawer } from './VehicleEditDrawer';
import { VehicleDetailsPopup } from './VehicleDetailsPopup';
import { SessionScan } from './SessionList';
import { playSounds } from '@/lib/sounds';
import { cn } from '@/lib/utils';
import { CameraPermissionHelp } from './PlateCapturePermissionHelp';
import { AlertAcknowledgementModal } from './AlertAcknowledgementModal';
import { DuplicateScanModal } from './DuplicateScanModal';
import { DrivingModeToggle } from './DrivingModeToggle';
import { ScanFeedbackBubble, type BubbleType } from './ScanFeedbackBubble';
import { ManualEntryModal, type ManualEntryData } from './ManualEntryModal';
import { ComplianceResultModal } from './ComplianceResultModal';

interface PlateCaptureProps {
  zoneId: string;
  zoneName: string;
  organizationId: string;
  onPlateDetected: (data: PlateDetectionResult) => void;
  onCancel?: () => void;
}

interface PlateDetectionResult {
  plateNumber: string;
  confidence: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicleYear?: string;
  croppedImageUrl: string | null;
  fullImageUrl: string | null;
  gpsLocation: { lat: number; lng: number; accuracy: number } | null;
  detectionMethod: 'alpr' | 'ocr' | 'manual';
  isSelfContained?: boolean;
  hasGreenSticker?: boolean;
  hasBlueSticker?: boolean;
  officerNotes?: string; // Metadata notes (manual entry, file upload indicators)
  // Enriched from vehicle-ingest
  vehicleId?: string;
  observationId?: string;
  isCompliant?: boolean;
  isFlagged?: boolean;
  priorObservationsCount?: number;
}

export function PlateCapture({
  zoneId,
  zoneName,
  organizationId,
  onPlateDetected,
  onCancel,
}: PlateCaptureProps) {
  // Validate required props
  useEffect(() => {
    if (!zoneId || !organizationId) {
      console.error('Missing required props', {
        zoneId: !!zoneId,
        organizationId: !!organizationId,
      });
      toast.error('Configuration error: Missing zone or organization ID');
    } else {
      console.log('PlateCapture initialized:', {
        zoneId,
        zoneName,
        organizationId,
      });
    }
  }, [zoneId, organizationId, zoneName]);

  const [mode, setMode] = useState<'camera' | 'manual'>(isMobile() ? 'camera' : 'manual');
  const [drivingMode, setDrivingMode] = useState(false);
  const [drivingScanCount, setDrivingScanCount] = useState(0);
  // Handheld sub-modes: 'continuous' (auto-add to history) or 'collect_details' (popup before adding)
  // DEFAULT TO DETAILS MODE for better workflow control
  const [handheldMode, setHandheldMode] = useState<'continuous' | 'collect_details'>('collect_details');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInitializingCamera, setIsInitializingCamera] = useState(false);
  const [processingMethod, setProcessingMethod] = useState<'alpr' | 'ocr' | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isBackgroundProcessing, setIsBackgroundProcessing] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<Array<{
    id: string;
    image: string;
    timestamp: number;
    status: 'processing' | 'complete' | 'error';
    plateNumber?: string;
  }>>([]);
  const [manualPlate, setManualPlate] = useState('');
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'acquiring' | 'good' | 'fair' | 'poor'>('acquiring');
  const [zoom, setZoom] = useState<number>(() => {
    const saved = localStorage.getItem('camera-zoom-level');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(() => {
    // Load saved camera from localStorage
    return localStorage.getItem('preferred-camera-id') || '';
  });
  const [showCameraSelector, setShowCameraSelector] = useState(false);
  const [autoFocusEnabled, setAutoFocusEnabled] = useState(true);
  const [focusIndicator, setFocusIndicator] = useState<{ x: number; y: number } | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [showVehicleDrawer, setShowVehicleDrawer] = useState(false);
  const [currentNotificationIndex, setCurrentNotificationIndex] = useState(0);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState(false);
  
  // Alert acknowledgement state
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [currentAlert, setCurrentAlert] = useState<{
    type: 'flagged_vehicle' | 'hs_issue' | 'breach_alert' | 'homeless_confirmed';
    vehicleId?: string;
    plateNumber: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleColor?: string;
    photoUrl?: string;
    message: string;
    details?: string;
  } | null>(null);
  
  // Duplicate scan state
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  
  // Button feedback state
  const [buttonFeedback, setButtonFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const [lastErrorMessage, setLastErrorMessage] = useState<string>('');
  const [currentDuplicate, setCurrentDuplicate] = useState<{
    plateNumber: string;
    vehicleId?: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleColor?: string;
    photoUrl?: string;
    observationId: string;
    duplicateInfo: {
      recordedBy: string;
      recordedByName: string;
      recordedAt: string;
      zoneName: string;
      isSameOfficer: boolean;
    };
  } | null>(null);
  
  // Swipe-to-dismiss state
  const [swipeState, setSwipeState] = useState<{
    notificationId: string | null;
    startX: number;
    currentX: number;
    isDragging: boolean;
  }>({
    notificationId: null,
    startX: 0,
    currentX: 0,
    isDragging: false,
  });
  
  // Vehicle Details Popup State (for driving mode)
  const [showVehiclePopup, setShowVehiclePopup] = useState(false);
  const [waitForDetailsBeforeNext, setWaitForDetailsBeforeNext] = useState(false);
  const [currentVehicleDetails, setCurrentVehicleDetails] = useState<PlateDetectionResult | null>(null);
  
  // Compliance Result Modal State (shows after Check button)
  const [showComplianceModal, setShowComplianceModal] = useState(false);
  const [complianceResult, setComplianceResult] = useState<{
    isCompliant: boolean;
    isBreach: boolean;
    isAtRisk: boolean;
    alerts: string[];
    plateNumber: string;
    vehicleDetails?: PlateDetectionResult;
  } | null>(null);
  
  // Workflow lock state - blocks camera when popup is active
  const [isWorkflowLocked, setIsWorkflowLocked] = useState(false);
  
  // Scan feedback bubble state
  const [showFeedbackBubble, setShowFeedbackBubble] = useState(false);
  const [feedbackType, setFeedbackType] = useState<BubbleType>('success');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  
  // Manual entry modal state (auto-triggered when detection fails)
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);
  const [failedDetectionData, setFailedDetectionData] = useState<{
    image: string;
    photoUrl: string;
    gpsLocation: { lat: number; lng: number; accuracy: number } | null;
  } | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Track vehicles currently being analyzed by AI to prevent duplicate calls
  const analyzingVehicles = useRef<Set<string>>(new Set());
  
  const { checkPlateNotifications, notifications, markAsRead } = useNotifications();

  // Show notifications panel when new notifications arrive
  useEffect(() => {
    if (notifications.length > 0) {
      setShowNotifications(true);
    }
  }, [notifications.length]);

  // Initialize GPS tracking
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGpsStatus('poor');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = position.coords.accuracy;
        setGpsLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy,
        });

        if (accuracy <= 10) {
          setGpsStatus('good');
        } else if (accuracy <= 20) {
          setGpsStatus('fair');
        } else {
          setGpsStatus('poor');
        }
      },
      (error) => {
        console.error('GPS error:', error);
        setGpsStatus('poor');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // STEP 1 & 2: Request camera permission and enumerate devices (following guidance)
  // This runs ONCE on mount when in camera mode
  useEffect(() => {
    const requestPermissionAndEnumerateDevices = async () => {
      setIsInitializingCamera(true);
      try {
        console.log('Step 1: Requesting camera permission...');
        
        // Step A: Request permission with basic constraints (user gesture required)
        // This will trigger browser's permission prompt
        const permissionStream = await navigator.mediaDevices.getUserMedia({ 
          video: true // Request access to ANY camera first
        });
        
        console.log('Camera permission granted');
        
        // Stop the test stream immediately - we just needed permission
        permissionStream.getTracks().forEach(track => track.stop());
        
        console.log('Step 2: Enumerating available cameras...');
        
        // Step B: Now enumerate devices (labels will be available after permission)
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === 'videoinput');
        
        console.log(`Found ${cameras.length} cameras:`, cameras.map(c => c.label || 'Unnamed'));
        
        if (cameras.length === 0) {
          toast.error('No cameras found on this device');
          setCameraPermissionDenied(true);
          return;
        }
        
        setAvailableCameras(cameras);
        
        // Step C: Validate and set camera selection
        if (selectedCameraId) {
          // Validate saved camera still exists
          const exists = cameras.some(cam => cam.deviceId === selectedCameraId);
          if (!exists) {
            console.warn('Saved camera no longer available, selecting new default');
            const newCameraId = cameras[0].deviceId;
            setSelectedCameraId(newCameraId);
            localStorage.setItem('preferred-camera-id', newCameraId);
          }
        } else {
          // No saved camera - smart default selection
          const backCamera = cameras.find(cam => 
            cam.label.toLowerCase().includes('back') || 
            cam.label.toLowerCase().includes('rear') ||
            cam.label.toLowerCase().includes('environment')
          );
          const defaultCameraId = backCamera?.deviceId || cameras[0].deviceId;
          console.log('Default camera selected:', cameras.find(c => c.deviceId === defaultCameraId)?.label);
          setSelectedCameraId(defaultCameraId);
          localStorage.setItem('preferred-camera-id', defaultCameraId);
        }
        
      } catch (error: any) {
        console.error('Camera initialization failed:', error);
        
        // Handle specific error types
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          console.error('Permission denied by user');
          setCameraPermissionDenied(true);
          toast.error('Camera permission denied. Please grant access to use camera scanning.');
        } else if (error.name === 'NotFoundError') {
          console.error('No camera found');
          toast.error('No camera found on this device');
          setCameraPermissionDenied(true);
        } else if (error.name === 'NotReadableError') {
          console.error('Camera already in use');
          toast.error('Camera is already in use. Please close other apps using the camera.');
        } else {
          console.error('Unknown camera error:', error.message);
          toast.error('Failed to access camera: ' + error.message);
        }
      } finally {
        setIsInitializingCamera(false);
      }
    };

    // Only request on mount when in camera mode
    if (mode === 'camera') {
      requestPermissionAndEnumerateDevices();
    }
  }, []); // Run once on mount

  // Initialize camera for mobile
  useEffect(() => {
    if (mode === 'camera' && availableCameras.length > 0) {
      initializeCamera();
    }

    return () => {
      stopCamera();
    };
  }, [mode, selectedCameraId, availableCameras.length]);

  // ❌ REMOVED: Continuous monitoring approach didn't work for exposure control
  // New approach: Apply settings ONCE with very aggressive anti-washout constraints

  // Driving mode auto-capture
  useEffect(() => {
    if (!drivingMode || mode !== 'camera' || !videoRef.current) {
      return;
    }

    console.log('🚗 Starting driving mode auto-capture (5 second interval)');
    
    const interval = setInterval(() => {
      if (!isBackgroundProcessing) {
        capturePhoto();
      }
    }, 5000); // Auto-capture every 5 seconds
    
    return () => {
      clearInterval(interval);
      console.log('🚗 Driving mode auto-capture stopped');
    };
  }, [drivingMode, mode, isBackgroundProcessing]);

  const requestCameraPermission = async () => {
    try {
      console.log('Requesting camera permission (user action)...');
      setCameraPermissionDenied(false);
      setIsInitializingCamera(true);
      
      // Step 1: Request permission with basic constraints
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      console.log('Permission granted');
      
      // Stop the test stream
      stream.getTracks().forEach(track => track.stop());
      
      // Step 2: Enumerate devices now that we have permission
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      
      console.log(`Found ${cameras.length} cameras after permission grant`);
      
      if (cameras.length === 0) {
        toast.error('No cameras found on this device');
        setCameraPermissionDenied(true);
        return;
      }
      
      setAvailableCameras(cameras);
      
      // Step 3: Select default camera if none selected
      if (!selectedCameraId || !cameras.some(c => c.deviceId === selectedCameraId)) {
        const backCamera = cameras.find(cam => 
          cam.label.toLowerCase().includes('back') || 
          cam.label.toLowerCase().includes('rear') ||
          cam.label.toLowerCase().includes('environment')
        );
        const defaultCameraId = backCamera?.deviceId || cameras[0].deviceId;
        setSelectedCameraId(defaultCameraId);
        localStorage.setItem('preferred-camera-id', defaultCameraId);
      }
      
      // Step 4: Initialize camera with selected device
      await initializeCamera();
      toast.success('✅ Camera ready!');
      
    } catch (error: any) {
      console.error('Permission request failed:', error);
      
      // Enhanced error messages with retry guidance
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraPermissionDenied(true);
        toast.error('❌ Camera permission denied. Check browser settings and try again.', {
          duration: 5000,
          action: {
            label: 'Retry',
            onClick: () => requestCameraPermission(),
          },
        });
      } else if (error.name === 'NotFoundError') {
        setCameraPermissionDenied(true);
        toast.error('❌ No camera found. Please connect a camera and try again.');
      } else if (error.name === 'NotReadableError') {
        toast.error('❌ Camera in use by another app. Close other apps and try again.', {
          duration: 5000,
          action: {
            label: 'Retry',
            onClick: () => requestCameraPermission(),
          },
        });
      } else {
        toast.error('❌ Camera error: ' + error.message, {
          duration: 5000,
          action: {
            label: 'Retry',
            onClick: () => requestCameraPermission(),
          },
        });
      }
    } finally {
      setIsInitializingCamera(false);
    }
  };

  // STEP 3: Initialize camera with validated deviceId and fallback strategy
  const initializeCamera = async () => {
    try {
      console.log('Initializing camera with deviceId:', selectedCameraId);
      
      // Validate deviceId before using it (Step 3: Common Pitfalls)
      if (selectedCameraId && availableCameras.length > 0) {
        const deviceExists = availableCameras.some(cam => cam.deviceId === selectedCameraId);
        if (!deviceExists) {
          console.warn('Selected deviceId no longer exists, falling back to default');
          const fallbackId = availableCameras[0]?.deviceId;
          if (fallbackId) {
            setSelectedCameraId(fallbackId);
            localStorage.setItem('preferred-camera-id', fallbackId);
          }
        }
      }
      
      // Build constraints with fallback strategy
      let constraints: MediaStreamConstraints;
      
      if (selectedCameraId) {
        // Try specific device first
        constraints = {
          video: {
            deviceId: { exact: selectedCameraId },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            focusMode: 'continuous',
            whiteBalanceMode: 'continuous',
            exposureMode: 'continuous',
          } as any,
        };
      } else {
        // Fallback to default camera
        constraints = {
          video: {
            facingMode: 'environment', // Prefer back camera
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
          },
        };
      }

      console.log('Requesting stream with constraints:', constraints);
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log('Camera stream obtained');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        // Apply advanced camera settings
        await applyAdvancedSettings();
        
        // Apply zoom if supported
        applyZoom(zoom);
        
        // Apply flash if supported
        applyFlash(flashEnabled);
        
        toast.success('Camera ready');
      }
    } catch (error: any) {
      console.error('Camera initialization failed:', error);
      
      // Specific error handling with fallback strategy
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        console.error('Permission denied');
        setCameraPermissionDenied(true);
        toast.error('Camera permission denied');
      } else if (error.name === 'NotFoundError') {
        console.error('Camera not found');
        toast.error('No camera found on this device');
      } else if (error.name === 'NotReadableError') {
        console.error('Camera already in use');
        toast.error('Camera is already in use. Please close other apps using the camera.');
      } else if (error.name === 'OverconstrainedError') {
        console.error('Camera constraints too strict, falling back to default');
        
        // Fallback: Try again with minimal constraints
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
          });
          
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            streamRef.current = fallbackStream;
            toast.warning('Using default camera (device-specific camera unavailable)');
          }
        } catch (fallbackError: any) {
          console.error('Fallback camera also failed:', fallbackError);
          toast.error('Failed to start any camera');
        }
      } else {
        console.error('Unknown camera error:', error.message);
        toast.error('Camera error: ' + error.message);
      }
      
      // Don't automatically switch to manual mode - let user decide
    }
  };

  const applyZoom = async (zoomLevel: number) => {
    if (!streamRef.current) return;
    
    const track = streamRef.current.getVideoTracks()[0];
    const capabilities = track.getCapabilities();
    
    if ('zoom' in capabilities) {
      try {
        await track.applyConstraints({
          advanced: [{ zoom: zoomLevel }]
        });
      } catch (error) {
        console.warn('Zoom not supported:', error);
      }
    }
  };

  const applyFlash = async (enabled: boolean) => {
    if (!streamRef.current) return;
    
    const track = streamRef.current.getVideoTracks()[0];
    const capabilities = track.getCapabilities();
    
    if ('torch' in capabilities) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: enabled }]
        });
      } catch (error) {
        console.warn('Flash/torch not supported:', error);
      }
    }
  };

  const applyAdvancedSettings = async () => {
    if (!streamRef.current) return;
    
    const track = streamRef.current.getVideoTracks()[0];
    const capabilities = track.getCapabilities() as any;
    
    console.log('📷 Camera capabilities:', capabilities);
    
    try {
      // ✅ FACTORY DEFAULT SETTINGS - Let camera auto-adjust
      // Using continuous auto-focus and auto-white-balance for best results
      
      const constraints: any = {};
      const advanced: any[] = [];
      
      // 1. Continuous auto-focus for sharp plates
      if ('focusMode' in capabilities && capabilities.focusMode?.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
        console.log('✅ Continuous auto-focus enabled');
      }
      
      // 2. Continuous auto-exposure for varying light conditions
      if ('exposureMode' in capabilities && capabilities.exposureMode?.includes('continuous')) {
        advanced.push({ exposureMode: 'continuous' });
        console.log('✅ Continuous auto-exposure enabled');
      }
      
      // 3. Continuous auto-white-balance for accurate colors
      if ('whiteBalanceMode' in capabilities && capabilities.whiteBalanceMode?.includes('continuous')) {
        advanced.push({ whiteBalanceMode: 'continuous' });
        console.log('✅ Continuous auto-white-balance enabled');
      }
      
      // 4. Maximum sharpness for text clarity (safe to max out)
      if ('sharpness' in capabilities) {
        const { max } = capabilities.sharpness as { max: number };
        advanced.push({ sharpness: max });
        console.log('✅ Sharpness maximized for text clarity');
      }
      
      // Apply factory defaults
      if (advanced.length > 0) {
        constraints.advanced = advanced;
        await track.applyConstraints(constraints);
        console.log(`✅ Applied ${advanced.length} factory default settings`);
        toast.success('Camera ready with automatic settings', {
          duration: 2000,
        });
      } else {
        console.warn('⚠️ No advanced camera controls available');
        toast.info('Using basic camera settings');
      }
    } catch (error) {
      console.error('❌ Failed to apply camera settings:', error);
      toast.warning('Camera settings partially applied');
    }
  };

  const handleTapToFocus = async (event: React.TouchEvent<HTMLVideoElement> | React.MouseEvent<HTMLVideoElement>) => {
    if (!streamRef.current || !videoRef.current) return;
    
    const track = streamRef.current.getVideoTracks()[0];
    const capabilities = track.getCapabilities() as any;
    
    // Check if manual focus control is supported
    if (!('focusMode' in capabilities) || !capabilities.focusMode?.includes('manual')) {
      toast.info('Tap-to-focus not supported on this camera');
      return;
    }
    
    const rect = videoRef.current.getBoundingClientRect();
    const x = ('touches' in event ? event.touches[0].clientX : event.clientX) - rect.left;
    const y = ('touches' in event ? event.touches[0].clientY : event.clientY) - rect.top;
    
    // Normalize coordinates (0-1 range)
    const normalizedX = x / rect.width;
    const normalizedY = y / rect.height;
    
    // Show focus indicator
    setFocusIndicator({ x, y });
    setTimeout(() => setFocusIndicator(null), 1000);
    
    try {
      // Apply point of interest for focus
      if ('pointsOfInterest' in capabilities) {
        await track.applyConstraints({
          advanced: [
            {
              focusMode: 'single-shot',
              pointsOfInterest: [{ x: normalizedX, y: normalizedY }],
            },
          ],
        });
        console.log('Focus point set to:', normalizedX, normalizedY);
        toast.success('Focus locked');
      }
    } catch (error) {
      console.warn('Tap-to-focus failed:', error);
    }
  };

  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
    localStorage.setItem('camera-zoom-level', newZoom.toString());
    applyZoom(newZoom);
  };

  const handleFlashToggle = () => {
    const newFlashState = !flashEnabled;
    setFlashEnabled(newFlashState);
    applyFlash(newFlashState);
  };

  const handleCameraChange = async (cameraId: string) => {
    console.log('Switching camera to:', cameraId);
    
    // Validate new deviceId exists
    const deviceExists = availableCameras.some(cam => cam.deviceId === cameraId);
    if (!deviceExists) {
      toast.error('Selected camera is no longer available');
      return;
    }
    
    setShowCameraSelector(false);
    toast.info('Switching camera...');
    
    try {
      // Stop current camera first
      stopCamera();
      
      // Update selection
      setSelectedCameraId(cameraId);
      localStorage.setItem('preferred-camera-id', cameraId);
      
      // Small delay to ensure old camera is fully released
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Initialize with new camera
      await initializeCamera();
      
      const selectedCamera = availableCameras.find(c => c.deviceId === cameraId);
      toast.success(`Switched to ${selectedCamera?.label || 'camera'}`);
      
    } catch (error: any) {
      console.error('Camera switch failed:', error);
      toast.error('Failed to switch camera: ' + error.message);
      
      // Try to restart with original camera on failure
      try {
        await initializeCamera();
      } catch (restartError) {
        console.error('Failed to restart camera after switch error');
      }
    }
  };

  const getCameraLabel = (camera: MediaDeviceInfo) => {
    if (!camera.label) return `Camera ${availableCameras.indexOf(camera) + 1}`;
    
    // Simplify common camera labels
    const label = camera.label.toLowerCase();
    if (label.includes('front') || label.includes('user')) return 'Front Camera';
    if (label.includes('back') || label.includes('rear') || label.includes('environment')) return 'Back Camera';
    return camera.label;
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    console.log('[🎬 Capture] Starting capture...');
    const t0 = performance.now();

    // Clear previous error state on new capture
    if (buttonFeedback === 'error') {
      setButtonFeedback('idle');
      setLastErrorMessage('');
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) {
      console.error('[❌ Capture] No canvas context');
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
    console.log('[📸 Capture] Frame captured:', { size: imageDataUrl.length });
    
    // Increment driving scan count
    if (drivingMode) {
      setDrivingScanCount(prev => prev + 1);
    }
    
    // Play photo capture sound if GPS is available (only in handheld mode)
    if (gpsLocation && !drivingMode) {
      playSounds.photoCapture();
    }
    
    // Create processing queue item
    const queueId = Date.now().toString() + Math.random().toString(36).slice(2);
    const newQueueItem = {
      id: queueId,
      image: imageDataUrl,
      timestamp: Date.now(),
      status: 'processing' as const,
    };
    
    setProcessingQueue(prev => [...prev, newQueueItem]);
    setIsBackgroundProcessing(true);
    
    // Play background processing notification sound (only in handheld mode)
    if (!drivingMode) {
      setTimeout(() => {
        playSounds.backgroundProcessing();
      }, 300);
    }
    
    // Process in background WITHOUT stopping camera
    // ⚠️ CRITICAL: Wrap in try/catch/finally to guarantee loading state clears
    try {
      await processImageUnified(imageDataUrl, queueId, 'camera');
      const t1 = performance.now();
      console.log(`[✅ Capture] Completed in ${Math.round(t1 - t0)}ms`);
    } catch (error: any) {
      console.error('[❌ Capture] Failed:', error);
      toast.error('Capture failed: ' + (error?.message || 'Unknown error'));
      
      // Mark queue item as error
      setProcessingQueue(prev => 
        prev.map(item => 
          item.id === queueId 
            ? { ...item, status: 'error' as const } 
            : item
        )
      );
    } finally {
      // ✅ ALWAYS clear loading state, even if error thrown
      const hasProcessingItems = processingQueue.filter(p => p.status === 'processing' && p.id !== queueId).length > 0;
      if (!hasProcessingItems) {
        setIsBackgroundProcessing(false);
        console.log('[🔓 Capture] Loading state cleared');
      }
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const imageDataUrl = e.target?.result as string;
      
      // Auto-process uploaded photo through ALPR/OCR/AI pipeline
      toast.info('Processing uploaded photo...');
      
      // Create processing queue item for uploaded file
      const queueId = Date.now().toString() + Math.random().toString(36).slice(2);
      const newQueueItem = {
        id: queueId,
        image: imageDataUrl,
        timestamp: Date.now(),
        status: 'processing' as const,
      };
      
      setProcessingQueue(prev => [...prev, newQueueItem]);
      setIsBackgroundProcessing(true);
      
      // Process file upload using unified function
      processImageUnified(imageDataUrl, queueId, 'file_upload');
    };
    reader.readAsDataURL(file);
  };

  // TODO: Replace with ORC/AI vehicle fingerprinting
  // REMOVED: ALPR-based processing - will be replaced with ORC/AI
  const processImageUnified = async (
    imageDataUrl: string, 
    queueId: string,
    sourceType: 'camera' | 'file_upload' = 'camera'
  ) => {
    console.log(`📸 [${sourceType.toUpperCase()}] ALPR REMOVED - ORC/AI rebuild pending...`);

    try {
      // TODO: Implement ORC/AI processing here
      // 1. Upload photo to evidence bucket
      // 2. Call ORC inference (vehicle detection + embedding)
      // 3. Match against existing vehicle signatures
      // 4. Create observation with vehicle fingerprint
      
      throw new Error('ALPR removed - ORC/AI system under development');

      // REMOVED: All ALPR processing logic
      
    } catch (error: any) {
      console.error('❌ Image processing failed:', error);
      playSounds.error();
      
      setFeedbackType('error');
      setFeedbackMessage('Scan Failed');
      setShowFeedbackBubble(true);
      setTimeout(() => setShowFeedbackBubble(false), 3000);
      
      setLastErrorMessage('Processing error');
      setButtonFeedback('error');
      
      setProcessingQueue(prev => 
        prev.map(item => 
          item.id === queueId 
            ? { ...item, status: 'error' as const } 
            : item
        )
      );
      
      toast.error('Failed to process image: ' + error.message);
    } finally {
      setProcessingQueue(prev => {
        const allComplete = prev.every(item => item.status !== 'processing');
        if (allComplete) {
          setIsBackgroundProcessing(false);
        }
        return prev;
      });
    }
  };

  // Process complete field scan (creates vehicle, observation, checks compliance)
  const processFieldScan = async (detectionResult: PlateDetectionResult) => {
    // Final validation before sending to Edge Function
    if (!zoneId || !organizationId) {
      toast.error('Cannot process scan: Missing zone or organization ID');
      console.error('Missing required IDs:', { zoneId, organizationId });
      return;
    }

    console.log('Calling vehicle-ingest Edge Function...');
    console.log('Request data:', {
      plateNumber: detectionResult.plateNumber,
      zoneId,
      organizationId,
      gpsLocation,
      detectionMethod: detectionResult.detectionMethod,
    });

    try {
      const { data: scanResult, error: scanError } = await supabase.functions.invoke('vehicle-ingest', {
        body: {
          plate: detectionResult.plateNumber,
          confidence: detectionResult.confidence,
          image: detectionResult.fullImageUrl,
          gpsLatitude: gpsLocation?.lat || null,
          gpsLongitude: gpsLocation?.lng || null,
          gpsAccuracy: gpsLocation?.accuracy || null,
          recordedAt: new Date().toISOString(),
          officerId: organizationId, // will be overridden by JWT sub in function
          organizationId,
          zoneId,
          idempotencyKey: `scan:${Date.now()}:${Math.random().toString(36).slice(2)}`,
          requires_manual_entry: false,
        },
      });

      if (scanError) {
        console.error('Field scan processing failed:', scanError);
        
        // Use FunctionsHttpError pattern for proper error extraction
        let errorMessage = '';
        let statusCode = 500;
        let parsedError: any = null;
        
        if (scanError instanceof FunctionsHttpError) {
          try {
            const errorText = await scanError.context?.text();
            statusCode = scanError.context?.status ?? 500;
            console.error('Error details:', errorText);
            errorMessage = errorText || scanError.message;
            
            // Try to parse error as JSON to check for duplicate_scan
            try {
              parsedError = JSON.parse(errorMessage);
            } catch {
              parsedError = null;
            }
            
            // Check for duplicate scan (409 status or duplicate_scan error type)
            if (statusCode === 409 || parsedError?.error === 'duplicate_scan' || parsedError?.duplicate === true) {
              console.log('⚠️ Duplicate scan detected:', parsedError);
              playSounds.violationAlert();
              
              // Show friendly bubble message
              setFeedbackType('warning');
              setFeedbackMessage('Already Scanned');
              setShowFeedbackBubble(true);
              setTimeout(() => setShowFeedbackBubble(false), 3000);
              
              // Show detailed toast with timing info
              const minutesAgo = parsedError?.details?.minutes_ago;
              const zoneName = parsedError?.details?.zone_name || 'this zone';
              toast.warning(
                `Vehicle already scanned ${minutesAgo ? minutesAgo + ' minutes ago' : 'today'} in ${zoneName}`,
                { duration: 5000 }
              );
              
              return;
            }
            
            // Check for specific "other-location" UUID error
            if (errorMessage.includes('invalid input syntax for type uuid') && errorMessage.includes('other-location')) {
              // Don't show any notification for this error
              console.error('Zone ID error: other-location is not a valid UUID');
              
              // Show red bubble
              setFeedbackType('error');
              setFeedbackMessage('Zone Error');
              setShowFeedbackBubble(true);
              setTimeout(() => setShowFeedbackBubble(false), 3000);
              
              return;
            }
            
            toast.error(`Failed to process scan [${statusCode}]: ${errorMessage}`);
          } catch {
            toast.error(`Failed to process scan: ${scanError.message}`);
          }
        } else {
          toast.error('Failed to process scan: ' + (scanError?.message || 'Unknown error'));
        }
        return;
      }

      console.log('Field scan processed:', scanResult);

      // In driving mode with "wait for details" enabled OR handheld mode "collect details", show popup
      const shouldShowPopup = 
        (drivingMode && waitForDetailsBeforeNext) || 
        (!drivingMode && handheldMode === 'collect_details');
      
      if (shouldShowPopup) {
        // Use enriched vehicle data from vehicle-ingest
        const enrichedDetails = {
          ...detectionResult,
          vehicleId: scanResult.vehicle_id,
          observationId: scanResult.observation_id,
          isCompliant: scanResult.is_compliant,
          isFlagged: scanResult.is_flagged,
          priorObservationsCount: scanResult.prior_observations_count,
          // Override with enriched data from canonical_vehicles if available
          vehicleMake: scanResult.vehicle_details?.make || detectionResult.vehicleMake,
          vehicleModel: scanResult.vehicle_details?.model || detectionResult.vehicleModel,
          vehicleColor: scanResult.vehicle_details?.color || detectionResult.vehicleColor,
          vehicleYear: scanResult.vehicle_details?.year?.toString() || detectionResult.vehicleYear,
        };
        
        setCurrentVehicleDetails(enrichedDetails);
        setShowVehiclePopup(true);
        setIsWorkflowLocked(true); // 🔒 Lock camera until workflow complete
        
        // If vehicle details are incomplete, trigger background AI analysis
        const hasIncompleteDetails = !enrichedDetails.vehicleMake || !enrichedDetails.vehicleModel || !enrichedDetails.vehicleColor;
        if (hasIncompleteDetails && detectionResult.fullImageUrl && scanResult.vehicle_id) {
          console.log('🤖 Vehicle details incomplete - triggering background AI analysis...');
          triggerBackgroundAIAnalysis(
            detectionResult.plateNumber,
            scanResult.vehicle_id,
            detectionResult.fullImageUrl
          );
          toast.info('Analyzing vehicle details in background...', { duration: 2000 });
        }
        
        // Don't return here - still process alerts below
      }

      // CHECK FOR DUPLICATE SCAN FIRST (highest priority)
      if (scanResult.is_duplicate && scanResult.duplicate_info) {
        console.log('⚠️ Duplicate scan detected:', scanResult.duplicate_info);
        playSounds.violationAlert();
        
        setCurrentDuplicate({
          plateNumber: detectionResult.plateNumber,
          vehicleId: scanResult.vehicle_id,
          vehicleMake: detectionResult.vehicleMake,
          vehicleModel: detectionResult.vehicleModel,
          vehicleColor: detectionResult.vehicleColor,
          photoUrl: detectionResult.fullImageUrl || undefined,
          observationId: scanResult.observation_id,
          duplicateInfo: {
            recordedBy: scanResult.duplicate_info.recorded_by,
            recordedByName: scanResult.duplicate_info.recorded_by_name,
            recordedAt: scanResult.duplicate_info.recorded_at,
            zoneName: scanResult.duplicate_info.zone_name,
            isSameOfficer: scanResult.duplicate_info.is_same_officer,
          },
        });
        setShowDuplicateModal(true);
        
        // Don't process other alerts when duplicate detected
        return;
      }

      // Track if sound has been played to avoid duplicates
      let hasPlayedSound = false;
      let requiresAcknowledgement = false;

      // Check for critical alerts requiring acknowledgement modal
      if (scanResult.is_flagged) {
        playSounds.flaggedVehicle();
        hasPlayedSound = true;
        requiresAcknowledgement = true;
        
        // Use flagged_details from backend for comprehensive information
        const flaggedReason = scanResult.flagged_details?.reason || 'Unknown reason';
        const flaggedPriority = scanResult.flagged_details?.priority || 'medium';
        const flaggedNotes = scanResult.flagged_details?.notes || '';
        const isHomeless = scanResult.flagged_details?.confirmed_homeless || false;
        
        setCurrentAlert({
          type: 'flagged_vehicle',
          vehicleId: scanResult.vehicle_id,
          plateNumber: detectionResult.plateNumber,
          vehicleMake: detectionResult.vehicleMake,
          vehicleModel: detectionResult.vehicleModel,
          vehicleColor: detectionResult.vehicleColor,
          photoUrl: detectionResult.fullImageUrl || undefined,
          message: `${flaggedReason}${isHomeless ? ' • Confirmed Homeless' : ''}`,
          details: flaggedNotes,
        });
        setShowAlertModal(true);
      } else if (scanResult.alerts && scanResult.alerts.some((a: string) => a.toLowerCase().includes('h&s') || a.toLowerCase().includes('health'))) {
        playSounds.healthSafety();
        hasPlayedSound = true;
        requiresAcknowledgement = true;
        
        const hsAlert = scanResult.alerts.find((a: string) => a.toLowerCase().includes('h&s') || a.toLowerCase().includes('health'));
        setCurrentAlert({
          type: 'hs_issue',
          vehicleId: scanResult.vehicle_id,
          plateNumber: detectionResult.plateNumber,
          vehicleMake: detectionResult.vehicleMake,
          vehicleModel: detectionResult.vehicleModel,
          vehicleColor: detectionResult.vehicleColor,
          photoUrl: detectionResult.fullImageUrl || undefined,
          message: 'Health and Safety concern detected',
          details: hsAlert || 'H&S issue requires attention',
        });
        setShowAlertModal(true);
      } else if (scanResult.is_compliant === false && scanResult.alerts && scanResult.alerts.some((a: string) => a.includes('BREACH') || a.includes('NON-COMPLIANT'))) {
        playSounds.violationAlert();
        hasPlayedSound = true;
        requiresAcknowledgement = true;
        
        const breachAlert = scanResult.alerts.find((a: string) => a.includes('BREACH') || a.includes('NON-COMPLIANT'));
        setCurrentAlert({
          type: 'breach_alert',
          vehicleId: scanResult.vehicle_id,
          plateNumber: detectionResult.plateNumber,
          vehicleMake: detectionResult.vehicleMake,
          vehicleModel: detectionResult.vehicleModel,
          vehicleColor: detectionResult.vehicleColor,
          photoUrl: detectionResult.fullImageUrl || undefined,
          message: 'Compliance breach detected',
          details: breachAlert || 'Vehicle is non-compliant with zone regulations',
        });
        setShowAlertModal(true);
      }
      // NOTE: Homeless alerts removed - homeless vehicles are FC Act exempt (low priority, informational only)

      // Show remaining alerts as bubbles (non-critical, informational)
      if (!requiresAcknowledgement && scanResult.alerts && scanResult.alerts.length > 0) {
        scanResult.alerts.forEach((alert: string) => {
          if (alert.toLowerCase().includes('homeless') && alert.toLowerCase().includes('exempt')) {
            // Homeless FC Act Exempt - informational bubble (low priority)
            if (!hasPlayedSound) {
              playSounds.homeless();
              hasPlayedSound = true;
            }
            
            setFeedbackType('warning');
            setFeedbackMessage('Homeless (FC Exempt)');
            setShowFeedbackBubble(true);
            setTimeout(() => setShowFeedbackBubble(false), 3000);
          } else if (alert.toLowerCase().includes('compliant')) {
            // Success bubble for compliant vehicles
            setFeedbackType('success');
            setFeedbackMessage('Compliant');
            setShowFeedbackBubble(true);
            setTimeout(() => setShowFeedbackBubble(false), 2000);
          }
        });
      }
      
      // Play success sound and show bubble if no issues detected
      if (!hasPlayedSound && scanResult.is_compliant === true) {
        playSounds.processingComplete();
        
        setFeedbackType('success');
        setFeedbackMessage('Compliant');
        setShowFeedbackBubble(true);
        setTimeout(() => setShowFeedbackBubble(false), 2000);
      }
      
      // Update processing queue status
      setProcessingQueue(prev => 
        prev.map(item => 
          item.plateNumber === detectionResult.plateNumber 
            ? { ...item, status: 'complete' as const } 
            : item
        )
      );

      // Check for notifications related to this plate
      if (scanResult.vehicle_id || detectionResult.plateNumber) {
        // Create notification with vehicle photo and details
        const notificationMetadata = {
          plateNumber: detectionResult.plateNumber,
          vehicleMake: detectionResult.vehicleMake,
          vehicleModel: detectionResult.vehicleModel,
          vehicleColor: detectionResult.vehicleColor,
          photoUrl: detectionResult.fullImageUrl,
          zoneName: zoneName,
          priorVisits: scanResult.prior_observations_count,
          vehicleId: scanResult.vehicle_id,
          observationId: scanResult.observation_id,
        };
        
        checkPlateNotifications(
          detectionResult.plateNumber, 
          scanResult.vehicle_id,
          notificationMetadata
        );
      }

      // Return enriched detection result to parent
      // In continuous mode, auto-add to history
      // In collect_details mode or driving with wait, popup handles the flow
      const shouldAutoAddToHistory = 
        (!drivingMode && handheldMode === 'continuous') || 
        (drivingMode && !waitForDetailsBeforeNext);
      
      if (shouldAutoAddToHistory) {
        onPlateDetected({
          ...detectionResult,
          vehicleId: scanResult.vehicle_id,
          observationId: scanResult.observation_id,
          isCompliant: scanResult.is_compliant,
          isFlagged: scanResult.is_flagged,
          priorObservationsCount: scanResult.prior_observations_count,
        });
      }

      // Background AI Analysis - In continuous mode, auto-analyze vehicles with photos
      // This runs in the background and doesn't interrupt the scanning workflow
      if (handheldMode === 'continuous' && detectionResult.fullImageUrl && scanResult.vehicle_id) {
        triggerBackgroundAIAnalysis(
          detectionResult.plateNumber,
          scanResult.vehicle_id,
          detectionResult.fullImageUrl
        );
      }
    } catch (processError: any) {
      console.error('Field scan exception:', processError);
      playSounds.error();
      toast.error('Failed to process scan: ' + processError.message);
    }
  };

  // ❌ REMOVED: processUploadedImage - consolidated into processImageUnified

  // Background AI Analysis - Non-blocking enrichment of vehicle details
  const triggerBackgroundAIAnalysis = async (
    plateNumber: string,
    vehicleId: string,
    photoUrl: string
  ) => {
    // Prevent duplicate AI calls for the same vehicle in this session
    const vehicleKey = `${plateNumber}-${vehicleId}`;
    if (analyzingVehicles.current.has(vehicleKey)) {
      console.log(`AI analysis already in progress for ${plateNumber}, skipping...`);
      return;
    }

    analyzingVehicles.current.add(vehicleKey);
    console.log(`Starting background AI analysis for ${plateNumber}...`);

    try {
      // Call AI analysis in the background - don't await, don't block
      supabase.functions.invoke('analyze-vehicle-photo', {
        body: {
          plateNumber: plateNumber.toUpperCase().trim(),
          photoUrl,
          vehicleId,
        },
      }).then(({ data, error }) => {
        if (error) {
          console.error(`Background AI analysis failed for ${plateNumber}:`, error);
          analyzingVehicles.current.delete(vehicleKey);
          return;
        }

        if (data?.analysis) {
          console.log(`Background AI analysis complete for ${plateNumber}:`, {
            make: data.analysis.make,
            model: data.analysis.model,
            color: data.analysis.color,
            year: data.analysis.year,
            selfContained: data.analysis.is_self_contained,
            greenSticker: data.analysis.has_green_sticker,
            blueSticker: data.analysis.has_blue_sticker,
            confidence: data.analysis.confidence,
          });

          // Show subtle notification if AI detected something interesting
          if (data.analysis.has_green_sticker || data.analysis.has_blue_sticker) {
            console.log(`AI detected self-contained sticker on ${plateNumber}`);
          }
        } else if (data?.skipped) {
          console.log(`AI analysis skipped for ${plateNumber} (details already exist)`);
        }
        
        // Remove from tracking set after successful analysis
        analyzingVehicles.current.delete(vehicleKey);
      });

    } catch (error) {
      console.error(`Failed to trigger background AI analysis for ${plateNumber}:`, error);
      analyzingVehicles.current.delete(vehicleKey);
    }
  };

  // Upload image to Supabase Storage (only after successful detection)
  const uploadToStorage = async (imageDataUrl: string): Promise<string> => {
    const blob = await fetch(imageDataUrl).then(r => r.blob());
    const fileName = `scans/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    
    const { error: uploadError } = await supabase.storage
      .from('evidence')
      .upload(fileName, blob);

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = await supabase.storage
      .from('evidence')
      .getPublicUrl(fileName);

    return publicUrl;
  };

  const handleManualSubmit = async () => {
    if (!manualPlate.trim()) {
      toast.error('Please enter a plate number');
      return;
    }

    setIsProcessing(true);

    try {
      // Upload captured image if available
      let imageUrl: string | null = null;
      if (capturedImage) {
        imageUrl = await uploadToStorage(capturedImage);
      }

      // Process manual entry through field scan
      await processFieldScan({
        plateNumber: manualPlate.toUpperCase().trim(),
        confidence: 1.0, // Manual entry is 100% confidence
        croppedImageUrl: capturedImage,
        fullImageUrl: imageUrl,
        gpsLocation,
        detectionMethod: 'manual',
      });
    } catch (error: any) {
      console.error('Manual submission failed:', error);
      toast.error('Failed to submit: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id);
    
    // Find index in notifications array
    const index = notifications.findIndex(n => n.id === notification.id);
    setCurrentNotificationIndex(index);
    setSelectedNotification(notification);
    setShowVehicleDrawer(true);
  };

  // Convert notification to SessionScan format for VehicleEditDrawer
  const convertNotificationToScan = (notification: Notification): SessionScan | null => {
    if (!notification.metadata?.plateNumber) return null;

    return {
      id: notification.id,
      plateNumber: notification.metadata.plateNumber,
      zoneName: notification.metadata.zoneName || zoneName,
      zoneId: zoneId,
      organizationId: organizationId,
      timestamp: notification.timestamp,
      isCompliant: notification.type !== 'breach_alert',
      isFlagged: notification.type === 'flagged_vehicle',
      vehicleMake: notification.metadata.vehicleMake,
      vehicleModel: notification.metadata.vehicleModel,
      vehicleColor: notification.metadata.vehicleColor,
      vehicleId: notification.metadata.vehicleId,
      observationId: notification.metadata.observationId,
      priorObservationsCount: notification.metadata.priorVisits,
      detectionMethod: 'alpr',
      isSelfContained: false,
      isHomeless: notification.type === 'homeless_confirmed',
      hasHSIssue: notification.type === 'hs_report',
      requiresFollowup: notification.severity === 'urgent',
    };
  };

  const handlePreviousVehicle = () => {
    if (currentNotificationIndex > 0) {
      const newIndex = currentNotificationIndex - 1;
      setCurrentNotificationIndex(newIndex);
      setSelectedNotification(notifications[newIndex]);
    }
  };

  const handleNextVehicle = () => {
    if (currentNotificationIndex < notifications.length - 1) {
      const newIndex = currentNotificationIndex + 1;
      setCurrentNotificationIndex(newIndex);
      setSelectedNotification(notifications[newIndex]);
    }
  };

  const handleCloseDrawer = () => {
    setShowVehicleDrawer(false);
    setSelectedNotification(null);
  };

  const handleUpdateScan = (updatedScan: SessionScan) => {
    // Notification-based scans don't need update handling in this context
    // The database updates happen inside VehicleEditDrawer
    setShowVehicleDrawer(false);
  };

  // Swipe-to-dismiss handlers
  const handleSwipeStart = (e: React.TouchEvent, notificationId: string, isPinned: boolean) => {
    if (isPinned) return; // Don't allow swiping urgent notifications
    
    setSwipeState({
      notificationId,
      startX: e.touches[0].clientX,
      currentX: 0,
      isDragging: true,
    });
  };

  const handleSwipeMove = (e: React.TouchEvent) => {
    if (!swipeState.isDragging || !swipeState.notificationId) return;
    
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - swipeState.startX;
    
    setSwipeState(prev => ({
      ...prev,
      currentX: deltaX,
    }));
  };

  const handleSwipeEnd = (notificationId: string) => {
    if (!swipeState.isDragging) return;
    
    const threshold = 100; // Minimum swipe distance to dismiss
    const shouldDismiss = Math.abs(swipeState.currentX) > threshold;
    
    if (shouldDismiss) {
      // Play dismissal sound
      playSounds.photoCapture();
      
      // Dismiss notification
      markAsRead(notificationId);
    }
    
    // Reset swipe state
    setSwipeState({
      notificationId: null,
      startX: 0,
      currentX: 0,
      isDragging: false,
    });
  };

  const getSwipeTransform = (notificationId: string) => {
    if (swipeState.notificationId !== notificationId) return 'translateX(0)';
    return `translateX(${swipeState.currentX}px)`;
  };

  const getSwipeOpacity = (notificationId: string) => {
    if (swipeState.notificationId !== notificationId) return 1;
    const fadeThreshold = 100;
    return Math.max(0.3, 1 - Math.abs(swipeState.currentX) / fadeThreshold);
  };

  const currentScan = selectedNotification ? convertNotificationToScan(selectedNotification) : null;

  const handleAlertIgnore = () => {
    setShowAlertModal(false);
    setCurrentAlert(null);
    setIsWorkflowLocked(false); // 🔓 Unlock camera when dismissing alert
    toast.info('Alert acknowledged - continuing scan session');
  };

  const handleAlertTakeAction = () => {
    setShowAlertModal(false);
    setIsWorkflowLocked(false); // 🔓 Unlock camera before opening drawer
    
    // Convert alert to notification for drawer
    if (currentAlert) {
      const alertNotification: Notification = {
        id: `alert-${Date.now()}`,
        type: currentAlert.type,
        severity: currentAlert.type === 'flagged_vehicle' || currentAlert.type === 'hs_issue' ? 'urgent' : 'normal',
        title: currentAlert.message,
        message: currentAlert.details || currentAlert.message,
        timestamp: new Date(),
        read: false,
        metadata: {
          plateNumber: currentAlert.plateNumber,
          vehicleMake: currentAlert.vehicleMake,
          vehicleModel: currentAlert.vehicleModel,
          vehicleColor: currentAlert.vehicleColor,
          photoUrl: currentAlert.photoUrl,
          vehicleId: currentAlert.vehicleId,
          zoneName: zoneName,
        },
      };
      
      setSelectedNotification(alertNotification);
      setShowVehicleDrawer(true);
      setCurrentAlert(null);
    }
  };

  // Navigate to Evidence Collection with vehicle details
  const handleOpenEvidenceCollection = (details: PlateDetectionResult) => {
    // Close popup
    setShowVehiclePopup(false);
    setCurrentVehicleDetails(null);
    
    // Create SessionScan object for VehicleEditDrawer
    const scan: SessionScan = {
      id: `scan-${Date.now()}`,
      plateNumber: details.plateNumber,
      zoneName: zoneName,
      zoneId: zoneId,
      organizationId: organizationId,
      timestamp: new Date().toISOString(),
      isCompliant: details.isCompliant ?? true,
      isFlagged: details.isFlagged ?? false,
      vehicleMake: details.vehicleMake,
      vehicleModel: details.vehicleModel,
      vehicleColor: details.vehicleColor,
      vehicleId: details.vehicleId,
      observationId: details.observationId,
      priorObservationsCount: details.priorObservationsCount,
      detectionMethod: details.detectionMethod,
      isSelfContained: details.isSelfContained || false,
      isHomeless: false, // TODO: Get from scan result
      hasHSIssue: false,
      requiresFollowup: false,
    };
    
    // Open drawer in evidence mode
    setSelectedNotification({
      id: `evidence-${Date.now()}`,
      type: 'breach_alert',
      severity: 'normal',
      title: 'Evidence Collection',
      message: `Collecting evidence for ${details.plateNumber}`,
      timestamp: new Date(),
      read: false,
      metadata: {
        plateNumber: details.plateNumber,
        vehicleMake: details.vehicleMake,
        vehicleModel: details.vehicleModel,
        vehicleColor: details.vehicleColor,
        photoUrl: details.fullImageUrl,
        vehicleId: details.vehicleId,
        zoneName: zoneName,
        priorVisits: details.priorObservationsCount,
        observationId: details.observationId,
      },
    });
    setShowVehicleDrawer(true);
  };

  const handleDuplicateCancel = () => {
    setShowDuplicateModal(false);
    setCurrentDuplicate(null);
    setIsWorkflowLocked(false); // 🔓 Unlock camera when dismissing duplicate modal
    toast.info('Duplicate scan cancelled - continuing patrol');
  };

  const handleDuplicateContinue = () => {
    setShowDuplicateModal(false);
    
    // Convert duplicate to notification for drawer (must add H&S or Incident)
    if (currentDuplicate) {
      const duplicateNotification: Notification = {
        id: `duplicate-${Date.now()}`,
        type: 'breach_alert',
        severity: 'urgent',
        title: 'Update Required: Add H&S or Incident',
        message: `This vehicle was already scanned by ${currentDuplicate.duplicateInfo.recordedByName}. You must add an H&S report or incident to proceed.`,
        timestamp: new Date(),
        read: false,
        metadata: {
          plateNumber: currentDuplicate.plateNumber,
          vehicleMake: currentDuplicate.vehicleMake,
          vehicleModel: currentDuplicate.vehicleModel,
          vehicleColor: currentDuplicate.vehicleColor,
          photoUrl: currentDuplicate.photoUrl,
          vehicleId: currentDuplicate.vehicleId,
          zoneName: zoneName,
        },
      };
      
      setSelectedNotification(duplicateNotification);
      setShowVehicleDrawer(true);
      setCurrentDuplicate(null);
      
      toast.info('Opening vehicle record - please add H&S or Incident report');
    }
  };

  const handleManualEntrySubmit = async (formData: ManualEntryData) => {
    setShowManualEntryModal(false);
    
    if (!failedDetectionData) {
      toast.error('Failed detection data lost - please retry capture');
      return;
    }

    try {
      // AUTO-ADD METADATA: Indicate manual entry with automatic detection failure context
      const autoNotes = [
        '🔧 MANUALLY ENTERED BY OFFICER',
        '❌ Automatic detection failed (both ALPR and OCR)',
        formData.notes ? `Officer Notes: ${formData.notes}` : null,
      ].filter(Boolean).join(' • ');

      // Process manual entry through field scan
      await processFieldScan({
        plateNumber: formData.plateNumber,
        confidence: 1.0, // Manual entry is 100% confidence (officer verified)
        vehicleMake: formData.make,
        vehicleModel: formData.model,
        vehicleColor: formData.color,
        vehicleYear: formData.year?.toString(),
        croppedImageUrl: failedDetectionData.image,
        fullImageUrl: failedDetectionData.photoUrl,
        gpsLocation: failedDetectionData.gpsLocation,
        detectionMethod: 'manual',
        isSelfContained: formData.selfContained,
        officerNotes: autoNotes, // Pass metadata notes
      });

      // Clear failed detection data
      setFailedDetectionData(null);
      
      // Reset button feedback
      setButtonFeedback('idle');
      
      toast.success(`Manual entry successful: ${formData.plateNumber}`);
    } catch (error: any) {
      console.error('Manual entry processing failed:', error);
      toast.error('Failed to process manual entry: ' + error.message);
    }
  };

  const handleManualEntryCancel = () => {
    setShowManualEntryModal(false);
    setFailedDetectionData(null);
    setButtonFeedback('idle');
    setIsWorkflowLocked(false); // 🔓 Unlock camera when cancelling manual entry
    toast.info('Manual entry cancelled - you can retry capture');
  };

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden relative">
      {/* Plate Capture Card - Full screen */}
      <div className="flex-1 overflow-y-auto">
        <Card className="h-full rounded-none border-x-0 border-b-0">
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Plate Capture
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* GPS Status Badge */}
            <Badge 
              variant={gpsStatus === 'good' ? 'default' : gpsStatus === 'fair' ? 'secondary' : 'destructive'}
              className="text-xs px-2 py-0.5"
            >
              <MapPin className="h-3 w-3 mr-1" />
              GPS: {gpsStatus === 'good' ? 'Good' : gpsStatus === 'fair' ? 'Fair' : 'Poor'}
            </Badge>
            {onCancel && (
              <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {zoneName} • {new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' })}
        </p>
      </CardHeader>

      <CardContent className="space-y-3 pb-20">
        {/* Primary Mode Toggle - Larger mobile buttons with clear highlighting */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant={!drivingMode ? 'default' : 'outline'}
            onClick={() => {
              setDrivingMode(false);
              setDrivingScanCount(0);
            }}
            className={cn(
              "h-16 text-base font-bold touch-manipulation transition-all",
              !drivingMode && "bg-blue-600 hover:bg-blue-700 ring-4 ring-blue-200 dark:ring-blue-800 shadow-lg"
            )}
          >
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                📱 Handheld
              </div>
              {!drivingMode && <div className="text-xs opacity-90">✓ Selected</div>}
            </div>
          </Button>
          <Button
            variant={drivingMode ? 'default' : 'outline'}
            onClick={() => {
              setDrivingMode(true);
              setDrivingScanCount(0);
            }}
            className={cn(
              "h-16 text-base font-bold touch-manipulation transition-all",
              drivingMode && "bg-orange-600 hover:bg-orange-700 ring-4 ring-orange-200 dark:ring-orange-800 shadow-lg"
            )}
          >
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2">
                🚗 Driving
              </div>
              {drivingMode && <div className="text-xs opacity-90">✓ Selected</div>}
            </div>
          </Button>
        </div>

        {/* Handheld Sub-Mode Options - Only show when handheld mode active */}
        {!drivingMode && mode === 'camera' && !cameraPermissionDenied && availableCameras.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-bold text-gray-900 dark:text-white mb-2">Handheld Mode:</p>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant={handheldMode === 'continuous' ? 'default' : 'outline'}
                onClick={() => setHandheldMode('continuous')}
                className={cn(
                  "h-20 text-sm font-bold touch-manipulation transition-all flex flex-col items-center justify-center gap-1",
                  handheldMode === 'continuous' && "bg-green-600 hover:bg-green-700 ring-2 ring-green-300 dark:ring-green-700"
                )}
              >
                <div className="text-base">📋 Continuous</div>
                <div className="text-xs opacity-90">Auto-add to history</div>
                {handheldMode === 'continuous' && <div className="text-xs opacity-90">✓</div>}
              </Button>
              <Button
                variant={handheldMode === 'collect_details' ? 'default' : 'outline'}
                onClick={() => setHandheldMode('collect_details')}
                className={cn(
                  "h-20 text-sm font-bold touch-manipulation transition-all flex flex-col items-center justify-center gap-1",
                  handheldMode === 'collect_details' && "bg-purple-600 hover:bg-purple-700 ring-2 ring-purple-300 dark:ring-purple-700"
                )}
              >
                <div className="text-base">🔍 Details</div>
                <div className="text-xs opacity-90">Review before adding</div>
                {handheldMode === 'collect_details' && <div className="text-xs opacity-90">✓</div>}
              </Button>
            </div>
          </div>
        )}
        
        {/* Driving Mode Wait Option - Only show when driving mode active */}
        {drivingMode && mode === 'camera' && !cameraPermissionDenied && availableCameras.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg border-2 border-orange-200 dark:border-orange-700">
              <input
                type="checkbox"
                id="wait-for-details"
                checked={waitForDetailsBeforeNext}
                onChange={(e) => setWaitForDetailsBeforeNext(e.target.checked)}
                className="h-5 w-5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
              />
              <label htmlFor="wait-for-details" className="text-sm font-semibold text-gray-900 dark:text-white cursor-pointer">
                ⏸️ Wait for details before next vehicle
              </label>
            </div>
          </div>
        )}

        {/* Camera Mode */}
        {mode === 'camera' && (
          <div className="space-y-3">
            {/* Camera Initializing - Show Loading */}
            {isInitializingCamera && (
              <div className="text-center py-16">
                <Loader2 className="h-16 w-16 mx-auto mb-4 animate-spin text-blue-600" />
                <p className="text-base font-semibold text-gray-900 dark:text-white">Initializing Camera...</p>
                <p className="text-sm text-muted-foreground mt-2">Please wait while we access your camera</p>
              </div>
            )}
            
            {/* Camera Permission Denied - Show Instructions */}
            {!isInitializingCamera && cameraPermissionDenied && (
              <CameraPermissionHelp
                onRequestPermission={requestCameraPermission}
                onSwitchToManual={() => {
                  setCameraPermissionDenied(false);
                  setMode('manual');
                }}
              />
            )}
            
            {/* Camera initialization complete but no cameras found - Fallback UI */}
            {!isInitializingCamera && !cameraPermissionDenied && availableCameras.length === 0 && (
              <div className="text-center py-12">
                <AlertTriangle className="h-16 w-16 mx-auto mb-4 text-yellow-600" />
                <p className="text-base font-bold text-gray-900 dark:text-white mb-2">No Camera Available</p>
                <p className="text-sm text-muted-foreground mb-4">No cameras were detected on this device</p>
                <Button 
                  onClick={() => setMode('manual')}
                  className="h-14 px-8 text-base font-bold"
                >
                  <FileText className="h-5 w-5 mr-2" />
                  Switch to Manual Entry
                </Button>
              </div>
            )}
            
            {!isInitializingCamera && !capturedImage && !cameraPermissionDenied && availableCameras.length > 0 && (
              <>
                <div className="relative bg-black rounded-lg overflow-hidden h-[55vh]">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    onClick={handleTapToFocus}
                    onTouchStart={handleTapToFocus}
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  
                  {/* Focus Indicator */}
                  {focusIndicator && (
                    <div
                      className="absolute w-16 h-16 border-2 border-yellow-400 rounded-full pointer-events-none animate-ping"
                      style={{
                        left: focusIndicator.x - 32,
                        top: focusIndicator.y - 32,
                      }}
                    />
                  )}
                  
                  {/* Camera Controls - Top Right */}
                  <div className="absolute top-2 right-2 flex flex-col gap-2">
                    {/* Enhanced Camera Selector */}
                    {availableCameras.length > 1 && (
                      <div className="relative">
                        <Button
                          variant="ghost"
                          className="h-auto px-3 py-2 bg-black/70 hover:bg-black/90 text-white rounded-lg touch-manipulation shadow-lg backdrop-blur-sm border border-white/20"
                          onClick={() => setShowCameraSelector(!showCameraSelector)}
                        >
                          <div className="flex items-center gap-2">
                            <Video className="h-5 w-5 shrink-0" />
                            <div className="text-left">
                              <div className="text-xs font-semibold whitespace-nowrap">Camera</div>
                              <div className="text-[10px] opacity-80 max-w-[100px] truncate">
                                {getCameraLabel(availableCameras.find(c => c.deviceId === selectedCameraId) || availableCameras[0])}
                              </div>
                            </div>
                          </div>
                        </Button>
                        
                        {/* Enhanced Camera Dropdown */}
                        {showCameraSelector && (
                          <>
                            {/* Backdrop to close selector */}
                            <div 
                              className="fixed inset-0 z-40"
                              onClick={() => setShowCameraSelector(false)}
                            />
                            
                            <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl border-t-4 border-primary z-50 animate-in slide-in-from-bottom duration-300 max-h-[80vh] flex flex-col">
                              <div className="p-4 border-b-2 border-gray-200 dark:border-gray-700 bg-primary/10 shrink-0">
                                <p className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                  <Video className="h-5 w-5" />
                                  Select Camera
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                  {availableCameras.length} camera{availableCameras.length !== 1 ? 's' : ''} available • Tap to select
                                </p>
                              </div>
                              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                                {availableCameras.map((camera, index) => (
                                  <button
                                    key={camera.deviceId}
                                    onClick={() => handleCameraChange(camera.deviceId)}
                                    className={`w-full text-left px-5 py-4 rounded-xl text-base touch-manipulation transition-all ${
                                      camera.deviceId === selectedCameraId
                                        ? 'bg-primary text-primary-foreground shadow-lg scale-[1.02] border-2 border-primary/50'
                                        : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 border-2 border-transparent'
                                    }`}
                                  >
                                    <div className="flex items-center gap-4">
                                      {camera.deviceId === selectedCameraId && (
                                        <CheckCircle2 className="h-6 w-6 shrink-0" />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <div className="font-bold text-base mb-1">
                                          {getCameraLabel(camera)}
                                        </div>
                                        {camera.label && (
                                          <div className="text-xs opacity-80 break-words">
                                            {camera.label}
                                          </div>
                                        )}
                                      </div>
                                      {camera.deviceId === selectedCameraId && (
                                        <Badge variant="secondary" className="shrink-0 text-xs">
                                          Active
                                        </Badge>
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                              <div className="p-4 border-t-2 border-gray-200 dark:border-gray-700 bg-muted/30 shrink-0">
                                <p className="text-sm text-muted-foreground text-center font-medium">
                                  💡 Your selection is saved automatically
                                </p>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    
                    {/* Flash Toggle */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-12 w-12 bg-black/60 hover:bg-black/80 text-white rounded-full touch-manipulation"
                      onClick={handleFlashToggle}
                    >
                      {flashEnabled ? (
                        <Zap className="h-6 w-6" fill="yellow" />
                      ) : (
                        <ZapOff className="h-6 w-6" />
                      )}
                    </Button>
                  </div>

                  {/* Zoom Controls - Right Side Vertical Slider */}
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 bg-black/80 backdrop-blur-sm rounded-full px-3 py-6 shadow-lg border border-white/20">
                    <button
                      onClick={() => handleZoomChange(Math.min(5, zoom + 0.5))}
                      className="p-2 hover:bg-white/20 rounded-full transition-colors touch-manipulation"
                    >
                      <ZoomIn className="h-5 w-5 text-white shrink-0" />
                    </button>
                    <div className="flex flex-col items-center gap-2 min-h-[200px]">
                      <Slider
                        value={[zoom]}
                        onValueChange={([value]) => handleZoomChange(value)}
                        min={1}
                        max={5}
                        step={0.1}
                        orientation="vertical"
                        className="h-full"
                      />
                      <span className="text-white text-xs font-bold bg-black/50 px-2 py-1 rounded">
                        {zoom.toFixed(1)}x
                      </span>
                    </div>
                    <button
                      onClick={() => handleZoomChange(Math.max(1, zoom - 0.5))}
                      className="p-2 hover:bg-white/20 rounded-full transition-colors touch-manipulation"
                    >
                      <ZoomOut className="h-5 w-5 text-white shrink-0" />
                    </button>
                  </div>
                  
                  {/* Aim Guide - Single centered box */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-3/4 h-24 border-2 border-dashed border-yellow-400 rounded-lg bg-yellow-400/10">
                      <span className="absolute top-1 left-1/2 -translate-x-1/2 text-xs text-yellow-400 font-semibold bg-black/70 px-2 py-0.5 rounded">
                        Align plate here
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Capture Button - Always visible, disabled in driving mode with "collect details" popup lock */}
                <div className="mt-3 pb-safe">
                  <Button
                    onClick={capturePhoto}
                    disabled={isProcessing || isWorkflowLocked}
                    variant={buttonFeedback === 'idle' ? 'default' : 'secondary'}
                    className={cn(
                      "w-full h-16 text-xl font-bold relative shadow-lg touch-manipulation transition-all duration-300",
                      buttonFeedback === 'success' && '!bg-blue-600 hover:!bg-blue-700 !text-white border-blue-700',
                      buttonFeedback === 'error' && '!bg-red-600 hover:!bg-red-700 !text-white border-red-700',
                      isWorkflowLocked && 'opacity-50 cursor-not-allowed'
                    )}
                    size="lg"
                  >
                    {isBackgroundProcessing && (
                      <span className="absolute -top-1 -right-1 h-6 w-6 bg-blue-500 rounded-full flex items-center justify-center animate-pulse">
                        <span className="text-xs font-bold text-white">{processingQueue.filter(p => p.status === 'processing').length}</span>
                      </span>
                    )}
                    <Camera className="h-5 w-5 mr-2" />
                    {isWorkflowLocked
                      ? '🔒 Complete Details First...' 
                      : buttonFeedback === 'error' 
                      ? lastErrorMessage 
                      : drivingMode 
                      ? `Driving Mode (${drivingScanCount})` 
                      : 'Capture Plate'
                    }
                    {isBackgroundProcessing && (
                      <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                    )}
                  </Button>
                </div>
                
                {/* Manual Entry / File Upload Options - Larger mobile-friendly buttons */}
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isWorkflowLocked}
                    className={cn(
                      "h-14 text-sm font-bold touch-manipulation",
                      isWorkflowLocked && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <Upload className="h-5 w-5 mr-2" />
                    Load from File
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setMode('manual')}
                    disabled={isWorkflowLocked}
                    className={cn(
                      "h-14 text-sm font-bold touch-manipulation",
                      isWorkflowLocked && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <FileText className="h-5 w-5 mr-2" />
                    Manual Entry
                  </Button>
                </div>
                
                {/* Hidden file input for loading photos */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                
                {/* Background Processing Status */}
                {processingQueue.length > 0 && (
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {processingQueue.slice(-3).reverse().map((item) => (
                      <div
                        key={item.id}
                        className={`p-2 rounded-lg border text-xs flex items-center justify-between ${
                          item.status === 'processing'
                            ? 'bg-blue-50 border-blue-200'
                            : item.status === 'complete'
                            ? 'bg-green-50 border-green-200'
                            : 'bg-red-50 border-red-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {item.status === 'processing' ? (
                            <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                          ) : item.status === 'complete' ? (
                            <CheckCircle2 className="h-3 w-3 text-green-600" />
                          ) : (
                            <AlertTriangle className="h-3 w-3 text-red-600" />
                          )}
                          <span className="font-mono font-semibold">
                            {item.plateNumber || 'Processing...'}
                          </span>
                        </div>
                        <span className="text-muted-foreground">
                          {new Date(item.timestamp).toLocaleTimeString('en-NZ', { 
                            hour: '2-digit', 
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Background Processing Status - Always Visible */}
        {isBackgroundProcessing && (
          <Alert className="bg-blue-50 border-blue-200">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <AlertDescription className="text-xs">
              <strong>Processing in background:</strong> Continue scanning while AI analyzes plates
            </AlertDescription>
          </Alert>
        )}

        {/* Manual Mode */}
        {mode === 'manual' && (
          <div className="space-y-3">
            {capturedImage && (
              <img src={capturedImage} alt="Reference" className="w-full rounded-lg border mb-3" />
            )}
            
            <div>
              <Label htmlFor="manual-plate">Plate Number</Label>
              <Input
                id="manual-plate"
                value={manualPlate}
                onChange={(e) => setManualPlate(e.target.value.toUpperCase())}
                placeholder="ABC123"
                className="mt-1 text-lg font-mono text-center"
                autoFocus
              />
            </div>

            {!capturedImage && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full"
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Take Photo (Optional)
                </Button>
                
                {/* Manual Entry Tips */}
                <Alert>
                  <AlertDescription className="text-xs">
                    💡 <strong>Manual Entry Tips:</strong> Enter plate exactly as shown • Double-check spelling • Include all letters/numbers
                  </AlertDescription>
                </Alert>
              </>
            )}

            <Button
              onClick={handleManualSubmit}
              disabled={!manualPlate.trim()}
              className="w-full h-14 text-lg font-bold"
              size="lg"
            >
              <CheckCircle2 className="h-5 w-5 mr-2" />
              Continue with Manual Entry
            </Button>
          </div>
        )}

        {/* GPS Warnings - Two-tier approach */}
        {gpsLocation && gpsLocation.accuracy > 100 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs font-semibold">
              ⛔ GPS accuracy too poor ({gpsLocation.accuracy.toFixed(0)}m). Server will reject scans &gt;100m. Please move to an open area.
            </AlertDescription>
          </Alert>
        )}
        {gpsLocation && gpsLocation.accuracy > 50 && gpsLocation.accuracy <= 100 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              ⚠️ GPS accuracy is fair ({gpsLocation.accuracy.toFixed(0)}m). For best evidence quality, move to an open area (target ≤50m).
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
        </Card>
      </div>

      {/* Duplicate Scan Modal - Highest priority overlay */}
      {showDuplicateModal && currentDuplicate && (
        <DuplicateScanModal
          plateNumber={currentDuplicate.plateNumber}
          vehicleId={currentDuplicate.vehicleId}
          vehicleMake={currentDuplicate.vehicleMake}
          vehicleModel={currentDuplicate.vehicleModel}
          vehicleColor={currentDuplicate.vehicleColor}
          photoUrl={currentDuplicate.photoUrl}
          observationId={currentDuplicate.observationId}
          duplicateInfo={currentDuplicate.duplicateInfo}
          onCancel={handleDuplicateCancel}
          onContinueUpdate={handleDuplicateContinue}
        />
      )}

      {/* Alert Acknowledgement Modal - Second priority overlay */}
      {showAlertModal && currentAlert && (
        <AlertAcknowledgementModal
          alertType={currentAlert.type}
          vehicleId={currentAlert.vehicleId}
          plateNumber={currentAlert.plateNumber}
          vehicleMake={currentAlert.vehicleMake}
          vehicleModel={currentAlert.vehicleModel}
          vehicleColor={currentAlert.vehicleColor}
          photoUrl={currentAlert.photoUrl}
          alertMessage={currentAlert.message}
          alertDetails={currentAlert.details}
          onIgnore={handleAlertIgnore}
          onTakeAction={handleAlertTakeAction}
        />
      )}

      {/* VehicleEditDrawer - Overlays entire screen */}
      {showVehicleDrawer && currentScan && (
        <VehicleEditDrawer
          scan={currentScan}
          onClose={handleCloseDrawer}
          onUpdate={handleUpdateScan}
          onCreateIncident={() => {
            toast.info('Opening incident report for ' + currentScan.plateNumber);
          }}
          onCreateHSReport={() => {
            toast.info('Opening H&S report for ' + currentScan.plateNumber);
          }}
          onCreateMaintenanceReport={() => {
            toast.info('Opening maintenance report for ' + currentScan.plateNumber);
          }}
          // Navigation props
          showNavigation={notifications.length > 1}
          currentIndex={currentNotificationIndex}
          totalVehicles={notifications.length}
          onPrevious={handlePreviousVehicle}
          onNext={handleNextVehicle}
        />
      )}

      {/* Vehicle Details Popup - For driving mode with "wait for details" */}
      {showVehiclePopup && currentVehicleDetails && (
        <VehicleDetailsPopup
          open={showVehiclePopup}
          plateNumber={currentVehicleDetails.plateNumber}
          zoneName={zoneName}
          vehicleMake={currentVehicleDetails.vehicleMake}
          vehicleModel={currentVehicleDetails.vehicleModel}
          vehicleColor={currentVehicleDetails.vehicleColor}
          vehicleYear={currentVehicleDetails.vehicleYear}
          isSelfContained={currentVehicleDetails.isSelfContained || false}
          hasGreenSticker={currentVehicleDetails.hasGreenSticker}
          hasBlueSticker={currentVehicleDetails.hasBlueSticker}
          isCompliant={currentVehicleDetails.isCompliant ?? true}
          isHomeless={false} // TODO: Get from scan result
          isFlagged={currentVehicleDetails.isFlagged ?? false}
          isBreaching={!currentVehicleDetails.isCompliant}
          photoUrl={currentVehicleDetails.fullImageUrl || undefined}
          onClose={() => {
            setShowVehiclePopup(false);
            setCurrentVehicleDetails(null);
            setIsWorkflowLocked(false); // 🔓 Unlock camera on cancel
            toast.info('Scan cancelled - camera unlocked');
          }}
          onRetake={() => {
            setShowVehiclePopup(false);
            setCurrentVehicleDetails(null);
            setIsWorkflowLocked(false); // 🔓 Unlock camera for retake
            toast.info('Ready to retake photo');
          }}
          onUpdateDetails={async (details) => {
            // TODO: Update vehicle details via Edge Function
            toast.success('Vehicle details updated');
            setShowVehiclePopup(false);
            setCurrentVehicleDetails(null);
            setIsWorkflowLocked(false); // 🔓 Unlock camera after details updated
          }}

          onCheck={async (selfContainedStatus) => {
            // Record observation and show compliance result
            if (currentVehicleDetails) {
              // Use self-contained status from popup (user-selected)
              const updatedDetails = {
                ...currentVehicleDetails,
                isSelfContained: selfContainedStatus.isSelfContained,
                hasGreenSticker: selfContainedStatus.hasGreenSticker,
                hasBlueSticker: selfContainedStatus.hasBlueSticker,
              };
              
              // Record to database
              if (handheldMode === 'collect_details') {
                onPlateDetected(updatedDetails);
              }
              
              // Close details popup
              setShowVehiclePopup(false);
              setCurrentVehicleDetails(null);
              setIsWorkflowLocked(false);
              
              // Show compliance result
              setComplianceResult({
                isCompliant: updatedDetails.isCompliant ?? true,
                isBreach: !updatedDetails.isCompliant,
                isAtRisk: false, // TODO: Get from scan result
                alerts: [], // TODO: Get alerts from scan
                plateNumber: updatedDetails.plateNumber,
                vehicleDetails: updatedDetails,
              });
              setShowComplianceModal(true);
            }
          }}
        />
      )}
      
      {/* Scan Feedback Bubble */}
      <ScanFeedbackBubble
        show={showFeedbackBubble}
        type={feedbackType}
        message={feedbackMessage}
        duration={feedbackType === 'error' ? 3000 : 2000}
        onHide={() => setShowFeedbackBubble(false)}
      />

      {/* Manual Entry Modal - Auto-triggered when detection fails */}
      {showManualEntryModal && failedDetectionData && (
        <ManualEntryModal
          open={showManualEntryModal}
          capturedPhoto={failedDetectionData.image}
          photoUrl={failedDetectionData.photoUrl}
          gpsLocation={failedDetectionData.gpsLocation}
          zoneName={zoneName}
          onSubmit={handleManualEntrySubmit}
          onCancel={handleManualEntryCancel}
        />
      )}

      {/* Compliance Result Modal - Shows after Check button */}
      {showComplianceModal && complianceResult && (
        <ComplianceResultModal
          open={showComplianceModal}
          plateNumber={complianceResult.plateNumber}
          isCompliant={complianceResult.isCompliant}
          isBreach={complianceResult.isBreach}
          isAtRisk={complianceResult.isAtRisk}
          isHomeless={complianceResult.vehicleDetails?.isHomeless}
          hasHSIssue={complianceResult.vehicleDetails?.hasHSIssue}
          isFlagged={complianceResult.vehicleDetails?.isFlagged}
          alerts={complianceResult.alerts}
          onContinueScanning={() => {
            setShowComplianceModal(false);
            setComplianceResult(null);
            toast.success('Ready to scan next vehicle');
          }}
          onAddEvidence={() => {
            setShowComplianceModal(false);
            // Open evidence collection with vehicle details
            if (complianceResult.vehicleDetails) {
              handleOpenEvidenceCollection(complianceResult.vehicleDetails);
            }
          }}
          onGoToEnforcement={() => {
            setShowComplianceModal(false);
            toast.info('Opening enforcement workflow...');
            // TODO: Navigate to enforcement page with vehicle context
          }}
          onAcknowledge={() => {
            setShowComplianceModal(false);
            setComplianceResult(null);
            toast.success('Alert acknowledged - ready to continue');
          }}
        />
      )}
    </div>
  );
}
