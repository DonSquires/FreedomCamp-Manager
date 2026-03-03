import { Car } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VehicleProfilePhotoProps {
  plateNumber: string
  photoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  showPlate?: boolean
  className?: string
}

const sizeMap = {
  sm: 'w-16 h-16',
  md: 'w-32 h-32',
  lg: 'w-64 h-64',
}

const iconSizeMap = {
  sm: 'h-6 w-6',
  md: 'h-10 w-10',
  lg: 'h-20 w-20',
}

const textSizeMap = {
  sm: 'text-[9px]',
  md: 'text-xs',
  lg: 'text-sm',
}

export function VehicleProfilePhoto({
  plateNumber,
  photoUrl,
  size = 'md',
  showPlate = false,
  className,
}: VehicleProfilePhotoProps) {
  return (
    <div
      className={cn(
        'relative aspect-square rounded-lg overflow-hidden flex-shrink-0',
        sizeMap[size],
        className
      )}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={`Vehicle ${plateNumber}`}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center">
          <Car className={cn('text-gray-400', iconSizeMap[size])} />
        </div>
      )}

      {showPlate && (
        <div className="absolute bottom-0 inset-x-0 bg-black/60 flex items-center justify-center py-0.5 px-1">
          <span className={cn('text-white font-mono font-semibold tracking-wide', textSizeMap[size])}>
            {plateNumber}
          </span>
        </div>
      )}
    </div>
  )
}
