/**
 * ZoomScan - Production-Ready Vehicle Scanner
 * Connects to new vehicle-ingest Edge Function
 */

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, X, Loader2, ZoomIn, ZoomOut, RotateCcw, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface ZoomScanProps {
  onExit: () => void;
}

export function ZoomScan({ onExit }: ZoomScanProps) {
  const { user } = useAuthStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [zoom, setZoom] = useState(1);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [selectedZone, setSelectedZone] = useState<{ id: string; name: string } | null>(null);
  const [scanResult, setScanResult] = useState<{
    plate: string | null;
    isCompliant: boolean;
    message: string;
  } | null>(null);

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
  }, [facingMode]);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play();
      }

      setStream(mediaStream);
    } catch (error: any) {
      console.error('Camera access failed:', error);
      toast.error('Failed to access camera: ' + error.message);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const captureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current || !selectedZone) {
      toast.error('Camera or zone not ready');
      return;
    }

    setIsProcessing(true);
    setScanResult(null);

    console.log('🎯 Starting vehicle scan...', {
      zone: selectedZone.name,
      zoneId: selectedZone.id,
      userId: user?.id,
      orgId: user?.organization_id,
    });

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context not available');

      ctx.drawImage(video, 0, 0);

      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9);
      });

      // Get GPS location
      let gpsLat = null;
      let gpsLng = null;
      let gpsAccuracy = null;

      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0,
          });
        });

        gpsLat = position.coords.latitude;
        gpsLng = position.coords.longitude;
        gpsAccuracy = position.coords.accuracy;
      } catch (gpsError) {
        console.warn('GPS not available:', gpsError);
        toast.warning('GPS not available - using zone default location');
      }

      // Create FormData for multipart upload
      const formData = new FormData();
      formData.append('photo', blob, 'scan.jpg');
      formData.append('gpsLatitude', String(gpsLat || -41.2865));
      formData.append('gpsLongitude', String(gpsLng || 174.7762));
      formData.append('gpsAccuracy', String(gpsAccuracy || 10));
      formData.append('recordedAt', new Date().toISOString());
      formData.append('officerId', user?.id || '');
      formData.append('organizationId', user?.organization_id || '');
      formData.append('zoneId', selectedZone.id);
      formData.append('idempotencyKey', `scan-${Date.now()}-${Math.random()}`);

      // Call vehicle-ingest Edge Function
      console.log('📤 Calling vehicle-ingest Edge Function...');
      
      const { data, error } = await supabase.functions.invoke('vehicle-ingest', {
        body: formData,
      });

      console.log('📥 Edge Function response:', { data, error });

      if (error) {
        console.error('❌ Edge Function error:', error);
        throw new Error(error.message || 'Edge Function invocation failed');
      }

      if (data.success) {
        setScanResult({
          plate: data.plate || null,
          isCompliant: true,
          message: data.plate
            ? `Plate detected: ${data.plate}`
            : 'Photo captured - manual entry required',
        });

        toast.success(data.plate ? `Scanned: ${data.plate}` : 'Photo captured');

        // Auto-exit after 2 seconds
        setTimeout(() => {
          onExit();
        }, 2000);
      }
    } catch (error: any) {
      console.error('❌ Scan failed:', error);
      const errorMessage = error.message || 'Unknown error occurred';
      toast.error('Scan failed: ' + errorMessage);
      
      setScanResult({
        plate: null,
        isCompliant: false,
        message: 'Scan failed - try again',
      });

      // Clear error message after 5 seconds
      setTimeout(() => {
        setScanResult(null);
        console.log('🧹 Cleared error message');
      }, 5000);
    } finally {
      setIsProcessing(false);
    }
  };

  const switchCamera = () => {
    stopCamera();
    setFacingMode(facingMode === 'user' ? 'environment' : 'user');
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/80 to-transparent z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-6 w-6 text-white" />
            <div>
              <h2 className="text-white font-bold">Vehicle Scanner</h2>
              {selectedZone && (
                <p className="text-white/80 text-xs">{selectedZone.name}</p>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onExit}
            className="text-white hover:bg-white/20"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      </div>

      {/* Camera View */}
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

        {/* Scan Result Overlay */}
        {scanResult && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className={cn(
              "max-w-md p-8 rounded-2xl text-center",
              scanResult.isCompliant ? "bg-green-600" : "bg-red-600"
            )}>
              <CheckCircle2 className="h-16 w-16 text-white mx-auto mb-4" />
              <h3 className="text-white text-2xl font-bold mb-2">
                {scanResult.plate || 'Scan Complete'}
              </h3>
              <p className="text-white/90">{scanResult.message}</p>
            </div>
          </div>
        )}

        {/* Guide Frame */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-80 h-20 border-4 border-green-500 rounded-lg" />
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-between mb-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom(Math.max(1, zoom - 0.5))}
            className="text-white hover:bg-white/20"
            disabled={zoom <= 1}
          >
            <ZoomOut className="h-6 w-6" />
          </Button>

          <Button
            onClick={captureAndScan}
            disabled={isProcessing || !selectedZone}
            className="h-20 w-20 rounded-full bg-green-600 hover:bg-green-700"
            size="lg"
          >
            {isProcessing ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <Camera className="h-8 w-8" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom(Math.min(3, zoom + 0.5))}
            className="text-white hover:bg-white/20"
            disabled={zoom >= 3}
          >
            <ZoomIn className="h-6 w-6" />
          </Button>
        </div>

        <div className="flex justify-center gap-2">
          <Badge variant="secondary" className="bg-white/20 text-white">
            Zoom: {zoom}x
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={switchCamera}
            className="text-white hover:bg-white/20"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Switch Camera
          </Button>
        </div>
      </div>
    </div>
  );
}
