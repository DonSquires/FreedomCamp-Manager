import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Users,
  UserPlus,
  Search,
  Edit,
  Trash2,
  Shield,
  User,
  Loader2,
  Mail,
  Phone,
  Lock,
} from 'lucide-react';
import { useUsers, useUpdateUser, useDeleteUser } from '@/hooks/useUsers';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { Label } from '@/components/ui/label';
import { PermissionsEditor } from '@/components/features/PermissionsEditor';

export function UserManagement() {
  const { user: currentUser } = useAuthStore();
  const { data: users, isLoading: usersLoading } = useUsers();
  const { data: organizations } = useOrganizations();
  const updateUserMutation = useUpdateUser();
  const deleteUserMutation = useDeleteUser();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'officer' as 'master' | 'admin' | 'officer' | 'admin_officer',
    organizationId: '',
    isActive: true,
    permissions: [] as string[],
  });

  const isMaster = currentUser?.role === 'master';
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'master';

  const filteredUsers = users?.filter(user => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      user.first_name.toLowerCase().includes(search) ||
      user.last_name.toLowerCase().includes(search) ||
      user.email.toLowerCase().includes(search) ||
      user.role.toLowerCase().includes(search)
    );
  });

  const handleCreateUser = async () => {
    if (!formData.firstName || !formData.email) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    try {
      // Call edge function to create user
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: formData.email,
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: formData.phone || null,
          role: formData.role,
          organizationId: formData.organizationId || null,
          permissions: formData.permissions,
        },
      });

      if (error) throw error;

      toast.success('User created successfully');
      setShowCreateDialog(false);
      resetForm();
    } catch (error: any) {
      console.error('Failed to create user:', error);
      toast.error('Failed to create user: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) return;

    setIsSubmitting(true);
    try {
      // Ensure permissions is properly formatted as a clean array of strings
      let safePermissions: string[] = [];
      
      if (Array.isArray(formData.permissions)) {
        // Filter to ensure only strings, remove any invalid entries
        safePermissions = formData.permissions.filter(p => typeof p === 'string' && p.length > 0);
      }
      
      console.log('Updating user with permissions:', safePermissions);
      
      const updateData = {
        id: selectedUser.id,
        first_name: formData.firstName,
        last_name: formData.lastName,
        phone: formData.phone || null,
        role: formData.role,
        organization_id: formData.organizationId || null,
        is_active: formData.isActive,
        permissions: safePermissions,
      };
      
      console.log('Update data:', updateData);
      
      await updateUserMutation.mutateAsync(updateData);

      toast.success('User updated successfully');
      setShowEditDialog(false);
      setSelectedUser(null);
      resetForm();
    } catch (error: any) {
      console.error('Failed to update user:', error);
      console.error('Error details:', JSON.stringify(error));
      toast.error('Failed to update user: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    setIsSubmitting(true);
    try {
      await deleteUserMutation.mutateAsync(selectedUser.id);
      toast.success('User deleted successfully');
      setShowDeleteDialog(false);
      setSelectedUser(null);
    } catch (error: any) {
      console.error('Failed to delete user:', error);
      toast.error('Failed to delete user: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditDialog = (user: any) => {
    console.log('Opening edit dialog for user:', user);
    setSelectedUser(user);
    
    // Safely handle permissions - ensure it's always an array
    let userPermissions = [];
    if (user.permissions && Array.isArray(user.permissions)) {
      userPermissions = user.permissions;
    } else if (user.permissions && typeof user.permissions === 'string') {
      try {
        userPermissions = JSON.parse(user.permissions);
      } catch {
        userPermissions = [];
      }
    }
    
    setFormData({
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role || 'officer',
      organizationId: user.organization_id || '',
      isActive: user.is_active !== false,
      permissions: userPermissions,
    });
    setShowEditDialog(true);
  };

  const openDeleteDialog = (user: any) => {
    setSelectedUser(user);
    setShowDeleteDialog(true);
  };

  const resetForm = () => {
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      role: 'officer',
      organizationId: '',
      isActive: true,
      permissions: [],
    });
  };

  if (usersLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">User Management</h2>
          <p className="text-muted-foreground">
            Manage user accounts and permissions
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Create User
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{users?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500">
              {users?.filter(u => u.is_active).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-500">
              {users?.filter(u => u.role === 'admin' || u.role === 'master' || u.role === 'admin_officer').length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Officers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-500">
              {users?.filter(u => u.role === 'officer' || u.role === 'admin_officer').length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users by name, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
          </div>
        </CardHeader>
        <CardContent>
          {filteredUsers && filteredUsers.length > 0 ? (
            <div className="space-y-3">
              {filteredUsers.map((user) => (
                <Card key={user.id} className={!user.is_active ? 'opacity-60' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-lg">
                            {user.first_name} {user.last_name}
                          </h3>
                          <Badge variant={
                            user.role === 'master' ? 'default' : 
                            user.role === 'admin' ? 'secondary' : 
                            user.role === 'admin_officer' ? 'default' : 
                            'outline'
                          }>
                            {user.role === 'admin_officer' ? 'Admin + Officer' : user.role}
                          </Badge>
                          {!user.is_active && (
                            <Badge variant="destructive">Inactive</Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div className="flex items-center gap-2">
                            <Mail className="h-3 w-3" />
                            {user.email}
                          </div>
                          {user.phone && (
                            <div className="flex items-center gap-2">
                              <Phone className="h-3 w-3" />
                              {user.phone}
                            </div>
                          )}
                          {user.organization && (
                            <div className="flex items-center gap-2">
                              <Shield className="h-3 w-3" />
                              {user.organization.name}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditDialog(user)}
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDeleteDialog(user)}
                          disabled={user.id === currentUser?.id}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No users found</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Add a new user to the system
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  placeholder="John"
                />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder="Doe"
                />
              </div>
            </div>

            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john.doe@example.com"
              />
            </div>

            <div>
              <Label>Phone</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+64 21 123 4567"
              />
            </div>

            <div>
              <Label>Role *</Label>
              <Select value={formData.role} onValueChange={(value: any) => setFormData({ ...formData, role: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isMaster && (
                    <SelectItem value="master">Master</SelectItem>
                  )}
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="officer">Officer</SelectItem>
                  <SelectItem value="admin_officer">Admin + Officer (Dual Role)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {formData.role === 'admin_officer' && (
                  <span className="text-blue-600 font-semibold">💼 Dual-role: Can access both Admin Portal AND Field Portal. Cannot self-approve enforcement actions.</span>
                )}
              </p>
            </div>

            <div>
              <Label>Organization</Label>
              <Select value={formData.organizationId} onValueChange={(value) => setFormData({ ...formData, organizationId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select organization (optional)" />
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

            <div>
              <Label>Permissions</Label>
              <PermissionsEditor
                selectedPermissions={formData.permissions || []}
                onPermissionsChange={(permissions) => setFormData({ ...formData, permissions })}
                userRole={formData.role}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create User'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information and permissions
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Email cannot be changed after account creation
              </p>
            </div>

            <div>
              <Label>Phone</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

            {/* Only allow admin/master to edit these fields */}
            {isAdmin && (
              <>
                <div>
                  <Label>Role *</Label>
                  <Select 
                    value={formData.role} 
                    onValueChange={(value: any) => setFormData({ ...formData, role: value })}
                    disabled={selectedUser?.id === currentUser?.id}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {isMaster && (
                        <SelectItem value="master">Master</SelectItem>
                      )}
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="officer">Officer</SelectItem>
                      <SelectItem value="admin_officer">Admin + Officer (Dual Role)</SelectItem>
                    </SelectContent>
                  </Select>
                  {selectedUser?.id === currentUser?.id && (
                    <p className="text-xs text-muted-foreground mt-1">
                      ℹ️ You cannot change your own role
                    </p>
                  )}
                  {formData.role === 'admin_officer' && (
                    <p className="text-xs text-blue-600 font-semibold mt-1">
                      💼 Dual-role: Can access both Admin Portal AND Field Portal. Cannot self-approve enforcement actions.
                    </p>
                  )}
                </div>

                <div>
                  <Label>Organization</Label>
                  <Select value={formData.organizationId} onValueChange={(value) => setFormData({ ...formData, organizationId: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="No organization" />
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

                <div>
                  <Label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                      className="rounded"
                      disabled={selectedUser?.id === currentUser?.id}
                    />
                    Active User
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedUser?.id === currentUser?.id 
                      ? 'ℹ️ You cannot deactivate yourself'
                      : 'Inactive users cannot log in'}
                  </p>
                </div>

                <div>
                  <Label>Permissions</Label>
                  <PermissionsEditor
                    selectedPermissions={formData.permissions || []}
                    onPermissionsChange={(permissions) => setFormData({ ...formData, permissions })}
                    userRole={formData.role}
                  />
                  {selectedUser?.id === currentUser?.id && (
                    <p className="text-xs text-amber-600 mt-1">
                      ⚠️ Be careful editing your own permissions
                    </p>
                  )}
                </div>
              </>
            )}
            
            {/* Non-admin users can only see read-only fields */}
            {!isAdmin && (
              <div className="p-4 bg-muted rounded-lg border-2 border-dashed">
                <p className="text-sm text-muted-foreground text-center">
                  ℹ️ You can only edit your name and phone number. Contact an administrator to change role, organization, or permissions.
                </p>
                <div className="mt-4 space-y-2 text-sm">
                  <div>
                    <span className="font-semibold">Role:</span> {formData.role}
                  </div>
                  <div>
                    <span className="font-semibold">Organization:</span> {organizations?.find(o => o.id === formData.organizationId)?.name || 'None'}
                  </div>
                  <div>
                    <span className="font-semibold">Status:</span> {formData.isActive ? 'Active' : 'Inactive'}
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateUser} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedUser?.first_name} {selectedUser?.last_name}? 
              This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} disabled={isSubmitting} className="bg-destructive text-destructive-foreground">
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete User'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
