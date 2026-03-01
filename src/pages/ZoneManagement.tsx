import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useGlobalFiltersStore } from '@/stores/globalFiltersStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MapPin, Plus, Edit, CheckCircle, XCircle, Building2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { ZoneGeofenceEditor } from '@/components/features/ZoneGeofenceEditor'

interface Zone {
  id: string
  name: string
  organization_id: string
  parent_zone_id: string | null
  zone_type: string
  location_lat: number | null
  location_lng: number | null
  geometry: any
  geom: any
  is_active: boolean
  day_visit_only: boolean
  nights_per_month: number
  max_consecutive_nights: number
  self_contained_required: boolean
  created_at: string
  organization?: {
    id: string
    name: string
  }
  parent_zone?: {
    id: string
    name: string
  }
}

interface Organization {
  id: string
  name: string
}

export default function ZoneManagement() {
  const { user } = useAuthStore()
  const { organizationId } = useGlobalFiltersStore()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  
  // Edit form state
  const [editName, setEditName] = useState('')
  const [editOrganizationId, setEditOrganizationId] = useState('')
  const [editNightsPerMonth, setEditNightsPerMonth] = useState(28)
  const [editMaxConsecutive, setEditMaxConsecutive] = useState(3)
  const [editDayVisitOnly, setEditDayVisitOnly] = useState(false)
  const [editSelfContained, setEditSelfContained] = useState(true)
  const [editParentZoneId, setEditParentZoneId] = useState<string | null>(null)
  const [editZoneType, setEditZoneType] = useState('specific')
  const [showGeofenceEditor, setShowGeofenceEditor] = useState(false)

  // Fetch all organizations (for Masters only)
  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      if (user?.role !== 'master') return []
      
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name', { ascending: true })
      
      if (error) throw error
      return data as Organization[]
    },
    enabled: user?.role === 'master',
  })

  // Fetch zones with counts
  const { data: zones, isLoading } = useQuery({
    queryKey: ['zones', organizationId, showInactive, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('zones')
        .select(`
          *,
          organization:organizations(
            id,
            name
          ),
          parent_zone:zones!parent_zone_id(
            id,
            name
          )
        `)
        .order('zone_type', { ascending: false })  // General zones first
        .order('name', { ascending: true })

      // ✅ Filter by GlobalFilterRibbon organization selector
      if (organizationId) {
        query = query.eq('organization_id', organizationId)
      } else if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id)
      }

      if (!showInactive) {
        query = query.eq('is_active', true)
      }

      if (searchQuery) {
        query = query.ilike('name', `%${searchQuery}%`)
      }

      const { data, error } = await query
      if (error) throw error

      // Fetch counts for each zone
      const zonesWithCounts = await Promise.all(
        (data || []).map(async (zone) => {
          const [obsCount, breachCount] = await Promise.all([
            supabase.from('observations').select('id', { count: 'exact', head: true }).eq('zone_id', zone.id),
            supabase.from('breach_alerts').select('id', { count: 'exact', head: true }).eq('zone_id', zone.id),
          ])

          return {
            ...zone,
            observationCount: obsCount.count || 0,
            breachCount: breachCount.count || 0,
          }
        })
      )

      return zonesWithCounts
    },
  })

  // Toggle zone active status
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ zoneId, isActive }: { zoneId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('zones')
        .update({ is_active: !isActive })
        .eq('id', zoneId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zones'] })
      toast.success('Zone status updated')
    },
    onError: () => {
      toast.error('Failed to update zone status')
    },
  })

  // Update zone mutation
  const updateZoneMutation = useMutation({
    mutationFn: async (updates: Partial<Zone>) => {
      if (!selectedZone) throw new Error('No zone selected')
      
      const { error } = await supabase
        .from('zones')
        .update(updates)
        .eq('id', selectedZone.id)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Zone updated successfully')
      queryClient.invalidateQueries({ queryKey: ['zones'] })
      setShowEditDialog(false)
      setSelectedZone(null)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update zone')
    },
  })

  const resetForm = () => {
    setEditName('')
    setEditOrganizationId('')
    setEditNightsPerMonth(28)
    setEditMaxConsecutive(3)
    setEditDayVisitOnly(false)
    setEditSelfContained(true)
    setEditParentZoneId(null)
    setEditZoneType('specific')
    setShowGeofenceEditor(false)
  }

  const openEditDialog = (zone: any) => {
    setSelectedZone(zone)
    setEditName(zone.name)
    setEditOrganizationId(zone.organization_id)
    setEditNightsPerMonth(zone.nights_per_month)
    setEditMaxConsecutive(zone.max_consecutive_nights)
    setEditDayVisitOnly(zone.day_visit_only || false)
    setEditSelfContained(zone.self_contained_required)
    setEditParentZoneId(zone.parent_zone_id)
    setEditZoneType(zone.zone_type || 'specific')
    setShowGeofenceEditor(false)
    setShowEditDialog(true)
  }

  // Calculate stats
  const stats = zones ? {
    total: zones.length,
    active: zones.filter(z => z.is_active).length,
    inactive: zones.filter(z => !z.is_active).length,
    dayVisitOnly: zones.filter(z => z.day_visit_only).length,
    requiresSC: zones.filter(z => z.self_contained_required).length,
  } : null

  return (
    <AppLayout title="Zone Management" description="Configure compliance zones and geofencing" showBackButton>
      <GlobalFilterRibbon showDateFilter={false} />

      <div className="flex justify-end mb-6">
        <Button disabled>
          <Plus className="h-4 w-4 mr-2" />
          Add Zone
        </Button>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
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
              <CardTitle className="text-sm font-medium text-green-600">Active</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.active}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Inactive</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-600">{stats.inactive}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-600">Day Visit Only</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.dayVisitOnly}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600">Requires SC</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.requiresSC}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="flex-1 w-full">
              <Input
                placeholder="Search zones by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Switch
                checked={showInactive}
                onCheckedChange={setShowInactive}
                id="show-inactive"
              />
              <label htmlFor="show-inactive" className="text-sm text-gray-600 cursor-pointer">
                Show inactive zones
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Zones Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading zones...</p>
        </div>
      ) : zones && zones.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <MapPin className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No zones found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {zones?.map((zone: any) => (
            <Card key={zone.id} className={`hover:shadow-lg transition-shadow ${!zone.is_active ? 'opacity-60' : ''}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                      <MapPin className="h-5 w-5" />
                      {zone.name}
                    </CardTitle>
                    <CardDescription className="mt-1 space-y-1">
                      {/* ✅ Organization Display */}
                      {zone.organization && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-600">
                          <Building2 className="h-3 w-3" />
                          <span className="font-medium">{zone.organization.name}</span>
                        </div>
                      )}
                      {/* ✅ Parent Zone Display */}
                      {zone.parent_zone && (
                        <div className="flex items-center gap-1.5 text-xs text-blue-600">
                          <MapPin className="h-3 w-3" />
                          <span>Parent: {zone.parent_zone.name}</span>
                        </div>
                      )}
                      {/* Zone Type Badge */}
                      {zone.zone_type === 'general' && (
                        <Badge variant="outline" className="bg-purple-50 text-xs">
                          Jurisdiction Zone
                        </Badge>
                      )}
                      {!zone.geometry && !zone.geom && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 text-xs">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          No Boundary
                        </Badge>
                      )}
                      <div>
                        {zone.location_lat && zone.location_lng 
                          ? `${zone.location_lat.toFixed(4)}, ${zone.location_lng.toFixed(4)}`
                          : 'No GPS coordinates'
                        }
                      </div>
                    </CardDescription>
                  </div>
                  {zone.is_active ? (
                    <Badge variant="outline" className="bg-green-50">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-gray-50">
                      <XCircle className="h-3 w-3 mr-1" />
                      Inactive
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {/* Compliance Rules */}
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-2">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Compliance Rules</h4>
                    
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Max nights/month:</span>
                      <span className="font-medium">{zone.nights_per_month}</span>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Max consecutive:</span>
                      <span className="font-medium">{zone.max_consecutive_nights}</span>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-2">
                      {zone.day_visit_only && (
                        <Badge variant="outline" className="text-xs bg-orange-50">
                          Day Visit Only
                        </Badge>
                      )}
                      {zone.self_contained_required && (
                        <Badge variant="outline" className="text-xs bg-blue-50">
                          Requires SC
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Activity Stats */}
                  <div className="flex items-center justify-between text-sm pt-2 border-t">
                    <span className="text-gray-600">Observations:</span>
                    <span className="font-medium">{zone.observationCount || 0}</span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Breaches:</span>
                    <span className={`font-medium ${(zone.breachCount || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {zone.breachCount || 0}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-3 mt-3 border-t">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => openEditDialog(zone)}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button 
                      variant={zone.is_active ? "outline" : "default"}
                      size="sm" 
                      className="flex-1"
                      onClick={() => toggleActiveMutation.mutate({ 
                        zoneId: zone.id, 
                        isActive: zone.is_active 
                      })}
                    >
                      {zone.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Zone Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Zone</DialogTitle>
            <DialogDescription>
              Update zone compliance rules and boundary
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="editName">Zone Name</Label>
              <Input
                id="editName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            {/* ✅ Organization Selector (Masters Only) */}
            {user?.role === 'master' && (
              <div>
                <Label htmlFor="editOrganization">Organization</Label>
                <Select
                  value={editOrganizationId}
                  onValueChange={setEditOrganizationId}
                >
                  <SelectTrigger id="editOrganization">
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations?.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* ✅ Organization Display (Non-Masters) */}
            {user?.role !== 'master' && selectedZone?.organization && (
              <div>
                <Label>Organization</Label>
                <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-md">
                  <Building2 className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">{selectedZone.organization.name}</span>
                </div>
              </div>
            )}

            {/* ✅ Zone Type (Masters Only) */}
            {user?.role === 'master' && (
              <div>
                <Label htmlFor="editZoneType">Zone Type</Label>
                <Select
                  value={editZoneType}
                  onValueChange={setEditZoneType}
                >
                  <SelectTrigger id="editZoneType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">🗺️ General (Jurisdiction Area)</SelectItem>
                    <SelectItem value="specific">📍 Specific (Enforcement Zone)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* ✅ Parent Zone Selector (For Specific Zones) */}
            {editZoneType === 'specific' && (
              <div>
                <Label htmlFor="editParentZone">Parent Zone (Jurisdiction)</Label>
                <Select
                  value={editParentZoneId || 'none'}
                  onValueChange={(val) => setEditParentZoneId(val === 'none' ? null : val)}
                >
                  <SelectTrigger id="editParentZone">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (Top-level zone)</SelectItem>
                    {zones?.filter((z: any) => z.zone_type === 'general' && z.id !== selectedZone?.id).map((parentZone: any) => (
                      <SelectItem key={parentZone.id} value={parentZone.id}>
                        🗺️ {parentZone.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="editNights">Max Nights/Month</Label>
                <Input
                  id="editNights"
                  type="number"
                  value={editNightsPerMonth}
                  onChange={(e) => setEditNightsPerMonth(parseInt(e.target.value))}
                />
              </div>
              
              <div>
                <Label htmlFor="editConsecutive">Max Consecutive</Label>
                <Input
                  id="editConsecutive"
                  type="number"
                  value={editMaxConsecutive}
                  onChange={(e) => setEditMaxConsecutive(parseInt(e.target.value))}
                />
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="editDayVisit">Day Visit Only</Label>
                <Switch
                  id="editDayVisit"
                  checked={editDayVisitOnly}
                  onCheckedChange={setEditDayVisitOnly}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <Label htmlFor="editSelfContained">Requires Self-Contained</Label>
                <Switch
                  id="editSelfContained"
                  checked={editSelfContained}
                  onCheckedChange={setEditSelfContained}
                />
              </div>
            </div>

            {/* Zone Boundary Section */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <Label>Zone Boundary</Label>
                <Badge variant="outline" className={selectedZone?.geometry || selectedZone?.geom ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}>
                  {selectedZone?.geometry || selectedZone?.geom ? '✅ Boundary Set' : '⚠️ No Boundary'}
                </Badge>
              </div>
              {!showGeofenceEditor ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowGeofenceEditor(true)}
                >
                  <MapPin className="h-4 w-4 mr-2" />
                  {selectedZone?.geometry || selectedZone?.geom ? 'Edit Boundary' : 'Set Boundary'}
                </Button>
              ) : (
                <ZoneGeofenceEditor
                  zoneId={selectedZone?.id}
                  initialGeometry={selectedZone?.geometry}
                  onSave={async (geometry) => {
                    if (!selectedZone) return
                    const { error } = await supabase
                      .from('zones')
                      .update({ geometry, geom: geometry })
                      .eq('id', selectedZone.id)
                    if (error) throw error
                    queryClient.invalidateQueries({ queryKey: ['zones'] })
                    setShowGeofenceEditor(false)
                  }}
                  onCancel={() => setShowGeofenceEditor(false)}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                const updates: Partial<Zone> = {
                  name: editName,
                  nights_per_month: editNightsPerMonth,
                  max_consecutive_nights: editMaxConsecutive,
                  day_visit_only: editDayVisitOnly,
                  self_contained_required: editSelfContained
                }
                
                // ✅ Masters can change organization, zone type, and parent
                if (user?.role === 'master') {
                  if (editOrganizationId) {
                    updates.organization_id = editOrganizationId
                  }
                  updates.zone_type = editZoneType
                  updates.parent_zone_id = editZoneType === 'general' ? null : editParentZoneId
                }
                
                updateZoneMutation.mutate(updates)
              }}
              disabled={updateZoneMutation.isPending}
            >
              {updateZoneMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
