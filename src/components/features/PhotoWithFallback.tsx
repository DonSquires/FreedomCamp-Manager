/**
 * PhotoWithFallback
 * Renders a vehicle/observation photo with a graceful car-icon placeholder
 * when the image URL is missing or fails to load.
 */

import { useState } from 'react'
import { Car } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PhotoWithFallbackProps {
  src: string | null | undefined
  alt?: string
  className?: string
  /** Extra classes applied to the placeholder container */
  placeholderClassName?: string
}

export function PhotoWithFallback({
  src,
  alt = 'Vehicle photo',
  className = 'w-full h-full object-cover',
  placeholderClassName,
}: PhotoWithFallbackProps) {
  const [errored, setErrored] = useState(false)

  if (!src || errored) {
    return (
      <div
        className={cn('flex items-center justify-center bg-muted', placeholderClassName)}
      >
        <Car className="h-8 w-8 text-muted-foreground/40" />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setErrored(true)}
    />
  )
}
