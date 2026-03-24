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
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'
import { ZoneGeofenceEditor } from '@/components/features/ZoneGeofenceEditor'
import { ZoneGeofenceIndicator } from '@/components/features/ZoneGeofenceIndicator'

interface Zone {
  id: string
  name: string
  description?: string | null
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
  land_manager?: string | null
  enforcement_authority?: string | null
  bylaw_clause?: string | null
  bylaw_source_url?: string | null
  land_managing_agency?: string | null
  bylaw_reference?: string | null
  seasonal_open_month?: number | null
  seasonal_close_month?: number | null
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
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  
  // Edit form state
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editOrganizationId, setEditOrganizationId] = useState('')
  const [editNightsPerMonth, setEditNightsPerMonth] = useState(28)
  const [editMaxConsecutive, setEditMaxConsecutive] = useState(3)
  const [editDayVisitOnly, setEditDayVisitOnly] = useState(false)
  const [editSelfContained, setEditSelfContained] = useState(true)
  const [editParentZoneId, setEditParentZoneId] = useState<string | null>(null)
  const [editZoneType, setEditZoneType] = useState('specific')
  const [editLandManager, setEditLandManager] = useState('')
  const [editEnforcementAuthority, setEditEnforcementAuthority] = useState('')
  const [editBylawClause, setEditBylawClause] = useState('')
  const [editBylawUrl, setEditBylawUrl] = useState('')
  const [editLandManagingAgency, setEditLandManagingAgency] = useState('')
  const [editBylawReference, setEditBylawReference] = useState('')
  const [editSeasonalOpenMonth, setEditSeasonalOpenMonth] = useState<number | null>(null)
  const [editSeasonalCloseMonth, setEditSeasonalCloseMonth] = useState<number | null>(null)
  const [showGeofenceEditor, setShowGeofenceEditor] = useState(false)

  // zone_legal_config payment & objections fields
  const [editPaymentOnlineUrl, setEditPaymentOnlineUrl] = useState('')
  const [editPaymentBankAccount, setEditPaymentBankAccount] = useState('')
  const [editPaymentInstructions, setEditPaymentInstructions] = useState('')
  const [editObjectionsEmail, setEditObjectionsEmail] = useState('')
  const [editObjectionsPostalAddress, setEditObjectionsPostalAddress] = useState('')
  const [editDisputePortalUrl, setEditDisputePortalUrl] = useState('')

  // Create form state
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createOrganizationId, setCreateOrganizationId] = useState('')
  const [createNightsPerMonth, setCreateNightsPerMonth] = useState(28)
  const [createMaxConsecutive, setCreateMaxConsecutive] = useState(3)
  const [createDayVisitOnly, setCreateDayVisitOnly] = useState(false)
  const [createSelfContained, setCreateSelfContained] = useState(true)
  const [createZoneType, setCreateZoneType] = useState('specific')
  const [createParentZoneId, setCreateParentZoneId] = useState<string | null>(null)

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
  const { data: zoneData, isLoading } = useQuery({
    queryKey: ['zones', organizationId, showInactive, searchQuery],
    queryFn: async () => {
      let query = (supabase.from('zones') as any)
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

      // Deduplicate zones by (organization_id, name) — keep first occurrence, count dupes
      const seen = new Set<string>()
      let duplicateCount = 0
      const uniqueZones = ((data || []) as Zone[]).filter((zone) => {
        const key = `${zone.organization_id}::${zone.name.trim().toLowerCase()}`
        if (seen.has(key)) { duplicateCount++; return false }
        seen.add(key)
        return true
      })

      // Fetch counts for each zone
      const zonesWithCounts = await Promise.all(
        uniqueZones.map(async (zone) => {
          const [obsCount, breachCount] = await Promise.all([
            supabase.from('observations').select('observation_id', { count: 'exact', head: true }).eq('zone_id', zone.id),
            supabase.from('breach_alerts').select('id', { count: 'exact', head: true }).eq('zone_id', zone.id),
          ])

          return {
            ...zone,
            observationCount: obsCount.count || 0,
            breachCount: breachCount.count || 0,
          }
        })
      )

      return { zones: zonesWithCounts, duplicateCount }
    },
  })

  // Toggle zone active status
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ zoneId, isActive }: { zoneId: string; isActive: boolean }) => {
      const { error } = await (supabase.from('zones') as any)
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

      const {
        land_manager,
        enforcement_authority,
        bylaw_clause,
        bylaw_source_url,
        ...zoneUpdates
      } = updates

      const { error } = await (supabase.from('zones') as any)
        .update(zoneUpdates)
        .eq('id', selectedZone.id)

      if (error) throw error

      // Persist legal + payment fields to zone_legal_config (authoritative legal profile)
      if (
        land_manager !== undefined ||
        enforcement_authority !== undefined ||
        bylaw_clause !== undefined ||
        bylaw_source_url !== undefined ||
        editPaymentOnlineUrl ||
        editPaymentBankAccount ||
        editPaymentInstructions ||
        editObjectionsEmail ||
        editObjectionsPostalAddress ||
        editDisputePortalUrl
      ) {
        const orgId = selectedZone.organization_id
        const { error: legalError } = await (supabase.from('zone_legal_config') as any)
          .upsert({
            zone_id: selectedZone.id,
            organization_id: orgId,
            managing_authority: editLandManager || null,
            enforcement_authority: editEnforcementAuthority || null,
            legal_description: editBylawClause || null,
            org_website: editBylawUrl || null,
            payment_online_url: editPaymentOnlineUrl || null,
            payment_bank_account: editPaymentBankAccount || null,
            payment_instructions: editPaymentInstructions || null,
            objections_email: editObjectionsEmail || null,
            objections_postal_address: editObjectionsPostalAddress || null,
            dispute_portal_url: editDisputePortalUrl || null,
          }, { onConflict: 'zone_id' })

        if (legalError) throw legalError
      }
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

  // Create zone mutation
  const createZoneMutation = useMutation({
    mutationFn: async () => {
      if (!createName.trim()) throw new Error('Zone name is required')
      const orgId = user?.role === 'master' ? createOrganizationId : user?.organization_id
      if (!orgId) throw new Error('Organisation is required')

      // Check for existing zone with same name in this org
      const { data: existing } = await supabase
        .from('zones')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .ilike('name', createName.trim())
        .limit(1)

      if (existing && existing.length > 0) {
        throw new Error(`A zone named "${createName.trim()}" already exists in this organisation`)
      }

      const { error } = await (supabase.from('zones') as any)
        .insert({
          name: createName.trim(),
          description: createDescription || null,
          organization_id: orgId,
          zone_type: createZoneType,
          parent_zone_id: createZoneType === 'general' ? null : createParentZoneId,
          nights_per_month: createNightsPerMonth,
          max_consecutive_nights: createMaxConsecutive,
          day_visit_only: createDayVisitOnly,
          self_contained_required: createSelfContained,
          is_active: true,
        })

      if (error) {
        if (error.message?.includes('idx_zones_unique_org_name_active')) {
          throw new Error(`A zone named "${createName.trim()}" already exists in this organisation`)
        }
        throw error
      }
    },
    onSuccess: () => {
      toast.success('Zone created successfully')
      queryClient.invalidateQueries({ queryKey: ['zones'] })
      setShowCreateDialog(false)
      resetCreateForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create zone')
    },
  })

  const resetForm = () => {
    setEditName('')
    setEditDescription('')
    setEditOrganizationId('')
    setEditNightsPerMonth(28)
    setEditMaxConsecutive(3)
    setEditDayVisitOnly(false)
    setEditSelfContained(true)
    setEditParentZoneId(null)
    setEditZoneType('specific')
    setEditLandManager('')
    setEditLandManagingAgency('')
    setEditBylawReference('')
    setEditSeasonalOpenMonth(null)
    setEditSeasonalCloseMonth(null)
    setEditEnforcementAuthority('')
    setEditBylawClause('')
    setEditBylawUrl('')
    setShowGeofenceEditor(false)
    setEditPaymentOnlineUrl('')
    setEditPaymentBankAccount('')
    setEditPaymentInstructions('')
    setEditObjectionsEmail('')
    setEditObjectionsPostalAddress('')
    setEditDisputePortalUrl('')
  }

  const resetCreateForm = () => {
    setCreateName('')
    setCreateDescription('')
    setCreateOrganizationId('')
    setCreateNightsPerMonth(28)
    setCreateMaxConsecutive(3)
    setCreateDayVisitOnly(false)
    setCreateSelfContained(true)
    setCreateZoneType('specific')
    setCreateParentZoneId(null)
  }

  const openEditDialog = (zone: any) => {
    setSelectedZone(zone)
    setEditName(zone.name)
    setEditDescription(zone.description || '')
    setEditOrganizationId(zone.organization_id)
    setEditNightsPerMonth(zone.nights_per_month)
    setEditMaxConsecutive(zone.max_consecutive_nights)
    setEditDayVisitOnly(zone.day_visit_only || false)
    setEditSelfContained(zone.self_contained_required)
    setEditParentZoneId(zone.parent_zone_id)
    setEditZoneType(zone.zone_type || 'specific')
    setEditLandManager('')
    setEditEnforcementAuthority('')
    setEditBylawClause('')
    setEditBylawUrl('')
    setEditLandManagingAgency(zone.land_managing_agency || '')
    setEditBylawReference(zone.bylaw_reference || '')
    setEditSeasonalOpenMonth(zone.seasonal_open_month ?? null)
    setEditSeasonalCloseMonth(zone.seasonal_close_month ?? null)
    setShowGeofenceEditor(false)

    // Load legal + payment fields from zone_legal_config
    ;(supabase.from('zone_legal_config') as any)
      .select('managing_authority, land_owner, enforcement_authority, legal_description, org_website, payment_online_url, payment_bank_account, payment_instructions, objections_email, objections_postal_address, dispute_portal_url')
      .eq('zone_id', zone.id)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        setEditLandManager(data?.managing_authority || data?.land_owner || zone.land_manager || '')
        setEditEnforcementAuthority(data?.enforcement_authority || zone.enforcement_authority || '')
        setEditBylawClause(data?.legal_description || zone.bylaw_clause || '')
        setEditBylawUrl(data?.org_website || zone.bylaw_source_url || '')
        setEditPaymentOnlineUrl(data?.payment_online_url || '')
        setEditPaymentBankAccount(data?.payment_bank_account || '')
        setEditPaymentInstructions(data?.payment_instructions || '')
        setEditObjectionsEmail(data?.objections_email || '')
        setEditObjectionsPostalAddress(data?.objections_postal_address || '')
        setEditDisputePortalUrl(data?.dispute_portal_url || '')
      })

    setShowEditDialog(true)
  }

  // Calculate stats
  const zones = zoneData?.zones ?? null
  const duplicateZoneCount = zoneData?.duplicateCount ?? 0
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
        <Button onClick={() => setShowCreateDialog(true)}>
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

      {/* Deduplication Warning */}
      {duplicateZoneCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4 mb-6 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200">
          <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 mt-0.5" />
          <div>
            <strong>{duplicateZoneCount} duplicate zone name{duplicateZoneCount !== 1 ? 's' : ''} detected</strong> — only the first occurrence is shown.
            Duplicate zone names violate the uniqueness constraint and may cause unexpected behaviour.
            Please rename or deactivate the duplicate zones to resolve this.
          </div>
        </div>
      )}

      {/* Zones Grid */}
      {isLoading ? (
        <PaperworkSearchAnimation text="Loading zones…" />
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
                      <ZoneGeofenceIndicator geometry={zone.geometry || zone.geom} compact />
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
                  <ZoneGeofenceIndicator geometry={zone.geometry || zone.geom} />

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
              Update zone compliance rules, legal info, and boundary
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

            <div>
              <Label htmlFor="editDescription">Description</Label>
              <Input
                id="editDescription"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Brief description of this zone"
              />
            </div>

            {/* ✅ Organization Selector (Masters Only) */}
            {user?.role === 'master' && (
              <div>
                <Label htmlFor="editOrganization">Organisation</Label>
                <Select
                  value={editOrganizationId}
                  onValueChange={setEditOrganizationId}
                >
                  <SelectTrigger id="editOrganization">
                    <SelectValue placeholder="Select organisation" />
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
                <Label>Organisation</Label>
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

            {/* Legal / Governance Fields */}
            <div className="border-t pt-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Legal & Governance</h4>
              <div>
                <Label htmlFor="editLandManager">Land Manager</Label>
                <Input
                  id="editLandManager"
                  value={editLandManager}
                  onChange={(e) => setEditLandManager(e.target.value)}
                  placeholder="e.g., DOC, LINZ, Council"
                />
              </div>
              <div>
                <Label htmlFor="editEnforcementAuthority">Enforcement Authority</Label>
                <Input
                  id="editEnforcementAuthority"
                  value={editEnforcementAuthority}
                  onChange={(e) => setEditEnforcementAuthority(e.target.value)}
                  placeholder="e.g., Tauranga City Council"
                />
              </div>
              <div>
                <Label htmlFor="editBylawClause">Bylaw Clause</Label>
                <Input
                  id="editBylawClause"
                  value={editBylawClause}
                  onChange={(e) => setEditBylawClause(e.target.value)}
                  placeholder="e.g., Freedom Camping Bylaw 2021, Clause 7"
                />
              </div>
              <div>
                <Label htmlFor="editBylawUrl">Bylaw Source URL</Label>
                <Input
                  id="editBylawUrl"
                  value={editBylawUrl}
                  onChange={(e) => setEditBylawUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              {/* New legal / operational fields */}
              <div>
                <Label htmlFor="editLandManagingAgency">Land Managing Agency</Label>
                <Select
                  value={editLandManagingAgency || ''}
                  onValueChange={(v) => setEditLandManagingAgency(v === 'none' ? '' : v)}
                >
                  <SelectTrigger id="editLandManagingAgency">
                    <SelectValue placeholder="Select agency…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Not specified —</SelectItem>
                    <SelectItem value="council">Council</SelectItem>
                    <SelectItem value="doc">DOC – Dept of Conservation</SelectItem>
                    <SelectItem value="linz">LINZ – Land Information NZ</SelectItem>
                    <SelectItem value="nzta">NZTA – NZ Transport Agency</SelectItem>
                    <SelectItem value="crown">Crown (other)</SelectItem>
                    <SelectItem value="private">Private land</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Determines which legislation applies (FCA 2011 for council/DOC, Crown Pastoral Land Act for LINZ, etc.)
                </p>
              </div>
              <div>
                <Label htmlFor="editBylawReference">Bylaw / Regulation Reference</Label>
                <Input
                  id="editBylawReference"
                  value={editBylawReference}
                  onChange={(e) => setEditBylawReference(e.target.value)}
                  placeholder="e.g. Freedom Camping Bylaw 2024 cl 7.2 or FCA 2011 s20(1)(a)"
                />
                <p className="text-xs text-muted-foreground mt-1">Pre-fills the legal basis on infringement notices issued in this zone.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="editSeasonalOpenMonth">Seasonal Open (month)</Label>
                  <Select
                    value={editSeasonalOpenMonth != null ? String(editSeasonalOpenMonth) : 'year-round'}
                    onValueChange={(v) => setEditSeasonalOpenMonth(v === 'year-round' ? null : Number(v))}
                  >
                    <SelectTrigger id="editSeasonalOpenMonth">
                      <SelectValue placeholder="Year-round" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="year-round">Year-round</SelectItem>
                      {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                        <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="editSeasonalCloseMonth">Seasonal Close (month, inclusive)</Label>
                  <Select
                    value={editSeasonalCloseMonth != null ? String(editSeasonalCloseMonth) : 'year-round'}
                    onValueChange={(v) => setEditSeasonalCloseMonth(v === 'year-round' ? null : Number(v))}
                  >
                    <SelectTrigger id="editSeasonalCloseMonth">
                      <SelectValue placeholder="Year-round" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="year-round">Year-round</SelectItem>
                      {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                        <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Notice Payment & Objections */}
            <div className="border-t pt-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Notice Payment &amp; Objections</h4>
              <p className="text-xs text-muted-foreground">These fields appear on infringement notices issued in this zone.</p>
              <div>
                <Label htmlFor="editPaymentOnlineUrl">Online Payment URL</Label>
                <Input
                  id="editPaymentOnlineUrl"
                  value={editPaymentOnlineUrl}
                  onChange={(e) => setEditPaymentOnlineUrl(e.target.value)}
                  placeholder="https://pay.council.govt.nz/..."
                />
              </div>
              <div>
                <Label htmlFor="editPaymentBankAccount">Bank Account (for direct credit)</Label>
                <Input
                  id="editPaymentBankAccount"
                  value={editPaymentBankAccount}
                  onChange={(e) => setEditPaymentBankAccount(e.target.value)}
                  placeholder="12-3456-7890123-00"
                />
              </div>
              <div>
                <Label htmlFor="editPaymentInstructions">Payment Instructions</Label>
                <Input
                  id="editPaymentInstructions"
                  value={editPaymentInstructions}
                  onChange={(e) => setEditPaymentInstructions(e.target.value)}
                  placeholder="Include notice number as reference"
                />
              </div>
              <div>
                <Label htmlFor="editObjectionsEmail">Objections Email</Label>
                <Input
                  id="editObjectionsEmail"
                  type="email"
                  value={editObjectionsEmail}
                  onChange={(e) => setEditObjectionsEmail(e.target.value)}
                  placeholder="enforcement@council.govt.nz"
                />
              </div>
              <div>
                <Label htmlFor="editObjectionsPostalAddress">Objections Postal Address</Label>
                <Input
                  id="editObjectionsPostalAddress"
                  value={editObjectionsPostalAddress}
                  onChange={(e) => setEditObjectionsPostalAddress(e.target.value)}
                  placeholder="PO Box 123, City 1234"
                />
              </div>
              <div>
                <Label htmlFor="editDisputePortalUrl">Dispute Portal URL</Label>
                <Input
                  id="editDisputePortalUrl"
                  type="url"
                  value={editDisputePortalUrl}
                  onChange={(e) => setEditDisputePortalUrl(e.target.value)}
                  placeholder="https://yourapp.example.com/public/dispute"
                />
                <p className="text-xs text-muted-foreground mt-1">Printed on notices so recipients can self-serve a dispute online.</p>
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
                    // Only update geometry (JSONB). geom is PostGIS and cannot be set from JSON directly.
                    const { error } = await (supabase.from('zones') as any)
                      .update({ geometry })
                      .eq('id', selectedZone.id)
                    if (error) throw error
                    queryClient.invalidateQueries({ queryKey: ['zones'] })
                    setShowGeofenceEditor(false)
                    toast.success('Zone boundary saved')
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
                  description: editDescription || null,
                  nights_per_month: editNightsPerMonth,
                  max_consecutive_nights: editMaxConsecutive,
                  day_visit_only: editDayVisitOnly,
                  self_contained_required: editSelfContained,
                  land_managing_agency: editLandManagingAgency || null,
                  bylaw_reference: editBylawReference || null,
                  seasonal_open_month: editSeasonalOpenMonth,
                  seasonal_close_month: editSeasonalCloseMonth,
                }
                
                // Masters can change organization, zone type, and parent
                if (user?.role === 'master') {
                  if (editOrganizationId) updates.organization_id = editOrganizationId
                  updates.zone_type = editZoneType
                  updates.parent_zone_id = editZoneType === 'general' ? null : editParentZoneId
                }
                
                updateZoneMutation.mutate(updates)
              }}
              disabled={updateZoneMutation.isPending || !editName.trim()}
            >
              {updateZoneMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Zone Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Zone</DialogTitle>
            <DialogDescription>Create a new enforcement or jurisdiction zone</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="createName">Zone Name *</Label>
              <Input
                id="createName"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g., Marine Parade Freedom Camping"
              />
            </div>
            <div>
              <Label htmlFor="createDescription">Description</Label>
              <Input
                id="createDescription"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Brief description"
              />
            </div>

            {user?.role === 'master' && (
              <div>
                <Label htmlFor="createOrganization">Organisation *</Label>
                <Select value={createOrganizationId} onValueChange={setCreateOrganizationId}>
                  <SelectTrigger id="createOrganization">
                    <SelectValue placeholder="Select organisation" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations?.map((org) => (
                      <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="createZoneType">Zone Type</Label>
              <Select value={createZoneType} onValueChange={setCreateZoneType}>
                <SelectTrigger id="createZoneType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">🗺️ General (Jurisdiction Area)</SelectItem>
                  <SelectItem value="specific">📍 Specific (Enforcement Zone)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {createZoneType === 'specific' && (
              <div>
                <Label htmlFor="createParentZone">Parent Zone (Jurisdiction)</Label>
                <Select
                  value={createParentZoneId || 'none'}
                  onValueChange={(v) => setCreateParentZoneId(v === 'none' ? null : v)}
                >
                  <SelectTrigger id="createParentZone"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {zones?.filter((z: any) => z.zone_type === 'general').map((z: any) => (
                      <SelectItem key={z.id} value={z.id}>🗺️ {z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="createNights">Max Nights/Month</Label>
                <Input
                  id="createNights"
                  type="number"
                  value={createNightsPerMonth}
                  onChange={(e) => setCreateNightsPerMonth(parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor="createConsecutive">Max Consecutive</Label>
                <Input
                  id="createConsecutive"
                  type="number"
                  value={createMaxConsecutive}
                  onChange={(e) => setCreateMaxConsecutive(parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="createDayVisit">Day Visit Only</Label>
                <Switch id="createDayVisit" checked={createDayVisitOnly} onCheckedChange={setCreateDayVisitOnly} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="createSelfContained">Requires Self-Contained</Label>
                <Switch id="createSelfContained" checked={createSelfContained} onCheckedChange={setCreateSelfContained} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); resetCreateForm() }}>
              Cancel
            </Button>
            <Button
              onClick={() => createZoneMutation.mutate()}
              disabled={createZoneMutation.isPending || !createName.trim() || (user?.role === 'master' && !createOrganizationId)}
            >
              {createZoneMutation.isPending ? 'Creating...' : 'Create Zone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
