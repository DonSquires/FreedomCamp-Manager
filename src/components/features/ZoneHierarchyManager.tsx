import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MapPin, Layers, Plus, Edit } from 'lucide-react'

interface Zone {
  id: string
  name: string
  zone_type: string
  parent_zone_id: string | null
  is_active: boolean
  total_observations: number
  total_breaches: number
  parent_zone?: {
    name: string
  }
}

interface ZoneHierarchyManagerProps {
  organizationId: string
  onCreateChildZone?: () => void
  onEditZone?: (zoneId: string) => void
}

export function ZoneHierarchyManager({ 
  organizationId,
  onCreateChildZone,
  onEditZone 
}: ZoneHierarchyManagerProps) {
  const [showInactive, setShowInactive] = useState(false)

  // Fetch zones grouped by hierarchy
  const { data: zones, isLoading } = useQuery({
    queryKey: ['zone-hierarchy', organizationId, showInactive],
    queryFn: async () => {
      let query = supabase
        .from('zones')
        .select(`
          id,
          name,
          zone_type,
          parent_zone_id,
          is_active,
          total_observations,
          total_breaches,
          parent_zone:zones!parent_zone_id(
            name
          )
        `)
        .eq('organization_id', organizationId)
        .order('zone_type', { ascending: false }) // General (parent) first
        .order('name', { ascending: true })

      if (!showInactive) {
        query = query.eq('is_active', true)
      }

      const { data, error } = await query

      if (error) throw error
      return data as Zone[]
    },
  })

  // Separate parent and child zones
  const parentZones = zones?.filter(z => z.zone_type === 'general') || []
  const childZones = zones?.filter(z => z.zone_type === 'specific') || []

  // Calculate coverage stats
  const stats = {
    total: zones?.length || 0,
    parent: parentZones.length,
    children: childZones.length,
    observations: zones?.reduce((sum, z) => sum + (z.total_observations || 0), 0) || 0,
    breaches: zones?.reduce((sum, z) => sum + (z.total_breaches || 0), 0) || 0,
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Zones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-purple-600">Parent Zones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{stats.parent}</div>
            <p className="text-xs text-gray-500">Jurisdiction areas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600">Child Zones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.children}</div>
            <p className="text-xs text-gray-500">Enforcement zones</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-600">Breaches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.breaches}</div>
            <p className="text-xs text-gray-500">Across all zones</p>
          </CardContent>
        </Card>
      </div>

      {/* Parent Zones (Auto-managed) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-purple-600" />
                Parent Zones (Auto-Managed)
              </CardTitle>
              <CardDescription className="mt-1">
                These zones are automatically synced from the organization boundary
              </CardDescription>
            </div>
            <Badge variant="outline" className="bg-purple-50 text-purple-700">
              Read-Only
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : parentZones.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No parent zone found. Upload an organization boundary to auto-create.
            </div>
          ) : (
            <div className="space-y-3">
              {parentZones.map((zone) => (
                <div key={zone.id} className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-950 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-purple-600" />
                      <span className="font-semibold">{zone.name}</span>
                      <Badge variant="outline" className="text-xs">
                        Jurisdiction
                      </Badge>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      Observations: {zone.total_observations || 0} | Breaches: {zone.total_breaches || 0}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    Auto-synced from org boundary
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Child Zones (Editable) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-blue-600" />
                Child Zones (Enforcement Areas)
              </CardTitle>
              <CardDescription className="mt-1">
                Operational patrol zones within the jurisdiction
              </CardDescription>
            </div>
            <Button onClick={onCreateChildZone}>
              <Plus className="h-4 w-4 mr-2" />
              Add Child Zone
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : childZones.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No child zones found. Click "Add Child Zone" to create one.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {childZones.map((zone) => (
                <div key={zone.id} className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-blue-600" />
                        <span className="font-semibold">{zone.name}</span>
                      </div>
                      {zone.parent_zone && (
                        <div className="text-xs text-gray-600 mt-1">
                          Parent: {zone.parent_zone.name}
                        </div>
                      )}
                    </div>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => onEditZone?.(zone.id)}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="text-xs text-gray-600 space-y-0.5">
                    <div>Observations: {zone.total_observations || 0}</div>
                    <div>Breaches: <span className={zone.total_breaches ? 'text-red-600 font-medium' : ''}>{zone.total_breaches || 0}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Coverage Visualization Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle>Coverage Map</CardTitle>
          <CardDescription>
            Visual representation of parent boundary and child zones
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg h-64 flex items-center justify-center text-gray-500">
            Map visualization coming soon (requires map library integration)
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
