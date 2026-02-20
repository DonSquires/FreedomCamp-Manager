/**
 * ZoomScan - Rapid ALPR Scanning Interface
 * 
 * Features:
 * - Manual capture (press button each time)
 * - Two-step process: recognize-plate → process-field-scan
 * - Auto-zone detection with GPS geofence
 * - Auto-start/resume patrol
 * - Results queue with auto-dismiss
 * - Photo retention in observations
 * - Vertical zoom slider, torch, GPS/time overlay
 * 
 * Workflow:
 * 1. Capture → Watermark
 * 2. Call recognize-plate (ALPR only)
 * 3. Call process-field-scan (observation creation)
 * 4. Queue result with auto-dismiss
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, X, Loader2, MapPin, Flashlight, ZoomIn } from 'lucide-react';
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
  confidence?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
}

interface ZoomScanProps {
  onExit: () => void;
}

export function ZoomScan({ onExit }: ZoomScanProps) {
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
  const [weatherConditions, setWeatherConditions] = useState<string>('');
  
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

  // Load available zones
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
        }
      } catch (error) {
        console.error('❌ Failed to load zones:', error);
      }
    };
    
    loadZones();
  }, [user?.organization_id]);

  // Fetch weather conditions when GPS is available
  useEffect(() => {
    const fetchWeather = async () => {
      if (!gpsLocation) return;
      
      try {
        const { data, error } = await supabase.functions.invoke('get-weather', {
          body: {
            latitude: gpsLocation.lat,
            longitude: gpsLocation.lng,
          },
        });
        
        if (!error && data?.weather) {
          setWeatherConditions(data.weather);
          console.log('🌤️ Weather:', data.weather);
        }
      } catch (error) {
        console.warn('⚠️ Weather fetch failed (non-critical):', error);
      }
    };
    
    fetchWeather();
  }, [gpsLocation?.lat, gpsLocation?.lng]);

  // Get GPS and auto-detect zone (ONCE only, no repeated popups)
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      console.warn('⚠️ Geolocation not supported');
      loadDefaultZone();
      return;
    }

    // Skip if zone already selected
    if (selectedZone) {
      console.log('✅ Zone already selected, skipping auto-detect');
      return;
    }

    setZoneDetectionStatus('detecting');
    let detectionTimeout: NodeJS.Timeout | null = null;
    let hasDetected = false;

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        // Only detect once
        if (hasDetected) return;
        hasDetected = true;

        const gps = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        
        setGpsLocation(gps);
        
        if (user?.organization_id) {
          await autoDetectZone(gps.lat, gps.lng, user.organization_id);
        }

        // Clear timeout after first successful GPS read
        if (detectionTimeout) {
          clearTimeout(detectionTimeout);
          detectionTimeout = null;
        }
      },
      (error) => {
        console.error('❌ GPS error:', error);
        if (detectionTimeout) {
          clearTimeout(detectionTimeout);
        }
        setZoneDetectionStatus('failed');
        loadDefaultZone();
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0, // Always get fresh location
      }
    );

    // Fallback timeout: auto-select "Other Location" after 8 seconds if no zone found
    detectionTimeout = setTimeout(async () => {
      if (!selectedZone && user?.organization_id) {
        console.log('⏰ Auto-detect timeout - setting to Other Location');
        await autoCreateOrSelectOtherLocation(user.organization_id);
      }
    }, 8000);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (detectionTimeout) {
        clearTimeout(detectionTimeout);
      }
    };
  }, [user?.organization_id, selectedZone]);

  const loadDefaultZone = async () => {
    if (!user?.organization_id || availableZones.length === 0) return;
    setSelectedZone(availableZones[0]);
    setZoneDetectionStatus('found');
  };

  const autoDetectZone = async (lat: number, lng: number, organizationId: string) => {
    try {
      const { data: matchingZones } = await supabase
        .rpc('find_all_matching_zones', {
          p_latitude: lat,
          p_longitude: lng,
          p_organization_id: organizationId,
        });

      if (matchingZones && matchingZones.length > 0) {
        // Inside a geofence - use detected zone
        const zone = matchingZones[0];
        setSelectedZone({
          id: zone.zone_id,
          name: zone.zone_name,
          organization_id: organizationId,
        });
        setZoneDetectionStatus('found');
        console.log('📍 GPS inside geofence:', zone.zone_name);
        toast.success(`📍 Zone: ${zone.zone_name}`, {
          duration: 2000,
        });
      } else {
        // Outside all geofences - auto-create/select "Other Location"
        console.log('📍 GPS outside all geofences, auto-setting Other Location');
        await autoCreateOrSelectOtherLocation(organizationId);
      }
    } catch (error) {
      console.error('❌ Auto-detect zone failed:', error);
      setZoneDetectionStatus('failed');
      // Don't show toast or modal - silently fall back to Other Location
      await autoCreateOrSelectOtherLocation(organizationId);
    }
  };

  const autoCreateOrSelectOtherLocation = async (organizationId: string) => {
    try {
      // Try to find existing "Other Location" zone
      const { data: fallbackZone } = await supabase
        .from('zones')
        .select('id, name, organization_id')
        .eq('organization_id', organizationId)
        .eq('zone_type', 'fallback')
        .ilike('name', '%Other%')
        .maybeSingle();

      if (fallbackZone) {
        setSelectedZone({
          id: fallbackZone.id,
          name: fallbackZone.name,
          organization_id: fallbackZone.organization_id,
        });
        setZoneDetectionStatus('found');
        console.log('📍 Auto-set to:', fallbackZone.name);
        toast.info(`📍 Zone: ${fallbackZone.name}`, {
          duration: 2000,
        });
      } else {
        // Create "Other Location" zone
        const { data: newZone, error } = await supabase
          .from('zones')
          .insert({
            organization_id: organizationId,
            name: 'Other Location',
            zone_type: 'fallback',
            description: 'Fallback zone for GPS locations outside defined geofences',
            is_active: true,
          })
          .select()
          .single();
        
        if (!error && newZone) {
          setSelectedZone({
            id: newZone.id,
            name: newZone.name,
            organization_id: newZone.organization_id,
          });
          setZoneDetectionStatus('found');
          console.log('📍 Created and set to: Other Location');
          toast.info('📍 Zone: Other Location', {
            duration: 2000,
          });
        } else {
          // Last resort: use first available zone
          if (availableZones.length > 0) {
            setSelectedZone(availableZones[0]);
            setZoneDetectionStatus('found');
            console.log('📍 Fallback to first zone:', availableZones[0].name);
          } else {
            setZoneDetectionStatus('failed');
          }
        }
      }
    } catch (error) {
      console.error('❌ Failed to create/select Other Location:', error);
      // Use first available zone as last resort
      if (availableZones.length > 0) {
        setSelectedZone(availableZones[0]);
        setZoneDetectionStatus('found');
      } else {
        setZoneDetectionStatus('failed');
      }
    }
  };

  // Auto-start patrol
  useEffect(() => {
    if (!selectedZone || !user?.id) return;

    const checkOrStartPatrol = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const currentHour = new Date().getHours();
        const shift = currentHour < 12 ? 'morning' : currentHour < 18 ? 'afternoon' : 'evening';

        const { data: existingPatrol } = await supabase
          .from('patrols')
          .select('*')
          .eq('zone_id', selectedZone.id)
          .eq('patrol_date', today)
          .eq('shift', shift)
          .eq('assigned_to', user.id)
          .maybeSingle();

        if (existingPatrol) {
          if (!existingPatrol.checked_in_at) {
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
              toast.success('Patrol resumed');
            }
          } else {
            setCurrentPatrol(existingPatrol);
          }
        } else {
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
            toast.success('Patrol started');
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
      videoTrack.applyConstraints({ advanced: [{ zoom: zoomLevel }] }).catch(() => {});
    }
  }, [zoomLevel]);

  // Apply torch
  useEffect(() => {
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    const capabilities = videoTrack.getCapabilities();
    if (capabilities.torch) {
      videoTrack.applyConstraints({ advanced: [{ torch: torchEnabled }] }).catch(() => {});
    }
  }, [torchEnabled]);

  // Capture and process with PARALLEL SPLIT workflow
  // Path A: Raw photo → ALPR (clean image)
  // Path B: Watermarked photo → Storage (evidence)
  const captureAndProcess = async () => {
    if (!videoRef.current || !canvasRef.current || !user || !selectedZone) {
      toast.error('Not ready to scan');
      return;
    }

    setProcessingCount(prev => prev + 1);

    const tempId = `temp-${Date.now()}`;
    const tempItem: QueueItem = {
      id: tempId,
      plateNumber: 'Processing...',
      status: 'processing',
      details: '🔄 Recognizing plate...',
      timestamp: new Date(),
    };
    setQueue(prev => [tempItem, ...prev]);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas not available');

      // ============================================================================
      // STEP 1: Capture RAW photo (no watermark)
      // ============================================================================
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);

      // Save raw image data for ALPR (clean, unwatermarked)
      const rawImageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
      console.log('📸 Raw photo captured (for ALPR)');

      // ============================================================================
      // STEP 2: PARALLEL PROCESSING (Fork A + Fork B)
      // ============================================================================
      
      // Fork A: Send RAW photo to ALPR (no watermark interference)
      const alprPromise = (async () => {
        console.log('📤 Fork A: Sending to ALPR...');
        const { data: alprData, error: alprError } = await supabase.functions.invoke('recognize-plate', {
          body: {
            image: rawImageDataUrl,
            regions: ['nz'],
            enableMMC: true,
          },
        });

        if (alprError) {
          let errorMessage = alprError.message;
          if (alprError.name === 'FunctionsHttpError' && alprError.context) {
            try {
              const statusCode = alprError.context?.status ?? 500;
              const textContent = await alprError.context?.text();
              errorMessage = `[Code: ${statusCode}] ${textContent || alprError.message || 'Unknown error'}`;
            } catch {
              errorMessage = `${alprError.message || 'Failed to read response'}`;
            }
          }
          throw new Error(`ALPR: ${errorMessage}`);
        }

        if (!alprData?.success || !alprData?.plate_number) {
          throw new Error('No plate detected by ALPR');
        }

        console.log('✅ Fork A: ALPR detected:', alprData.plate_number);
        return alprData;
      })();

      // Fork B: Add watermark and upload to storage
      const storagePromise = (async () => {
        console.log('📤 Fork B: Creating watermarked photo...');
        
        // Re-draw image (fresh canvas)
        context.drawImage(video, 0, 0);
        
        // Add watermark overlay
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
        if (weatherConditions) {
          context.fillText(`🌤️ ${weatherConditions}`, 20, 135);
        }

        // Convert to blob and upload
        const watermarkedBlob = await new Promise<Blob>((resolve) => {
          canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.95);
        });
        
        const fileName = `scans/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        
        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(fileName, watermarkedBlob);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('evidence')
          .getPublicUrl(fileName);
        
        console.log('✅ Fork B: Watermarked photo uploaded');
        return publicUrl;
      })();

      // ============================================================================
      // STEP 3: Wait for BOTH forks to complete
      // ============================================================================
      const [alprData, publicUrl] = await Promise.all([alprPromise, storagePromise]);
      
      console.log('✅ Both forks completed!');
      playSounds.plateRecognized();

      // ============================================================================
      // STEP 4: Create observation with ALPR data + watermarked photo
      // ============================================================================
      console.log('📤 Creating observation...');
      const { data: scanResult, error: scanError } = await supabase.functions.invoke('process-field-scan', {
        body: {
          plateNumber: alprData.plate_number,
          zoneId: selectedZone.id,
          organizationId: selectedZone.organization_id,
          imageUrl: publicUrl,
          gpsLocation: gpsLocation,
          vehicleDetails: {
            make: alprData.vehicle_make,
            model: alprData.vehicle_model,
            color: alprData.vehicle_color,
            year: alprData.vehicle_year,
          },
          detectionMethod: 'alpr',
          confidence: alprData.confidence,
          isSelfContained: false,
          weatherConditions: weatherConditions || undefined,
        },
      });

      if (scanError) {
        let errorMessage = scanError.message;
        if (scanError.name === 'FunctionsHttpError' && scanError.context) {
          try {
            const statusCode = scanError.context?.status ?? 500;
            const textContent = await scanError.context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || scanError.message || 'Unknown error'}`;
          } catch {
            errorMessage = `${scanError.message || 'Failed to read response'}`;
          }
        }
        throw new Error(errorMessage);
      }

      if (!scanResult?.success) {
        throw new Error(scanResult?.error || 'Scan processing failed');
      }

      console.log('✅ Observation created:', scanResult);
      playSounds.processingComplete();

      // STEP 5: Determine status
      let status: QueueItem['status'] = 'compliant';
      let details = '✅ Compliant';

      if (scanResult.is_flagged) {
        status = 'breach';
        details = `🚩 FLAGGED: ${scanResult.flagged_details?.reason || 'Watch list'}`;
      } else if (!scanResult.is_compliant) {
        status = 'breach';
        details = '⚠️ Non-compliant with zone requirements';
      }

      const newItem: QueueItem = {
        id: scanResult.observation_id || `scan-${Date.now()}`,
        plateNumber: alprData.plate_number,
        status,
        details,
        timestamp: new Date(),
        confidence: alprData.confidence,
        vehicleMake: alprData.vehicle_make,
        vehicleModel: alprData.vehicle_model,
        vehicleColor: alprData.vehicle_color,
      };

      setQueue(prev => {
        const filtered = prev.filter(item => item.id !== tempId);
        return [newItem, ...filtered];
      });

      // Auto-dismiss compliant after 5s
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
      <div className="h-1/4 overflow-y-auto bg-gray-900 border-b-4 border-blue-500">
        <div className="sticky top-0 bg-gray-900 z-10 p-2 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-bold text-sm flex items-center gap-2">
              🔍 ZoomScan Queue
              {queue.length > 0 && <Badge variant="secondary">{queue.length}</Badge>}
              {processingCount > 0 && (
                <Badge variant="outline" className="bg-blue-500/20 border-blue-500 text-blue-100">
                  🔄 {processingCount}
                </Badge>
              )}
            </h3>
            {currentPatrol && (
              <Badge variant="outline" className="text-xs bg-green-500/20 border-green-500 text-green-100">
                ✓ Patrol
              </Badge>
            )}
          </div>
        </div>
        
        {queue.length === 0 ? (
          <div className="flex items-center justify-center h-[calc(100%-3rem)] text-gray-400">
            <div className="text-center">
              <Camera className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Press capture to scan</p>
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
                  item.status === 'compliant' && "bg-green-50 dark:bg-green-950/30 border-green-500",
                  item.status === 'breach' && "bg-red-50 dark:bg-red-950/30 border-red-500",
                  item.status === 'fc_exempt' && "bg-cyan-50 dark:bg-cyan-950/30 border-cyan-500"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div>
                    <p className="font-black text-lg">{item.plateNumber}</p>
                    {item.vehicleMake && (
                      <p className="text-xs text-muted-foreground">
                        {item.vehicleColor} {item.vehicleMake} {item.vehicleModel}
                      </p>
                    )}
                  </div>
                  <Badge variant={item.status === 'compliant' ? 'default' : 'destructive'}>
                    {item.status === 'processing' && '🔄'}
                    {item.status === 'compliant' && '✅'}
                    {item.status === 'breach' && '⚠️'}
                    {item.status === 'fc_exempt' && '🏕️'}
                  </Badge>
                </div>
                <p className="text-xs mb-2">{item.details}</p>
                {item.confidence && (
                  <p className="text-[10px] text-muted-foreground">
                    Confidence: {Math.round(item.confidence * 100)}%
                  </p>
                )}
                {item.status !== 'processing' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDismiss(item.id)}
                    className="h-8 text-xs mt-1"
                  >
                    Dismiss
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
        
        {/* Zone/GPS/Time Overlay - 50% opacity */}
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md rounded-lg p-3 border border-white/20 opacity-50">
          <div className="text-white space-y-1">
            <p className="font-bold text-sm">
              {zoneDetectionStatus === 'detecting' && '🔍 Detecting...'}
              {zoneDetectionStatus === 'found' && selectedZone?.name}
              {(zoneDetectionStatus === 'failed' || zoneDetectionStatus === 'idle') && (
                <button onClick={() => setShowZoneSelector(true)} className="text-yellow-300 underline">
                  ⚠️ Select Zone
                </button>
              )}
            </p>
            {gpsLocation && (
              <p className="text-xs">📍 {gpsLocation.lat.toFixed(5)}, {gpsLocation.lng.toFixed(5)}</p>
            )}
            <p className="text-xs">📅 {currentTime.toLocaleDateString('en-NZ')}</p>
            <p className="text-xs">🕐 {currentTime.toLocaleTimeString('en-NZ')}</p>
          </div>
        </div>

        {/* Zoom Slider */}
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
          />
          <span className="text-white text-xs font-bold">{zoomLevel.toFixed(1)}x</span>
        </div>

        {/* Torch Toggle */}
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

        {/* Zone Selector Modal */}
        {showZoneSelector && (
          <>
            <div className="fixed inset-0 bg-black/80 z-40" onClick={() => setShowZoneSelector(false)} />
            <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl z-50 max-h-[70vh] flex flex-col">
              <div className="p-4 border-b-2">
                <p className="text-base font-bold flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Select Zone
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
                      toast.success(`Zone: ${zone.name}`);
                    }}
                    className={cn(
                      "w-full text-left px-5 py-4 rounded-xl text-base transition-all",
                      selectedZone?.id === zone.id
                        ? "bg-primary text-primary-foreground shadow-lg border-2 border-primary/50"
                        : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-2 border-transparent"
                    )}
                  >
                    {zone.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Capture Button */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <Button
            onClick={captureAndProcess}
            disabled={!cameraReady || !selectedZone}
            className={cn(
              "h-24 w-24 rounded-full shadow-[0_0_40px_rgba(59,130,246,0.8)] border-8 relative",
              !selectedZone 
                ? "bg-yellow-500 hover:bg-yellow-600 border-yellow-600" 
                : "bg-blue-500 hover:bg-blue-600 border-blue-700"
            )}
            size="lg"
          >
            {!cameraReady ? (
              <Loader2 className="h-12 w-12 animate-spin" />
            ) : (
              <Camera className="h-12 w-12 text-white" />
            )}
            {processingCount > 0 && (
              <div className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full h-8 w-8 flex items-center justify-center text-xs font-bold border-2 border-white">
                {processingCount}
              </div>
            )}
          </Button>
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
