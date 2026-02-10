/**
 * VehiclePhotoGallery - Displays all photos for a vehicle with AI-selection capability
 * Shows all evidence photos with the ability to trigger AI analysis to select best profile photo
 */

import { useState } from 'react';
import { useVehicleAllPhotos } from '@/hooks/useVehicleProfilePhoto';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Camera, Sparkles, Loader2, Calendar, MapPin, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';

interface VehiclePhotoGalleryProps {
  plateNumber: string;
  className?: string;
  showAISelection?: boolean;
}

export function VehiclePhotoGallery({ 
  plateNumber, 
  className = '',
  showAISelection = true
}: VehiclePhotoGalleryProps) {
  const { data: photos = [], isLoading, refetch } = useVehicleAllPhotos(plateNumber);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<{
    url: string;
    recorded_at: string;
    zone_name: string | null;
  } | null>(null);

  const handleAISelection = async (forceUpdate: boolean = false) => {
    if (photos.length === 0) {
      toast.error('No photos available to analyze');
      return;
    }

    // Check if a profile photo already exists
    const { data: canonicalVehicle } = await supabase
      .from('canonical_vehicles')
      .select('profile_photo_url')
      .eq('plate_number', plateNumber)
      .single();

    if (!forceUpdate && canonicalVehicle?.profile_photo_url) {
      toast.info('Profile photo already selected', {
        description: 'Use "Force Re-select" to choose a different photo',
      });
      setSelectedPhoto(canonicalVehicle.profile_photo_url);
      return;
    }

    setIsAnalyzing(true);
    try {
      const photoUrls = photos.map(p => p.url);
      
      // If forcing update, temporarily clear the profile photo
      if (forceUpdate && canonicalVehicle?.vehicle_id) {
        await supabase
          .from('canonical_vehicles')
          .update({ profile_photo_url: null })
          .eq('plate_number', plateNumber);
      }
      
      const { data, error } = await supabase.functions.invoke('select-best-vehicle-photo', {
        body: { plateNumber, photoUrls },
      });

      if (error) throw error;

      const message = forceUpdate 
        ? `🔄 Profile photo re-selected (score: ${data.score}/100)`
        : `🏆 AI selected the best photo (score: ${data.score}/100)`;
      
      toast.success(message, {
        description: 'Profile photo has been updated',
      });
      
      setSelectedPhoto(data.bestPhoto);
      
      // Refetch to show updated profile photo
      await refetch();

    } catch (error: any) {
      console.error('AI photo selection failed:', error);
      toast.error('Failed to analyze photos with AI');
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isLoading) {
    return (
      <div className={`${className} flex items-center justify-center p-8`}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className={`${className} text-center p-8`}>
        <Camera className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No photos available for this vehicle</p>
      </div>
    );
  }

  return (
    <>
      <div className={`${className} space-y-4`}>
        {/* Header with AI Selection Button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold">
              Vehicle Photos ({photos.length})
            </h3>
          </div>
          {showAISelection && photos.length > 1 && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handleAISelection(false)}
                disabled={isAnalyzing}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    AI Select Best Photo
                  </>
                )}
              </Button>
              <Button
                onClick={() => handleAISelection(true)}
                disabled={isAnalyzing}
                variant="ghost"
                size="sm"
                className="gap-2 text-xs"
              >
                Force Re-select
              </Button>
            </div>
          )}
        </div>

        {/* Photo Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map((photo, index) => (
            <div
              key={`${photo.url}-${index}`}
              className={`
                relative aspect-square rounded-lg overflow-hidden border-2 cursor-pointer
                transition-all hover:scale-105 hover:shadow-lg
                ${selectedPhoto === photo.url 
                  ? 'border-blue-500 ring-2 ring-blue-500/50' 
                  : 'border-border hover:border-blue-300'
                }
              `}
              onClick={() => setViewingPhoto(photo)}
            >
              <img
                src={photo.url}
                alt={`Vehicle photo ${index + 1}`}
                className="w-full h-full object-cover"
              />
              
              {/* AI Selected Badge */}
              {selectedPhoto === photo.url && (
                <div className="absolute top-2 right-2">
                  <Badge className="bg-blue-500 text-white text-xs gap-1">
                    <Sparkles className="h-3 w-3" />
                    AI Best
                  </Badge>
                </div>
              )}

              {/* Photo Info Overlay */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                <div className="text-white text-xs space-y-0.5">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    <span>{format(new Date(photo.recorded_at), 'MMM d, yyyy')}</span>
                  </div>
                  {photo.zone_name && (
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      <span className="truncate">{photo.zone_name}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Full Screen Photo Viewer */}
      <Dialog open={!!viewingPhoto} onOpenChange={(open) => !open && setViewingPhoto(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0">
          <DialogHeader className="px-6 pt-6">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Camera className="h-5 w-5" />
                  Vehicle Photo
                  {selectedPhoto === viewingPhoto?.url && (
                    <Badge className="bg-blue-500 text-white gap-1">
                      <Sparkles className="h-3 w-3" />
                      AI Selected
                    </Badge>
                  )}
                </DialogTitle>
                {viewingPhoto && (
                  <DialogDescription className="mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4" />
                      <span>{format(new Date(viewingPhoto.recorded_at), 'MMMM d, yyyy')}</span>
                    </div>
                    {viewingPhoto.zone_name && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-4 w-4" />
                        <span>{viewingPhoto.zone_name}</span>
                      </div>
                    )}
                  </DialogDescription>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewingPhoto(null)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>
          {viewingPhoto && (
            <div className="px-6 pb-6">
              <img
                src={viewingPhoto.url}
                alt="Vehicle photo full view"
                className="w-full h-auto max-h-[70vh] object-contain rounded-lg"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
