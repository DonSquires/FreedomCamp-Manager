/**
 * PhotoEditor Component
 * Client-side photo editing (crop, rotate, watermark)
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  RotateCw, 
  Crop, 
  Check, 
  X,
  ZoomIn,
  ZoomOut,
  Type,
  Droplet,
} from 'lucide-react'
import { applyTextWatermark } from '@/lib/imageWatermarking'
import { toast } from 'sonner'

interface PhotoEditorProps {
  file: File
  onSave: (editedFile: File) => void
  onCancel: () => void
  enableWatermark?: boolean
  watermarkText?: string
}

type EditMode = 'none' | 'crop' | 'rotate' | 'watermark'

export function PhotoEditor({
  file,
  onSave,
  onCancel,
  enableWatermark = true,
  watermarkText,
}: PhotoEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  
  const [mode, setMode] = useState<EditMode>('none')
  const [rotation, setRotation] = useState(0)
  const [scale, setScale] = useState(1)
  const [cropArea, setCropArea] = useState({ x: 0, y: 0, width: 100, height: 100 })
  const [imageLoaded, setImageLoaded] = useState(false)

  // Load image
  useEffect(() => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      imageRef.current = img
      setImageLoaded(true)
      URL.revokeObjectURL(url)
    }

    img.src = url

    return () => {
      URL.revokeObjectURL(url)
    }
  }, [file])

  // Draw image to canvas
  const drawCropOverlay = useCallback((ctx: CanvasRenderingContext2D) => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Darken outside crop area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Clear crop area
    ctx.clearRect(
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height
    )

    // Draw crop border
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.strokeRect(
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height
    )
  }, [cropArea])

  const drawImage = useCallback(() => {
    if (!canvasRef.current || !imageRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = imageRef.current

    // Set canvas size
    canvas.width = img.width
    canvas.height = img.height

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Apply transformations
    ctx.save()

    // Center of canvas
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2

    // Move to center
    ctx.translate(centerX, centerY)

    // Apply rotation
    ctx.rotate((rotation * Math.PI) / 180)

    // Apply scale
    ctx.scale(scale, scale)

    // Draw image centered
    ctx.drawImage(img, -img.width / 2, -img.height / 2)

    ctx.restore()

    // Draw crop overlay if in crop mode
    if (mode === 'crop') {
      drawCropOverlay(ctx)
    }
  }, [rotation, scale, mode, drawCropOverlay])

  // Rotate image
  const rotate = () => {
    setRotation((rotation + 90) % 360)
  }

  // Apply crop
  const applyCrop = () => {
    if (!canvasRef.current || !imageRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Create new canvas for cropped image
    const croppedCanvas = document.createElement('canvas')
    croppedCanvas.width = cropArea.width
    croppedCanvas.height = cropArea.height
    const croppedCtx = croppedCanvas.getContext('2d')
    if (!croppedCtx) return

    // Draw cropped portion
    croppedCtx.drawImage(
      canvas,
      cropArea.x,
      cropArea.y,
      cropArea.width,
      cropArea.height,
      0,
      0,
      cropArea.width,
      cropArea.height
    )

    // Update canvas
    canvas.width = cropArea.width
    canvas.height = cropArea.height
    ctx.drawImage(croppedCanvas, 0, 0)

    setMode('none')
    toast.success('Crop applied')
  }

  // Apply watermark
  const applyWatermark = async () => {
    if (!canvasRef.current) return

    try {
      canvasRef.current.toBlob(async (blob) => {
        if (!blob) return

        const tempFile = new File([blob], 'temp.jpg', { type: 'image/jpeg' })
        const watermarked = await applyTextWatermark(tempFile, {
          text: watermarkText || 'Evidence Photo',
          position: 'bottom-right',
        })

        // Load watermarked image back to canvas
        const img = new Image()
        const url = URL.createObjectURL(watermarked)

        img.onload = () => {
          const canvas = canvasRef.current
          const ctx = canvas?.getContext('2d')
          if (!canvas || !ctx) return

          canvas.width = img.width
          canvas.height = img.height
          ctx.drawImage(img, 0, 0)

          URL.revokeObjectURL(url)
          toast.success('Watermark applied')
          setMode('none')
        }

        img.src = url
      }, 'image/jpeg', 0.95)
    } catch (error) {
      console.error('Watermark failed:', error)
      toast.error('Failed to apply watermark')
    }
  }

  // Save edited image
  const saveImage = () => {
    if (!canvasRef.current) return

    canvasRef.current.toBlob((blob) => {
      if (!blob) {
        toast.error('Failed to save image')
        return
      }

      const editedFile = new File([blob], file.name, {
        type: 'image/jpeg',
      })

      onSave(editedFile)
    }, 'image/jpeg', 0.95)
  }

  // Redraw when transformations change
  useEffect(() => {
    if (imageLoaded) {
      drawImage()
    }
  }, [imageLoaded, drawImage])

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* Top toolbar */}
      <div className="flex items-center justify-between p-4 bg-black/50">
        <div className="flex gap-2">
          {mode !== 'none' && (
            <Badge variant="secondary">{mode.toUpperCase()} MODE</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button size="sm" onClick={saveImage}>
            <Check className="h-4 w-4 mr-2" />
            Save
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `scale(${scale})`,
            transition: 'transform 0.2s',
          }}
        />
      </div>

      {/* Bottom controls */}
      <Card className="m-4 p-4">
        <div className="flex items-center justify-center gap-3">
          {/* Rotate */}
          <Button
            variant={mode === 'rotate' ? 'default' : 'outline'}
            onClick={rotate}
          >
            <RotateCw className="h-4 w-4 mr-2" />
            Rotate
          </Button>

          {/* Crop */}
          <Button
            variant={mode === 'crop' ? 'default' : 'outline'}
            onClick={() => setMode(mode === 'crop' ? 'none' : 'crop')}
          >
            <Crop className="h-4 w-4 mr-2" />
            Crop
          </Button>

          {mode === 'crop' && (
            <Button onClick={applyCrop}>
              <Check className="h-4 w-4 mr-2" />
              Apply Crop
            </Button>
          )}

          {/* Watermark */}
          {enableWatermark && (
            <Button
              variant={mode === 'watermark' ? 'default' : 'outline'}
              onClick={applyWatermark}
            >
              <Droplet className="h-4 w-4 mr-2" />
              Watermark
            </Button>
          )}

          {/* Zoom */}
          <div className="flex gap-1 ml-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setScale(Math.max(0.5, scale - 0.1))}
              disabled={scale <= 0.5}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setScale(Math.min(3, scale + 0.1))}
              disabled={scale >= 3}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
