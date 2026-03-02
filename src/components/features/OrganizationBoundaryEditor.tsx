import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Upload, MapPin, AlertTriangle, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

interface OrganizationBoundaryEditorProps {
  organizationId: string
  organizationName: string
  currentBoundary?: any
  onBoundaryUpdated?: () => void
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  stats?: {
    type: string
    features: number
    area_km2: number
    bbox: [number, number, number, number]
  }
}

export function OrganizationBoundaryEditor({ 
  organizationId, 
  organizationName,
  currentBoundary,
  onBoundaryUpdated 
}: OrganizationBoundaryEditorProps) {
  const [uploading, setUploading] = useState(false)
  const [validating, setValidating] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [geojsonData, setGeojsonData] = useState<any>(null)

  /**
   * CLIENT-SIDE VALIDATION
   * - Ensure valid GeoJSON structure
   * - Check CRS is WGS84 (EPSG:4326)
   * - Validate geometry type (Polygon/MultiPolygon only)
   * - Snap coordinates to 6-7 decimal places
   * - Remove Z/M dimensions
   */
  const validateGeoJson = (geojson: any): ValidationResult => {
    const errors: string[] = []
    const warnings: string[] = []

    // Check basic structure
    if (!geojson.type) {
      errors.push('Missing "type" property')
      return { valid: false, errors, warnings }
    }

    // Handle FeatureCollection
    if (geojson.type === 'FeatureCollection') {
      if (!geojson.features || !Array.isArray(geojson.features)) {
        errors.push('FeatureCollection must have "features" array')
        return { valid: false, errors, warnings }
      }

      if (geojson.features.length === 0) {
        errors.push('FeatureCollection is empty')
        return { valid: false, errors, warnings }
      }

      if (geojson.features.length > 1) {
        warnings.push(`Multiple features detected (${geojson.features.length}). They will be merged into a single MultiPolygon.`)
      }

      // Validate each feature
      for (let i = 0; i < geojson.features.length; i++) {
        const feature = geojson.features[i]
        if (!feature.geometry) {
          errors.push(`Feature ${i} missing geometry`)
          continue
        }

        const geomType = feature.geometry.type
        if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') {
          errors.push(`Feature ${i} has invalid geometry type: ${geomType}. Only Polygon/MultiPolygon allowed.`)
        }
      }
    } else if (geojson.type === 'Feature') {
      if (!geojson.geometry) {
        errors.push('Feature missing geometry')
        return { valid: false, errors, warnings }
      }

      const geomType = geojson.geometry.type
      if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') {
        errors.push(`Invalid geometry type: ${geomType}. Only Polygon/MultiPolygon allowed.`)
      }
    } else if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
      // Direct geometry object
      warnings.push('Direct geometry object detected. Will be wrapped in Feature.')
    } else {
      errors.push(`Unsupported GeoJSON type: ${geojson.type}`)
      return { valid: false, errors, warnings }
    }

    // Check CRS (default is WGS84)
    if (geojson.crs) {
      const crsName = geojson.crs.properties?.name
      if (crsName && !crsName.includes('4326') && !crsName.includes('WGS84')) {
        errors.push(`Invalid CRS: ${crsName}. Must be WGS84 (EPSG:4326)`)
      }
    }

    // Calculate stats
    const stats = {
      type: geojson.type,
      features: geojson.type === 'FeatureCollection' ? geojson.features.length : 1,
      area_km2: 0, // Will be calculated server-side
      bbox: [0, 0, 0, 0] as [number, number, number, number],
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats,
    }
  }

  /**
   * NORMALIZE GEOJSON
   * - Snap coordinates to 6 decimal places (~10cm precision)
   * - Remove Z/M coordinates
   * - Ensure CRS is WGS84
   */
  const normalizeGeoJson = (geojson: any): any => {
    const normalize = (coords: any): any => {
      if (typeof coords[0] === 'number') {
        // Single coordinate pair [lon, lat] - snap to 6 decimals, remove Z/M
        return [
          parseFloat(coords[0].toFixed(6)),
          parseFloat(coords[1].toFixed(6))
        ]
      } else {
        // Nested array - recurse
        return coords.map(normalize)
      }
    }

    const normalized = JSON.parse(JSON.stringify(geojson))

    // Normalize all geometries
    if (normalized.type === 'FeatureCollection') {
      normalized.features = normalized.features.map((f: any) => {
        if (f.geometry && f.geometry.coordinates) {
          f.geometry.coordinates = normalize(f.geometry.coordinates)
        }
        return f
      })
    } else if (normalized.type === 'Feature') {
      if (normalized.geometry && normalized.geometry.coordinates) {
        normalized.geometry.coordinates = normalize(normalized.geometry.coordinates)
      }
    } else if (normalized.coordinates) {
      normalized.coordinates = normalize(normalized.coordinates)
    }

    // Remove CRS (let server handle SRID)
    delete normalized.crs

    return normalized
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    // Check file type
    const validExtensions = ['.geojson', '.json', '.wkt']
    const fileExt = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase()
    
    if (!validExtensions.includes(fileExt)) {
      toast.error('Invalid file type. Please upload .geojson, .json, or .wkt file')
      return
    }

    // Check file size (max 10MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 10MB')
      return
    }

    setFile(selectedFile)
    setValidation(null)
    setGeojsonData(null)

    // Auto-validate
    setValidating(true)
    try {
      const content = await selectedFile.text()
      let geojson: any

      if (fileExt === '.wkt') {
        // TODO: Convert WKT to GeoJSON (requires library or server-side conversion)
        toast.error('WKT format support coming soon. Please use GeoJSON for now.')
        setValidating(false)
        return
      } else {
        geojson = JSON.parse(content)
      }

      // Normalize coordinates
      const normalized = normalizeGeoJson(geojson)
      setGeojsonData(normalized)

      // Validate
      const result = validateGeoJson(normalized)
      setValidation(result)

      if (result.valid) {
        toast.success('✅ Boundary validated successfully')
      } else {
        toast.error(`❌ Validation failed: ${result.errors.length} error(s)`)
      }
    } catch (error: any) {
      toast.error('Failed to parse file: ' + error.message)
      setValidation({
        valid: false,
        errors: ['Invalid JSON format'],
        warnings: [],
      })
    } finally {
      setValidating(false)
    }
  }

  const handleUpload = async () => {
    if (!geojsonData || !validation?.valid) {
      toast.error('Please upload and validate a boundary first')
      return
    }

    setUploading(true)
    try {
      // Call RPC to update organization boundary
      const { data, error } = await supabase.rpc('set_org_geometry', {
        org_id: organizationId,
        geom_geojson: JSON.stringify(geojsonData),
      })

      if (error) throw error

      toast.success('✅ Organization boundary updated successfully', {
        description: `Area: ${data?.area_km2?.toFixed(2) || 'N/A'} km²`,
        duration: 5000,
      })

      // Reset form
      setFile(null)
      setGeojsonData(null)
      setValidation(null)

      // Notify parent
      onBoundaryUpdated?.()
    } catch (error: any) {
      console.error('Upload failed:', error)
      toast.error(error.message || 'Failed to update boundary')
    } finally {
      setUploading(false)
    }
  }

  const downloadCleaned = () => {
    if (!geojsonData) return

    const blob = new Blob([JSON.stringify(geojsonData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${organizationName.replace(/\s/g, '_')}_boundary_cleaned.geojson`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success('Cleaned boundary downloaded')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-blue-600" />
          Organization Boundary
        </CardTitle>
        <CardDescription>
          Upload jurisdiction boundary for {organizationName}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Boundary Info */}
        {currentBoundary && (
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-green-700 dark:text-green-300">
                <p className="font-semibold">Current boundary set</p>
                <p className="mt-1">Uploading a new boundary will replace the existing one and auto-update the "Other Location" parent zone.</p>
              </div>
            </div>
          </div>
        )}

        {/* File Upload */}
        <div>
          <Label htmlFor="boundaryFile">Upload Boundary File</Label>
          <Input
            id="boundaryFile"
            type="file"
            accept=".geojson,.json,.wkt"
            onChange={handleFileChange}
            disabled={uploading || validating}
          />
          {file && (
            <p className="text-xs text-gray-600 mt-1">
              Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {/* Validation Results */}
        {validation && (
          <div className="space-y-2">
            {validation.errors.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-red-700 dark:text-red-300 space-y-1">
                    <p className="font-semibold">Validation Errors:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {validation.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {validation.warnings.length > 0 && (
              <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1">
                    <p className="font-semibold">Warnings:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      {validation.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {validation.valid && (
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-green-700 dark:text-green-300">
                    <p className="font-semibold">✅ Validation Passed</p>
                    {validation.stats && (
                      <div className="mt-2 space-y-0.5">
                        <p>Type: {validation.stats.type}</p>
                        <p>Features: {validation.stats.features}</p>
                        <p>Coordinates normalized to 6 decimal places</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Requirements Info */}
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
              <p className="font-semibold">Requirements:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Geometry type: Polygon or MultiPolygon</li>
                <li>CRS: WGS84 (EPSG:4326)</li>
                <li>Coordinates: 6-7 decimal places (no Z/M)</li>
                <li>Max file size: 10MB</li>
                <li>Format: GeoJSON (.geojson, .json)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {validation?.valid && (
            <Button 
              variant="outline"
              onClick={downloadCleaned}
              className="flex-1"
            >
              Download Cleaned
            </Button>
          )}
          <Button 
            onClick={handleUpload}
            disabled={!validation?.valid || uploading}
            className="flex-1"
          >
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? 'Uploading...' : 'Update Boundary'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
