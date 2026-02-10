import { useVehicleProfilePhoto } from '@/hooks/useVehicleProfilePhoto';
import { Camera, Calendar, MapPin, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';

interface VehicleProfilePhotoProps {
  plateNumber: string;
  className?: string;
  showMetadata?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'h-12 w-12',
  md: 'h-20 w-20',
  lg: 'h-32 w-32',
};

export function VehicleProfilePhoto({ 
  plateNumber, 
  className = '', 
  showMetadata = false,
  size = 'md' 
}: VehicleProfilePhotoProps) {
  const { data: photo, isLoading } = useVehicleProfilePhoto(plateNumber);

  if (isLoading) {
    return (
      <div className={`${sizeClasses[size]} ${className} rounded-lg bg-muted animate-pulse flex items-center justify-center`}>
        <Camera className="h-6 w-6 text-muted-foreground/50" />
      </div>
    );
  }

  if (!photo) {
    return (
      <div className={`${sizeClasses[size]} ${className} rounded-lg bg-muted flex items-center justify-center border-2 border-dashed border-muted-foreground/20`}>
        <Camera className="h-6 w-6 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div className={showMetadata ? 'space-y-2' : ''}>
      <div className={`${sizeClasses[size]} ${className} rounded-lg overflow-hidden border-2 ${photo.is_ai_selected ? 'border-blue-500 shadow-lg' : 'border-border shadow-sm'} relative group`}>
        <img
          src={photo.url}
          alt={`Vehicle ${plateNumber}`}
          className="h-full w-full object-cover"
        />
        {photo.is_ai_selected && (
          <div className="absolute top-1 right-1">
            <Badge variant="secondary" className="bg-blue-500 text-white text-xs gap-1 px-1.5 py-0.5">
              <Sparkles className="h-3 w-3" />
              AI
            </Badge>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-all">
            <Camera className="h-6 w-6 text-white" />
          </div>
        </div>
      </div>
      {showMetadata && (
        <div className="space-y-1">
          {photo.is_ai_selected && (
            <div className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium">
              <Sparkles className="h-3 w-3" />
              <span>AI-Selected Best View</span>
              {photo.score && <span className="text-muted-foreground">({photo.score}/100)</span>}
            </div>
          )}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>{format(new Date(photo.recorded_at), 'MMM d, yyyy')}</span>
          </div>
          {photo.total_photos > 1 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Camera className="h-3 w-3" />
              <span>{photo.total_photos} photos available</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
