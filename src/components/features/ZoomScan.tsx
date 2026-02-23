/**
 * ZoomScan - Split-Screen Vehicle Scanner (Original Spec)
 * Top 25%: Queue of scan results
 * Bottom 75%: Live camera feed
 * Connects to vehicle-ingest Edge Function with Onspace AI fallback
 */

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, X, Loader2, ZoomIn, ZoomOut, Flashlight, MapPin, Clock, Flag, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { scanVehicle } from '@/lib/alprService';
import { useAuthStore } from '@/stores/authStore';
import { playSounds } from '@/lib/sounds';

interface ZoomScanProps {
  onExit: () => void;
}

interface QueueItem {
  id: string;
  plateNumber: string;
  status: 'processing' | 'compliant' | 'breach' | 'flagged' | 'error';
  details: string;
  timestamp: Date;
  autoDismiss?: number; // seconds until auto-dismiss
}

export function ZoomScan({ onExit }: ZoomScanProps) {
  const { user } = useAuthStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // State
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [processingCount, setProcessingCount] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [selectedZone, setSelectedZone] = useState<{ id: string; name: string } | null>(null);

  // Load user's zone on mount
  useEffect(() => {
    const loadZone = async () => {
      if (!user?.organization_id) return;

      const { data } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', user.organization_id)
        .eq('is_active', true)
        .order('name')
        .limit(1)
        .single();

      if (data) {
        setSelectedZone({ id: data.id, name: data.name });
      }
    };

    loadZone();
  }, [user?.organization_id]);

  // Start camera on mount
  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  // Update time every second
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Get GPS location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => console.warn('GPS not available:', error),
        { enableHighAccuracy: true }
      );
    }
  }, []);

  // Auto-dismiss queue items
  useEffect(() => {
    const interval = setInterval(() => {
      setQueue(prev => prev.filter(item => {
        if (!item.autoDismiss) return true;
        const age = (Date.now() - item.timestamp.getTime()) / 1000;
        return age < item.autoDismiss;
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
        setCameraReady(true);
      }

      streamRef.current = mediaStream;
    } catch (error: any) {
      console.error('Camera access failed:', error);
      toast.error('Failed to access camera: ' + error.message);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;

    try {
      const track = streamRef.current.getVideoTracks()[0];
      const capabilities: any = track.getCapabilities();

      if (capabilities.torch) {
        await track.applyConstraints({
          advanced: [{ torch: !torchEnabled }]
        } as any);
        setTorchEnabled(!torchEnabled);
      } else {
        toast.error('Torch not supported on this device');
      }
    } catch (error) {
      console.error('Torch toggle failed:', error);
      toast.error('Failed to toggle torch');
    }
  };

  const captureAndProcess = async () => {
    if (!videoRef.current || !canvasRef.current || !selectedZone) {
      toast.error('Camera or zone not ready');
      return;
    }

    // ✅ NON-BLOCKING: Increment processing count immediately
    setProcessingCount(prev => prev + 1);
    
    // ✅ Add temp processing item to queue
    const tempId = `temp-${Date.now()}`;
    const tempItem: QueueItem = {
      id: tempId,
      plateNumber: 'Processing...',
      status: 'processing',
      details: '🔄 Capturing photo...',
      timestamp: new Date(),
    };
    setQueue(prev => [tempItem, ...prev]);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      // Draw video frame
      ctx.drawImage(video, 0, 0);

      // Apply watermark overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, canvas.height - 100, canvas.width, 100);
      ctx.fillStyle = 'white';
      ctx.font = 'bold 20px monospace';
      
      const watermarkLines = [
        `📍 ${selectedZone.name}`,
        `👤 ${user?.first_name} ${user?.last_name}`,
        `🕐 ${currentTime.toLocaleString('en-NZ')}`,
        gpsLocation ? `📌 ${gpsLocation.lat.toFixed(5)}, ${gpsLocation.lng.toFixed(5)}` : '',
      ].filter(Boolean);
      
      watermarkLines.forEach((line, i) => {
        ctx.fillText(line, 20, canvas.height - 80 + (i * 25));
      });

      // Convert to blob
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.95);
      });

      // ✅ STEP 3: UPLOAD PHOTO IMMEDIATELY (Before ALPR)
      setQueue(prev => prev.map(item => 
        item.id === tempId 
          ? { ...item, details: '📤 Uploading photo...' }
          : item
      ));

      // Generate unique filename
      const timestamp = Date.now();
      const fileName = `${user?.id}/${timestamp}-scan.jpg`;
      
      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('evidence')
        .getPublicUrl(fileName);

      console.log('✅ Photo uploaded:', publicUrl);

      // ✅ STEP 4: Process with ALPR (plate recognition + observation creation)
      setQueue(prev => prev.map(item => 
        item.id === tempId 
          ? { ...item, details: '🔍 Processing scan...' }
          : item
      ));

      // Calculate SHA-256 hash for photo integrity
      const arrayBuffer = await blob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const photoHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      console.log('📤 Calling alpr-process...', {
        hasPhoto: !!publicUrl,
        photoHash: photoHash.substring(0, 16),
        zoneId: selectedZone.id,
      });

      // Use scanVehicle() - adds Authorization header (fixes 403) and base64 payload (fixes 400)
      const data = await scanVehicle(blob, {
        publicUrl,
        hash: photoHash,
        lat: gpsLocation?.lat || -41.2865,
        lng: gpsLocation?.lng || 174.7762,
        accuracy: gpsLocation?.accuracy,
        orgId: user?.organization_id || '',
        zoneId: selectedZone.id,
      });

      if (!data.success && !data.requires_manual_entry) {
        throw new Error(data.error || 'Scan failed');
      }

      // ✅ Determine status from response
      let status: QueueItem['status'] = 'compliant';
      let details = '✅ Compliant with zone requirements';
      let autoDismiss = 5; // Compliant auto-dismiss after 5s

      if (data.requires_manual_entry) {
        status = 'error';
        details = '❌ No plate detected - manual entry required';
        autoDismiss = 10;
        playSounds.processingComplete();
      } else if (data.is_flagged) {
        status = 'flagged';
        details = '🚩 FLAGGED: Watch list vehicle';
        autoDismiss = undefined; // Manual dismiss only
        playSounds.flaggedVehicle();
      } else if (data.is_compliant === false) {
        status = 'breach';
        details = '🔴 BREACH DETECTED';
        autoDismiss = undefined; // Manual dismiss only
        playSounds.violationAlert();
      } else {
        playSounds.processingComplete();
      }

      // ✅ Replace temp item with real result
      const resultItem: QueueItem = {
        id: data.observation_id || tempId,
        plateNumber: data.plate || 'UNKNOWN',
        status,
        details,
        timestamp: new Date(),
        autoDismiss,
      };

      setQueue(prev => prev.map(item => item.id === tempId ? resultItem : item));

    } catch (error: any) {
      console.error('❌ Scan failed:', error);
      
      // ✅ Replace temp item with error
      const errorItem: QueueItem = {
        id: tempId,
        plateNumber: 'FAILED',
        status: 'error',
        details: `❌ ${error.message || 'Scan failed'}`,
        timestamp: new Date(),
        autoDismiss: 10,
      };

      setQueue(prev => prev.map(item => item.id === tempId ? errorItem : item));
    } finally {
      // ✅ Decrement processing count
      setProcessingCount(prev => Math.max(0, prev - 1));
    }
  };

  const dismissQueueItem = (id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  const getStatusColor = (status: QueueItem['status']) => {
    switch (status) {
      case 'compliant': return 'border-green-500 bg-green-50 dark:bg-green-950/30';
      case 'breach': return 'border-red-500 bg-red-50 dark:bg-red-950/30';
      case 'flagged': return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30';
      case 'processing': return 'border-gray-300 bg-gray-50 dark:bg-gray-800';
      case 'error': return 'border-red-400 bg-red-50 dark:bg-red-950/30';
    }
  };

  const getStatusIcon = (status: QueueItem['status']) => {
    switch (status) {
      case 'compliant': return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'breach': return <AlertCircle className="h-5 w-5 text-red-600" />;
      case 'flagged': return <Flag className="h-5 w-5 text-yellow-600" />;
      case 'processing': return <Loader2 className="h-5 w-5 text-gray-500 animate-spin" />;
      case 'error': return <X className="h-5 w-5 text-red-600" />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* ========== QUEUE (TOP 25%) ========== */}
      <div className="h-1/4 bg-gray-900 border-b-2 border-white/20 overflow-y-auto">
        <div className="sticky top-0 bg-gray-800 border-b border-white/20 p-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <h3 className="text-white font-bold">Scan Queue</h3>
            {processingCount > 0 && (
              <Badge variant="secondary" className="bg-blue-500 text-white">
                {processingCount} processing
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onExit}
            className="text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-2 space-y-2">
          {queue.length === 0 ? (
            <div className="text-center py-8 text-white/60 text-sm">
              No scans yet - tap camera button to start
            </div>
          ) : (
            queue.map(item => (
              <div
                key={item.id}
                className={cn(
                  'p-3 rounded-lg border-2 flex items-start justify-between gap-3',
                  getStatusColor(item.status)
                )}
              >
                <div className="flex items-start gap-2 flex-1">
                  {getStatusIcon(item.status)}
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-bold text-sm truncate">{item.plateNumber}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.details}</p>
                  </div>
                </div>
                {item.status !== 'processing' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismissQueueItem(item.id)}
                    className="shrink-0 h-6 px-2 text-xs"
                  >
                    ✓ Dismiss
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ========== CAMERA (BOTTOM 75%) ========== */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          playsInline
          muted
          style={{ transform: `scale(${zoom})` }}
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Zone/GPS/Time Info (Top Left) */}
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm border border-white/20 rounded-lg p-3 text-white text-xs space-y-1" style={{ opacity: 0.5 }}>
          <div className="flex items-center gap-1 font-bold">
            <MapPin className="h-3 w-3" />
            {selectedZone?.name || 'No Zone'}
          </div>
          {gpsLocation && (
            <div className="font-mono text-[10px] text-white/80">
              {gpsLocation.lat.toFixed(5)}, {gpsLocation.lng.toFixed(5)}
            </div>
          )}
          <div className="flex items-center gap-1 text-white/80">
            <Clock className="h-3 w-3" />
            {currentTime.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>

        {/* Zoom Slider (Right Vertical) */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2" style={{ opacity: 0.5 }}>
          <div className="bg-black/50 backdrop-blur-sm border border-white/20 rounded-full p-3 flex flex-col items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setZoom(Math.min(5, zoom + 0.5))}
              disabled={zoom >= 5}
              className="text-white hover:bg-white/20 h-8 w-8"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <div className="text-white text-xs font-mono">{zoom.toFixed(1)}x</div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setZoom(Math.max(1, zoom - 0.5))}
              disabled={zoom <= 1}
              className="text-white hover:bg-white/20 h-8 w-8"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Torch Toggle (Left Bottom) */}
        <Button
          size="icon"
          onClick={toggleTorch}
          className={cn(
            'absolute left-6 bottom-32 h-14 w-14 rounded-full',
            torchEnabled ? 'bg-yellow-500/80 border-yellow-300' : 'bg-black/60 border-white/20',
            'border-2 text-white'
          )}
          style={{ opacity: 0.5 }}
        >
          <Flashlight className="h-6 w-6" />
        </Button>

        {/* Capture Button (Center Bottom) */}
        <Button
          onClick={captureAndProcess}
          disabled={!cameraReady || !selectedZone}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 h-24 w-24 rounded-full bg-white border-8 border-green-500 hover:bg-gray-100 disabled:opacity-50"
          style={{ boxShadow: '0 0 40px rgba(255,255,255,0.8)' }}
        >
          {processingCount > 0 && (
            <Badge className="absolute -top-2 -right-2 h-8 w-8 rounded-full bg-blue-500 text-white flex items-center justify-center">
              {processingCount}
            </Badge>
          )}
          <Camera className="h-12 w-12 text-green-600" />
        </Button>

        {/* Guide Frame */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-20 border-4 border-green-500 rounded-lg opacity-30" />
        </div>
      </div>
    </div>
  );
}
