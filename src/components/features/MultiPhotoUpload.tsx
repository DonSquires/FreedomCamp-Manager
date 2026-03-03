import { useRef, useState, useCallback, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Camera, X } from 'lucide-react'
import { toast } from 'sonner'

interface MultiPhotoUploadProps {
  maxPhotos?: number
  onPhotosChange?: (photos: File[]) => void
  accept?: string
  label?: string
  existingPhotoUrls?: string[]
}

export function MultiPhotoUpload({
  maxPhotos = 5,
  onPhotosChange,
  accept = 'image/*',
  label = 'Photos',
  existingPhotoUrls = [],
}: MultiPhotoUploadProps) {
  const [photos, setPhotos] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files) return
      const incoming = Array.from(files)
      const available = maxPhotos - photos.length - existingPhotoUrls.length
      if (available <= 0) {
        toast.error(`Maximum ${maxPhotos} photos allowed`)
        return
      }
      const toAdd = incoming.slice(0, available)
      if (incoming.length > available) {
        toast.error(`Only ${available} more photo(s) can be added (limit: ${maxPhotos})`)
      }
      const newPreviews = toAdd.map((f) => URL.createObjectURL(f))
      const updatedPhotos = [...photos, ...toAdd]
      const updatedPreviews = [...previews, ...newPreviews]
      setPhotos(updatedPhotos)
      setPreviews(updatedPreviews)
      onPhotosChange?.(updatedPhotos)
    },
    [photos, previews, maxPhotos, existingPhotoUrls.length, onPhotosChange]
  )

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(previews[index])
    const updatedPhotos = photos.filter((_, i) => i !== index)
    const updatedPreviews = previews.filter((_, i) => i !== index)
    setPhotos(updatedPhotos)
    setPreviews(updatedPreviews)
    onPhotosChange?.(updatedPhotos)
  }

  // Revoke all preview URLs when component unmounts to prevent memory leaks
  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const totalCount = photos.length + existingPhotoUrls.length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Badge variant="secondary">
          {totalCount}/{maxPhotos} photos
        </Badge>
      </div>

      {/* Drop zone */}
      {totalCount < maxPhotos && (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer.files)
          }}
        >
          <Camera className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Add Photos</span>
            {' '}— click or drag &amp; drop
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>
      )}

      {/* Thumbnails grid */}
      {(previews.length > 0 || existingPhotoUrls.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          {existingPhotoUrls.map((url, i) => (
            <div key={`existing-${i}`} className="relative aspect-square">
              <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover rounded-md" />
            </div>
          ))}
          {previews.map((src, i) => (
            <div key={`new-${i}`} className="relative aspect-square">
              <img src={src} alt={`New photo ${i + 1}`} className="w-full h-full object-cover rounded-md" />
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="absolute top-1 right-1 h-6 w-6"
                onClick={() => removePhoto(i)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
