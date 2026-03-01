import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Building2, Users, MapPin, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
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
}

export default function OrganizationManagement() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)
  
  // Edit form state
  const [editName, setEditName] = useState('')
  const [editWorkflow, setEditWorkflow] = useState('admin_first')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')

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
      
      const { error } = await supabase
        .from('organizations')
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

  const resetForm = () => {
    setEditName('')
    setEditWorkflow('admin_first')
    setEditEmail('')
    setEditPhone('')
  }

  const openSettingsDialog = (org: Organization) => {
    setSelectedOrg(org)
    setEditName(org.name)
    setEditWorkflow(org.enforcement_workflow)
    setEditEmail(org.contact_email || '')
    setEditPhone(org.contact_phone || '')
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
        <Button disabled>
          <Building2 className="h-4 w-4 mr-2" />
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organization Settings</DialogTitle>
            <DialogDescription>
              Update organization details and workflow
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
              <Label htmlFor="editWorkflow">Enforcement Workflow</Label>
              <Select value={editWorkflow} onValueChange={setEditWorkflow}>
                <SelectTrigger>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettingsDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateOrgMutation.mutate({
                name: editName,
                enforcement_workflow: editWorkflow,
                contact_email: editEmail || null,
                contact_phone: editPhone || null
              })}
              disabled={updateOrgMutation.isPending}
            >
              {updateOrgMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
