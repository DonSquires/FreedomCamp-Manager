import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
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
import { Building2, Users, MapPin, Settings, Plus, Search, FileText, ChevronRight, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'
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
  const navigate = useNavigate()
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)
  const [orgSearch, setOrgSearch] = useState('')
  const [orgTypeFilter, setOrgTypeFilter] = useState('all')
  const [createSuccessNotice, setCreateSuccessNotice] = useState('')
  
  // Edit form state
  const [editName, setEditName] = useState('')
  const [editWorkflow, setEditWorkflow] = useState('admin_first')
  const [editOvernightVerificationMode, setEditOvernightVerificationMode] = useState<'two_photo_verification' | 'one_photo_per_day_inference'>('two_photo_verification')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editIsActive, setEditIsActive] = useState(true)
  const [editOrgType, setEditOrgType] = useState<'owner' | 'service_provider' | 'client' | 'contractor'>('client')
  const [editParentOrgId, setEditParentOrgId] = useState<string | null>(null)

  // Create form state
  const [createName, setCreateName] = useState('')
  const [createWorkflow, setCreateWorkflow] = useState('admin_first')
  const [createOvernightVerificationMode, setCreateOvernightVerificationMode] = useState<'two_photo_verification' | 'one_photo_per_day_inference'>('two_photo_verification')
  const [createEmail, setCreateEmail] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [createOrgType, setCreateOrgType] = useState<'owner' | 'service_provider' | 'client' | 'contractor'>('client')
  const [createParentOrgId, setCreateParentOrgId] = useState<string | null>(null)

  // Check user role
  const isMaster = user?.role === 'master' || user?.role === 'grand_master'

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
      if (!selectedOrg) throw new Error('No organisation selected')
      
      const { error } = await (supabase.from('organizations') as any)
        .update(updates)
        .eq('id', selectedOrg.id)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Organisation updated successfully')
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      setShowSettingsDialog(false)
      setSelectedOrg(null)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update organisation')
    },
  })

  // Create organization mutation
  const createOrgMutation = useMutation({
    mutationFn: async () => {
      if (!createName.trim()) throw new Error('Organisation name is required')

      // Derive level from type
      const levelMap: Record<string, number> = { owner: 1, service_provider: 2, client: 3, contractor: 4 }
      const level = levelMap[createOrgType] || 3
      const parentOrgId =
        createOrgType === 'owner'
          ? null
          : (createParentOrgId || user?.organization_id || null)

      const { error } = await (supabase
        .from('organizations') as any)
        .insert({
          name: createName.trim(),
          organization_type: createOrgType,
          organization_level: level,
          parent_organization_id: parentOrgId,
          enforcement_workflow: createWorkflow,
          overnight_verification_mode: createOvernightVerificationMode,
          contact_email: createEmail || null,
          contact_phone: createPhone || null,
          is_active: true,
        })

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Organisation created successfully')
      setCreateSuccessNotice('Organisation created successfully')
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      setShowCreateDialog(false)
      resetCreateForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create organisation')
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
      <AppLayout title="Organisation Management" description="Manage organisational hierarchy and settings" showBackButton>
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
    <AppLayout title="Organisation Management" description="Manage organisational hierarchy and settings" showBackButton>
      <GlobalFilterRibbon showDateFilter={false} />

      <Card className="mb-4 mt-2 border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 dark:border-blue-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            Governance Quick Actions
          </CardTitle>
          <CardDescription>
            Master tools for organisation setup, user access, permission overrides, and audit traceability.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: 'User Management',
                description: 'Manage cross-org users and role assignments',
                icon: Users,
                path: '/users',
              },
              {
                label: 'Access Control',
                description: 'Control portal areas and organisation scope',
                icon: ShieldCheck,
                path: '/access-control',
              },
              {
                label: 'Site Permissions',
                description: 'Review field-group role permissions and overrides',
                icon: Settings,
                path: '/site-permissions',
              },
              {
                label: 'Audit Log',
                description: 'Trace governance and Bob-assisted actions',
                icon: FileText,
                path: '/audit-log',
              },
            ].map(({ label, description, icon: Icon, path }) => (
              <button
                key={label}
                type="button"
                onClick={() => navigate(path)}
                className="text-left rounded-lg border bg-white dark:bg-[#1A1A1A] px-3 py-3 transition-colors hover:bg-blue-100/60 dark:hover:bg-blue-900/20"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                  <Icon className="h-4 w-4 text-blue-600" />
                  {label}
                </div>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{description}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 mb-4 mt-2">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search organisations…"
            value={orgSearch}
            onChange={(e) => setOrgSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Type filter */}
        <Select value={orgTypeFilter} onValueChange={setOrgTypeFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
            <SelectItem value="service_provider">Service Provider</SelectItem>
            <SelectItem value="client">Client</SelectItem>
            <SelectItem value="contractor">Contractor</SelectItem>
          </SelectContent>
        </Select>

        <div className="sm:ml-auto">
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Organisation
          </Button>
        </div>
      </div>

      {createSuccessNotice && (
        <Card className="mb-4 border-green-200 bg-green-50/70 dark:bg-green-950/20 dark:border-green-900">
          <CardContent className="py-3 text-sm text-green-800 dark:text-green-300">
            {createSuccessNotice}
          </CardContent>
        </Card>
      )}

      {/* Organizations List */}
      <div className="space-y-4">
        {isLoading ? (
          <PaperworkSearchAnimation size="sm" text="Loading organisations…" />
        ) : organizations && organizations.length > 0 ? (
          organizations
            .filter((org) => {
              const matchesSearch = !orgSearch ||
                org.name.toLowerCase().includes(orgSearch.toLowerCase())
              const matchesType = orgTypeFilter === 'all' ||
                org.organization_type === orgTypeFilter
              return matchesSearch && matchesType
            })
            .map((org) => {
            const stats = orgStats?.[org.id] || { users: 0, zones: 0 }
            const isChild = org.organization_level > 1

            return (
              <Card
                key={org.id}
                className={
                  org.organization_type === 'contractor'
                    ? 'ml-8 border-l-4 border-l-amber-400'
                    : isChild
                    ? 'ml-8 border-l-4 border-l-blue-200'
                    : ''
                }
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-gray-600" />
                        <CardTitle>{org.name}</CardTitle>
                        <Badge variant={org.is_active ? 'default' : 'secondary'}>
                          {org.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            org.organization_type === 'contractor'
                              ? 'border-amber-400 text-amber-700 bg-amber-50'
                              : ''
                          }
                        >
                          {getOrgTypeLabel(org.organization_type)}
                        </Badge>
                      </div>
                      <CardDescription className="mt-2">
                        Level {org.organization_level} ({getOrgTypeLabel(org.organization_type)})
                        {org.parent_organization_id && ' — Child organisation'}
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

                  {/* Quick Actions — Drill down into org resources */}
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-xs text-muted-foreground font-medium mb-2">Manage Resources</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => navigate(`/users?organization_id=${org.id}`)}
                      >
                        <Users className="h-3.5 w-3.5" />
                        Users
                        <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                          {stats.users}
                        </Badge>
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => navigate(`/zones?organization_id=${org.id}`)}
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        Zones
                        <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                          {stats.zones}
                        </Badge>
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => {
                          if (org.organization_type === 'contractor') {
                            navigate(`/crm/contractor/${org.id}`)
                          } else if (org.organization_type === 'client') {
                            navigate(`/crm/client/${org.id}`)
                          } else {
                            navigate(`/tender-workspace`)
                          }
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Documents
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Client List for Service Providers */}
                    {org.organization_type === 'service_provider' && (
                      <div className="mt-3">
                        <p className="text-xs text-muted-foreground font-medium mb-2">Client Organisations</p>
                        <div className="space-y-1">
                          {organizations?.filter(client =>
                            client.parent_organization_id === org.id &&
                            (client.organization_type === 'client' || client.organization_type === 'contractor')
                          ).map(client => (
                            <div
                              key={client.id}
                              className="flex items-center justify-between p-2 bg-gray-50 dark:bg-[#1E1E1E] rounded-md hover:bg-gray-100 dark:hover:bg-[#2A2A2A] cursor-pointer"
                              onClick={() => navigate(`/crm?account=${client.id}`)}
                            >
                              <div className="flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-gray-500" />
                                <span className="text-sm font-medium">{client.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {getOrgTypeLabel(client.organization_type)}
                                </Badge>
                              </div>
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            </div>
                          ))}
                          {organizations?.filter(client =>
                            client.parent_organization_id === org.id
                          ).length === 0 && (
                            <p className="text-sm text-muted-foreground italic">No client organisations</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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
            <DialogTitle>Organisation Settings</DialogTitle>
            <DialogDescription>
              Update organisation details, type, and workflow
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="editName">Organisation Name</Label>
              <Input
                id="editName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="editOrgType">Organisation Type</Label>
              <Select value={editOrgType} onValueChange={(v: any) => setEditOrgType(v)}>
                <SelectTrigger id="editOrgType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner (Level 1 – Iron Eagle Security Limited / Platform Owner)</SelectItem>
                  <SelectItem value="service_provider">Service Provider (Level 2 – Security Company / Branch)</SelectItem>
                  <SelectItem value="client">Client (Level 3 – Council / Territory / Business)</SelectItem>
                  <SelectItem value="contractor">Contractor (Level 4 – Sub-contracted Security Company)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="editParentOrg">Parent Organisation</Label>
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
                const levelMap: Record<string, number> = { owner: 1, service_provider: 2, client: 3, contractor: 4 }
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
            <DialogTitle>New Organisation</DialogTitle>
            <DialogDescription>
              Create a new organisation in the hierarchy
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="createName">Organisation Name *</Label>
              <Input
                id="createName"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g., Tauranga City Council"
              />
            </div>

            <div>
              <Label htmlFor="createOrgType">Organisation Type</Label>
              <Select value={createOrgType} onValueChange={(v: any) => setCreateOrgType(v)}>
                <SelectTrigger id="createOrgType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner (Level 1)</SelectItem>
                  <SelectItem value="service_provider">Service Provider (Level 2)</SelectItem>
                  <SelectItem value="client">Client (Level 3)</SelectItem>
                  <SelectItem value="contractor">Contractor (Level 4)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="createParentOrg">Parent Organisation</Label>
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
              {createOrgMutation.isPending ? 'Creating...' : 'Create Organisation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
