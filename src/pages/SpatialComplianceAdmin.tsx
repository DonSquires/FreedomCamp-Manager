import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GeoJsonUploader } from '@/components/features/GeoJsonUploader'
import { OrganizationBoundaryEditor } from '@/components/features/OrganizationBoundaryEditor'
import { ZoneHierarchyManager } from '@/components/features/ZoneHierarchyManager'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Map, Shield, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { Database } from '@/types/database'

// Organization type with optional PostGIS geom field (geometry columns not auto-generated in Supabase types)
type Organization = Database['public']['Tables']['organizations']['Row']
type OrganizationWithGeom = Organization & { geom?: unknown }

// Restriction zones - derived from zones table (no dedicated restrictions table exists)
interface Restriction {
  id: string
  name: string
  restriction_type: string
  organization_id: string | null
  created_at: string
  organization?: { name: string } | null
}

export default function SpatialComplianceAdmin() {
  const { user } = useAuthStore()
  const [syncing, setSyncing] = useState(false)

  // Fetch organization boundary
  const { data: orgBoundary, refetch: refetchBoundary } = useQuery({
    queryKey: ['org-boundary', user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id) return null
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', user.organization_id)
        .single()
      if (error) throw error
      return data as OrganizationWithGeom | null
    },
    enabled: !!user?.organization_id,
  })

  // Fetch jurisdictions
  const { data: jurisdictions, refetch: refetchJurisdictions } = useQuery({
    queryKey: ['jurisdictions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .order('name')

      if (error) throw error
      return data as OrganizationWithGeom[]
    },
  })

  // Fetch restrictions - uses zones table as restrictions source (no dedicated restrictions table)
  const { data: restrictions, refetch: refetchRestrictions } = useQuery({
    queryKey: ['restrictions'],
    queryFn: async () => {
      type ZoneRow = Database['public']['Tables']['zones']['Row']
      const { data, error } = await supabase
        .from('zones')
        .select('id, name, zone_type, organization_id, created_at')
        .order('created_at', { ascending: false })

      if (error) throw error
      const zones = data as Pick<ZoneRow, 'id' | 'name' | 'zone_type' | 'organization_id' | 'created_at'>[] | null
      // Map zones to restriction-like structure (organization lookup not implemented)
      return (zones || []).map(zone => ({
        id: zone.id,
        name: zone.name,
        restriction_type: zone.zone_type || 'unknown',
        organization_id: zone.organization_id,
        created_at: zone.created_at,
        organization: null,
      })) as Restriction[]
    },
  })

  // Trigger sync from external sources
  const handleSync = async () => {
    setSyncing(true)
    try {
      const { error } = await supabase.functions.invoke('sync-spatial-layers')
      
      if (error) throw error
      
      toast.success('Spatial layers synced successfully')
      refetchJurisdictions()
      refetchRestrictions()
    } catch (error: any) {
      toast.error(error.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <AppLayout 
      title="Spatial Compliance Management" 
      description="Manage jurisdictions and restriction zones"
      showBackButton
    >
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Jurisdictions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{jurisdictions?.length || 0}</div>
            <p className="text-xs text-gray-500">Council/DOC/LINZ boundaries</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Restriction Zones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{restrictions?.length || 0}</div>
            <p className="text-xs text-gray-500">Freedom camping bylaws</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {jurisdictions && restrictions ? 
                ((restrictions.length / Math.max(jurisdictions.length, 1)) * 100).toFixed(0) : 0}%
            </div>
            <p className="text-xs text-gray-500">Restrictions per jurisdiction</p>
          </CardContent>
        </Card>
      </div>

      {/* Sync Button */}
      <div className="flex justify-end mb-6">
        <Button onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          Sync External Layers
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="boundary" className="space-y-4">
        <TabsList>
          <TabsTrigger value="boundary">Organization Boundary</TabsTrigger>
          <TabsTrigger value="zones">Zone Hierarchy</TabsTrigger>
          <TabsTrigger value="upload">Upload GeoJSON</TabsTrigger>
          <TabsTrigger value="jurisdictions">Jurisdictions</TabsTrigger>
          <TabsTrigger value="restrictions">Restrictions</TabsTrigger>
        </TabsList>

        {/* Organization Boundary Tab */}
        <TabsContent value="boundary">
          <OrganizationBoundaryEditor
            organizationId={user?.organization_id || ''}
            organizationName={user?.email?.split('@')[0] || 'Organization'}
            currentBoundary={orgBoundary?.geom}
            onBoundaryUpdated={refetchBoundary}
          />
        </TabsContent>

        {/* Zone Hierarchy Tab */}
        <TabsContent value="zones">
          <ZoneHierarchyManager
            organizationId={user?.organization_id || ''}
            onCreateChildZone={() => toast.info('Zone creation coming soon')}
            onEditZone={(zoneId) => toast.info('Edit zone: ' + zoneId)}
          />
        </TabsContent>

        {/* Upload Tab (Legacy - for restrictions) */}
        <TabsContent value="upload">
          <GeoJsonUploader organizationId={user?.organization_id || ''} />
        </TabsContent>

        {/* Jurisdictions Tab */}
        <TabsContent value="jurisdictions">
          <div className="grid gap-4">
            {jurisdictions?.map((jurisdiction) => (
              <Card key={jurisdiction.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Map className="h-5 w-5 text-blue-600" />
                    {jurisdiction.name}
                  </CardTitle>
                  <CardDescription>
                    Type: {jurisdiction.organization_type?.toUpperCase() || 'Unknown'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-gray-600">
                    ID: <span className="font-mono">{jurisdiction.id}</span>
                  </div>
                </CardContent>
              </Card>
            ))}

            {(!jurisdictions || jurisdictions.length === 0) && (
              <Card>
                <CardContent className="text-center py-8 text-gray-500">
                  No jurisdictions found. Upload GeoJSON files to get started.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Restrictions Tab */}
        <TabsContent value="restrictions">
          <div className="grid gap-4">
            {restrictions?.map((restriction) => (
              <Card key={restriction.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-orange-600" />
                      {restriction.name}
                    </div>
                    <Badge variant="outline" className={
                      restriction.restriction_type === 'prohibited' ? 'bg-red-50 text-red-700' :
                      restriction.restriction_type === 'self_contained' ? 'bg-blue-50 text-blue-700' :
                      restriction.restriction_type === 'day_use' ? 'bg-orange-50 text-orange-700' :
                      'bg-purple-50 text-purple-700'
                    }>
                      {restriction.restriction_type.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Jurisdiction: {restriction.organization?.name || 'Unknown'}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}

            {(!restrictions || restrictions.length === 0) && (
              <Card>
                <CardContent className="text-center py-8 text-gray-500">
                  No restrictions found. Upload GeoJSON files to get started.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </AppLayout>
  )
}
