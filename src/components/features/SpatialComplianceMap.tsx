import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MapPin, Layers } from 'lucide-react'

interface SpatialComplianceMapProps {
  latitude: number
  longitude: number
  onComplianceCheck?: (result: ComplianceResult) => void
  showLayers?: boolean
}

interface ComplianceResult {
  jurisdiction_name: string | null
  restriction_name: string | null
  restriction_status: string | null
  is_breach: boolean
}

interface Jurisdiction {
  id: string
  name: string
  organization_type: string | null
}

interface Restriction {
  id: string
  name: string
  restriction_type: string
  geom: any
}

export function SpatialComplianceMap({ 
  latitude, 
  longitude, 
  onComplianceCheck,
  showLayers = true 
}: SpatialComplianceMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null)
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([])
  const [restrictions, setRestrictions] = useState<Restriction[]>([])
  const [loading, setLoading] = useState(false)

  // Fetch spatial layers
  useEffect(() => {
    async function loadLayers() {
      try {
        const [jurisdictionsData, restrictionsData] = await Promise.all([
          supabase.from('organizations').select('id, name, organization_type'),
          (supabase.from('restrictions') as any).select('id, name, restriction_type, geom'),
        ])

        if (jurisdictionsData.data) setJurisdictions(jurisdictionsData.data)
        if (restrictionsData.data) setRestrictions(restrictionsData.data)
      } catch (error) {
        console.error('Failed to load spatial layers:', error)
      }
    }

    loadLayers()
  }, [])

  // Check compliance when GPS changes
  useEffect(() => {
    async function checkCompliance() {
      if (!latitude || !longitude) return
      
      setLoading(true)
      try {
        const { data, error } = await (supabase as any).rpc('check_compliance', {
          lat: latitude,
          lng: longitude,
        })

        if (error) throw error

        if (data && data.length > 0) {
          const result = data[0]
          setCompliance(result)
          onComplianceCheck?.(result)
        } else {
          setCompliance(null)
        }
      } catch (error) {
        console.error('Compliance check failed:', error)
      } finally {
        setLoading(false)
      }
    }

    checkCompliance()
  }, [latitude, longitude, onComplianceCheck])

  // Render map on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !showLayers) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw jurisdictions (light blue outline)
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)'
    ctx.lineWidth = 2
    jurisdictions.forEach((jurisdiction) => {
      // Simplified rendering - in production use proper map library
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, 80, 0, Math.PI * 2)
      ctx.stroke()
    })

    // Draw restrictions (filled polygons by type)
    restrictions.forEach((restriction) => {
      const colors = {
        prohibited: 'rgba(239, 68, 68, 0.3)', // Red
        self_contained: 'rgba(59, 130, 246, 0.3)', // Blue
        day_use: 'rgba(251, 146, 60, 0.3)', // Orange
        permit_required: 'rgba(168, 85, 247, 0.3)', // Purple
      }

      ctx.fillStyle = colors[restriction.restriction_type as keyof typeof colors] || 'rgba(156, 163, 175, 0.3)'
      ctx.beginPath()
      ctx.arc(canvas.width / 2 + 20, canvas.height / 2 + 20, 60, 0, Math.PI * 2)
      ctx.fill()
    })

    // Draw officer position (green marker)
    ctx.fillStyle = '#10b981'
    ctx.beginPath()
    ctx.arc(canvas.width / 2, canvas.height / 2, 8, 0, Math.PI * 2)
    ctx.fill()
  }, [jurisdictions, restrictions, showLayers])

  return (
    <div className="space-y-4">
      {/* Map Canvas */}
      {showLayers && (
        <Card>
          <CardContent className="p-0">
            <div className="relative">
              <canvas 
                ref={canvasRef} 
                width={800} 
                height={400} 
                className="w-full h-64 bg-gray-50 dark:bg-gray-900 rounded-lg"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <Badge variant="outline" className="bg-white/90 backdrop-blur">
                  <Layers className="h-3 w-3 mr-1" />
                  Jurisdictions: {jurisdictions.length}
                </Badge>
                <Badge variant="outline" className="bg-white/90 backdrop-blur">
                  Restrictions: {restrictions.length}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compliance Info */}
      {loading ? (
        <Card>
          <CardContent className="p-4 text-center text-sm text-gray-500">
            Checking compliance...
          </CardContent>
        </Card>
      ) : compliance ? (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">Jurisdiction:</span>
              </div>
              <span className="text-sm">{compliance.jurisdiction_name || 'Unknown'}</span>
            </div>

            {compliance.restriction_name && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Restriction:</span>
                  <span className="text-sm">{compliance.restriction_name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Type:</span>
                  <Badge variant="outline" className={
                    compliance.restriction_status === 'prohibited' ? 'bg-red-50 text-red-700' :
                    compliance.restriction_status === 'self_contained' ? 'bg-blue-50 text-blue-700' :
                    compliance.restriction_status === 'day_use' ? 'bg-orange-50 text-orange-700' :
                    'bg-gray-50 text-gray-700'
                  }>
                    {compliance.restriction_status?.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-center text-sm text-gray-500">
            No compliance data for this location
          </CardContent>
        </Card>
      )}
    </div>
  )
}
