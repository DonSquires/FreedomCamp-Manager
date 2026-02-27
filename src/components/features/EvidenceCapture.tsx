/**
 * EvidenceCapture Component
 * Multi-photo evidence collection workflow
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { CameraCapture } from './CameraCapture'
import { PhotoEditor } from './PhotoEditor'
import { 
  Camera, 
  Image, 
  Trash2, 
  Edit2,
  Check,
  Plus,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

interface Evidence {
  id: string
  file: File
  preview: string
  label: string
  timestamp: Date
}

interface EvidenceCaptureProps {
  maxPhotos?: number
  requiredLabels?: string[]
  onComplete: (evidence: Evidence[]) => void
  onCancel: () => void
}

export function EvidenceCapture({
  maxPhotos = 5,
  requiredLabels = ['Front View', 'Rear View', 'Plate Close-up'],
  onComplete,
  onCancel,
}: EvidenceCaptureProps) {
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [showCamera, setShowCamera] = useState(false)
  const [editingPhoto, setEditingPhoto] = useState<Evidence | null>(null)
  const [currentLabel, setCurrentLabel] = useState('')

  // Add photo from camera
  const handleCapture = (file: File) => {
    const id = crypto.randomUUID()
    const preview = URL.createObjectURL(file)

    const newEvidence: Evidence = {
      id,
      file,
      preview,
      label: currentLabel || `Photo ${evidence.length + 1}`,
      timestamp: new Date(),
    }

    setEvidence([...evidence, newEvidence])
    setShowCamera(false)
    setCurrentLabel('')
    toast.success('Photo added to evidence')
  }

  // Remove photo
  const removePhoto = (id: string) => {
    const photo = evidence.find(e => e.id === id)
    if (photo) {
      URL.revokeObjectURL(photo.preview)
    }
    setEvidence(evidence.filter(e => e.id !== id))
  }

  // Edit photo
  const startEditPhoto = (photo: Evidence) => {
    setEditingPhoto(photo)
  }

  // Save edited photo
  const handlePhotoEdit = (editedFile: File) => {
    if (!editingPhoto) return

    const preview = URL.createObjectURL(editedFile)
    URL.revokeObjectURL(editingPhoto.preview)

    setEvidence(evidence.map(e =>
      e.id === editingPhoto.id
        ? { ...e, file: editedFile, preview }
        : e
    ))

    setEditingPhoto(null)
    toast.success('Photo updated')
  }

  // Update photo label
  const updateLabel = (id: string, label: string) => {
    setEvidence(evidence.map(e =>
      e.id === id ? { ...e, label } : e
    ))
  }

  // Check if all required labels are present
  const hasAllRequiredLabels = () => {
    return requiredLabels.every(required =>
      evidence.some(e => e.label === required)
    )
  }

  // Complete evidence collection
  const handleComplete = () => {
    if (evidence.length === 0) {
      toast.error('Please capture at least one photo')
      return
    }

    if (!hasAllRequiredLabels()) {
      toast.error(`Missing required photos: ${requiredLabels.filter(r => !evidence.some(e => e.label === r)).join(', ')}`)
      return
    }

    onComplete(evidence)
  }

  // Cancel and cleanup
  const handleCancel = () => {
    evidence.forEach(e => URL.revokeObjectURL(e.preview))
    onCancel()
  }

  if (showCamera) {
    return (
      <CameraCapture
        onCapture={handleCapture}
        onCancel={() => setShowCamera(false)}
      />
    )
  }

  if (editingPhoto) {
    return (
      <PhotoEditor
        file={editingPhoto.file}
        onSave={handlePhotoEdit}
        onCancel={() => setEditingPhoto(null)}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <Card className="max-w-4xl mx-auto">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Evidence Collection</CardTitle>
              <CardDescription className="mt-1">
                Capture all required photos for this observation
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={handleCancel}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Required labels checklist */}
          <div>
            <Label>Required Photos</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {requiredLabels.map(label => {
                const captured = evidence.some(e => e.label === label)
                return (
                  <Badge
                    key={label}
                    variant={captured ? 'default' : 'outline'}
                    className="flex items-center gap-1"
                  >
                    {captured && <Check className="h-3 w-3" />}
                    {label}
                  </Badge>
                )
              })}
            </div>
          </div>

          {/* Captured photos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Photos ({evidence.length}/{maxPhotos})</Label>
              <Button
                size="sm"
                onClick={() => setShowCamera(true)}
                disabled={evidence.length >= maxPhotos}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Photo
              </Button>
            </div>

            {evidence.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {evidence.map((item) => (
                  <Card key={item.id}>
                    <CardContent className="p-3">
                      {/* Photo preview */}
                      <div className="relative mb-2">
                        <img
                          src={item.preview}
                          alt={item.label}
                          className="w-full h-32 object-cover rounded"
                        />
                        <div className="absolute top-1 right-1 flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => startEditPhoto(item)}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => removePhoto(item.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Label input */}
                      <Input
                        value={item.label}
                        onChange={(e) => updateLabel(item.id, e.target.value)}
                        placeholder="Photo label"
                        className="text-sm"
                      />

                      {/* Timestamp */}
                      <div className="text-xs text-muted-foreground mt-1">
                        {item.timestamp.toLocaleTimeString()}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 border-2 border-dashed rounded-lg">
                <Camera className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p className="text-muted-foreground">No photos captured</p>
                <Button
                  variant="outline"
                  className="mt-2"
                  onClick={() => setShowCamera(true)}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Capture First Photo
                </Button>
              </div>
            )}
          </div>

          {/* Label for next photo */}
          {evidence.length < maxPhotos && (
            <div>
              <Label htmlFor="next-label">Label for Next Photo</Label>
              <Input
                id="next-label"
                value={currentLabel}
                onChange={(e) => setCurrentLabel(e.target.value)}
                placeholder="e.g., Front View, Plate Close-up"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              onClick={handleCancel}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleComplete}
              disabled={evidence.length === 0 || !hasAllRequiredLabels()}
              className="flex-1"
            >
              <Check className="h-4 w-4 mr-2" />
              Complete ({evidence.length} photos)
            </Button>
          </div>

          {/* Missing required labels warning */}
          {evidence.length > 0 && !hasAllRequiredLabels() && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="text-sm text-yellow-900 dark:text-yellow-100">
                Missing required photos: {requiredLabels.filter(r => !evidence.some(e => e.label === r)).join(', ')}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
