/**
 * Zoom Scan Queue Component - REBUILT FROM SCRATCH
 * 
 * Simple split-screen layout:
 * - Top 1/4: Queue results
 * - Bottom 3/4: Camera feed
 * 
 * Workflow:
 * 1. Capture photo
 * 2. Upload to storage
 * 3. Call recognize-plate (ALPR)
 * 4. Call process-field-scan (creates observation + compliance check)
 * 5. Display result in queue
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, X, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { playSounds } from '@/lib/sounds';
import { useAuthStore } from '@/stores/authStore';

interface QueueItem {
  id: string;
  plateNumber: string;
  status: 'compliant' | 'breach' | 'flagged';
  details: string;
  timestamp: Date;
}

interface ZoomScanQueueProps {
  zoneId: string;
  zoneName: string;
  organizationId: string;
  onCancel: () => void;
}

export function ZoomScanQueue({
  zoneId,
  zoneName,
  organizationId,
  onCancel,
}: ZoomScanQueueProps) {
  const { user } = useAuthStore();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  
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
            height: { ideal: 1080 } 
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
        console.error('Camera error:', error);
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

  const captureAndProcess = async () => {
    if (!videoRef.current || !canvasRef.current || !user) return;

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
      console.log('📸 Photo captured');

      // STEP 1: Upload photo to storage
      const blob = await fetch(imageDataUrl).then(r => r.blob());
      const fileName = `scans/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from('evidence')
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('evidence')
        .getPublicUrl(fileName);
      
      console.log('✅ Photo uploaded');

      // STEP 2: Call recognize-plate (ALPR)
      console.log('🔍 Running ALPR...');
      const { data: alprData, error: alprError } = await supabase.functions.invoke('recognize-plate', {
        body: { 
          image: imageDataUrl,
          regions: ['nz'],
        },
      });

      if (alprError || !alprData?.success) {
        throw new Error(alprData?.error || 'ALPR failed');
      }

      const plateNumber = alprData.plate_number;
      console.log('✅ Plate recognized:', plateNumber);

      // STEP 3: Call process-field-scan (creates observation + compliance)
      console.log('📤 Processing field scan...');
      const { data: scanResult, error: scanError } = await supabase.functions.invoke('process-field-scan', {
        body: {
          plateNumber,
          zoneId,
          organizationId,
          imageUrl: publicUrl,
          gpsLocation: null, // Desktop mode has no GPS
          vehicleDetails: {
            make: alprData.vehicle_make,
            model: alprData.vehicle_model,
            color: alprData.vehicle_color,
          },
          detectionMethod: 'alpr',
          confidence: alprData.confidence || 0.85,
          isSelfContained: false,
        },
      });

      if (scanError) {
        console.error('Field scan error:', scanError);
        throw new Error('Failed to process scan');
      }

      console.log('✅ Scan complete:', scanResult);

      // STEP 4: Determine status and add to queue
      let status: 'compliant' | 'breach' | 'flagged' = 'compliant';
      let details = 'Vehicle is compliant';

      if (scanResult.is_flagged) {
        status = 'flagged';
        details = `🚩 FLAGGED: ${scanResult.flagged_details?.reason || 'Watch list'}`;
        playSounds.flaggedVehicle();
      } else if (!scanResult.is_compliant) {
        status = 'breach';
        details = scanResult.alerts?.find((a: string) => a.includes('Non-compliant')) || 'Breach detected';
        playSounds.violationAlert();
      } else {
        playSounds.processingComplete();
      }

      const newItem: QueueItem = {
        id: scanResult.observation_id || `queue-${Date.now()}`,
        plateNumber,
        status,
        details,
        timestamp: new Date(),
      };

      setQueue(prev => [newItem, ...prev]);

      // Auto-dismiss compliant after 5s
      if (status === 'compliant') {
        setTimeout(() => {
          setQueue(prev => prev.filter(item => item.id !== newItem.id));
        }, 5000);
      }

    } catch (error: any) {
      console.error('Scan error:', error);
      alert(`Scan failed: ${error.message}`);
      playSounds.processingComplete();
    } finally {
      setIsProcessing(false);
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
          <h3 className="text-white font-bold text-sm">
            📋 Scan Queue {queue.length > 0 && `(${queue.length})`}
          </h3>
        </div>
        
        {queue.length === 0 ? (
          <div className="flex items-center justify-center h-[calc(100%-3rem)] text-gray-400">
            <div className="text-center">
              <Camera className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No scans yet</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 p-2">
            {queue.map((item) => (
              <div
                key={item.id}
                className={`p-3 rounded-lg border-2 ${
                  item.status === 'compliant' ? 'bg-green-50 border-green-300' :
                  item.status === 'breach' ? 'bg-red-50 border-red-500' :
                  'bg-yellow-50 border-yellow-500'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-black text-lg">{item.plateNumber}</p>
                  <Badge variant={item.status === 'compliant' ? 'default' : 'destructive'}>
                    {item.status === 'compliant' && '🟢'}
                    {item.status === 'breach' && '🔴'}
                    {item.status === 'flagged' && '🚩'}
                  </Badge>
                </div>
                <p className="text-xs mb-2">{item.details}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDismiss(item.id)}
                  className="h-8 text-xs"
                >
                  ✓ Dismiss
                </Button>
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
        
        {/* Zone Info */}
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md rounded-lg p-3 border border-white/20">
          <p className="text-white font-bold">{zoneName}</p>
        </div>

        {/* Capture Button */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <Button
            onClick={captureAndProcess}
            disabled={isProcessing || !cameraReady}
            className="h-24 w-24 rounded-full bg-white hover:bg-gray-200 text-black shadow-[0_0_40px_rgba(255,255,255,0.8)] border-8 border-green-500"
            size="lg"
          >
            {isProcessing ? (
              <Loader2 className="h-12 w-12 animate-spin text-green-600" />
            ) : (
              <Camera className="h-12 w-12 text-green-600" />
            )}
          </Button>
        </div>

        {/* Exit Button */}
        <div className="absolute top-4 right-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="h-12 w-12 bg-black/60 hover:bg-black/80 text-white rounded-full"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>
      </div>
    </div>
  );
}
