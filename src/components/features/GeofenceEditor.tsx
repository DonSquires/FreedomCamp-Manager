/**
 * GeofenceEditor Component
 * Visual zone boundary editor
 */

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  Edit3,
  MapPin,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Circle,
  Square,
  Pentagon,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'

interface Coordinate {
  lat: number
  lng: number
}

interface GeofenceEditorProps {
  initialBoundary?: Coordinate[]
  zoneName?: string
  onSave?: (boundary: Coordinate[]) => Promise<void>
  onCancel?: () => void
  mode?: 'create' | 'edit'
}

export function GeofenceEditor({
  initialBoundary = [],
  zoneName,
  onSave,
  onCancel,
  mode = 'create',
}: GeofenceEditorProps) {
  const [boundary, setBoundary] = useState<Coordinate[]>(initialBoundary)
  const [drawMode, setDrawMode] = useState<'polygon' | 'circle' | 'rectangle'>('polygon')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const addPoint = (lat: number, lng: number) => {
    setBoundary([...boundary, { lat, lng }])
    setHasChanges(true)
  }

  const removePoint = (index: number) => {
    setBoundary(boundary.filter((_, i) => i !== index))
    setHasChanges(true)
  }

  const updatePoint = (index: number, lat: number, lng: number) => {
    const updated = [...boundary]
    updated[index] = { lat, lng }
    setBoundary(updated)
    setHasChanges(true)
  }

  const handleSave = async () => {
    if (boundary.length < 3) {
      toast.error('Boundary must have at least 3 points')
      return
    }

    if (!onSave) return

    setIsSaving(true)
    try {
      await onSave(boundary)
      toast.success('Boundary saved successfully')
      setHasChanges(false)
    } catch (error: any) {
      toast.error(`Failed to save boundary: ${error.message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setBoundary(initialBoundary)
    setHasChanges(false)
    toast.info('Changes discarded')
  }

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    // Convert pixel coordinates to lat/lng (simplified)
    const lat = -41.2865 + (y / rect.height - 0.5) * 0.1
    const lng = 174.7762 + (x / rect.width - 0.5) * 0.1
    
    addPoint(lat, lng)
  }

  const calculateArea = () => {
    if (boundary.length < 3) return 0
    
    // Simplified area calculation (would use proper spherical geometry)
    let area = 0
    for (let i = 0; i < boundary.length; i++) {
      const j = (i + 1) % boundary.length
      area += boundary[i].lng * boundary[j].lat
      area -= boundary[j].lng * boundary[i].lat
    }
    return Math.abs(area / 2) * 111000 // rough km² conversion
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" />
              {mode === 'create' ? 'Create' : 'Edit'} Zone Boundary
            </CardTitle>
            <CardDescription className="mt-1">
              {zoneName && `Zone: ${zoneName} • `}
              Draw boundary by clicking on the map
            </CardDescription>
          </div>
          {hasChanges && (
            <Badge variant="secondary">Unsaved Changes</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Drawing tools */}
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Draw Mode:</Label>
          <div className="flex gap-2">
            <Button
              variant={drawMode === 'polygon' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDrawMode('polygon')}
            >
              <Pentagon className="h-4 w-4 mr-2" />
              Polygon
            </Button>
            <Button
              variant={drawMode === 'circle' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDrawMode('circle')}
            >
              <Circle className="h-4 w-4 mr-2" />
              Circle
            </Button>
            <Button
              variant={drawMode === 'rectangle' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDrawMode('rectangle')}
            >
              <Square className="h-4 w-4 mr-2" />
              Rectangle
            </Button>
          </div>
        </div>

        {/* Map editor */}
        <div
          className="relative bg-muted rounded-lg overflow-hidden cursor-crosshair"
          style={{ height: '400px' }}
          onClick={handleMapClick}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center pointer-events-none">
              <MapPin className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-20" />
              <p className="text-muted-foreground">
                Click to add boundary points
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {boundary.length} point{boundary.length !== 1 ? 's' : ''} placed
              </p>
            </div>
          </div>

          {/* Boundary visualization */}
          {boundary.length > 0 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {/* Lines between points */}
              <polyline
                points={boundary.map((p, i) => {
                  // Convert lat/lng to pixel coordinates (simplified)
                  const x = ((p.lng - 174.7762) / 0.1 + 0.5) * 100
                  const y = ((p.lat + 41.2865) / 0.1 + 0.5) * 100
                  return `${x}%,${y}%`
                }).join(' ')}
                stroke="currentColor"
                strokeWidth="2"
                fill="currentColor"
                fillOpacity="0.1"
                className="text-primary"
              />
              
              {/* Points */}
              {boundary.map((p, i) => {
                const x = ((p.lng - 174.7762) / 0.1 + 0.5) * 100
                const y = ((p.lat + 41.2865) / 0.1 + 0.5) * 100
                return (
                  <circle
                    key={i}
                    cx={`${x}%`}
                    cy={`${y}%`}
                    r="4"
                    fill="currentColor"
                    className="text-primary"
                  />
                )
              })}
            </svg>
          )}
        </div>

        {/* Boundary info */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 bg-muted rounded-lg">
            <div className="text-xl font-bold">{boundary.length}</div>
            <div className="text-xs text-muted-foreground">Points</div>
          </div>
          <div className="text-center p-2 bg-muted rounded-lg">
            <div className="text-xl font-bold">{calculateArea().toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">km²</div>
          </div>
          <div className="text-center p-2 bg-muted rounded-lg">
            <div className="text-xl font-bold">
              {boundary.length >= 3 ? <CheckCircle2 className="h-6 w-6 mx-auto text-green-600" /> : '—'}
            </div>
            <div className="text-xs text-muted-foreground">Valid</div>
          </div>
        </div>

        {/* Coordinate list */}
        {boundary.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            <div className="text-sm font-medium">Boundary Points</div>
            {boundary.map((point, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2 border rounded-lg"
              >
                <div className="flex-1 grid grid-cols-2 gap-2 text-sm">
                  <Input
                    type="number"
                    step="0.000001"
                    value={point.lat}
                    onChange={(e) => updatePoint(index, parseFloat(e.target.value), point.lng)}
                    className="h-8"
                    placeholder="Latitude"
                  />
                  <Input
                    type="number"
                    step="0.000001"
                    value={point.lng}
                    onChange={(e) => updatePoint(index, point.lat, parseFloat(e.target.value))}
                    className="h-8"
                    placeholder="Longitude"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removePoint(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          <Button
            onClick={handleSave}
            disabled={isSaving || boundary.length < 3 || !hasChanges}
          >
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Boundary'}
          </Button>
          
          {hasChanges && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isSaving}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Discard Changes
            </Button>
          )}

          {onCancel && (
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
          )}
        </div>

        {/* Instructions */}
        <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
          <p>• Click on the map to add boundary points</p>
          <p>• At least 3 points required for a valid boundary</p>
          <p>• Drag points on map to adjust (requires map library)</p>
          <p>• Use coordinate inputs for precise positioning</p>
        </div>
      </CardContent>
    </Card>
  )
}
