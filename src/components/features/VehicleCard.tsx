/**
 * VehicleCard Component
 * 
 * Reusable card displaying vehicle plate number with profile photo, make, model, year, and color.
 * Used across FlaggedVehicles, EnforcementActions, BreachAlerts, and other reporting pages.
 * 
 * Excludes: observations (evidential records must not be altered)
 */

import { VehicleProfilePhoto } from './VehicleProfilePhoto';
import { Badge } from '@/components/ui/badge';
import { Car, Calendar, Palette, Flag, Home, AlertTriangle } from 'lucide-react';

interface VehicleCardProps {
  plateNumber: string;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  vehicleColor?: string | null;
  isFlagged?: boolean;
  isHomeless?: boolean;
  isBreach?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showPhoto?: boolean;
  showDetails?: boolean;
  className?: string;
  onClick?: () => void;
}

const sizeConfig = {
  sm: {
    photo: 'sm' as const,
    plateText: 'text-sm',
    detailsText: 'text-xs',
    badgeText: 'text-[10px]',
    gap: 'gap-2',
  },
  md: {
    photo: 'md' as const,
    plateText: 'text-base',
    detailsText: 'text-sm',
    badgeText: 'text-xs',
    gap: 'gap-3',
  },
  lg: {
    photo: 'lg' as const,
    plateText: 'text-lg',
    detailsText: 'text-base',
    badgeText: 'text-sm',
    gap: 'gap-4',
  },
};

export function VehicleCard({
  plateNumber,
  vehicleMake,
  vehicleModel,
  vehicleYear,
  vehicleColor,
  isFlagged = false,
  isHomeless = false,
  isBreach = false,
  size = 'md',
  showPhoto = true,
  showDetails = true,
  className = '',
  onClick,
}: VehicleCardProps) {
  const config = sizeConfig[size];

  const vehicleDescription = [
    vehicleColor,
    vehicleYear,
    vehicleMake,
    vehicleModel,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={`flex items-center ${config.gap} ${onClick ? 'cursor-pointer hover:bg-muted/50 transition-colors rounded-lg p-2 -m-2' : ''} ${className}`}
      onClick={onClick}
    >
      {showPhoto && (
        <VehicleProfilePhoto
          plateNumber={plateNumber}
          size={config.photo}
          className="flex-shrink-0"
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className={`font-mono font-bold ${config.plateText}`}>
            {plateNumber}
          </div>
          
          {/* Status Badges */}
          {isFlagged && (
            <Badge variant="destructive" className={`${config.badgeText} gap-1 px-1.5 py-0.5`}>
              <Flag className="h-3 w-3" />
              Flagged
            </Badge>
          )}
          {isHomeless && (
            <Badge variant="outline" className={`${config.badgeText} gap-1 px-1.5 py-0.5 bg-cyan-50 text-cyan-700 border-cyan-300`}>
              <Home className="h-3 w-3" />
              Homeless
            </Badge>
          )}
          {isBreach && (
            <Badge variant="destructive" className={`${config.badgeText} gap-1 px-1.5 py-0.5`}>
              <AlertTriangle className="h-3 w-3" />
              Breach
            </Badge>
          )}
        </div>

        {showDetails && vehicleDescription && (
          <div className={`text-muted-foreground ${config.detailsText} mt-1 flex items-center gap-2 flex-wrap`}>
            {vehicleColor && (
              <span className="flex items-center gap-1">
                <Palette className="h-3 w-3" />
                {vehicleColor}
              </span>
            )}
            {vehicleYear && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {vehicleYear}
              </span>
            )}
            {vehicleMake && vehicleModel && (
              <span className="flex items-center gap-1">
                <Car className="h-3 w-3" />
                {vehicleMake} {vehicleModel}
              </span>
            )}
          </div>
        )}

        {showDetails && !vehicleDescription && (
          <div className={`text-muted-foreground ${config.detailsText} mt-1 italic`}>
            No vehicle details available
          </div>
        )}
      </div>
    </div>
  );
}
