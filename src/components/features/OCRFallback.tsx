/**
 * OCRFallback Component
 * Manual plate entry when ALPR fails
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Check, X, Keyboard } from 'lucide-react'

interface OCRFallbackProps {
  photoUrl?: string
  detectedPlate?: string
  confidence?: number
  onSubmit: (plateNumber: string) => void
  onCancel: () => void
}

export function OCRFallback({
  photoUrl,
  detectedPlate,
  confidence,
  onSubmit,
  onCancel,
}: OCRFallbackProps) {
  const [plateNumber, setPlateNumber] = useState(detectedPlate || '')
  const [isValid, setIsValid] = useState(false)

  // NZ plate number validation (basic)
  const validatePlate = (plate: string): boolean => {
    // Remove spaces and convert to uppercase
    const cleaned = plate.trim().toUpperCase().replace(/\s/g, '')
    
    // NZ plates are typically 2-6 characters (letters and numbers)
    // Common formats: ABC123, AB1234, A12345
    const valid = /^[A-Z0-9]{2,6}$/.test(cleaned)
    
    setIsValid(valid)
    return valid
  }

  const handleChange = (value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    setPlateNumber(cleaned)
    validatePlate(cleaned)
  }

  const handleSubmit = () => {
    if (validatePlate(plateNumber)) {
      onSubmit(plateNumber)
    }
  }

  const shouldShowWarning = detectedPlate && confidence !== undefined && confidence < 0.8

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Keyboard className="h-5 w-5" />
                Manual Plate Entry
              </CardTitle>
              <CardDescription className="mt-1">
                ALPR detection failed or low confidence - please verify the plate number
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onCancel}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Photo preview */}
          {photoUrl && (
            <div className="relative">
              <img
                src={photoUrl}
                alt="Vehicle"
                className="w-full rounded-lg border"
              />
              {shouldShowWarning && (
                <div className="absolute top-2 right-2">
                  <Badge variant="destructive" className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Low Confidence ({Math.round((confidence || 0) * 100)}%)
                  </Badge>
                </div>
              )}
            </div>
          )}

          {/* Detected plate (if any) */}
          {detectedPlate && (
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Detected Plate</div>
                  <div className="text-2xl font-bold mt-1">{detectedPlate}</div>
                </div>
                {confidence !== undefined && (
                  <Badge variant={confidence >= 0.8 ? 'default' : 'destructive'}>
                    {Math.round(confidence * 100)}% confidence
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Manual entry */}
          <div className="space-y-2">
            <Label htmlFor="plate">
              {detectedPlate ? 'Confirm or Correct Plate Number' : 'Enter Plate Number'}
            </Label>
            <div className="flex gap-2">
              <Input
                id="plate"
                value={plateNumber}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="ABC123"
                className="text-2xl font-bold text-center uppercase"
                maxLength={6}
                autoFocus
              />
              {isValid && (
                <div className="flex items-center text-green-600">
                  <Check className="h-6 w-6" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              NZ plate format: 2-6 characters (letters and numbers)
            </p>
          </div>

          {/* Warning if differs from detected */}
          {detectedPlate && plateNumber !== detectedPlate && plateNumber.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-yellow-900 dark:text-yellow-100">
                  Plate differs from detection
                </div>
                <div className="text-yellow-800 dark:text-yellow-200 mt-1">
                  Detected: <strong>{detectedPlate}</strong> → Your entry: <strong>{plateNumber}</strong>
                </div>
              </div>
            </div>
          )}

          {/* Validation error */}
          {plateNumber.length > 0 && !isValid && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <X className="h-4 w-4 text-red-600 mt-0.5" />
              <div className="text-sm text-red-900 dark:text-red-100">
                Invalid plate format. Please check and try again.
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              onClick={onCancel}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!isValid}
              className="flex-1"
            >
              <Check className="h-4 w-4 mr-2" />
              Confirm Plate
            </Button>
          </div>

          {/* Tips */}
          <div className="p-3 bg-muted rounded-lg">
            <div className="text-sm font-medium mb-2">Tips for accuracy:</div>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Double-check characters that look similar (0 vs O, 1 vs I)</li>
              <li>Zoom in on the photo to verify each character</li>
              <li>Remove spaces - the system will format automatically</li>
              <li>Use uppercase letters only</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
