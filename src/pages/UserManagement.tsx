import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Loader2,
  Mail,
  Phone,
  Shield,
  RefreshCw,
  Building2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { PermissionsEditor } from '@/components/features/PermissionsEditor';

interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: 'master' | 'admin' | 'officer' | 'admin_officer';
  organization_id: string | null;
  employer_organization_id: string | null;
  authorized_work_locations: string[];
  phone: string | null;
  is_active: boolean;
  permissions: string[];
  created_at: string;
  organization?: {
    id: string;
    name: string;
  };
}

interface Organization {
  id: string;
  name: string;
  organization_level: number;
  parent_organization_id: string | null;
}

export function UserManagement() {
  const { user: currentUser } = useAuthStore();
  const isMaster = currentUser?.role === 'master';
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'master';

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'officer' as 'master' | 'admin' | 'officer' | 'admin_officer',
    organizationId: '',
    employerOrgId: '',
    authorizedWorkLocations: [] as string[],
    isActive: true,
    permissions: [] as string[],
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [users, searchQuery]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load organizations
      const { data: orgsData, error: orgsError } = await supabase
        .from('organizations')
        .select('*')
        .eq('is_active', true)
        .order('organization_level')
        .order('name');

      if (orgsError) throw orgsError;
      setOrganizations(orgsData || []);

      // Load users
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('Not authenticated');

      const { data: currentUserProfile } = await supabase
        .from('user_profiles')
        .select('role, organization_id')
        .eq('id', authUser.id)
        .single();

      if (!currentUserProfile) throw new Error('User profile not found');

      let query = supabase
        .from('user_profiles')
        .select(`
          id,
          email,
          first_name,
          last_name,
          role,
          organization_id,
          employer_organization_id,
          authorized_work_locations,
          phone,
          is_active,
          permissions,
          created_at,
          organization:organizations!organization_id(id, name)
        `)
        .order('created_at', { ascending: false });

      // Apply role-based filtering
      if (currentUserProfile.role === 'admin' || currentUserProfile.role === 'admin_officer') {
        if (currentUserProfile.organization_id) {
          query = query.eq('organization_id', currentUserProfile.organization_id);
        } else {
          query = query.eq('id', authUser.id);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      
      setUsers(data || []);
      console.log('✅ Loaded', data?.length || 0, 'users');
    } catch (error: any) {
      console.error('Failed to load users:', error);
      toast.error('Failed to load users: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...users];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        u =>
          u.first_name.toLowerCase().includes(query) ||
          u.last_name.toLowerCase().includes(query) ||
          u.email.toLowerCase().includes(query) ||
          u.role.toLowerCase().includes(query)
      );
    }

    setFilteredUsers(filtered);
  };

  const handleCreateUser = async () => {
    if (!formData.firstName || !formData.email) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-user', {
        body: {
          email: formData.email,
          password: Math.random().toString(36).slice(-8) + 'Aa1!', // Generate secure temp password
          first_name: formData.firstName,
          last_name: formData.lastName,
          phone: formData.phone || null,
          role: formData.role,
          organization_id: formData.organizationId || null,
          employer_organization_id: formData.employerOrgId || null,
          authorized_work_locations: formData.authorizedWorkLocations || [],
          permissions: formData.permissions,
        },
      });

      if (error) throw error;

      toast.success('User created successfully');
      setShowCreateDialog(false);
      resetForm();
      await loadData();
    } catch (error: any) {
      console.error('Failed to create user:', error);
      toast.error('Failed to create user: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          first_name: formData.firstName,
          last_name: formData.lastName,
          phone: formData.phone || null,
          role: formData.role,
          organization_id: formData.organizationId || null,
          employer_organization_id: formData.employerOrgId || null,
          authorized_work_locations: formData.authorizedWorkLocations || [],
          is_active: formData.isActive,
          permissions: formData.permissions,
        })
        .eq('id', selectedUser.id);

      if (error) throw error;

      toast.success('User updated successfully');
      setShowEditDialog(false);
      setSelectedUser(null);
      resetForm();
      await loadData();
    } catch (error: any) {
      console.error('Failed to update user:', error);
      toast.error('Failed to update user: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ is_active: false })
        .eq('id', selectedUser.id);

      if (error) throw error;

      toast.success('User deactivated successfully');
      setShowDeleteDialog(false);
      setSelectedUser(null);
      await loadData();
    } catch (error: any) {
      console.error('Failed to delete user:', error);
      toast.error('Failed to delete user: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const openEditDialog = (user: UserProfile) => {
    setSelectedUser(user);
    setFormData({
      firstName: user.first_name || '',
      lastName: user.last_name || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role || 'officer',
      organizationId: user.organization_id || '',
      employerOrgId: user.employer_organization_id || '',
      authorizedWorkLocations: user.authorized_work_locations || [],
      isActive: user.is_active !== false,
      permissions: Array.isArray(user.permissions) ? user.permissions : [],
    });
    setShowEditDialog(true);
  };

  const openDeleteDialog = (user: UserProfile) => {
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
      employerOrgId: '',
      authorizedWorkLocations: [],
      isActive: true,
      permissions: [],
    });
  };

  const getAvailableWorkLocations = () => {
    if (!formData.employerOrgId || !organizations) return [];
    
    const getDescendants = (orgId: string): string[] => {
      const children = organizations.filter(o => o.parent_organization_id === orgId);
      const descendantIds = children.map(c => c.id);
      children.forEach(child => descendantIds.push(...getDescendants(child.id)));
      return descendantIds;
    };
    
    const descendantIds = [formData.employerOrgId, ...getDescendants(formData.employerOrgId)];
    return organizations.filter(org => descendantIds.includes(org.id)).sort((a, b) => {
      const aLevel = a.organization_level || 1;
      const bLevel = b.organization_level || 1;
      return aLevel !== bLevel ? aLevel - bLevel : a.name.localeCompare(b.name);
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold mb-1 flex items-center gap-2">
            <Users className="h-8 w-8" />
            User Management
          </h2>
          <p className="text-muted-foreground">
            Manage user accounts and permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={loadData} variant="outline" disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Create User
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground mb-2">Total Users</div>
            <div className="text-4xl font-bold">{users.length}</div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
          <CardContent className="p-6">
            <div className="text-sm text-green-700 dark:text-green-300 mb-2">Active</div>
            <div className="text-4xl font-bold text-green-600">
              {users.filter(u => u.is_active).length}
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
          <CardContent className="p-6">
            <div className="text-sm text-blue-700 dark:text-blue-300 mb-2">Admins</div>
            <div className="text-4xl font-bold text-blue-600">
              {users.filter(u => u.role === 'admin' || u.role === 'master' || u.role === 'admin_officer').length}
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-6">
            <div className="text-sm text-amber-700 dark:text-amber-300 mb-2">Officers</div>
            <div className="text-4xl font-bold text-amber-600">
              {users.filter(u => u.role === 'officer' || u.role === 'admin_officer').length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="border-2 border-primary/20">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users by name, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>Users ({filteredUsers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p>No users found</p>
              {searchQuery && (
                <Button variant="outline" size="sm" onClick={() => setSearchQuery('')} className="mt-4">
                  Clear Search
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredUsers.map((user) => (
                <Card key={user.id} className={!user.is_active ? 'opacity-60' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
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
                              <Building2 className="h-3 w-3" />
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
                type="tel"
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
                  {isMaster && <SelectItem value="master">Master</SelectItem>}
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="officer">Officer</SelectItem>
                  <SelectItem value="admin_officer">Admin + Officer (Dual Role)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Primary Organization</Label>
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

            {(formData.role === 'officer' || formData.role === 'admin_officer') && (
              <>
                <div>
                  <Label>Employer Organization *</Label>
                  <Select 
                    value={formData.employerOrgId} 
                    onValueChange={(value) => {
                      setFormData({ 
                        ...formData, 
                        employerOrgId: value,
                        authorizedWorkLocations: []
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select employer" />
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

                {formData.employerOrgId && (
                  <div>
                    <Label>Authorized Work Locations *</Label>
                    <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto mt-1">
                      {getAvailableWorkLocations().map((org) => (
                        <div key={org.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`work-${org.id}`}
                            checked={formData.authorizedWorkLocations.includes(org.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({
                                  ...formData,
                                  authorizedWorkLocations: [...formData.authorizedWorkLocations, org.id]
                                });
                              } else {
                                setFormData({
                                  ...formData,
                                  authorizedWorkLocations: formData.authorizedWorkLocations.filter(id => id !== org.id)
                                });
                              }
                            }}
                            className="rounded"
                          />
                          <Label htmlFor={`work-${org.id}`} className="cursor-pointer">
                            {org.name}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div>
              <Label>Permissions</Label>
              <PermissionsEditor
                selectedPermissions={formData.permissions}
                onPermissionsChange={(permissions) => setFormData({ ...formData, permissions })}
                userRole={formData.role}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={isSaving}>
              {isSaving ? (
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
                Email cannot be changed
              </p>
            </div>

            <div>
              <Label>Phone</Label>
              <Input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>

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
                      {isMaster && <SelectItem value="master">Master</SelectItem>}
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="officer">Officer</SelectItem>
                      <SelectItem value="admin_officer">Admin + Officer (Dual Role)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Primary Organization</Label>
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

                {(formData.role === 'officer' || formData.role === 'admin_officer') && (
                  <>
                    <div>
                      <Label>Employer Organization *</Label>
                      <Select 
                        value={formData.employerOrgId} 
                        onValueChange={(value) => {
                          setFormData({ 
                            ...formData, 
                            employerOrgId: value,
                            authorizedWorkLocations: []
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select employer" />
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

                    {formData.employerOrgId && (
                      <div>
                        <Label>Authorized Work Locations *</Label>
                        <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto mt-1">
                          {getAvailableWorkLocations().map((org) => (
                            <div key={org.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`edit-work-${org.id}`}
                                checked={formData.authorizedWorkLocations.includes(org.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFormData({
                                      ...formData,
                                      authorizedWorkLocations: [...formData.authorizedWorkLocations, org.id]
                                    });
                                  } else {
                                    setFormData({
                                      ...formData,
                                      authorizedWorkLocations: formData.authorizedWorkLocations.filter(id => id !== org.id)
                                    });
                                  }
                                }}
                                className="rounded"
                              />
                              <Label htmlFor={`edit-work-${org.id}`} className="cursor-pointer">
                                {org.name}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

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
                </div>

                <div>
                  <Label>Permissions</Label>
                  <PermissionsEditor
                    selectedPermissions={formData.permissions}
                    onPermissionsChange={(permissions) => setFormData({ ...formData, permissions })}
                    userRole={formData.role}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateUser} disabled={isSaving}>
              {isSaving ? (
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
              This will deactivate the user account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} disabled={isSaving} className="bg-destructive text-destructive-foreground">
              {isSaving ? (
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
