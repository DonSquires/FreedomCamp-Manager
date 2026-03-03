import { Button } from '@/components/ui/button'
import { ZoomIn } from 'lucide-react'

interface ZoomScanProps {
  zoomLevel: number
  onZoomChange: (level: number) => void
  maxZoom?: number
}

export function ZoomScan({ zoomLevel, onZoomChange, maxZoom = 5 }: ZoomScanProps) {
  const decrease = () => {
    if (zoomLevel > 1) onZoomChange(Math.max(1, zoomLevel - 1))
  }

  const increase = () => {
    if (zoomLevel < maxZoom) onZoomChange(Math.min(maxZoom, zoomLevel + 1))
  }

  return (
    <div className="flex items-center gap-2 bg-black/60 rounded-lg px-3 py-1.5">
      <ZoomIn className="h-4 w-4 text-white" />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-white hover:bg-white/20"
        onClick={decrease}
        disabled={zoomLevel <= 1}
      >
        −
      </Button>
      <span className="text-white text-sm font-semibold w-8 text-center">{zoomLevel}x</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-white hover:bg-white/20"
        onClick={increase}
        disabled={zoomLevel >= maxZoom}
      >
        +
      </Button>
    </div>
  )
}
