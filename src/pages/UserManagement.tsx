import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { PaperworkSearchAnimation } from '@/components/features/PaperworkSearchAnimation'
import { 
  UserPlus, 
  Search, 
  Edit, 
  Mail, 
  Shield, 
  CheckCircle, 
  XCircle, 
  Upload,
  FileText,
  Calendar,
  AlertCircle,
  Award,
  Clock,
  Building2
} from 'lucide-react'
import { formatDateTime, formatDate } from '@/lib/utils'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'
import { uploadFile } from '@/lib/fileUpload'

interface Organization {
  id: string
  name: string
  parent_organization_id: string | null
}

interface UserProfile {
  id: string
  first_name: string
  last_name: string
  email: string
  role: string
  organization_id: string | null
  employer_organization_id: string | null
  is_active: boolean
  created_at: string
  phone: string | null
  // Compliance credentials
  coa_number: string | null
  coa_expiry: string | null
  coa_document_url: string | null
  warrant_number: string | null
  warrant_expiry: string | null
  warrant_document_url: string | null
  credentials_verified: boolean
  credentials_verified_at: string | null
  credentials_verified_by: string | null
  // Joined data
  organization?: Organization | null
}

export default function UserManagement() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showCredentialsDialog, setShowCredentialsDialog] = useState(false)
  const [showRoleDialog, setShowRoleDialog] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null)
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterCredentials, setFilterCredentials] = useState<string>('all')
  const [filterOrg, setFilterOrg] = useState<string>('all')
  
  // Form state
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState('officer')
  const [phone, setPhone] = useState('')
  const [organizationId, setOrganizationId] = useState<string>('')
  const [employerOrgId, setEmployerOrgId] = useState<string>('')
  
  // Credentials form state
  const [coaNumber, setCoaNumber] = useState('')
  const [coaExpiry, setCoaExpiry] = useState('')
  const [warrantNumber, setWarrantNumber] = useState('')
  const [warrantExpiry, setWarrantExpiry] = useState('')
  const [uploadingCOA, setUploadingCOA] = useState(false)
  const [uploadingWarrant, setUploadingWarrant] = useState(false)

  // Check user role
  const isAdmin = user?.role === 'admin' || user?.role === 'master'
  const isMaster = user?.role === 'master'

  // Fetch all active organizations for dropdowns
  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, parent_organization_id')
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (error) throw error
      return data as Organization[]
    },
  })

  // For non-master users, fetch accessible org IDs (own org + descendants)
  const { data: accessibleOrgIds } = useQuery({
    queryKey: ['user-org-ids'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_user_organization_ids')
      if (error) throw error
      return data as string[]
    },
    enabled: !isMaster,
  })

  // Organizations available for assignment, scoped by role
  const availableOrgs = isMaster
    ? (organizations || [])
    : (organizations || []).filter((o) => accessibleOrgIds?.includes(o.id))

  // Fetch users
  const { data: users, isLoading } = useQuery({
    queryKey: ['users', searchTerm, filterRole, filterCredentials, filterOrg],
    queryFn: async () => {
      let query = (supabase
        .from('user_profiles') as any)
        .select(`
          *,
          organization:organizations!organization_id(id, name)
        `)
        .order('created_at', { ascending: false })

      if (searchTerm) {
        query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      }

      if (filterRole !== 'all') {
        query = query.eq('role', filterRole)
      }

      if (filterOrg !== 'all') {
        query = query.eq('organization_id', filterOrg)
      }

      const { data, error } = await query
      if (error) throw error
      
      let filteredUsers = data as UserProfile[]

      // Filter by credentials status
      if (filterCredentials === 'verified') {
        filteredUsers = filteredUsers.filter(u => u.credentials_verified)
      } else if (filterCredentials === 'expired') {
        const today = new Date().toISOString().split('T')[0]
        filteredUsers = filteredUsers.filter(u => 
          (u.coa_expiry && u.coa_expiry < today) || 
          (u.warrant_expiry && u.warrant_expiry < today)
        )
      } else if (filterCredentials === 'missing') {
        filteredUsers = filteredUsers.filter(u => !u.coa_number && !u.warrant_number)
      }

      return filteredUsers
    },
  })

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: { 
          email, 
          role,
          first_name: firstName,
          last_name: lastName,
          phone,
          organization_id: organizationId || null,
          employer_organization_id: employerOrgId || null,
        }
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success('User invitation sent')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowCreateDialog(false)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create user')
    },
  })

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: async (updates: Partial<UserProfile>) => {
      if (!selectedUser) throw new Error('No user selected')
      
      const { error } = await (supabase.from('user_profiles') as any)
        .update(updates)
        .eq('id', selectedUser.id)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('User updated successfully')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowEditDialog(false)
      setSelectedUser(null)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update user')
    },
  })

  // Toggle user active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const { error } = await (supabase.from('user_profiles') as any)
        .update({ is_active: !isActive })
        .eq('id', userId)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('User status updated')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update user')
    },
  })

  const resetForm = () => {
    setEmail('')
    setFirstName('')
    setLastName('')
    setRole('officer')
    setPhone('')
    setCoaNumber('')
    setCoaExpiry('')
    setWarrantNumber('')
    setWarrantExpiry('')
    setOrganizationId('')
    setEmployerOrgId('')
  }

  const openEditDialog = (userProfile: UserProfile) => {
    setSelectedUser(userProfile)
    setFirstName(userProfile.first_name)
    setLastName(userProfile.last_name)
    setEmail(userProfile.email)
    setRole(userProfile.role)
    setPhone(userProfile.phone || '')
    setOrganizationId(userProfile.organization_id || '')
    setEmployerOrgId(userProfile.employer_organization_id || '')
    setShowEditDialog(true)
  }

  const openCredentialsDialog = (userProfile: UserProfile) => {
    setSelectedUser(userProfile)
    setCoaNumber(userProfile.coa_number || '')
    setCoaExpiry(userProfile.coa_expiry || '')
    setWarrantNumber(userProfile.warrant_number || '')
    setWarrantExpiry(userProfile.warrant_expiry || '')
    setShowCredentialsDialog(true)
  }

  const openRoleDialog = (userProfile: UserProfile) => {
    setSelectedUser(userProfile)
    setRole(userProfile.role)
    setShowRoleDialog(true)
  }

  // Upload COA document
  const handleCOAUpload = async (file: File) => {
    if (!selectedUser) return
    
    try {
      setUploadingCOA(true)
      const path = `credentials/${selectedUser.id}/coa_${Date.now()}.pdf`
      const result = await uploadFile({
        bucket: 'evidence',
        path,
        file
      })

      if (result.error) throw new Error(result.error)

      const { error } = await (supabase.from('user_profiles') as any)
        .update({ coa_document_url: result.url })
        .eq('id', selectedUser.id)

      if (error) throw error

      toast.success('COA document uploaded')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload COA')
    } finally {
      setUploadingCOA(false)
    }
  }

  // Upload Warrant document
  const handleWarrantUpload = async (file: File) => {
    if (!selectedUser) return
    
    try {
      setUploadingWarrant(true)
      const path = `credentials/${selectedUser.id}/warrant_${Date.now()}.pdf`
      const result = await uploadFile({
        bucket: 'evidence',
        path,
        file
      })

      if (result.error) throw new Error(result.error)

      const { error } = await (supabase.from('user_profiles') as any)
        .update({ warrant_document_url: result.url })
        .eq('id', selectedUser.id)

      if (error) throw error

      toast.success('Warrant document uploaded')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload warrant')
    } finally {
      setUploadingWarrant(false)
    }
  }

  // Update credentials mutation
  const updateCredentialsMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error('No user selected')
      
      const { error } = await (supabase.from('user_profiles') as any)
        .update({
          coa_number: coaNumber || null,
          coa_expiry: coaExpiry || null,
          warrant_number: warrantNumber || null,
          warrant_expiry: warrantExpiry || null,
        })
        .eq('id', selectedUser.id)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Credentials updated')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowCredentialsDialog(false)
      resetForm()
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update credentials')
    },
  })

  // Verify credentials mutation
  const verifyCredentialsMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await (supabase.from('user_profiles') as any)
        .update({
          credentials_verified: true,
          credentials_verified_at: new Date().toISOString(),
          credentials_verified_by: user?.id,
        })
        .eq('id', userId)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Credentials verified')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to verify credentials')
    },
  })

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser) throw new Error('No user selected')
      
      const { error } = await (supabase.from('user_profiles') as any)
        .update({ role })
        .eq('id', selectedUser.id)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Role updated successfully')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowRoleDialog(false)
      setSelectedUser(null)
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update role')
    },
  })

  // Check if credentials are expired
  const isCredentialExpired = (expiryDate: string | null) => {
    if (!expiryDate) return false
    const today = new Date().toISOString().split('T')[0]
    return expiryDate < today
  }

  // Check if credentials expire soon (within 30 days)
  const isCredentialExpiringSoon = (expiryDate: string | null) => {
    if (!expiryDate) return false
    const today = new Date()
    const expiry = new Date(expiryDate)
    const daysUntilExpiry = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilExpiry <= 30 && daysUntilExpiry > 0
  }

  // Get credentials status badge
  const getCredentialsBadge = (userProfile: UserProfile) => {
    const hasCredentials = userProfile.coa_number || userProfile.warrant_number
    const coaExpired = isCredentialExpired(userProfile.coa_expiry)
    const warrantExpired = isCredentialExpired(userProfile.warrant_expiry)
    const coaExpiring = isCredentialExpiringSoon(userProfile.coa_expiry)
    const warrantExpiring = isCredentialExpiringSoon(userProfile.warrant_expiry)

    if (!hasCredentials) {
      return <Badge variant="outline" className="text-gray-500"><XCircle className="h-3 w-3 mr-1" />No Credentials</Badge>
    }
    if (coaExpired || warrantExpired) {
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300"><AlertCircle className="h-3 w-3 mr-1" />Expired</Badge>
    }
    if (coaExpiring || warrantExpiring) {
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300"><Clock className="h-3 w-3 mr-1" />Expiring Soon</Badge>
    }
    if (userProfile.credentials_verified) {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300"><Award className="h-3 w-3 mr-1" />Verified</Badge>
    }
    return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300"><FileText className="h-3 w-3 mr-1" />Pending Review</Badge>
  }

  // Calculate stats
  const stats = users ? {
    total: users.length,
    active: users.filter(u => u.is_active).length,
    verified: users.filter(u => u.credentials_verified).length,
    expired: users.filter(u => 
      isCredentialExpired(u.coa_expiry) || isCredentialExpired(u.warrant_expiry)
    ).length,
    expiringSoon: users.filter(u => 
      isCredentialExpiringSoon(u.coa_expiry) || isCredentialExpiringSoon(u.warrant_expiry)
    ).length,
  } : null

  if (!isAdmin) {
    return (
      <AppLayout title="User Management" description="Manage user accounts and permissions" showBackButton>
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access this page. Admin access required.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="User Management" description="Manage user accounts and permissions" showBackButton>
      <GlobalFilterRibbon showDateFilter={false} />

      {/* Stats Grid */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-5 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-600">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600 flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Active
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{stats.active}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600 flex items-center gap-2">
                <Award className="h-4 w-4" />
                Verified
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{stats.verified}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-600 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Expired
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">{stats.expired}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-600 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Expiring Soon
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-600">{stats.expiringSoon}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex justify-end mb-6">
        <Button onClick={() => setShowCreateDialog(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite User
        </Button>
      </div>

      {/* Search and Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Select value={filterRole || 'all'} onValueChange={setFilterRole}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="officer">Officers</SelectItem>
                  <SelectItem value="admin_officer">Admin Officers</SelectItem>
                  <SelectItem value="admin">Admins</SelectItem>
                  <SelectItem value="master">Masters</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterCredentials || 'all'} onValueChange={setFilterCredentials}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Filter credentials" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Credentials</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="missing">Missing</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterOrg || 'all'} onValueChange={setFilterOrg}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Filter by organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Organisations</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {users?.length || 0} total users
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <PaperworkSearchAnimation size="sm" text="Loading users…" />
          ) : users && users.length > 0 ? (
            <div className="space-y-3">
              {users.map((userProfile) => (
                <div
                  key={userProfile.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="font-medium">
                        {userProfile.first_name} {userProfile.last_name}
                      </div>
                      <Badge variant={userProfile.is_active ? 'default' : 'secondary'}>
                        {userProfile.is_active ? (
                          <><CheckCircle className="h-3 w-3 mr-1" />Active</>
                        ) : (
                          <><XCircle className="h-3 w-3 mr-1" />Inactive</>
                        )}
                      </Badge>
                      <Badge variant="outline">
                        <Shield className="h-3 w-3 mr-1" />
                        {userProfile.role}
                      </Badge>
                      {getCredentialsBadge(userProfile)}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      <Mail className="h-3 w-3 inline mr-1" />
                      {userProfile.email}
                    </div>
                    {userProfile.organization && (
                      <div className="text-sm text-gray-500 mt-1">
                        <Building2 className="h-3 w-3 inline mr-1" />
                        {userProfile.organization.name}
                      </div>
                    )}
                    
                    {/* Credentials Info */}
                    {(userProfile.coa_number || userProfile.warrant_number) && (
                      <div className="mt-2 space-y-1">
                        {userProfile.coa_number && (
                          <div className="text-xs flex items-center gap-2">
                            <FileText className="h-3 w-3 text-blue-600" />
                            <span className="font-medium">COA:</span>
                            <span className="font-mono">{userProfile.coa_number}</span>
                            {userProfile.coa_expiry && (
                              <span className={`flex items-center gap-1 ${
                                isCredentialExpired(userProfile.coa_expiry) ? 'text-red-600' :
                                isCredentialExpiringSoon(userProfile.coa_expiry) ? 'text-yellow-600' :
                                'text-gray-500'
                              }`}>
                                <Calendar className="h-3 w-3" />
                                Expires {formatDate(userProfile.coa_expiry)}
                              </span>
                            )}
                          </div>
                        )}
                        {userProfile.warrant_number && (
                          <div className="text-xs flex items-center gap-2">
                            <Award className="h-3 w-3 text-purple-600" />
                            <span className="font-medium">Warrant:</span>
                            <span className="font-mono">{userProfile.warrant_number}</span>
                            {userProfile.warrant_expiry && (
                              <span className={`flex items-center gap-1 ${
                                isCredentialExpired(userProfile.warrant_expiry) ? 'text-red-600' :
                                isCredentialExpiringSoon(userProfile.warrant_expiry) ? 'text-yellow-600' :
                                'text-gray-500'
                              }`}>
                                <Calendar className="h-3 w-3" />
                                Expires {formatDate(userProfile.warrant_expiry)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="text-xs text-gray-500 mt-2">
                      Created {formatDateTime(userProfile.created_at)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openRoleDialog(userProfile)}
                      >
                        <Shield className="h-4 w-4 mr-1" />
                        Role
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => openEditDialog(userProfile)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openCredentialsDialog(userProfile)}
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        Credentials
                      </Button>
                      {(userProfile.coa_number || userProfile.warrant_number) && !userProfile.credentials_verified && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => verifyCredentialsMutation.mutate(userProfile.id)}
                          disabled={verifyCredentialsMutation.isPending}
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Verify
                        </Button>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleActiveMutation.mutate({
                        userId: userProfile.id,
                        isActive: userProfile.is_active
                      })}
                      disabled={userProfile.id === user?.id}
                      className="text-xs"
                    >
                      {userProfile.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-600">
              No users found
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite New User</DialogTitle>
            <DialogDescription>
              Send an invitation to create a new user account
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="role">Role *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="officer">Officer</SelectItem>
                  <SelectItem value="admin_officer">Admin Officer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  {user?.role === 'master' && (
                    <SelectItem value="master">Master</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+64 21 123 4567"
              />
            </div>
            <div>
              <Label htmlFor="createOrg">Organisation</Label>
              <Select value={organizationId || 'none'} onValueChange={(v) => setOrganizationId(v === 'none' ? '' : v)}>
                <SelectTrigger id="createOrg">
                  <SelectValue placeholder="Select organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Organisation</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="createEmployerOrg">Employer Organisation</Label>
              <Select value={employerOrgId || 'none'} onValueChange={(v) => setEmployerOrgId(v === 'none' ? '' : v)}>
                <SelectTrigger id="createEmployerOrg">
                  <SelectValue placeholder="Select employer organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Employer Organisation</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => createUserMutation.mutate()}
              disabled={!email || !firstName || !lastName || createUserMutation.isPending}
            >
              {createUserMutation.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role Assignment Dialog */}
      <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Role</DialogTitle>
            <DialogDescription>
              Change user role and permissions for {selectedUser?.first_name} {selectedUser?.last_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="assignRole">Select Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="officer">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">Officer</span>
                      <span className="text-xs text-gray-500">Field operations only</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin_officer">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">Admin Officer</span>
                      <span className="text-xs text-gray-500">Dual role - field + admin access</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">Admin</span>
                      <span className="text-xs text-gray-500">Full organisational management</span>
                    </div>
                  </SelectItem>
                  {user?.role === 'master' && (
                    <SelectItem value="master">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Master</span>
                        <span className="text-xs text-gray-500">Cross-organisation access</span>
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>Note:</strong> Role changes take effect immediately. User may need to log out and log back in to see updated permissions.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRoleDialog(false)
                setSelectedUser(null)
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => updateRoleMutation.mutate()}
              disabled={updateRoleMutation.isPending || !selectedUser}
            >
              {updateRoleMutation.isPending ? 'Updating...' : 'Update Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials Dialog */}
      <Dialog open={showCredentialsDialog} onOpenChange={setShowCredentialsDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Compliance Credentials</DialogTitle>
            <DialogDescription>
              Manage COA and Warrant verification for {selectedUser?.first_name} {selectedUser?.last_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* COA Section */}
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Certificate of Approval (COA)
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="coaNumber">COA Number</Label>
                  <Input
                    id="coaNumber"
                    value={coaNumber}
                    onChange={(e) => setCoaNumber(e.target.value)}
                    placeholder="e.g., COA-2024-001"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="coaExpiry">Expiry Date</Label>
                  <Input
                    id="coaExpiry"
                    type="date"
                    value={coaExpiry}
                    onChange={(e) => setCoaExpiry(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="coaUpload">Upload COA Document (PDF)</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="coaUpload"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleCOAUpload(file)
                    }}
                    disabled={uploadingCOA}
                  />
                  {uploadingCOA && <div className="text-sm text-gray-500">Uploading...</div>}
                </div>
                {selectedUser?.coa_document_url && (
                  <a 
                    href={selectedUser.coa_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline mt-1 flex items-center gap-1"
                  >
                    <FileText className="h-3 w-3" />
                    View current document
                  </a>
                )}
              </div>
            </div>

            {/* Warrant Section */}
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Award className="h-5 w-5 text-purple-600" />
                Warrant of Fitness
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="warrantNumber">Warrant Number</Label>
                  <Input
                    id="warrantNumber"
                    value={warrantNumber}
                    onChange={(e) => setWarrantNumber(e.target.value)}
                    placeholder="e.g., W-2024-001"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="warrantExpiry">Expiry Date</Label>
                  <Input
                    id="warrantExpiry"
                    type="date"
                    value={warrantExpiry}
                    onChange={(e) => setWarrantExpiry(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="warrantUpload">Upload Warrant Document (PDF)</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="warrantUpload"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleWarrantUpload(file)
                    }}
                    disabled={uploadingWarrant}
                  />
                  {uploadingWarrant && <div className="text-sm text-gray-500">Uploading...</div>}
                </div>
                {selectedUser?.warrant_document_url && (
                  <a 
                    href={selectedUser.warrant_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline mt-1 flex items-center gap-1"
                  >
                    <FileText className="h-3 w-3" />
                    View current document
                  </a>
                )}
              </div>
            </div>

            {/* Verification Status */}
            {selectedUser?.credentials_verified && (
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-semibold">Credentials Verified</span>
                </div>
                {selectedUser.credentials_verified_at && (
                  <p className="text-sm text-green-600 dark:text-green-500 mt-1">
                    Verified on {formatDateTime(selectedUser.credentials_verified_at)}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCredentialsDialog(false)
                setSelectedUser(null)
                resetForm()
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => updateCredentialsMutation.mutate()}
              disabled={updateCredentialsMutation.isPending}
            >
              {updateCredentialsMutation.isPending ? 'Saving...' : 'Save Credentials'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information and permissions
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="editFirstName">First Name</Label>
                <Input
                  id="editFirstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="editLastName">Last Name</Label>
                <Input
                  id="editLastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="editRole">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="officer">Officer</SelectItem>
                  <SelectItem value="admin_officer">Admin Officer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  {user?.role === 'master' && (
                    <SelectItem value="master">Master</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="editPhone">Phone</Label>
              <Input
                id="editPhone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="editOrg">Organisation</Label>
              <Select value={organizationId || 'none'} onValueChange={(v) => setOrganizationId(v === 'none' ? '' : v)}>
                <SelectTrigger id="editOrg">
                  <SelectValue placeholder="Select organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Organisation</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="editEmployerOrg">Employer Organisation</Label>
              <Select value={employerOrgId || 'none'} onValueChange={(v) => setEmployerOrgId(v === 'none' ? '' : v)}>
                <SelectTrigger id="editEmployerOrg">
                  <SelectValue placeholder="Select employer organisation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Employer Organisation</SelectItem>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => updateUserMutation.mutate({
                first_name: firstName,
                last_name: lastName,
                role,
                phone: phone || null,
                organization_id: organizationId || null,
                employer_organization_id: employerOrgId || null,
              })}
              disabled={updateUserMutation.isPending}
            >
              {updateUserMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
