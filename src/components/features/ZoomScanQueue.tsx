/**
 * Zoom Scan Queue Component
 * Split-screen layout: Top 1/4 queue + Bottom 3/4 camera
 * Persistent queue with enforcement before zone switch
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Camera, X, Loader2, ZoomIn, ZoomOut, AlertTriangle, Shield, FileText, Flashlight, MapPin, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { playSounds } from '@/lib/sounds';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

interface QueueItem {
  id: string;
  plateNumber: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  photoUrl?: string;
  status: 'compliant' | 'at_risk' | 'breach' | 'fc_exempt';
  complianceDetails: string;
  timestamp: Date;
  vehicleId?: string;
  observationId?: string;
}

interface ZoomScanQueueProps {
  zoneId: string;
  zoneName: string;
  organizationId: string;
  enforcementWorkflow: 'officer_first' | 'admin_first';
  onCancel: () => void;
}

export function ZoomScanQueue({
  zoneId,
  zoneName,
  organizationId,
  enforcementWorkflow,
  onCancel,
}: ZoomScanQueueProps) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [zoom, setZoom] = useState<number>(() => {
    const saved = localStorage.getItem('zoom-camera-zoom-level');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [captureAnimation, setCaptureAnimation] = useState(false);
  const [safetyAlertItem, setSafetyAlertItem] = useState<QueueItem | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState(true);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Get GPS location
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setGpsLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => console.warn('GPS error:', error),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Load persisted queue
  useEffect(() => {
    const stored = localStorage.getItem(`zoom-queue-${zoneId}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setQueue(parsed.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp),
        })));
      } catch (error) {
        console.error('Failed to load zoom queue:', error);
      }
    }
  }, [zoneId]);

  // Initialize camera (once only)
  useEffect(() => {
    let mounted = true;
    
    const initCamera = async () => {
      setIsCameraLoading(true);
      setCameraError(null);
      
      try {
        console.log('🎥 Requesting camera access...');
        
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: 'environment', 
            width: { ideal: 1920 }, 
            height: { ideal: 1080 } 
          },
        });
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        console.log('✅ Camera stream acquired');
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
          
          // Wait for video to be ready
          await new Promise<void>((resolve) => {
            if (videoRef.current) {
              videoRef.current.onloadedmetadata = () => {
                console.log('✅ Video metadata loaded');
                resolve();
              };
            } else {
              resolve();
            }
          });
          
          if (!mounted) return;
          
          setCameraReady(true);
          setIsCameraLoading(false);
          console.log('✅ Camera ready');
          
          // Check torch support
          const track = stream.getVideoTracks()[0];
          const capabilities = track.getCapabilities();
          if ('torch' in capabilities) {
            setTorchSupported(true);
            console.log('✅ Torch supported');
          }
          
          // Apply initial zoom
          applyZoom(zoom);
        }
      } catch (error: any) {
        console.error('❌ Camera error:', error);
        if (!mounted) return;
        
        setCameraError(error.message || 'Failed to access camera');
        setIsCameraLoading(false);
        toast.error('Camera Error: ' + (error.message || 'Failed to access camera'));
      }
    };

    initCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        console.log('🛑 Stopping camera stream');
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []); // ✅ Only run once on mount
  
  // Apply zoom changes (separate from camera initialization)
  useEffect(() => {
    if (cameraReady && streamRef.current) {
      applyZoom(zoom);
    }
  }, [zoom, cameraReady]); // ✅ Only apply zoom when it changes

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

  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
    localStorage.setItem('zoom-camera-zoom-level', newZoom.toString());
    applyZoom(newZoom);
  };

  const toggleTorch = async () => {
    if (!streamRef.current || !torchSupported) return;
    
    try {
      const track = streamRef.current.getVideoTracks()[0];
      await track.applyConstraints({
        advanced: [{ torch: !torchOn }]
      });
      setTorchOn(!torchOn);
      playSounds.photoCapture();
    } catch (error) {
      console.warn('Torch not supported:', error);
      toast.error('Torch not available on this device');
    }
  };

  const captureAndProcess = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsProcessing(true);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (!context) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);

      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);

      // Upload photo
      const blob = await fetch(imageDataUrl).then(r => r.blob());
      const fileName = `scans/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = await supabase.storage
        .from('evidence')
        .getPublicUrl(fileName);

      // Recognize plate
      const { data: recognitionData, error: recognitionError } = await supabase.functions.invoke('recognize-plate', {
        body: { 
          image: imageDataUrl,
          regions: ['nz'],
          enableMMC: true,
        },
      });

      if (recognitionError || !recognitionData?.success) {
        toast.error('Failed to recognize plate');
        setIsProcessing(false);
        return;
      }

      const plateNumber = recognitionData.plate_number;

      // Process field scan
      const { data: scanResult, error: scanError } = await supabase.functions.invoke('process-field-scan', {
        body: {
          plateNumber,
          zoneId,
          organizationId,
          imageUrl: publicUrl,
          vehicleDetails: {
            make: recognitionData.vehicle_make,
            model: recognitionData.vehicle_model,
            color: recognitionData.vehicle_color,
          },
          detectionMethod: 'alpr',
        },
      });

      if (scanError) {
        console.error('Scan error:', scanError);
        setIsProcessing(false);
        return;
      }

      // Determine status and sound
      let status: QueueItem['status'] = 'compliant';
      let details = 'Vehicle is compliant';
      
      if (scanResult.is_flagged) {
        status = 'breach';
        details = `⚠️ FLAGGED: ${scanResult.flagged_details?.reason || 'Requires attention'}`;
        playSounds.flaggedVehicle();
      } else if (scanResult.is_compliant === false && scanResult.alerts?.some((a: string) => a.includes('BREACH'))) {
        status = 'breach';
        details = scanResult.alerts.find((a: string) => a.includes('BREACH')) || 'Non-compliant - breach detected';
        playSounds.violationAlert();
      } else if (scanResult.alerts?.some((a: string) => a.toLowerCase().includes('homeless') && a.toLowerCase().includes('exempt'))) {
        status = 'fc_exempt';
        details = '💜 Homeless (FC Act Exempt)';
        playSounds.homeless();
      } else if (scanResult.is_compliant === false) {
        status = 'at_risk';
        details = '🟡 At Risk - Attention required';
        playSounds.violationAlert();
      } else {
        playSounds.processingComplete();
      }

      const newItem: QueueItem = {
        id: scanResult.observation_id || `queue-${Date.now()}`,
        plateNumber,
        vehicleMake: recognitionData.vehicle_make,
        vehicleModel: recognitionData.vehicle_model,
        vehicleColor: recognitionData.vehicle_color,
        photoUrl: publicUrl,
        status,
        complianceDetails: details,
        timestamp: new Date(),
        vehicleId: scanResult.vehicle_id,
        observationId: scanResult.observation_id,
      };

      // Trigger capture animation
      setCaptureAnimation(true);
      setTimeout(() => setCaptureAnimation(false), 600);

      setQueue(prev => {
        const updated = [newItem, ...prev];
        localStorage.setItem(`zoom-queue-${zoneId}`, JSON.stringify(updated));
        return updated;
      });

      // If flagged/safety concern, show full-screen modal immediately
      if (status === 'breach' && scanResult.is_flagged) {
        setSafetyAlertItem(newItem);
      }

      // Auto-dismiss compliant after 10s
      if (status === 'compliant') {
        setTimeout(() => {
          setQueue(prev => {
            const updated = prev.filter(item => item.id !== newItem.id);
            localStorage.setItem(`zoom-queue-${zoneId}`, JSON.stringify(updated));
            return updated;
          });
        }, 10000);
      }

      // Auto-dismiss FC exempt after 15s
      if (status === 'fc_exempt') {
        setTimeout(() => {
          setQueue(prev => {
            const updated = prev.filter(item => item.id !== newItem.id);
            localStorage.setItem(`zoom-queue-${zoneId}`, JSON.stringify(updated));
            return updated;
          });
        }, 15000);
      }

    } catch (error: any) {
      console.error('Capture error:', error);
      toast.error('Failed to process scan: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDismiss = (itemId: string) => {
    setQueue(prev => {
      const updated = prev.filter(item => item.id !== itemId);
      localStorage.setItem(`zoom-queue-${zoneId}`, JSON.stringify(updated));
      return updated;
    });
    playSounds.photoCapture();
  };

  const handleAdviseOwner = async (item: QueueItem) => {
    toast.info('Recording breach advisory - admin will review for official enforcement');
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('enforcement_actions')
        .insert({
          organization_id: organizationId,
          zone_id: zoneId,
          plate_number: item.plateNumber,
          vehicle_record_id: item.vehicleId,
          observation_id: item.observationId,
          action_type: 'breach_advisory',
          status: 'pending',
          notes: `Officer advised vehicle owner of breach: ${item.complianceDetails}\n\n⚠️ Pending admin review for official enforcement action.`,
          user_id: user.id,
        });
      
      if (error) throw error;
      
      playSounds.processingComplete();
      toast.success('Breach advisory recorded - vehicle owner has been notified');
      
      // Remove from queue and close modal
      handleDismiss(item.id);
      setSafetyAlertItem(null);
      
    } catch (error: any) {
      console.error('Failed to record breach advisory:', error);
      toast.error('Failed to record advisory: ' + error.message);
    }
  };

  const handleAcknowledgeSafety = () => {
    if (!safetyAlertItem) return;
    playSounds.processingComplete();
    toast.success('Safety alert acknowledged - proceed with caution');
    setSafetyAlertItem(null);
    // Alert stays in queue for reference, officer can continue scanning
  };

  const handleExit = () => {
    const actionableCount = queue.filter(i => i.status === 'breach' || i.status === 'at_risk').length;
    
    if (actionableCount > 0) {
      toast.error(`Please action ${actionableCount} item(s) before exiting`);
      return;
    }
    
    onCancel();
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black z-[9999]">
      {/* TOP 1/4: Queue */}
      <div className="h-1/4 overflow-y-auto bg-gray-900 border-b-4 border-yellow-500 flex-shrink-0">
        {queue.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p className="text-sm">Queue empty - start scanning</p>
          </div>
        ) : (
          <div className="space-y-2 p-2">
            {queue.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  // Make flagged/breach items clickable to show full details
                  if (item.status === 'breach' || item.status === 'at_risk') {
                    setSafetyAlertItem(item);
                  }
                }}
                className={cn(
                  "p-3 rounded-lg border-2 flex items-start gap-3 transition-all",
                  (item.status === 'breach' || item.status === 'at_risk') && "cursor-pointer hover:shadow-lg active:scale-[0.98]",
                  item.status === 'compliant' && "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-700",
                  item.status === 'at_risk' && "bg-yellow-50 border-yellow-400 dark:bg-yellow-950/30 dark:border-yellow-600",
                  item.status === 'breach' && "bg-red-50 border-red-500 dark:bg-red-950/30 dark:border-red-600",
                  item.status === 'fc_exempt' && "bg-purple-50 border-purple-400 dark:bg-purple-950/30 dark:border-purple-600"
                )}
              >
                {item.photoUrl && (
                  <img src={item.photoUrl} alt={item.plateNumber} className="w-16 h-16 object-cover rounded border" />
                )}
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <p className="font-black text-lg">{item.plateNumber}</p>
                      {item.vehicleMake && (
                        <p className="text-xs text-muted-foreground">
                          {item.vehicleMake} {item.vehicleModel} • {item.vehicleColor}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={
                        item.status === 'compliant' ? 'default' :
                        item.status === 'at_risk' ? 'secondary' :
                        item.status === 'breach' ? 'destructive' : 'outline'
                      }
                    >
                      {item.status === 'compliant' && '🟢'}
                      {item.status === 'at_risk' && '🟡'}
                      {item.status === 'breach' && '🔴'}
                      {item.status === 'fc_exempt' && '💜'}
                    </Badge>
                  </div>
                  
                  <p className="text-xs mb-2">{item.complianceDetails}</p>
                  
                  <div className="flex gap-2">
                    {item.status === 'breach' && enforcementWorkflow === 'admin_first' && (
                      <Button 
                        size="sm" 
                        variant="secondary" 
                        className="h-8 text-xs bg-orange-100 hover:bg-orange-200 text-orange-900 border-orange-300 dark:bg-orange-950/30 dark:hover:bg-orange-900/40 dark:text-orange-100 dark:border-orange-700"
                        onClick={() => handleAdviseOwner(item)}
                      >
                        💬 Advise Owner
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDismiss(item.id)}
                      className="h-8 text-xs ml-auto"
                    >
                      ✓ Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BOTTOM 3/4: Camera - Full Screen */}
      <div className="flex-1 relative overflow-hidden bg-black">
        {/* Loading State */}
        {isCameraLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-40">
            <div className="text-center">
              <Loader2 className="h-16 w-16 animate-spin text-white mx-auto mb-4" />
              <p className="text-white text-lg font-semibold">Initializing Camera...</p>
              <p className="text-white/60 text-sm mt-2">Please allow camera access</p>
            </div>
          </div>
        )}
        
        {/* Error State */}
        {cameraError && !isCameraLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-40">
            <div className="text-center px-6">
              <AlertTriangle className="h-16 w-16 text-red-500 mx-auto mb-4" />
              <p className="text-white text-lg font-semibold mb-2">Camera Error</p>
              <p className="text-white/80 text-sm mb-6">{cameraError}</p>
              <div className="space-y-3">
                <Button
                  onClick={() => window.location.reload()}
                  className="w-full bg-white text-black hover:bg-gray-200"
                >
                  Retry Camera Access
                </Button>
                <Button
                  onClick={handleExit}
                  variant="outline"
                  className="w-full bg-transparent border-white text-white hover:bg-white/10"
                >
                  Exit to Dashboard
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {/* Video Feed */}
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className="absolute inset-0 w-full h-full object-cover" 
        />
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Capture Animation - Slide Left */}
        {captureAnimation && (
          <div className="absolute inset-0 bg-white animate-slide-left pointer-events-none z-30" />
        )}
        
        {/* Zone Info Header */}
        <div className="absolute top-4 left-4 right-20 bg-black/70 backdrop-blur-md rounded-lg p-3 border border-white/30 z-40">
          <div className="space-y-1">
            <p className="text-white font-bold text-base">{zoneName}</p>
            <div className="flex items-center gap-3 text-white/80 text-xs">
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {gpsLocation ? `${gpsLocation.lat.toFixed(5)}, ${gpsLocation.lng.toFixed(5)}` : 'Locating...'}
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {currentTime.toLocaleString('en-NZ', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Pacific/Auckland',
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Zoom Controls - Right Side Vertical Slider (50% opacity) */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 bg-black/40 backdrop-blur-sm rounded-full px-3 py-6 shadow-lg border border-white/10 z-40">
          <button
            onClick={() => handleZoomChange(Math.min(5, zoom + 0.5))}
            className="p-3 hover:bg-white/20 rounded-full transition-colors touch-manipulation active:scale-95"
          >
            <ZoomIn className="h-6 w-6 text-white shrink-0" />
          </button>
          <div className="flex flex-col items-center gap-2 h-[250px] touch-none">
            <Slider
              value={[zoom]}
              onValueChange={([value]) => handleZoomChange(value)}
              min={1}
              max={5}
              step={0.1}
              orientation="vertical"
              className="h-full data-[orientation=vertical]:w-2"
            />
            <span className="text-white text-sm font-bold bg-black/70 px-3 py-1.5 rounded-full border border-white/20 min-w-[50px] text-center">
              {zoom.toFixed(1)}x
            </span>
          </div>
          <button
            onClick={() => handleZoomChange(Math.max(1, zoom - 0.5))}
            className="p-3 hover:bg-white/20 rounded-full transition-colors touch-manipulation active:scale-95"
          >
            <ZoomOut className="h-6 w-6 text-white shrink-0" />
          </button>
        </div>
        
        {/* Capture Button - Larger and More Visible */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50">
          <Button
            onClick={captureAndProcess}
            disabled={isProcessing || !cameraReady}
            className="h-24 w-24 rounded-full bg-white hover:bg-gray-200 text-black shadow-[0_0_40px_rgba(255,255,255,0.8)] border-8 border-green-500 hover:border-green-600 transition-all active:scale-95"
            size="lg"
          >
            {isProcessing ? (
              <Loader2 className="h-12 w-12 animate-spin text-green-600" />
            ) : (
              <Camera className="h-12 w-12 text-green-600" />
            )}
          </Button>
          {!isProcessing && cameraReady && (
            <p className="text-white text-sm font-bold text-center mt-3 drop-shadow-lg">
              TAP TO CAPTURE
            </p>
          )}
        </div>

        {/* Top Controls */}
        <div className="absolute top-4 right-4 flex items-center gap-3 z-50">
          {/* Torch Button */}
          {torchSupported && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTorch}
              className={cn(
                "h-12 w-12 rounded-full transition-all",
                torchOn 
                  ? "bg-yellow-500/90 hover:bg-yellow-600/90 text-white shadow-[0_0_20px_rgba(234,179,8,0.6)]" 
                  : "bg-black/60 hover:bg-black/80 text-white"
              )}
            >
              <Flashlight className={cn("h-6 w-6", torchOn && "fill-current")} />
            </Button>
          )}
          
          {/* Exit Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleExit}
            className="h-12 w-12 bg-black/60 hover:bg-black/80 text-white rounded-full"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>

        {/* Queue Badge */}
        {queue.length > 0 && (
          <div className="absolute top-4 left-4 bg-black/80 text-white px-4 py-2 rounded-full font-bold">
            Queue: {queue.length}
            {queue.filter(i => i.status === 'breach').length > 0 && (
              <span className="ml-2 text-red-400">
                ({queue.filter(i => i.status === 'breach').length} 🔴)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Safety Alert Modal - Full Screen */}
      <Dialog open={!!safetyAlertItem} onOpenChange={() => setSafetyAlertItem(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-2xl">
              <AlertTriangle className="h-8 w-8 text-red-600 animate-pulse" />
              {safetyAlertItem?.status === 'breach' ? 'BREACH DETECTED' : 'ATTENTION REQUIRED'}
            </DialogTitle>
            <DialogDescription className="text-base">
              {safetyAlertItem?.status === 'breach' 
                ? 'This vehicle has breached compliance requirements. Review details below.'
                : 'This vehicle requires attention. Review details and take appropriate action.'}
            </DialogDescription>
          </DialogHeader>

          {safetyAlertItem && (
            <div className="space-y-4">
              {/* Vehicle Photo */}
              {safetyAlertItem.photoUrl && (
                <div className="flex justify-center">
                  <img 
                    src={safetyAlertItem.photoUrl} 
                    alt={safetyAlertItem.plateNumber}
                    className="w-64 h-40 object-cover rounded-lg border-4 border-red-500"
                  />
                </div>
              )}

              {/* Vehicle Details */}
              <div className={cn(
                "p-4 rounded-lg border-2",
                safetyAlertItem.status === 'breach' && "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700",
                safetyAlertItem.status === 'at_risk' && "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300 dark:border-yellow-700"
              )}>
                <div className="flex items-center gap-2 mb-3">
                  <Shield className={cn(
                    "h-5 w-5",
                    safetyAlertItem.status === 'breach' && "text-red-600",
                    safetyAlertItem.status === 'at_risk' && "text-yellow-600"
                  )} />
                  <h3 className="font-bold text-xl">{safetyAlertItem.plateNumber}</h3>
                  <Badge
                    variant={safetyAlertItem.status === 'breach' ? 'destructive' : 'secondary'}
                    className="ml-auto"
                  >
                    {safetyAlertItem.status === 'breach' ? '🔴 BREACH' : '🟡 AT RISK'}
                  </Badge>
                </div>
                
                {safetyAlertItem.vehicleMake && (
                  <p className="text-sm mb-3">
                    <strong>Vehicle:</strong> {safetyAlertItem.vehicleMake} {safetyAlertItem.vehicleModel} ({safetyAlertItem.vehicleColor})
                  </p>
                )}

                <div className="bg-white dark:bg-gray-900 p-4 rounded border-2 border-red-200 dark:border-red-800">
                  <p className="text-sm font-semibold mb-2 text-red-800 dark:text-red-200 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    {safetyAlertItem.status === 'breach' ? 'Breach Details:' : 'Compliance Issues:'}
                  </p>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{safetyAlertItem.complianceDetails}</p>
                </div>

                {/* Timestamp */}
                <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-800">
                  <p className="text-xs text-muted-foreground">
                    <strong>Detected:</strong> {safetyAlertItem.timestamp.toLocaleString('en-NZ', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Pacific/Auckland',
                    })}
                  </p>
                </div>
              </div>

              {/* Officer Guidance */}
              <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border-2 border-blue-300 dark:border-blue-700">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                      Officer Guidance
                    </p>
                    <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1.5">
                      {safetyAlertItem.status === 'breach' && (
                        <>
                          <li>• This vehicle has violated compliance requirements</li>
                          <li>• Review the breach details above before proceeding</li>
                          <li>• Consider safety protocols when approaching the vehicle</li>
                          <li>• Document additional observations if necessary</li>
                        </>
                      )}
                      {safetyAlertItem.status === 'at_risk' && (
                        <>
                          <li>• This vehicle is approaching breach threshold</li>
                          <li>• Monitor for further compliance issues</li>
                          <li>• Consider advisory notification to vehicle owner</li>
                          <li>• Document current compliance status</li>
                        </>
                      )}
                      <li className="pt-1 border-t border-blue-200 dark:border-blue-800">• This notification will remain in your queue for reference</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button 
              onClick={handleAcknowledgeSafety}
              className="w-full bg-primary hover:bg-primary/90 text-white text-lg py-6"
            >
              <Shield className="h-5 w-5 mr-2" />
              I Acknowledge This Safety Alert - Continue Scanning
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
