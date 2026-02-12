/**
 * Organization Management - Master User Only
 * Create, edit, delete, and manage organizations
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Building2,
  Plus,
  Edit,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Users,
  MapPin,
  Shield,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface Organization {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  enforcement_workflow: 'admin_first' | 'officer_first';
  created_at: string;
  updated_at: string;
  user_count?: number;
  zone_count?: number;
}

export function OrganizationManagement() {
  const { user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    contact_email: '',
    contact_phone: '',
    enforcement_workflow: 'admin_first' as 'admin_first' | 'officer_first',
    is_active: true,
  });

  // Check if user is master
  const isMaster = user?.role === 'master';

  useEffect(() => {
    if (!isMaster) {
      toast.error('Access denied: Master user access required');
      return;
    }
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    setIsLoading(true);
    try {
      // Load organizations with user and zone counts
      const { data: orgs, error } = await supabase
        .from('organizations')
        .select('*')
        .order('name');

      if (error) throw error;

      // Get counts for each organization
      const orgsWithCounts = await Promise.all(
        (orgs || []).map(async (org) => {
          const [userCount, zoneCount] = await Promise.all([
            supabase
              .from('user_profiles')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', org.id)
              .then((res) => res.count || 0),
            supabase
              .from('zones')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', org.id)
              .then((res) => res.count || 0),
          ]);

          return {
            ...org,
            user_count: userCount,
            zone_count: zoneCount,
          };
        })
      );

      setOrganizations(orgsWithCounts);
    } catch (error: any) {
      console.error('Failed to load organizations:', error);
      toast.error('Failed to load organizations: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error('Organization name is required');
      return;
    }

    try {
      const { error } = await supabase
        .from('organizations')
        .insert({
          name: formData.name.trim(),
          contact_email: formData.contact_email || null,
          contact_phone: formData.contact_phone || null,
          enforcement_workflow: formData.enforcement_workflow,
          is_active: formData.is_active,
        });

      if (error) throw error;

      toast.success('Organization created successfully');
      setIsCreateDialogOpen(false);
      setFormData({
        name: '',
        contact_email: '',
        contact_phone: '',
        enforcement_workflow: 'admin_first',
        is_active: true,
      });
      loadOrganizations();
    } catch (error: any) {
      console.error('Failed to create organization:', error);
      toast.error('Failed to create organization: ' + error.message);
    }
  };

  const handleUpdate = async () => {
    if (!selectedOrg || !formData.name.trim()) {
      toast.error('Organization name is required');
      return;
    }

    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          name: formData.name.trim(),
          contact_email: formData.contact_email || null,
          contact_phone: formData.contact_phone || null,
          enforcement_workflow: formData.enforcement_workflow,
          is_active: formData.is_active,
        })
        .eq('id', selectedOrg.id);

      if (error) throw error;

      toast.success('Organization updated successfully');
      setIsEditDialogOpen(false);
      setSelectedOrg(null);
      loadOrganizations();
    } catch (error: any) {
      console.error('Failed to update organization:', error);
      toast.error('Failed to update organization: ' + error.message);
    }
  };

  const handleDelete = async (org: Organization) => {
    if (org.user_count! > 0 || org.zone_count! > 0) {
      toast.error('Cannot delete organization with users or zones. Please remove all associated data first.');
      return;
    }

    if (!confirm(`Are you sure you want to delete "${org.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('organizations')
        .delete()
        .eq('id', org.id);

      if (error) throw error;

      toast.success('Organization deleted successfully');
      loadOrganizations();
    } catch (error: any) {
      console.error('Failed to delete organization:', error);
      toast.error('Failed to delete organization: ' + error.message);
    }
  };

  const openEditDialog = (org: Organization) => {
    setSelectedOrg(org);
    setFormData({
      name: org.name,
      contact_email: org.contact_email || '',
      contact_phone: org.contact_phone || '',
      enforcement_workflow: org.enforcement_workflow,
      is_active: org.is_active,
    });
    setIsEditDialogOpen(true);
  };

  if (!isMaster) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Shield className="h-16 w-16 mx-auto mb-4 text-red-500" />
          <h3 className="text-xl font-bold mb-2">Access Denied</h3>
          <p className="text-muted-foreground">
            This page is only accessible to Master users
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
          <Building2 className="h-8 w-8 text-primary" />
          Organization Management
        </h2>
        <p className="text-muted-foreground">
          Create and manage organizations across the platform
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-base px-3 py-1">
            {organizations.length} Organization{organizations.length !== 1 ? 's' : ''}
          </Badge>
          <Badge variant="outline" className="text-base px-3 py-1">
            {organizations.filter(o => o.is_active).length} Active
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadOrganizations} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
          </Button>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Create Organization
          </Button>
        </div>
      </div>

      {/* Organizations Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Organizations</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">Loading organizations...</p>
            </div>
          ) : organizations.length === 0 ? (
            <div className="text-center py-12">
              <Building2 className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="font-medium">No organizations found</p>
              <p className="text-sm text-muted-foreground">Create your first organization to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Zones</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organizations.map((org) => (
                    <TableRow key={org.id}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-semibold">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {org.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm space-y-1">
                          {org.contact_email && (
                            <div className="truncate max-w-[200px]">{org.contact_email}</div>
                          )}
                          {org.contact_phone && (
                            <div className="text-muted-foreground">{org.contact_phone}</div>
                          )}
                          {!org.contact_email && !org.contact_phone && (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {org.enforcement_workflow.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {org.is_active ? (
                          <Badge className="gap-1 bg-green-100 text-green-700 border-green-300">
                            <CheckCircle2 className="h-3 w-3" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 bg-gray-100 text-gray-600">
                            <XCircle className="h-3 w-3" />
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">{org.user_count || 0}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">{org.zone_count || 0}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {new Date(org.created_at).toLocaleDateString('en-NZ')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog(org)}
                            className="gap-1"
                          >
                            <Edit className="h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDelete(org)}
                            disabled={(org.user_count || 0) > 0 || (org.zone_count || 0) > 0}
                            className="gap-1"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Organization</DialogTitle>
            <DialogDescription>
              Add a new organization to the platform
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Organization Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter organization name"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input
                type="email"
                value={formData.contact_email}
                onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                placeholder="contact@organization.com"
              />
            </div>

            <div className="space-y-2">
              <Label>Contact Phone</Label>
              <Input
                type="tel"
                value={formData.contact_phone}
                onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                placeholder="+64 21 123 4567"
              />
            </div>

            <div className="space-y-2">
              <Label>Enforcement Workflow</Label>
              <Select
                value={formData.enforcement_workflow}
                onValueChange={(value: any) => setFormData({ ...formData, enforcement_workflow: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin_first">
                    Admin First (Admin assigns → Officer completes)
                  </SelectItem>
                  <SelectItem value="officer_first">
                    Officer First (Officer creates → Admin reviews)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="is_active" className="cursor-pointer">
                Active Organization
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>Create Organization</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>
              Update organization details
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Organization Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter organization name"
              />
            </div>

            <div className="space-y-2">
              <Label>Contact Email</Label>
              <Input
                type="email"
                value={formData.contact_email}
                onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                placeholder="contact@organization.com"
              />
            </div>

            <div className="space-y-2">
              <Label>Contact Phone</Label>
              <Input
                type="tel"
                value={formData.contact_phone}
                onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                placeholder="+64 21 123 4567"
              />
            </div>

            <div className="space-y-2">
              <Label>Enforcement Workflow</Label>
              <Select
                value={formData.enforcement_workflow}
                onValueChange={(value: any) => setFormData({ ...formData, enforcement_workflow: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin_first">
                    Admin First (Admin assigns → Officer completes)
                  </SelectItem>
                  <SelectItem value="officer_first">
                    Officer First (Officer creates → Admin reviews)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active_edit"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="is_active_edit" className="cursor-pointer">
                Active Organization
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate}>Update Organization</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
