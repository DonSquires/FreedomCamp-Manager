import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Building2, Users, MapPin, Settings, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { getOrgTypeLabel, getOvernightVerificationModeLabel } from '@/lib/utils'

interface Organization {
  id: string
  name: string
  organization_type: string
  organization_level: number
  parent_organization_id: string | null
  is_active: boolean
  enforcement_workflow: string
  overnight_verification_mode: 'two_photo_verification' | 'one_photo_per_day_inference'
  contact_email: string | null
  contact_phone: string | null
}

export default function OrganizationManagement() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)
  
  // Edit form state
  const [editName, setEditName] = useState('')
  const [editWorkflow, setEditWorkflow] = useState('admin_first')
  const [editOvernightVerificationMode, setEditOvernightVerificationMode] = useState<'two_photo_verification' | 'one_photo_per_day_inference'>('two_photo_verification')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editIsActive, setEditIsActive] = useState(true)
  const [editOrgType, setEditOrgType] = useState<'owner' | 'service_provider' | 'client'>('client')
  const [editParentOrgId, setEditParentOrgId] = useState<string | null>(null)

  // Create form state
  const [createName, setCreateName] = useState('')
  const [createWorkflow, setCreateWorkflow] = useState('admin_first')
  const [createOvernightVerificationMode, setCreateOvernightVerificationMode] = useState<'two_photo_verification' | 'one_photo_per_day_inference'>('two_photo_verification')
  const [createEmail, setCreateEmail] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [createOrgType, setCreateOrgType] = useState<'owner' | 'service_provider' | 'client'>('client')
  const [createParentOrgId, setCreateParentOrgId] = useState<string | null>(null)

  // Check user role
  const isMaster = user?.role === 'master'

  // Fetch organizations
  const { data: organizations, isLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .order('organization_level', { ascending: true })

      if (error) throw error
      return data as Organization[]
    },
  })

  // Fetch organization stats
  const { data: orgStats } = useQuery({
    queryKey: ['organization-stats'],
    queryFn: async () => {
      const stats = await Promise.all(
        (organizations || []).map(async (org) => {
          const [userCount, zoneCount] = await Promise.all([
            supabase.from('user_profiles').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
            supabase.from('zones').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
          ])

          return {
            orgId: org.id,
            users: userCount.count || 0,
            zones: zoneCount.count || 0,
          }
        })
      )

      return stats.reduce((acc, stat) => {
        acc[stat.orgId] = { users: stat.users, zones: stat.zones }
        return acc
      }, {} as Record<string, { users: number; zones: number }>)
    },
    enabled: !!organizations,
  })

  // Update organization mutation
  const updateOrgMutation = useMutation({
    mutationFn: async (updates: Partial<Organization>) => {
      if (!selectedOrg) throw new Error('No organization selected')
      
      const { error } = await (supabase.from('organizations') as any)
        .update(updates)
        .eq('id', selectedOrg.id)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Organization updated successfully')
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      setShowSettingsDialog(false)
      setSelectedOrg(null)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update organization')
    },
  })

  // Create organization mutation
  const createOrgMutation = useMutation({
    mutationFn: async () => {
      if (!createName.trim()) throw new Error('Organization name is required')

      // Derive level from type
      const levelMap: Record<string, number> = { owner: 1, service_provider: 2, client: 3 }
      const level = levelMap[createOrgType] || 3

      const { error } = await (supabase
        .from('organizations') as any)
        .insert({
          name: createName.trim(),
          organization_type: createOrgType,
          organization_level: level,
          parent_organization_id: createParentOrgId,
          enforcement_workflow: createWorkflow,
          overnight_verification_mode: createOvernightVerificationMode,
          contact_email: createEmail || null,
          contact_phone: createPhone || null,
          is_active: true,
        })

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Organization created successfully')
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      setShowCreateDialog(false)
      resetCreateForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create organization')
    },
  })

  const resetForm = () => {
    setEditName('')
    setEditWorkflow('admin_first')
    setEditOvernightVerificationMode('two_photo_verification')
    setEditEmail('')
    setEditPhone('')
    setEditIsActive(true)
    setEditOrgType('client')
    setEditParentOrgId(null)
  }

  const resetCreateForm = () => {
    setCreateName('')
    setCreateWorkflow('admin_first')
    setCreateOvernightVerificationMode('two_photo_verification')
    setCreateEmail('')
    setCreatePhone('')
    setCreateOrgType('client')
    setCreateParentOrgId(null)
  }

  const openSettingsDialog = (org: Organization) => {
    setSelectedOrg(org)
    setEditName(org.name)
    setEditWorkflow(org.enforcement_workflow)
    setEditOvernightVerificationMode(org.overnight_verification_mode || 'two_photo_verification')
    setEditEmail(org.contact_email || '')
    setEditPhone(org.contact_phone || '')
    setEditIsActive(org.is_active)
    setEditOrgType(org.organization_type as any)
    setEditParentOrgId(org.parent_organization_id)
    setShowSettingsDialog(true)
  }

  if (!isMaster) {
    return (
      <AppLayout title="Organization Management" description="Manage organizational hierarchy and settings" showBackButton>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access this page. Master role required.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Organization Management" description="Manage organizational hierarchy and settings" showBackButton>
      <GlobalFilterRibbon showDateFilter={false} />

      <div className="flex justify-end mb-6">
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Organization
        </Button>
      </div>

      {/* Organizations List */}
      <div className="space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8 text-gray-600">Loading organizations...</div>
            </CardContent>
          </Card>
        ) : organizations && organizations.length > 0 ? (
          organizations.map((org) => {
            const stats = orgStats?.[org.id] || { users: 0, zones: 0 }
            const isChild = org.organization_level > 1

            return (
              <Card key={org.id} className={isChild ? 'ml-8 border-l-4 border-l-blue-200' : ''}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-gray-600" />
                        <CardTitle>{org.name}</CardTitle>
                        <Badge variant={org.is_active ? 'default' : 'secondary'}>
                          {org.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        <Badge variant="outline">
                          {org.organization_type}
                        </Badge>
                      </div>
                      <CardDescription className="mt-2">
                        Level {org.organization_level} ({getOrgTypeLabel(org.organization_type)})
                        {org.parent_organization_id && ' — Child organization'}
                      </CardDescription>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => openSettingsDialog(org)}
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Settings
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Users */}
                    <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <Users className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-blue-600">{stats.users}</div>
                        <div className="text-sm text-gray-600">Users</div>
                      </div>
                    </div>

                    {/* Zones */}
                    <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                      <div className="p-2 bg-green-100 rounded-lg">
                        <MapPin className="h-5 w-5 text-green-600" />
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-green-600">{stats.zones}</div>
                        <div className="text-sm text-gray-600">Zones</div>
                      </div>
                    </div>

                    {/* Workflow */}
                    <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <Settings className="h-5 w-5 text-purple-600" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-purple-600">
                          {org.enforcement_workflow?.replace('_', ' ').toUpperCase()}
                        </div>
                        <div className="text-xs text-gray-600">Workflow</div>
                      </div>
                    </div>

                    {/* Overnight Verification */}
                    <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
                      <div className="p-2 bg-amber-100 rounded-lg">
                        <Settings className="h-5 w-5 text-amber-600" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-amber-700">
                          {getOvernightVerificationModeLabel(org.overnight_verification_mode || 'two_photo_verification')}
                        </div>
                        <div className="text-xs text-gray-600">Stay Verification</div>
                      </div>
                    </div>
                  </div>

                  {/* Contact Info */}
                  {(org.contact_email || org.contact_phone) && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="text-sm text-gray-600">
                        {org.contact_email && (
                          <div>Email: {org.contact_email}</div>
                        )}
                        {org.contact_phone && (
                          <div>Phone: {org.contact_phone}</div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-8 text-gray-600">
                No organizations found
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Settings Dialog */}
      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Organization Settings</DialogTitle>
            <DialogDescription>
              Update organization details, type, and workflow
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="editName">Organization Name</Label>
              <Input
                id="editName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="editOrgType">Organization Type</Label>
              <Select value={editOrgType} onValueChange={(v: any) => setEditOrgType(v)}>
                <SelectTrigger id="editOrgType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner (Level 1 – Iron Eagle / Platform Owner)</SelectItem>
                  <SelectItem value="service_provider">Service Provider (Level 2 – Security Company)</SelectItem>
                  <SelectItem value="client">Client (Level 3 – Council / Territory)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="editParentOrg">Parent Organization</Label>
              <Select
                value={editParentOrgId || 'none'}
                onValueChange={(v) => setEditParentOrgId(v === 'none' ? null : v)}
              >
                <SelectTrigger id="editParentOrg">
                  <SelectValue placeholder="None (top-level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (top-level)</SelectItem>
                  {organizations?.filter((o) => o.id !== selectedOrg?.id).map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name} ({getOrgTypeLabel(org.organization_type)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="editWorkflow">Enforcement Workflow</Label>
              <Select value={editWorkflow} onValueChange={setEditWorkflow}>
                <SelectTrigger id="editWorkflow">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin_first">Admin First (default)</SelectItem>
                  <SelectItem value="officer_direct">Officer Direct</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="editOvernightMode">Overnight Stay Verification</Label>
              <Select
                value={editOvernightVerificationMode}
                onValueChange={(v: 'two_photo_verification' | 'one_photo_per_day_inference') => setEditOvernightVerificationMode(v)}
              >
                <SelectTrigger id="editOvernightMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="two_photo_verification">2-photo verification (day 1 + day 2)</SelectItem>
                  <SelectItem value="one_photo_per_day_inference">1-photo/day verification (inference + GPS)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="editEmail">Contact Email</Label>
              <Input
                id="editEmail"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="contact@example.com"
              />
            </div>
            
            <div>
              <Label htmlFor="editPhone">Contact Phone</Label>
              <Input
                id="editPhone"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="+64 21 123 4567"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <Label htmlFor="editIsActive">Active Status</Label>
              <Switch
                id="editIsActive"
                checked={editIsActive}
                onCheckedChange={setEditIsActive}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettingsDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                const levelMap: Record<string, number> = { owner: 1, service_provider: 2, client: 3 }
                updateOrgMutation.mutate({
                  name: editName,
                  organization_type: editOrgType,
                  organization_level: levelMap[editOrgType] || 3,
                  parent_organization_id: editParentOrgId,
                  enforcement_workflow: editWorkflow,
                  overnight_verification_mode: editOvernightVerificationMode,
                  contact_email: editEmail || null,
                  contact_phone: editPhone || null,
                  is_active: editIsActive,
                })
              }}
              disabled={updateOrgMutation.isPending || !editName.trim()}
            >
              {updateOrgMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Organization Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Organization</DialogTitle>
            <DialogDescription>
              Create a new organization in the hierarchy
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="createName">Organization Name *</Label>
              <Input
                id="createName"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g., Tauranga City Council"
              />
            </div>

            <div>
              <Label htmlFor="createOrgType">Organization Type</Label>
              <Select value={createOrgType} onValueChange={(v: any) => setCreateOrgType(v)}>
                <SelectTrigger id="createOrgType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner (Level 1)</SelectItem>
                  <SelectItem value="service_provider">Service Provider (Level 2)</SelectItem>
                  <SelectItem value="client">Client (Level 3)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="createParentOrg">Parent Organization</Label>
              <Select
                value={createParentOrgId || 'none'}
                onValueChange={(v) => setCreateParentOrgId(v === 'none' ? null : v)}
              >
                <SelectTrigger id="createParentOrg">
                  <SelectValue placeholder="None (top-level)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (top-level)</SelectItem>
                  {organizations?.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name} ({getOrgTypeLabel(org.organization_type)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="createWorkflow">Enforcement Workflow</Label>
              <Select value={createWorkflow} onValueChange={setCreateWorkflow}>
                <SelectTrigger id="createWorkflow">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin_first">Admin First (default)</SelectItem>
                  <SelectItem value="officer_direct">Officer Direct</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="createOvernightMode">Overnight Stay Verification</Label>
              <Select
                value={createOvernightVerificationMode}
                onValueChange={(v: 'two_photo_verification' | 'one_photo_per_day_inference') => setCreateOvernightVerificationMode(v)}
              >
                <SelectTrigger id="createOvernightMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="two_photo_verification">2-photo verification (day 1 + day 2)</SelectItem>
                  <SelectItem value="one_photo_per_day_inference">1-photo/day verification (inference + GPS)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="createEmail">Contact Email</Label>
              <Input
                id="createEmail"
                type="email"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="contact@example.com"
              />
            </div>

            <div>
              <Label htmlFor="createPhone">Contact Phone</Label>
              <Input
                id="createPhone"
                value={createPhone}
                onChange={(e) => setCreatePhone(e.target.value)}
                placeholder="+64 21 123 4567"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); resetCreateForm() }}>
              Cancel
            </Button>
            <Button
              onClick={() => createOrgMutation.mutate()}
              disabled={createOrgMutation.isPending || !createName.trim()}
            >
              {createOrgMutation.isPending ? 'Creating...' : 'Create Organization'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
