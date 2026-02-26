/**
 * Plate Scanner - Brand New Mini Portal for ALPR Scanning
 * 
 * Features:
 * - Auto-set zone from GPS geofence
 * - Auto-start/resume patrol
 * - Continuous rapid scanning
 * - Results queue with auto-dismiss
 * - Photo retention in observation_v2
 * - Vertical zoom slider, torch, GPS/time overlay
 * 
 * Workflow:
 * 1. Capture → Watermark → Upload (RETAIN PHOTO)
 * 2. ALPR recognition
 * 3. Process field scan → Creates observation
 * 4. Queue result with auto-dismiss logic
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, X, Loader2, MapPin, Clock, Flashlight, ZoomIn, Navigation, Calendar } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { playSounds } from '@/lib/sounds';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface QueueItem {
  id: string;
  plateNumber: string;
  status: 'compliant' | 'breach' | 'at_risk' | 'fc_exempt' | 'processing';
  details: string;
  timestamp: Date;
}

interface PlateScannerProps {
  onExit: () => void;
}

export function PlateScanner({ onExit }: PlateScannerProps) {
  const { user } = useAuthStore();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processingCount, setProcessingCount] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  
  // Camera controls
  const [zoomLevel, setZoomLevel] = useState(1);
  const [torchEnabled, setTorchEnabled] = useState(false);
  
  // Location & time
  const [currentTime, setCurrentTime] = useState(new Date());
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [selectedZone, setSelectedZone] = useState<{ id: string; name: string; organization_id: string } | null>(null);
  const [currentPatrol, setCurrentPatrol] = useState<{ id: string; zone_id: string; shift: string } | null>(null);
  const [zoneDetectionStatus, setZoneDetectionStatus] = useState<'idle' | 'detecting' | 'found' | 'failed'>('idle');
  const [availableZones, setAvailableZones] = useState<Array<{ id: string; name: string; organization_id: string }>>([]);
  const [showZoneSelector, setShowZoneSelector] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Initialize camera
  useEffect(() => {
    let mounted = true;
    
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
          setCameraReady(true);
        }
      } catch (error) {
        console.error('❌ Camera error:', error);
        toast.error('Failed to access camera');
      }
    };

    initCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Load available zones on mount
  useEffect(() => {
    const loadZones = async () => {
      if (!user?.organization_id) return;
      
      try {
        const { data: zones } = await supabase
          .from('zones')
          .select('id, name, organization_id')
          .eq('organization_id', user.organization_id)
          .eq('is_active', true)
          .order('name');
        
        if (zones && zones.length > 0) {
          setAvailableZones(zones);
          console.log(`📍 Loaded ${zones.length} zones`);
        } else {
          console.warn('⚠️ No zones found for organization');
          toast.error('No zones configured - please contact admin');
        }
      } catch (error) {
        console.error('❌ Failed to load zones:', error);
      }
    };
    
    loadZones();
  }, [user?.organization_id]);

  // Get GPS location and auto-detect zone
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      console.warn('⚠️ Geolocation not supported');
      loadDefaultZone();
      return;
    }

    setZoneDetectionStatus('detecting');
    const detectionTimeout = setTimeout(() => {
      if (!selectedZone) {
        console.warn('⚠️ Zone detection timeout - showing manual selector');
        setZoneDetectionStatus('failed');
        setShowZoneSelector(true);
        toast.warning('Auto-detect failed - please select zone manually');
      }
    }, 5000); // 5 second timeout

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const gps = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        
        setGpsLocation(gps);
        
        // Auto-detect zone from GPS
        if (user?.organization_id) {
          await autoDetectZone(gps.lat, gps.lng, user.organization_id);
        }
      },
      (error) => {
        console.error('❌ GPS error:', error);
        clearTimeout(detectionTimeout);
        setZoneDetectionStatus('failed');
        loadDefaultZone();
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(detectionTimeout);
    };
  }, [user?.organization_id]);

  // Load default zone if GPS fails
  const loadDefaultZone = async () => {
    if (!user?.organization_id) return;

    try {
      const { data: zones } = await supabase
        .from('zones')
        .select('id, name, organization_id')
        .eq('organization_id', user.organization_id)
        .eq('is_active', true)
        .order('name')
        .limit(1);

      if (zones && zones.length > 0) {
        setSelectedZone(zones[0]);
        setZoneDetectionStatus('found');
        console.log('📍 Default zone set:', zones[0].name);
      } else {
        setZoneDetectionStatus('failed');
        setShowZoneSelector(true);
        toast.error('No zones available - please contact admin');
      }
    } catch (error) {
      console.error('❌ Failed to load default zone:', error);
      setZoneDetectionStatus('failed');
      setShowZoneSelector(true);
    }
  };

  // Auto-detect zone from GPS geofence
  const autoDetectZone = async (lat: number, lng: number, organizationId: string) => {
    try {
      const { data: matchingZones } = await supabase
        .rpc('find_all_matching_zones', {
          p_latitude: lat,
          p_longitude: lng,
          p_organization_id: organizationId,
        });

      if (matchingZones && matchingZones.length > 0) {
        // Use first matching zone
        const zone = matchingZones[0];
        if (!selectedZone || selectedZone.id !== zone.zone_id) {
          setSelectedZone({
            id: zone.zone_id,
            name: zone.zone_name,
            organization_id: organizationId,
          });
          setZoneDetectionStatus('found');
          console.log('📍 Auto-detected zone:', zone.zone_name);
          toast.success(`Zone detected: ${zone.zone_name}`);
        }
      } else {
        // Outside geofences - use "Other Location" fallback
        const { data: fallbackZone } = await supabase
          .from('zones')
          .select('id, name, organization_id')
          .eq('organization_id', organizationId)
          .eq('zone_type', 'fallback')
          .ilike('name', '%Other Location%')
          .single();

        if (fallbackZone && (!selectedZone || selectedZone.id !== fallbackZone.id)) {
          setSelectedZone(fallbackZone);
          setZoneDetectionStatus('found');
          console.log('📍 Auto-set to Other Location (outside geofences)');
          toast.info('Outside patrol zones - using Other Location');
        } else {
          // No fallback zone found - show manual selector
          console.warn('⚠️ No zones match GPS and no fallback zone exists');
          setZoneDetectionStatus('failed');
          setShowZoneSelector(true);
          toast.warning('Outside patrol zones - please select manually');
        }
      }
    } catch (error) {
      console.error('❌ Auto-detect zone failed:', error);
      setZoneDetectionStatus('failed');
      // Don't show selector yet - wait for timeout
    }
  };

  // Auto-start or resume patrol when zone detected
  useEffect(() => {
    if (!selectedZone || !user?.id) return;

    const checkOrStartPatrol = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const currentHour = new Date().getHours();
        const shift = currentHour < 12 ? 'morning' : currentHour < 18 ? 'afternoon' : 'evening';

        // Check for existing patrol
        const { data: existingPatrol } = await supabase
          .from('patrols')
          .select('*')
          .eq('zone_id', selectedZone.id)
          .eq('patrol_date', today)
          .eq('shift', shift)
          .eq('assigned_to', user.id)
          .maybeSingle();

        if (existingPatrol) {
          // Resume existing patrol
          if (!existingPatrol.checked_in_at) {
            // Auto check-in
            const { data: updated } = await supabase
              .from('patrols')
              .update({
                checked_in_at: new Date().toISOString(),
                check_in_location_lat: gpsLocation?.lat,
                check_in_location_lng: gpsLocation?.lng,
                status: 'in_progress',
              })
              .eq('id', existingPatrol.id)
              .select()
              .single();

            if (updated) {
              setCurrentPatrol(updated);
              console.log('✅ Auto checked-in to existing patrol');
              toast.success('Patrol resumed');
            }
          } else {
            setCurrentPatrol(existingPatrol);
            console.log('✅ Existing patrol active');
          }
        } else {
          // Create new patrol
          const { data: newPatrol } = await supabase
            .from('patrols')
            .insert({
              organization_id: selectedZone.organization_id,
              zone_id: selectedZone.id,
              patrol_date: today,
              shift,
              assigned_to: user.id,
              checked_in_at: new Date().toISOString(),
              check_in_location_lat: gpsLocation?.lat,
              check_in_location_lng: gpsLocation?.lng,
              status: 'in_progress',
            })
            .select()
            .single();

          if (newPatrol) {
            setCurrentPatrol(newPatrol);
            console.log('✅ Auto-started new patrol');
            toast.success('New patrol started');
          }
        }
      } catch (error) {
        console.error('❌ Patrol setup failed:', error);
      }
    };

    checkOrStartPatrol();
  }, [selectedZone?.id, user?.id, gpsLocation]);

  // Apply zoom
  useEffect(() => {
    if (!streamRef.current) return;

    const videoTrack = streamRef.current.getVideoTracks()[0];
    const capabilities = videoTrack.getCapabilities();

    if (capabilities.zoom) {
      videoTrack.applyConstraints({
        advanced: [{ zoom: zoomLevel }]
      }).catch(err => console.error('❌ Zoom error:', err));
    }
  }, [zoomLevel]);

  // Apply torch
  useEffect(() => {
    if (!streamRef.current) return;

    const videoTrack = streamRef.current.getVideoTracks()[0];
    const capabilities = videoTrack.getCapabilities();

    if (capabilities.torch) {
      videoTrack.applyConstraints({
        advanced: [{ torch: torchEnabled }]
      }).catch(err => console.error('❌ Torch error:', err));
    }
  }, [torchEnabled]);

  // Capture and process scan
  const captureAndProcess = async () => {
    if (!videoRef.current || !canvasRef.current || !user || !selectedZone) {
      toast.error('Not ready to scan');
      return;
    }

    // Non-blocking - increment processing count
    setProcessingCount(prev => prev + 1);

    // Add temp queue item immediately
    const tempId = `temp-${Date.now()}`;
    const tempItem: QueueItem = {
      id: tempId,
      plateNumber: 'Processing...',
      status: 'processing',
      details: '🔄 Analyzing plate...',
      timestamp: new Date(),
    };
    setQueue(prev => [tempItem, ...prev]);

    try {
      // STEP 1: Capture photo
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context not available');

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);

      // Add watermark (zone, GPS, timestamp)
      context.fillStyle = 'rgba(0, 0, 0, 0.7)';
      context.fillRect(10, 10, 400, 120);
      context.fillStyle = 'white';
      context.font = 'bold 16px monospace';
      context.fillText(selectedZone.name, 20, 35);
      if (gpsLocation) {
        context.fillText(`📍 ${gpsLocation.lat.toFixed(5)}, ${gpsLocation.lng.toFixed(5)}`, 20, 60);
      }
      context.fillText(new Date().toLocaleString('en-NZ'), 20, 85);
      context.fillText(`Patrol: ${currentPatrol?.shift || 'N/A'}`, 20, 110);

      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
      console.log('📸 Photo captured with watermark');

      // STEP 2: Upload photo to storage (RETAIN BEFORE ALPR)
      const blob = await fetch(imageDataUrl).then(r => r.blob());
      const fileName = `scans/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('evidence')
        .getPublicUrl(fileName);
      
      console.log('✅ Photo uploaded:', publicUrl);

      // STEP 3: Call UNIFIED plate-scanner-photo-first function
      console.log('📤 Processing with unified photo-first ingest...');
      const { data: scanResult, error: scanError } = await supabase.functions.invoke('plate-scanner-photo-first', {
        body: {
          image: imageDataUrl,
          zoneId: selectedZone.id,
          organizationId: selectedZone.organization_id,
          userId: user.id,
          recordedAt: new Date().toISOString(),
          gpsLocation: gpsLocation ? {
            lat: gpsLocation.lat,
            lng: gpsLocation.lng,
            accuracy: gpsLocation.accuracy,
          } : null,
          idempotencyKey: `driving:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        },
      });

      if (scanError) {
        let errorMessage = scanError.message;
        if (scanError.name === 'FunctionsHttpError' && scanError.context) {
          try {
            errorMessage = await scanError.context.text() || errorMessage;
          } catch {}
        }
        throw new Error(errorMessage);
      }

      if (!scanResult?.success) {
        throw new Error(scanResult?.error || 'Scan failed');
      }

      console.log('✅ Photo-first ingest complete:', scanResult);

      // STEP 4: Determine status (initially just show plate detected)
      // Compliance evaluation happens via trigger - poll get_observation_result() for full details
      let status: QueueItem['status'] = 'compliant';
      let details = `✅ Plate detected: ${scanResult.plate_number || 'PENDING'}`;

      if (scanResult.plate_number) {
        playSounds.processingComplete();
      } else {
        details = '⏳ ALPR processing...';
        playSounds.processingComplete();
      }

      const newItem: QueueItem = {
        id: scanResult.observation_id || `scan-${Date.now()}`,
        plateNumber: scanResult.plate_number || 'PROCESSING',
        status,
        details,
        timestamp: new Date(),
      };

      // Replace temp item
      setQueue(prev => {
        const filtered = prev.filter(item => item.id !== tempId);
        return [newItem, ...filtered];
      });

      // Auto-dismiss compliant and homeless after 5s
      if (status === 'compliant' || status === 'fc_exempt') {
        setTimeout(() => {
          setQueue(prev => prev.filter(item => item.id !== newItem.id));
        }, 5000);
      }

    } catch (error: any) {
      console.error('❌ Scan error:', error);
      
      const errorItem: QueueItem = {
        id: `error-${Date.now()}`,
        plateNumber: 'FAILED',
        status: 'breach',
        details: `❌ ${error.message}`,
        timestamp: new Date(),
      };
      
      setQueue(prev => {
        const filtered = prev.filter(item => item.id !== tempId);
        return [errorItem, ...filtered];
      });
      
      // Auto-dismiss error after 10s
      setTimeout(() => {
        setQueue(prev => prev.filter(item => item.id !== errorItem.id));
      }, 10000);
    } finally {
      setProcessingCount(prev => prev - 1);
    }
  };

  const handleDismiss = (itemId: string) => {
    setQueue(prev => prev.filter(item => item.id !== itemId));
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black z-[9999]">
      {/* TOP 1/4: Queue */}
      <div className="h-1/4 overflow-y-auto bg-gray-900 border-b-4 border-yellow-500">
        <div className="sticky top-0 bg-gray-900 z-10 p-2 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-bold text-sm flex items-center gap-2">
              📋 Scan Queue
              {queue.length > 0 && <Badge variant="secondary">{queue.length}</Badge>}
              {processingCount > 0 && (
                <Badge variant="outline" className="bg-blue-500/20 border-blue-500 text-blue-100">
                  🔄 {processingCount}
                </Badge>
              )}
            </h3>
            {currentPatrol && (
              <Badge variant="outline" className="text-xs bg-green-500/20 border-green-500 text-green-100">
                ✓ Patrol Active
              </Badge>
            )}
          </div>
        </div>
        
        {queue.length === 0 ? (
          <div className="flex items-center justify-center h-[calc(100%-3rem)] text-gray-400">
            <div className="text-center">
              <Camera className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Ready to scan</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 p-2">
            {queue.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "p-3 rounded-lg border-2",
                  item.status === 'processing' && "bg-gray-800 border-gray-600 animate-pulse",
                  item.status === 'compliant' && "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700",
                  item.status === 'breach' && "bg-red-50 dark:bg-red-950/30 border-red-500",
                  item.status === 'at_risk' && "bg-amber-50 dark:bg-amber-950/30 border-amber-500",
                  item.status === 'fc_exempt' && "bg-cyan-50 dark:bg-cyan-950/30 border-cyan-500"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className={cn(
                    "font-black text-lg",
                    item.status === 'processing' && "text-gray-400"
                  )}>
                    {item.plateNumber}
                  </p>
                  <Badge variant={
                    item.status === 'compliant' ? 'default' :
                    item.status === 'fc_exempt' ? 'outline' :
                    'destructive'
                  }>
                    {item.status === 'processing' && '🔄'}
                    {item.status === 'compliant' && '🟢'}
                    {item.status === 'breach' && '🔴'}
                    {item.status === 'at_risk' && '🟡'}
                    {item.status === 'fc_exempt' && '🏕️'}
                  </Badge>
                </div>
                <p className="text-xs mb-2">{item.details}</p>
                {item.status !== 'processing' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDismiss(item.id)}
                    className="h-8 text-xs"
                  >
                    ✓ Dismiss
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BOTTOM 3/4: Camera */}
      <div className="flex-1 relative overflow-hidden bg-black">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="absolute inset-0 w-full h-full object-cover" 
        />
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Zone/GPS/Time Info - Top Left - 50% Opacity - ZoomScan Style */}
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md rounded-lg p-3 border border-white/20 opacity-50">
          <div className="text-white space-y-1">
            {/* Zone Name - Always visible, clickable if not set */}
            <p className="font-bold text-sm">
              {zoneDetectionStatus === 'detecting' && '🔍 Detecting zone...'}
              {zoneDetectionStatus === 'found' && selectedZone?.name}
              {(zoneDetectionStatus === 'failed' || zoneDetectionStatus === 'idle') && (
                <button
                  onClick={() => setShowZoneSelector(true)}
                  className="text-yellow-300 underline hover:text-yellow-100"
                >
                  ⚠️ Select Zone
                </button>
              )}
            </p>
            
            {/* GPS Coordinates - Always show if available */}
            {gpsLocation && (
              <p className="text-xs">
                📍 {gpsLocation.lat.toFixed(5)}, {gpsLocation.lng.toFixed(5)}
              </p>
            )}
            
            {/* Date */}
            <p className="text-xs">
              📅 {currentTime.toLocaleDateString('en-NZ')}
            </p>
            
            {/* Time */}
            <p className="text-xs">
              🕐 {currentTime.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Vertical Zoom Slider - Right Side */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-4 bg-black/50 backdrop-blur-md rounded-full p-4 border border-white/20 opacity-50">
          <ZoomIn className="h-5 w-5 text-white" />
          <input
            type="range"
            min="1"
            max="5"
            step="0.1"
            value={zoomLevel}
            onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
            className="w-48 -rotate-90 origin-center"
            style={{
              WebkitAppearance: 'slider-vertical',
              writingMode: 'bt-lr',
            }}
          />
          <span className="text-white text-xs font-bold">{zoomLevel.toFixed(1)}x</span>
        </div>

        {/* Torch Toggle - Left Bottom */}
        <div className="absolute left-6 bottom-32 opacity-50">
          <Button
            onClick={() => setTorchEnabled(!torchEnabled)}
            variant="ghost"
            size="icon"
            className={cn(
              "h-14 w-14 rounded-full backdrop-blur-md border",
              torchEnabled 
                ? "bg-yellow-500/80 border-yellow-300 text-white" 
                : "bg-black/60 border-white/20 text-white"
            )}
          >
            <Flashlight className="h-7 w-7" />
          </Button>
        </div>

        {/* Manual Zone Selector Modal */}
        {showZoneSelector && (
          <>
            <div 
              className="fixed inset-0 bg-black/80 z-40"
              onClick={() => setShowZoneSelector(false)}
            />
            <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl z-50 max-h-[70vh] flex flex-col">
              <div className="p-4 border-b-2 border-gray-200 dark:border-gray-700 bg-primary/10">
                <p className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Select Zone
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {availableZones.length} zone{availableZones.length !== 1 ? 's' : ''} available
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {availableZones.map((zone) => (
                  <button
                    key={zone.id}
                    onClick={() => {
                      setSelectedZone(zone);
                      setZoneDetectionStatus('found');
                      setShowZoneSelector(false);
                      toast.success(`Zone selected: ${zone.name}`);
                    }}
                    className={cn(
                      "w-full text-left px-5 py-4 rounded-xl text-base touch-manipulation transition-all",
                      selectedZone?.id === zone.id
                        ? "bg-primary text-primary-foreground shadow-lg border-2 border-primary/50"
                        : "bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 border-2 border-transparent"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {selectedZone?.id === zone.id && <MapPin className="h-5 w-5" />}
                      <span className="font-bold">{zone.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Capture Button - Show warning if no zone, but don't disable */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <Button
            onClick={captureAndProcess}
            disabled={!cameraReady || !selectedZone}
            className={cn(
              "h-24 w-24 rounded-full shadow-[0_0_40px_rgba(255,255,255,0.8)] border-8 relative",
              !selectedZone 
                ? "bg-yellow-500 hover:bg-yellow-600 text-white border-yellow-600" 
                : "bg-white hover:bg-gray-200 text-black border-green-500"
            )}
            size="lg"
          >
            {!cameraReady ? (
              <Loader2 className="h-12 w-12 text-gray-400 animate-spin" />
            ) : !selectedZone ? (
              <div className="text-center">
                <MapPin className="h-8 w-8 mx-auto mb-1" />
                <p className="text-[10px] font-bold">Select</p>
                <p className="text-[10px] font-bold">Zone</p>
              </div>
            ) : (
              <Camera className="h-12 w-12 text-green-600" />
            )}
            {processingCount > 0 && (
              <div className="absolute -top-2 -right-2 bg-blue-500 text-white rounded-full h-8 w-8 flex items-center justify-center text-xs font-bold border-2 border-white">
                {processingCount}
              </div>
            )}
          </Button>
          {!selectedZone && (
            <p className="text-white text-xs text-center mt-2 bg-black/60 px-3 py-1 rounded-full animate-pulse">
              👆 Tap yellow button or zone name above
            </p>
          )}
        </div>

        {/* Exit Button */}
        <div className="absolute top-4 right-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onExit}
            className="h-12 w-12 bg-black/60 hover:bg-black/80 text-white rounded-full"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      </div>
    </div>
  );
}
