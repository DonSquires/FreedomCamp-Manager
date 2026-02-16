/**
 * Zoom Scan Queue Component
 * Split-screen layout: Top 1/4 queue + Bottom 3/4 camera
 * Persistent queue with enforcement before zone switch
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Camera, X, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { playSounds } from '@/lib/sounds';
import { cn } from '@/lib/utils';

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
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [zoom, setZoom] = useState<number>(() => {
    const saved = localStorage.getItem('zoom-camera-zoom-level');
    return saved ? parseFloat(saved) : 1.0;
  });
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  // Initialize camera
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
          setCameraReady(true);
          // Apply initial zoom
          applyZoom(zoom);
        }
      } catch (error: any) {
        console.error('Camera error:', error);
        toast.error('Failed to access camera: ' + error.message);
      }
    };

    initCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

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

      setQueue(prev => {
        const updated = [newItem, ...prev];
        localStorage.setItem(`zoom-queue-${zoneId}`, JSON.stringify(updated));
        return updated;
      });

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
    // Record breach advisory (verbal warning given by officer)
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
      
      // Remove from queue after recording advisory
      handleDismiss(item.id);
      
    } catch (error: any) {
      console.error('Failed to record breach advisory:', error);
      toast.error('Failed to record advisory: ' + error.message);
    }
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
                className={cn(
                  "p-3 rounded-lg border-2 flex items-start gap-3",
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
                    {item.status === 'breach' && (
                      enforcementWorkflow === 'officer_first' ? (
                        <Button size="sm" variant="destructive" className="h-8 text-xs">
                          ⚠️ Add Enforcement
                        </Button>
                      ) : (
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          className="h-8 text-xs bg-orange-100 hover:bg-orange-200 text-orange-900 border-orange-300 dark:bg-orange-950/30 dark:hover:bg-orange-900/40 dark:text-orange-100 dark:border-orange-700"
                          onClick={() => handleAdviseOwner(item)}
                        >
                          💬 Advise Owner
                        </Button>
                      )
                    )}
                    {(item.status === 'breach' || item.status === 'at_risk') && (
                      <Button size="sm" variant="outline" className="h-8 text-xs">
                        📸 Evidence
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
      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Zoom Controls - Right Side Vertical Slider */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 bg-black/80 backdrop-blur-sm rounded-full px-3 py-6 shadow-lg border border-white/20 z-40">
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

        {/* Exit Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleExit}
          className="absolute top-4 right-4 h-12 w-12 bg-black/60 hover:bg-black/80 text-white rounded-full"
        >
          <X className="h-6 w-6" />
        </Button>

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
    </div>
  );
}
