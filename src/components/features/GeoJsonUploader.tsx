import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Upload, FileJson, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

interface GeoJsonUploaderProps {
  organizationId: string
}

export function GeoJsonUploader({ organizationId }: GeoJsonUploaderProps) {
  const [uploading, setUploading] = useState(false)
  const [layerType, setLayerType] = useState<'jurisdiction' | 'restriction'>('restriction')
  const [restrictionType, setRestrictionType] = useState('prohibited')
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.geojson') && !selectedFile.name.endsWith('.json')) {
        toast.error('Please select a GeoJSON file (.geojson or .json)')
        return
      }
      setFile(selectedFile)
    }
  }

  const handleUpload = async () => {
    if (!file || !name) {
      toast.error('Please provide a name and select a file')
      return
    }

    setUploading(true)
    try {
      // Read file content
      const fileContent = await file.text()
      const geojson = JSON.parse(fileContent)

      if (!geojson.type || geojson.type !== 'FeatureCollection') {
        throw new Error('Invalid GeoJSON format - must be a FeatureCollection')
      }

      // Insert into appropriate table
      if (layerType === 'jurisdiction') {
        // Insert into organizations table
        const { error } = await supabase.from('organizations').insert({
          name: name,
          type: 'council', // Default type
          geom: geojson.features[0].geometry, // First feature
        })

        if (error) throw error
        toast.success('Jurisdiction boundary uploaded successfully')
      } else {
        // Insert into restrictions table
        for (const feature of geojson.features) {
          const { error } = await supabase.from('restrictions').insert({
            organization_id: organizationId,
            name: name,
            restriction_type: restrictionType,
            geom: feature.geometry,
            meta_data: feature.properties || {},
          })

          if (error) throw error
        }

        toast.success(`${geojson.features.length} restriction zone(s) uploaded successfully`)
      }

      // Reset form
      setFile(null)
      setName('')
      setLayerType('restriction')
      setRestrictionType('prohibited')
    } catch (error: any) {
      console.error('Upload failed:', error)
      toast.error(error.message || 'Failed to upload GeoJSON')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileJson className="h-5 w-5 text-blue-600" />
          Upload Spatial Boundaries
        </CardTitle>
        <CardDescription>
          Import GeoJSON files for jurisdictions or restriction zones
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="layerType">Layer Type</Label>
          <Select value={layerType} onValueChange={(val) => setLayerType(val as any)}>
            <SelectTrigger id="layerType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="jurisdiction">Jurisdiction Boundary</SelectItem>
              <SelectItem value="restriction">Restriction Zone</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {layerType === 'restriction' && (
          <div>
            <Label htmlFor="restrictionType">Restriction Type</Label>
            <Select value={restrictionType} onValueChange={setRestrictionType}>
              <SelectTrigger id="restrictionType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prohibited">🚫 Prohibited</SelectItem>
                <SelectItem value="self_contained">🚐 Self-Contained Only</SelectItem>
                <SelectItem value="day_use">☀️ Day Use Only</SelectItem>
                <SelectItem value="permit_required">📋 Permit Required</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="e.g., Lake Tekapo Restriction Area"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="geojsonFile">GeoJSON File</Label>
          <Input
            id="geojsonFile"
            type="file"
            accept=".geojson,.json"
            onChange={handleFileChange}
          />
          {file && (
            <p className="text-xs text-gray-600 mt-1">
              Selected: {file.name}
            </p>
          )}
        </div>

        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
              <p className="font-semibold">GeoJSON Format Requirements:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Must be a valid FeatureCollection</li>
                <li>Coordinates must be in WGS84 (EPSG:4326)</li>
                <li>Geometry type: Polygon or MultiPolygon</li>
              </ul>
            </div>
          </div>
        </div>

        <Button 
          onClick={handleUpload} 
          disabled={uploading || !file || !name}
          className="w-full"
        >
          <Upload className="h-4 w-4 mr-2" />
          {uploading ? 'Uploading...' : 'Upload GeoJSON'}
        </Button>
      </CardContent>
    </Card>
  )
}
