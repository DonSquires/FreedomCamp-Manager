import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { AppLayout } from '@/components/features/AppLayout'
import { GeoJsonUploader } from '@/components/features/GeoJsonUploader'
import { OrganizationBoundaryEditor } from '@/components/features/OrganizationBoundaryEditor'
import { ZoneHierarchyManager } from '@/components/features/ZoneHierarchyManager'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Map, Shield, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export default function SpatialComplianceAdmin() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  // ── Create Zone state ─────────────────────────────────────────────────────
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createZoneType, setCreateZoneType] = useState('specific')
  const [createParentZoneId, setCreateParentZoneId] = useState<string | null>(null)
  const [createNightsPerMonth, setCreateNightsPerMonth] = useState(28)
  const [createMaxConsecutive, setCreateMaxConsecutive] = useState(3)
  const [createDayVisitOnly, setCreateDayVisitOnly] = useState(false)
  const [createSelfContained, setCreateSelfContained] = useState(true)

  // ── Edit Zone state ───────────────────────────────────────────────────────
  const [editZoneId, setEditZoneId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editNightsPerMonth, setEditNightsPerMonth] = useState(28)
  const [editMaxConsecutive, setEditMaxConsecutive] = useState(3)
  const [editDayVisitOnly, setEditDayVisitOnly] = useState(false)
  const [editSelfContained, setEditSelfContained] = useState(true)

  // Fetch organization boundary
  const { data: orgBoundary, refetch: refetchBoundary } = useQuery({
    queryKey: ['org-boundary', user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id) return null
      const { data, error } = await (supabase.from('organizations') as any)
        .select('geom')
        .eq('id', user.organization_id)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!user?.organization_id,
  })

  // Fetch jurisdictions
  const { data: jurisdictions, refetch: refetchJurisdictions } = useQuery({
    queryKey: ['jurisdictions'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('organizations') as any)
        .select('*')
        .not('geom', 'is', null)
        .order('name')
      if (error) throw error
      return data
    },
  })

  // Fetch restrictions
  const { data: restrictions, refetch: refetchRestrictions } = useQuery({
    queryKey: ['restrictions'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('restrictions') as any)
        .select('*, organization:organizations(name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // Fetch all zones for parent zone dropdown
  const { data: allZones } = useQuery({
    queryKey: ['zones-for-hierarchy', user?.organization_id],
    queryFn: async () => {
      if (!user?.organization_id) return []
      const { data, error } = await supabase
        .from('zones')
        .select('id, name, zone_type')
        .eq('organization_id', user.organization_id)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data
    },
    enabled: !!user?.organization_id,
  })

  // ── Create Zone mutation ──────────────────────────────────────────────────
  const createZoneMutation = useMutation({
    mutationFn: async () => {
      if (!createName.trim()) throw new Error('Zone name is required')
      const orgId = user?.organization_id
      if (!orgId) throw new Error('Organisation not set')

      // Duplicate name check
      const { data: existing } = await supabase
        .from('zones')
        .select('id')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .ilike('name', createName.trim())
        .limit(1)

      if (existing && existing.length > 0) {
        throw new Error(`A zone named "${createName.trim()}" already exists in this organisation`)
      }

      const { error } = await (supabase.from('zones') as any).insert({
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
      queryClient.invalidateQueries({ queryKey: ['zone-hierarchy'] })
      queryClient.invalidateQueries({ queryKey: ['zones-for-hierarchy'] })
      setShowCreateDialog(false)
      setCreateName('')
      setCreateDescription('')
      setCreateZoneType('specific')
      setCreateParentZoneId(null)
      setCreateNightsPerMonth(28)
      setCreateMaxConsecutive(3)
      setCreateDayVisitOnly(false)
      setCreateSelfContained(true)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create zone')
    },
  })

  // ── Edit Zone mutation ────────────────────────────────────────────────────
  const editZoneMutation = useMutation({
    mutationFn: async () => {
      if (!editZoneId) throw new Error('No zone selected')
      if (!editName.trim()) throw new Error('Zone name is required')

      const { error } = await (supabase.from('zones') as any)
        .update({
          name: editName.trim(),
          description: editDescription || null,
          nights_per_month: editNightsPerMonth,
          max_consecutive_nights: editMaxConsecutive,
          day_visit_only: editDayVisitOnly,
          self_contained_required: editSelfContained,
        })
        .eq('id', editZoneId)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Zone updated successfully')
      queryClient.invalidateQueries({ queryKey: ['zones'] })
      queryClient.invalidateQueries({ queryKey: ['zone-hierarchy'] })
      setEditZoneId(null)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update zone')
    },
  })

  // ── Open edit dialog, load zone data ─────────────────────────────────────
  const handleOpenEdit = async (zoneId: string) => {
    const { data, error } = await supabase
      .from('zones')
      .select('id, name, description, nights_per_month, max_consecutive_nights, day_visit_only, self_contained_required')
      .eq('id', zoneId)
      .single()

    if (error || !data) {
      toast.error('Failed to load zone')
      return
    }

    setEditZoneId(data.id)
    setEditName(data.name)
    setEditDescription((data as any).description ?? '')
    setEditNightsPerMonth((data as any).nights_per_month ?? 28)
    setEditMaxConsecutive((data as any).max_consecutive_nights ?? 3)
    setEditDayVisitOnly((data as any).day_visit_only ?? false)
    setEditSelfContained((data as any).self_contained_required ?? true)
  }

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
              {jurisdictions && restrictions
                ? ((restrictions.length / Math.max(jurisdictions.length, 1)) * 100).toFixed(0)
                : 0}%
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
          <TabsTrigger value="boundary">Organisation Boundary</TabsTrigger>
          <TabsTrigger value="zones">Zone Hierarchy</TabsTrigger>
          <TabsTrigger value="upload">Upload GeoJSON</TabsTrigger>
          <TabsTrigger value="jurisdictions">Jurisdictions</TabsTrigger>
          <TabsTrigger value="restrictions">Restrictions</TabsTrigger>
        </TabsList>

        {/* Organization Boundary Tab */}
        <TabsContent value="boundary">
          <OrganizationBoundaryEditor
            organizationId={user?.organization_id || ''}
            organizationName={user?.email?.split('@')[0] || 'Organisation'}
            currentBoundary={(orgBoundary as any)?.geom}
            onBoundaryUpdated={refetchBoundary}
          />
        </TabsContent>

        {/* Zone Hierarchy Tab */}
        <TabsContent value="zones">
          <ZoneHierarchyManager
            organizationId={user?.organization_id || ''}
            onCreateChildZone={() => setShowCreateDialog(true)}
            onEditZone={(zoneId) => handleOpenEdit(zoneId)}
          />
        </TabsContent>

        {/* Upload Tab */}
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
                    Type: {jurisdiction.type?.toUpperCase() || 'Unknown'}
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

      {/* ── Create Zone Dialog ──────────────────────────────────────────────── */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => { if (!open) setShowCreateDialog(false) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Zone</DialogTitle>
            <DialogDescription>Add a new zone to the hierarchy for your organisation</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="sz-create-name">Zone Name *</Label>
              <Input
                id="sz-create-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Waipu Cove Reserve"
              />
            </div>
            <div>
              <Label htmlFor="sz-create-desc">Description</Label>
              <Input
                id="sz-create-desc"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Brief description"
              />
            </div>
            <div>
              <Label htmlFor="sz-create-type">Zone Type</Label>
              <Select value={createZoneType} onValueChange={setCreateZoneType}>
                <SelectTrigger id="sz-create-type">
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
                <Label htmlFor="sz-create-parent">Parent Zone (Jurisdiction)</Label>
                <Select
                  value={createParentZoneId || 'none'}
                  onValueChange={(v) => setCreateParentZoneId(v === 'none' ? null : v)}
                >
                  <SelectTrigger id="sz-create-parent">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {allZones?.filter((z) => z.zone_type === 'general').map((z) => (
                      <SelectItem key={z.id} value={z.id}>🗺️ {z.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sz-create-nights">Max Nights/Month</Label>
                <Input
                  id="sz-create-nights"
                  type="number"
                  min={0}
                  value={createNightsPerMonth}
                  onChange={(e) => setCreateNightsPerMonth(parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label htmlFor="sz-create-consec">Max Consecutive</Label>
                <Input
                  id="sz-create-consec"
                  type="number"
                  min={0}
                  value={createMaxConsecutive}
                  onChange={(e) => setCreateMaxConsecutive(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="sz-create-dayvisit">Day Visit Only</Label>
                <Switch
                  id="sz-create-dayvisit"
                  checked={createDayVisitOnly}
                  onCheckedChange={setCreateDayVisitOnly}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="sz-create-scv">Requires Self-Contained</Label>
                <Switch
                  id="sz-create-scv"
                  checked={createSelfContained}
                  onCheckedChange={setCreateSelfContained}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createZoneMutation.mutate()}
              disabled={createZoneMutation.isPending || !createName.trim()}
            >
              {createZoneMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</>
                : 'Create Zone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Zone Dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!editZoneId} onOpenChange={(open) => { if (!open) setEditZoneId(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Zone</DialogTitle>
            <DialogDescription>Update the details of this zone</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="sz-edit-name">Zone Name *</Label>
              <Input
                id="sz-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sz-edit-desc">Description</Label>
              <Input
                id="sz-edit-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Brief description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sz-edit-nights">Max Nights/Month</Label>
                <Input
                  id="sz-edit-nights"
                  type="number"
                  min={0}
                  value={editNightsPerMonth}
                  onChange={(e) => setEditNightsPerMonth(parseInt(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label htmlFor="sz-edit-consec">Max Consecutive</Label>
                <Input
                  id="sz-edit-consec"
                  type="number"
                  min={0}
                  value={editMaxConsecutive}
                  onChange={(e) => setEditMaxConsecutive(parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="sz-edit-dayvisit">Day Visit Only</Label>
                <Switch
                  id="sz-edit-dayvisit"
                  checked={editDayVisitOnly}
                  onCheckedChange={setEditDayVisitOnly}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="sz-edit-scv">Requires Self-Contained</Label>
                <Switch
                  id="sz-edit-scv"
                  checked={editSelfContained}
                  onCheckedChange={setEditSelfContained}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditZoneId(null)}>Cancel</Button>
            <Button
              onClick={() => editZoneMutation.mutate()}
              disabled={editZoneMutation.isPending || !editName.trim()}
            >
              {editZoneMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}


