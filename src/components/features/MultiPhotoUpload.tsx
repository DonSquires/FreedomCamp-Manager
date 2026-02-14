/**
 * MultiPhotoUpload Component
 * 
 * Reusable photo upload component for admin workflows:
 * - Camera capture (mobile)
 * - File upload (desktop)
 * - Multiple photos support
 * - Photo preview and deletion
 * - Uploads to Supabase Storage
 */

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Camera,
  Upload,
  X,
  Loader2,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface PhotoUploadProps {
  photos: string[]; // Array of photo URLs
  onPhotosChange: (photos: string[]) => void;
  maxPhotos?: number;
  label?: string;
  required?: boolean;
}

export function MultiPhotoUpload({
  photos,
  onPhotosChange,
  maxPhotos = 5,
  label = 'Photos',
  required = false,
}: PhotoUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setCaptureMode(true);
      }
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
    setCaptureMode(false);
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.95);
    await uploadPhoto(imageDataUrl);
    stopCamera();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Limit to available slots
    const remainingSlots = maxPhotos - photos.length;
    const filesToUpload = files.slice(0, remainingSlots);

    if (files.length > remainingSlots) {
      toast.warning(`Only uploading ${remainingSlots} photos (${photos.length}/${maxPhotos} limit)`);
    }

    setIsUploading(true);

    try {
      // Collect all image data URLs first
      const imageDataPromises = filesToUpload.map(file => {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve(e.target?.result as string);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      });

      const imageDataUrls = await Promise.all(imageDataPromises);

      // Upload all photos and collect URLs
      const uploadedUrls: string[] = [];
      for (const imageDataUrl of imageDataUrls) {
        const url = await uploadPhotoAndGetUrl(imageDataUrl);
        uploadedUrls.push(url);
      }

      // Update photos array with all new URLs at once
      onPhotosChange([...photos, ...uploadedUrls]);

      toast.success(`Uploaded ${uploadedUrls.length} photo(s)`);
    } catch (error: any) {
      console.error('File upload failed:', error);
      toast.error('Failed to upload photos: ' + error.message);
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const uploadPhoto = async (imageDataUrl: string) => {
    try {
      const url = await uploadPhotoAndGetUrl(imageDataUrl);
      // Add to photos array using functional update to avoid stale state
      onPhotosChange(prevPhotos => [...prevPhotos, url]);
    } catch (error: any) {
      console.error('Photo upload failed:', error);
      throw error;
    }
  };

  // Helper function that uploads and returns URL without modifying state
  const uploadPhotoAndGetUrl = async (imageDataUrl: string): Promise<string> => {
    const blob = await fetch(imageDataUrl).then(r => r.blob());
    const fileName = `evidence/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('evidence')
      .upload(fileName, blob);

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('evidence')
      .getPublicUrl(fileName);

    return publicUrl;
  };

  const deletePhoto = (photoUrl: string) => {
    const confirmed = confirm('Delete this photo?');
    if (!confirmed) return;

    // Remove from array
    onPhotosChange(photos.filter(p => p !== photoUrl));
    toast.success('Photo removed');
  };

  const canAddMore = photos.length < maxPhotos;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {photos.length}/{maxPhotos} photo(s) • Tap photos to remove
          </p>
        </div>
        {canAddMore && (
          <Badge variant="outline" className="bg-blue-50 text-blue-700">
            {maxPhotos - photos.length} remaining
          </Badge>
        )}
      </div>

      {/* Camera Capture Mode */}
      {captureMode && (
        <Card className="border-2 border-primary">
          <CardContent className="p-0">
            <div className="relative bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-64 object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Camera Controls */}
              <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={stopCamera}
                  className="h-12 w-12 bg-black/60 hover:bg-black/80 text-white rounded-full"
                >
                  <X className="h-6 w-6" />
                </Button>
                <Button
                  size="icon"
                  onClick={capturePhoto}
                  className="h-16 w-16 rounded-full"
                >
                  <Camera className="h-8 w-8" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Buttons */}
      {!captureMode && canAddMore && (
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            onClick={startCamera}
            disabled={isUploading}
            className="h-14"
          >
            <Camera className="h-5 w-5 mr-2" />
            Take Photo
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="h-14"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5 mr-2" />
                Upload File{photos.length < maxPhotos - 1 ? 's' : ''}
              </>
            )}
          </Button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Photo Grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {photos.map((photoUrl, index) => (
            <div key={`${photoUrl}-${index}`} className="relative group">
              <img
                src={photoUrl}
                alt={`Photo ${index + 1}`}
                className="w-full h-32 object-cover rounded-lg border-2 border-gray-200 dark:border-gray-700 cursor-pointer hover:border-red-500 transition-all hover:scale-105"
                onClick={() => deletePhoto(photoUrl)}
              />
              {/* Delete overlay on hover */}
              <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center pointer-events-none">
                <div className="text-white text-center">
                  <Trash2 className="h-6 w-6 mx-auto mb-1" />
                  <span className="text-xs font-semibold">Tap to Delete</span>
                </div>
              </div>
              {/* Photo number badge */}
              <Badge className="absolute top-1 left-1 bg-black/70 text-white text-xs pointer-events-none">
                #{index + 1}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {photos.length === 0 && !captureMode && (
        <div className="text-center py-8 bg-muted/30 rounded-lg border-2 border-dashed">
          <ImageIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground font-medium">
            No photos added yet
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Use camera or upload files to add photos
          </p>
        </div>
      )}
    </div>
  );
}
