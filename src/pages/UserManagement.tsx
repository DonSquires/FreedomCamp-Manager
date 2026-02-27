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
import { UserPlus, Search, Edit, Mail, Shield, CheckCircle, XCircle } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { AppLayout } from '@/components/features/AppLayout'
import { GlobalFilterRibbon } from '@/components/features/GlobalFilterRibbon'

interface UserProfile {
  id: string
  first_name: string
  last_name: string
  email: string
  role: string
  organization_id: string
  is_active: boolean
  created_at: string
  phone: string | null
}

export default function UserManagement() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null)
  
  // Form state
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState('officer')
  const [phone, setPhone] = useState('')

  // Check user role
  const isAdmin = user?.role === 'admin' || user?.role === 'master'

  // Fetch users
  const { data: users, isLoading } = useQuery({
    queryKey: ['users', searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (searchTerm) {
        query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
      }

      const { data, error } = await query
      if (error) throw error
      return data as UserProfile[]
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
          phone
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
      
      const { error } = await supabase
        .from('user_profiles')
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
      const { error } = await supabase
        .from('user_profiles')
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
  }

  const openEditDialog = (userProfile: UserProfile) => {
    setSelectedUser(userProfile)
    setFirstName(userProfile.first_name)
    setLastName(userProfile.last_name)
    setEmail(userProfile.email)
    setRole(userProfile.role)
    setPhone(userProfile.phone || '')
    setShowEditDialog(true)
  }

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

      <div className="flex justify-end mb-6">
        <Button onClick={() => setShowCreateDialog(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite User
        </Button>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
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
            <div className="text-center py-8 text-gray-600">Loading users...</div>
          ) : users && users.length > 0 ? (
            <div className="space-y-3">
              {users.map((userProfile) => (
                <div
                  key={userProfile.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
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
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      <Mail className="h-3 w-3 inline mr-1" />
                      {userProfile.email}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Created {formatDateTime(userProfile.created_at)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleActiveMutation.mutate({
                        userId: userProfile.id,
                        isActive: userProfile.is_active
                      })}
                      disabled={userProfile.id === user?.id}
                    >
                      {userProfile.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => openEditDialog(userProfile)}
                    >
                      <Edit className="h-4 w-4" />
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
                phone: phone || null
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
