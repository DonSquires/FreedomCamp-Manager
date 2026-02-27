import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { MapPin, Plus, Edit, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'

interface Zone {
  id: string
  name: string
  organization_id: string
  location_lat: number | null
  location_lng: number | null
  is_active: boolean
  day_visit_only: boolean
  nights_per_month: number
  max_consecutive_nights: number
  self_contained_required: boolean
  created_at: string
}

export default function ZoneManagement() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  
  // Edit form state
  const [editName, setEditName] = useState('')
  const [editNightsPerMonth, setEditNightsPerMonth] = useState(28)
  const [editMaxConsecutive, setEditMaxConsecutive] = useState(3)
  const [editDayVisitOnly, setEditDayVisitOnly] = useState(false)
  const [editSelfContained, setEditSelfContained] = useState(true)

  // Fetch zones with counts
  const { data: zones, isLoading } = useQuery({
    queryKey: ['zones', user?.organization_id, showInactive, searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('zones')
        .select('*')
        .order('name', { ascending: true })

      if (user?.role !== 'master' && user?.organization_id) {
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
    setEditNightsPerMonth(28)
    setEditMaxConsecutive(3)
    setEditDayVisitOnly(false)
    setEditSelfContained(true)
  }

  const openEditDialog = (zone: any) => {
    setSelectedZone(zone)
    setEditName(zone.name)
    setEditNightsPerMonth(zone.nights_per_month)
    setEditMaxConsecutive(zone.max_consecutive_nights)
    setEditDayVisitOnly(zone.day_visit_only || false)
    setEditSelfContained(zone.self_contained_required)
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
                    <CardDescription className="mt-1">
                      {zone.location_lat && zone.location_lng 
                        ? `${zone.location_lat.toFixed(4)}, ${zone.location_lng.toFixed(4)}`
                        : 'No GPS coordinates'
                      }
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Zone</DialogTitle>
            <DialogDescription>
              Update zone compliance rules
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateZoneMutation.mutate({
                name: editName,
                nights_per_month: editNightsPerMonth,
                max_consecutive_nights: editMaxConsecutive,
                day_visit_only: editDayVisitOnly,
                self_contained_required: editSelfContained
              })}
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
