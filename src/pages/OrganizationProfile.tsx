import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Building2, MapPin, Users, Settings, Mail, Phone, Layers, Plus, Edit, CheckCircle, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/features/AppLayout'
import { ZoneGeofenceEditor } from '@/components/features/ZoneGeofenceEditor'
import { getOrgTypeLabel } from '@/lib/utils'
interface Organization {
  id: string
  name: string
  organization_type: string
  organization_level: number
  parent_organization_id: string | null
  is_active: boolean
  enforcement_workflow: string
  contact_email: string
  contact_phone: string
  geom: any
}

interface Zone {
  id: string
  name: string
  zone_type: string
  parent_zone_id: string | null
  is_active: boolean
  geometry: any
  geom: any
  location_lat: number | null
  location_lng: number | null
  nights_per_month: number
  max_consecutive_nights: number
  day_visit_only: boolean
  self_contained_required: boolean
}

export default function OrganizationProfile() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showAddChildDialog, setShowAddChildDialog] = useState(false)
  const [showGeofenceEditor, setShowGeofenceEditor] = useState(false)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [showEditZoneDialog, setShowEditZoneDialog] = useState(false)
  const [editingZone, setEditingZone] = useState<Zone | null>(null)

  // Add child zone form state
  const [childName, setChildName] = useState('')
  const [childNightsPerMonth, setChildNightsPerMonth] = useState(28)
  const [childMaxConsecutive, setChildMaxConsecutive] = useState(3)
  const [childDayVisitOnly, setChildDayVisitOnly] = useState(false)
  const [childSelfContained, setChildSelfContained] = useState(true)

  // Edit zone form state
  const [editZoneName, setEditZoneName] = useState('')
  const [editZoneNights, setEditZoneNights] = useState(28)
  const [editZoneConsecutive, setEditZoneConsecutive] = useState(3)
  const [editZoneDayVisit, setEditZoneDayVisit] = useState(false)
  const [editZoneSelfContained, setEditZoneSelfContained] = useState(true)

  const organizationId = user?.organization_id

  // Fetch organization details
  const { data: organization, isLoading: orgLoading } = useQuery({
    queryKey: ['organization-profile', organizationId],
    queryFn: async () => {
      if (!organizationId) return null

      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', organizationId)
        .single()

      if (error) throw error
      return data as Organization
    },
    enabled: !!organizationId,
  })

  // Fetch zones for this organization
  const { data: zones, isLoading: zonesLoading } = useQuery({
    queryKey: ['organization-zones', organizationId],
    queryFn: async () => {
      if (!organizationId) return []

      const { data, error } = await supabase
        .from('zones')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('zone_type', { ascending: false }) // General first
        .order('name', { ascending: true })

      if (error) throw error
      return data as Zone[]
    },
    enabled: !!organizationId,
  })

  // Fetch org stats
  const { data: stats } = useQuery({
    queryKey: ['organization-profile-stats', organizationId],
    queryFn: async () => {
      if (!organizationId) return { users: 0, zones: 0, observations: 0 }

      const [userCount, zoneCount, obsCount] = await Promise.all([
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
        supabase.from('zones').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).eq('is_active', true),
        supabase.from('observations').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId),
      ])

      return {
        users: userCount.count || 0,
        zones: zoneCount.count || 0,
        observations: obsCount.count || 0,
      }
    },
    enabled: !!organizationId,
  })

  // Separate parent and child zones
  const parentZones = zones?.filter(z => z.zone_type === 'general') || []
  const childZones = zones?.filter(z => z.zone_type === 'specific') || []

  // Create child zone mutation
  const createChildZoneMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('No organization')
      if (!childName.trim()) throw new Error('Zone name is required')

      const parentZone = parentZones[0] // Use first parent zone

      const { error } = await (supabase
        .from('zones') as any)
        .insert({
          organization_id: organizationId,
          name: childName.trim(),
          zone_type: 'specific',
          parent_zone_id: parentZone?.id || null,
          is_active: true,
          nights_per_month: childNightsPerMonth,
          max_consecutive_nights: childMaxConsecutive,
          day_visit_only: childDayVisitOnly,
          self_contained_required: childSelfContained,
        })

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Child zone created successfully')
      queryClient.invalidateQueries({ queryKey: ['organization-zones'] })
      queryClient.invalidateQueries({ queryKey: ['organization-profile-stats'] })
      setShowAddChildDialog(false)
      resetChildForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create child zone')
    },
  })

  const resetChildForm = () => {
    setChildName('')
    setChildNightsPerMonth(28)
    setChildMaxConsecutive(3)
    setChildDayVisitOnly(false)
    setChildSelfContained(true)
  }

  // Update zone mutation (for inline edit of child zones)
  const updateZoneMutation = useMutation({
    mutationFn: async (updates: { id: string } & Partial<Zone>) => {
      const { id, ...fields } = updates
      const { error } = await (supabase.from('zones') as any)
        .update(fields)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Zone updated successfully')
      queryClient.invalidateQueries({ queryKey: ['organization-zones'] })
      setShowEditZoneDialog(false)
      setEditingZone(null)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update zone')
    },
  })

  const openEditZone = (zone: Zone) => {
    setEditingZone(zone)
    setEditZoneName(zone.name)
    setEditZoneNights(zone.nights_per_month)
    setEditZoneConsecutive(zone.max_consecutive_nights)
    setEditZoneDayVisit(zone.day_visit_only)
    setEditZoneSelfContained(zone.self_contained_required)
    setShowEditZoneDialog(true)
  }

  if (!organizationId) {
    return (
      <AppLayout title="Organization Profile" showBackButton>
        <Card>
          <CardContent className="text-center py-12">
            <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No organization assigned to your account.</p>
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Organization Profile" description="Manage your organization and jurisdiction zones" showBackButton>
      {/* Organization Details */}
      {orgLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading organization...</p>
        </div>
      ) : organization ? (
        <div className="space-y-6">
          {/* Organization Header Card */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                    <Building2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">{organization.name}</CardTitle>
                    <CardDescription className="mt-1">
                      <Badge variant="outline" className="mr-2">
                        {getOrgTypeLabel(organization.organization_type)}
                      </Badge>
                      <Badge variant={organization.is_active ? 'default' : 'secondary'}>
                        {organization.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </CardDescription>
                  </div>
                </div>
                {(user?.role === 'admin' || user?.role === 'master') && (
                  <Button variant="outline" size="sm" onClick={() => navigate('/organizations')}>
                    <Settings className="h-4 w-4 mr-2" />
                    Settings
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Users */}
                <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-blue-600">{stats?.users || 0}</div>
                    <div className="text-sm text-gray-600">Officers</div>
                  </div>
                </div>

                {/* Zones */}
                <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                  <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                    <MapPin className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">{stats?.zones || 0}</div>
                    <div className="text-sm text-gray-600">Active Zones</div>
                  </div>
                </div>

                {/* Workflow */}
                <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
                  <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                    <Settings className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-purple-600">
                      {organization.enforcement_workflow?.replace('_', ' ').toUpperCase() || 'DEFAULT'}
                    </div>
                    <div className="text-xs text-gray-600">Workflow</div>
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              {(organization.contact_email || organization.contact_phone) && (
                <div className="mt-4 pt-4 border-t flex flex-wrap gap-4">
                  {organization.contact_email && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Mail className="h-4 w-4" />
                      <span>{organization.contact_email}</span>
                    </div>
                  )}
                  {organization.contact_phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone className="h-4 w-4" />
                      <span>{organization.contact_phone}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Jurisdiction Zone (Parent) */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-purple-600" />
                    Jurisdiction Zone
                  </CardTitle>
                  <CardDescription className="mt-1">
                    The parent boundary that defines your organization's enforcement area
                  </CardDescription>
                </div>
                <Badge variant="outline" className={parentZones.length > 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}>
                  {parentZones.length > 0 ? '✅ Configured' : '⚠️ Not Set'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {zonesLoading ? (
                <div className="text-center py-8 text-gray-500">Loading zones...</div>
              ) : parentZones.length === 0 ? (
                <div className="text-center py-8">
                  <MapPin className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 mb-2">No jurisdiction zone configured</p>
                  <p className="text-sm text-gray-500">
                    A jurisdiction zone defines your organization's boundary. Contact your system administrator or use Zone Management to create one.
                  </p>
                  {(user?.role === 'admin' || user?.role === 'master') && (
                    <Button variant="outline" className="mt-4" onClick={() => navigate('/zones')}>
                      <MapPin className="h-4 w-4 mr-2" />
                      Go to Zone Management
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {parentZones.map((zone) => (
                    <div key={zone.id} className="p-4 bg-purple-50 dark:bg-purple-950 rounded-lg border border-purple-200 dark:border-purple-800">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-5 w-5 text-purple-600" />
                          <span className="font-semibold text-lg">{zone.name}</span>
                          <Badge variant="outline" className="text-xs">Jurisdiction</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {zone.geometry || zone.geom ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Boundary Set
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              No Boundary
                            </Badge>
                          )}
                          {(user?.role === 'admin' || user?.role === 'master') && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingZoneId(zone.id)
                                setShowGeofenceEditor(true)
                              }}
                            >
                              <Edit className="h-3 w-3 mr-1" />
                              {zone.geometry || zone.geom ? 'Edit' : 'Set'} Boundary
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                        <div className="text-gray-600">
                          <span className="block text-xs text-gray-500">Max Nights/Month</span>
                          <span className="font-medium">{zone.nights_per_month}</span>
                        </div>
                        <div className="text-gray-600">
                          <span className="block text-xs text-gray-500">Max Consecutive</span>
                          <span className="font-medium">{zone.max_consecutive_nights}</span>
                        </div>
                        <div className="text-gray-600">
                          <span className="block text-xs text-gray-500">Day Visit Only</span>
                          <span className="font-medium">{zone.day_visit_only ? 'Yes' : 'No'}</span>
                        </div>
                        <div className="text-gray-600">
                          <span className="block text-xs text-gray-500">Self-Contained</span>
                          <span className="font-medium">{zone.self_contained_required ? 'Required' : 'Not Required'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Child Zones (Enforcement Areas) */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-blue-600" />
                    Enforcement Zones
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Child zones within the jurisdiction for specific enforcement areas
                  </CardDescription>
                </div>
                {(user?.role === 'admin' || user?.role === 'admin_officer' || user?.role === 'master') && (
                  <Button onClick={() => setShowAddChildDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Child Zone
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {zonesLoading ? (
                <div className="text-center py-8 text-gray-500">Loading zones...</div>
              ) : childZones.length === 0 ? (
                <div className="text-center py-8">
                  <MapPin className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No enforcement zones yet</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Add child zones within your jurisdiction to define specific patrol and enforcement areas.
                  </p>
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
                          {zone.parent_zone_id && parentZones.find(p => p.id === zone.parent_zone_id) && (
                            <div className="text-xs text-gray-600 mt-1">
                              Parent: {parentZones.find(p => p.id === zone.parent_zone_id)?.name}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {zone.geometry || zone.geom ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Boundary
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              No Boundary
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditZone(zone)}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="text-xs text-gray-600 space-y-0.5">
                        <div>Max nights: {zone.nights_per_month}/month, {zone.max_consecutive_nights} consecutive</div>
                        <div className="flex gap-2">
                          {zone.day_visit_only && <Badge variant="outline" className="text-xs bg-orange-50">Day Visit Only</Badge>}
                          {zone.self_contained_required && <Badge variant="outline" className="text-xs bg-blue-50">Requires SC</Badge>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="text-center py-12">
            <Building2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Organization not found</p>
          </CardContent>
        </Card>
      )}

      {/* Add Child Zone Dialog */}
      <Dialog open={showAddChildDialog} onOpenChange={setShowAddChildDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Enforcement Zone</DialogTitle>
            <DialogDescription>
              Create a new child zone within your jurisdiction
              {parentZones.length > 0 && (
                <span className="block mt-1 text-blue-600">
                  Parent: {parentZones[0].name}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="childName">Zone Name</Label>
              <Input
                id="childName"
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                placeholder="e.g., Marine Parade, Lake Rotorua"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="childNights">Max Nights/Month</Label>
                <Input
                  id="childNights"
                  type="number"
                  value={childNightsPerMonth}
                  onChange={(e) => setChildNightsPerMonth(parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="childConsecutive">Max Consecutive</Label>
                <Input
                  id="childConsecutive"
                  type="number"
                  value={childMaxConsecutive}
                  onChange={(e) => setChildMaxConsecutive(parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="childDayVisit">Day Visit Only</Label>
                <Switch
                  id="childDayVisit"
                  checked={childDayVisitOnly}
                  onCheckedChange={setChildDayVisitOnly}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="childSelfContained">Requires Self-Contained</Label>
                <Switch
                  id="childSelfContained"
                  checked={childSelfContained}
                  onCheckedChange={setChildSelfContained}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddChildDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createChildZoneMutation.mutate()}
              disabled={createChildZoneMutation.isPending || !childName.trim()}
            >
              {createChildZoneMutation.isPending ? 'Creating...' : 'Create Zone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Geofence Editor Dialog */}
      <Dialog open={showGeofenceEditor} onOpenChange={setShowGeofenceEditor}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Zone Boundary</DialogTitle>
            <DialogDescription>
              Set the geofence boundary for this zone
            </DialogDescription>
          </DialogHeader>
          <ZoneGeofenceEditor
            zoneId={editingZoneId || undefined}
            initialGeometry={editingZoneId ? zones?.find(z => z.id === editingZoneId)?.geometry : undefined}
            onSave={async (geometry) => {
              if (!editingZoneId) return
              // Only update geometry (JSONB). geom is PostGIS and cannot be set from JSON directly.
              const { error } = await (supabase.from('zones') as any)
                .update({ geometry })
                .eq('id', editingZoneId)
              if (error) throw error
              queryClient.invalidateQueries({ queryKey: ['organization-zones'] })
              setShowGeofenceEditor(false)
              setEditingZoneId(null)
              toast.success('Zone boundary saved')
            }}
            onCancel={() => {
              setShowGeofenceEditor(false)
              setEditingZoneId(null)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Inline Edit Child Zone Dialog */}
      <Dialog open={showEditZoneDialog} onOpenChange={setShowEditZoneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Zone – {editingZone?.name}</DialogTitle>
            <DialogDescription>Update compliance rules for this enforcement zone</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="editZoneName">Zone Name</Label>
              <Input
                id="editZoneName"
                value={editZoneName}
                onChange={(e) => setEditZoneName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="editZoneNights">Max Nights/Month</Label>
                <Input
                  id="editZoneNights"
                  type="number"
                  value={editZoneNights}
                  onChange={(e) => setEditZoneNights(parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="editZoneConsecutive">Max Consecutive</Label>
                <Input
                  id="editZoneConsecutive"
                  type="number"
                  value={editZoneConsecutive}
                  onChange={(e) => setEditZoneConsecutive(parseInt(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="editZoneDayVisit">Day Visit Only</Label>
                <Switch id="editZoneDayVisit" checked={editZoneDayVisit} onCheckedChange={setEditZoneDayVisit} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="editZoneSC">Requires Self-Contained</Label>
                <Switch id="editZoneSC" checked={editZoneSelfContained} onCheckedChange={setEditZoneSelfContained} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditZoneDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editingZone) return
                updateZoneMutation.mutate({
                  id: editingZone.id,
                  name: editZoneName,
                  nights_per_month: editZoneNights,
                  max_consecutive_nights: editZoneConsecutive,
                  day_visit_only: editZoneDayVisit,
                  self_contained_required: editZoneSelfContained,
                })
              }}
              disabled={updateZoneMutation.isPending || !editZoneName.trim()}
            >
              {updateZoneMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
