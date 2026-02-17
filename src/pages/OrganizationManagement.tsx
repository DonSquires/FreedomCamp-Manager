/**
 * Organization Management - Master User Only
 * Create, edit, delete, and manage organizations with hierarchical structure
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
  parent_organization_id: string | null;
  organization_level: number;
  organization_type: 'owner' | 'security_company' | 'client' | 'other';
  created_at: string;
  updated_at: string;
  user_count?: number;
  zone_count?: number;
  parent?: { id: string; name: string };
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
    parent_organization_id: 'none' as string,
    organization_type: 'client' as 'owner' | 'security_company' | 'client' | 'other',
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
      const { data: orgs, error } = await supabase
        .from('organizations')
        .select(`
          *,
          parent:organizations!parent_organization_id(id, name)
        `)
        .order('organization_level', { ascending: true })
        .order('name');

      if (error) throw error;

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
      let orgLevel = 1;
      if (formData.parent_organization_id) {
        const parent = organizations.find(o => o.id === formData.parent_organization_id);
        if (parent) {
          orgLevel = parent.organization_level + 1;
        }
      }

      const { error } = await supabase
        .from('organizations')
        .insert({
          name: formData.name.trim(),
          contact_email: formData.contact_email || null,
          contact_phone: formData.contact_phone || null,
          enforcement_workflow: formData.enforcement_workflow,
          parent_organization_id: formData.parent_organization_id === 'none' ? null : formData.parent_organization_id,
          organization_level: orgLevel,
          organization_type: formData.organization_type,
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
        parent_organization_id: 'none',
        organization_type: 'client',
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

    if (formData.parent_organization_id === selectedOrg.id) {
      toast.error('An organization cannot be its own parent');
      return;
    }

    try {
      let orgLevel = 1;
      if (formData.parent_organization_id && formData.parent_organization_id !== 'none') {
        const parent = organizations.find(o => o.id === formData.parent_organization_id);
        if (parent) {
          orgLevel = parent.organization_level + 1;
        }
      }

      // Validate organization type
      const validTypes: Array<'owner' | 'security_company' | 'client' | 'other'> = ['owner', 'security_company', 'client', 'other'];
      const safeOrgType = validTypes.includes(formData.organization_type as any) ? formData.organization_type : 'client';
      
      // Validate enforcement workflow with comprehensive logging
      console.log('🔍 ENFORCEMENT WORKFLOW DEBUG:');
      console.log('Raw formData.enforcement_workflow:', formData.enforcement_workflow);
      console.log('Type:', typeof formData.enforcement_workflow);
      console.log('Length:', formData.enforcement_workflow?.length);
      console.log('Character codes:', Array.from(formData.enforcement_workflow || '').map(c => c.charCodeAt(0)));
      
      let safeWorkflow: 'admin_first' | 'officer_first';
      const workflowValue = String(formData.enforcement_workflow).trim();
      
      if (workflowValue === 'admin_first') {
        safeWorkflow = 'admin_first';
        console.log('✅ Set to admin_first');
      } else if (workflowValue === 'officer_first') {
        safeWorkflow = 'officer_first';
        console.log('✅ Set to officer_first');
      } else {
        console.warn('⚠️ Invalid workflow value detected:', workflowValue, '- defaulting to admin_first');
        safeWorkflow = 'admin_first';
      }
      
      console.log('📤 Final safeWorkflow:', safeWorkflow);
      console.log('📤 Type:', typeof safeWorkflow);
      
      const updateData = {
        name: formData.name.trim(),
        contact_email: formData.contact_email || null,
        contact_phone: formData.contact_phone || null,
        enforcement_workflow: safeWorkflow,
        parent_organization_id: formData.parent_organization_id === 'none' ? null : formData.parent_organization_id,
        organization_level: orgLevel,
        organization_type: safeOrgType,
        is_active: formData.is_active,
      };
      
      console.log('📊 Complete update payload:', JSON.stringify(updateData, null, 2));
      
      const { error } = await supabase
        .from('organizations')
        .update(updateData)
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
    console.log('🔧 OPENING EDIT DIALOG FOR:', org.name);
    console.log('📥 From database - enforcement_workflow:', org.enforcement_workflow);
    console.log('📥 Type:', typeof org.enforcement_workflow);
    
    const validTypes: Array<'owner' | 'security_company' | 'client' | 'other'> = ['owner', 'security_company', 'client', 'other'];
    const orgType = validTypes.includes(org.organization_type as any) ? org.organization_type : 'client';
    
    // Validate and sanitize workflow value from database
    let workflow: 'admin_first' | 'officer_first';
    const workflowFromDb = String(org.enforcement_workflow || '').trim();
    
    if (workflowFromDb === 'admin_first') {
      workflow = 'admin_first';
      console.log('✅ Loaded workflow: admin_first');
    } else if (workflowFromDb === 'officer_first') {
      workflow = 'officer_first';
      console.log('✅ Loaded workflow: officer_first');
    } else {
      console.warn('⚠️ Invalid workflow from DB:', workflowFromDb, '- defaulting to admin_first');
      workflow = 'admin_first';
    }
    
    const newFormData = {
      name: org.name || '',
      contact_email: org.contact_email || '',
      contact_phone: org.contact_phone || '',
      enforcement_workflow: workflow,
      parent_organization_id: org.parent_organization_id || 'none',
      organization_type: orgType,
      is_active: org.is_active !== false,
    };
    
    console.log('📋 Form data populated:', newFormData);
    
    setSelectedOrg(org);
    setFormData(newFormData);
    setIsEditDialogOpen(true);
  };

  const getAvailableParentOrgs = (excludeOrgId?: string) => {
    if (!excludeOrgId) {
      return organizations;
    }

    const getDescendants = (orgId: string): string[] => {
      const children = organizations.filter(o => o.parent_organization_id === orgId);
      const descendantIds = children.map(c => c.id);
      children.forEach(child => {
        descendantIds.push(...getDescendants(child.id));
      });
      return descendantIds;
    };

    const excludeIds = [excludeOrgId, ...getDescendants(excludeOrgId)];
    return organizations.filter(o => !excludeIds.includes(o.id));
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
      <div>
        <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
          <Building2 className="h-8 w-8 text-primary" />
          Organization Management
        </h2>
        <p className="text-muted-foreground">
          Create and manage organizations with hierarchical structure
        </p>
      </div>

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
                    <TableHead>Type</TableHead>
                    <TableHead>Parent/Manager</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organizations.map((org) => (
                    <TableRow key={org.id} style={{ paddingLeft: `${(org.organization_level - 1) * 24}px` }}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-semibold">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {org.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {org.organization_type.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {org.parent ? (
                          <div className="text-sm">
                            <div className="font-medium">{org.parent.name}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Top Level</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          L{org.organization_level}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm space-y-1">
                          {org.contact_email && (
                            <div className="truncate max-w-[180px]">{org.contact_email}</div>
                          )}
                          {org.contact_phone && (
                            <div className="text-muted-foreground text-xs">{org.contact_phone}</div>
                          )}
                          {!org.contact_email && !org.contact_phone && (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
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
              <Label htmlFor="create-org-name">Organization Name *</Label>
              <Input
                id="create-org-name"
                name="name"
                autoComplete="organization"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., First Security, LINZ, Iron Eagle"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="create-org-type">Organization Type *</Label>
                <Select
                  value={formData.organization_type}
                  onValueChange={(value: any) => setFormData({ ...formData, organization_type: value })}
                >
                  <SelectTrigger id="create-org-type" name="organizationType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner (Top Level)</SelectItem>
                    <SelectItem value="security_company">Security Company</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="create-parent-org">Parent/Manager Organization</Label>
                <Select
                  value={formData.parent_organization_id}
                  onValueChange={(value) => setFormData({ ...formData, parent_organization_id: value })}
                >
                  <SelectTrigger id="create-parent-org" name="parentOrganizationId">
                    <SelectValue placeholder="No parent (top level)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No parent (top level)</SelectItem>
                    {getAvailableParentOrgs().map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name} (L{org.organization_level})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  💼 Who manages this organization? E.g., Iron Eagle manages First Security
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-contact-email">Contact Email</Label>
              <Input
                id="create-contact-email"
                name="contactEmail"
                type="email"
                autoComplete="email"
                value={formData.contact_email}
                onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                placeholder="contact@organization.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-contact-phone">Contact Phone</Label>
              <Input
                id="create-contact-phone"
                name="contactPhone"
                type="tel"
                autoComplete="tel"
                value={formData.contact_phone}
                onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                placeholder="+64 21 123 4567"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-workflow">Enforcement Workflow</Label>
              <Select
                value={formData.enforcement_workflow}
                onValueChange={(value: any) => setFormData({ ...formData, enforcement_workflow: value })}
              >
                <SelectTrigger id="create-workflow" name="enforcementWorkflow">
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
                name="isActive"
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
              <Label htmlFor="edit-org-name">Organization Name *</Label>
              <Input
                id="edit-org-name"
                name="name"
                autoComplete="organization"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., First Security, LINZ, Iron Eagle"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-org-type">Organization Type *</Label>
                <Select
                  value={formData.organization_type}
                  onValueChange={(value: any) => setFormData({ ...formData, organization_type: value })}
                >
                  <SelectTrigger id="edit-org-type" name="organizationType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner (Top Level)</SelectItem>
                    <SelectItem value="security_company">Security Company</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-parent-org">Parent/Manager Organization</Label>
                <Select
                  value={formData.parent_organization_id}
                  onValueChange={(value) => setFormData({ ...formData, parent_organization_id: value })}
                >
                  <SelectTrigger id="edit-parent-org" name="parentOrganizationId">
                    <SelectValue placeholder="No parent (top level)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No parent (top level)</SelectItem>
                    {getAvailableParentOrgs(selectedOrg?.id).map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name} (L{org.organization_level})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  💼 Who manages this organization? E.g., Iron Eagle manages First Security
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-contact-email">Contact Email</Label>
              <Input
                id="edit-contact-email"
                name="contactEmail"
                type="email"
                autoComplete="email"
                value={formData.contact_email}
                onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                placeholder="contact@organization.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-contact-phone">Contact Phone</Label>
              <Input
                id="edit-contact-phone"
                name="contactPhone"
                type="tel"
                autoComplete="tel"
                value={formData.contact_phone}
                onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                placeholder="+64 21 123 4567"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-workflow">Enforcement Workflow</Label>
              <Select
                value={formData.enforcement_workflow}
                onValueChange={(value: any) => setFormData({ ...formData, enforcement_workflow: value })}
              >
                <SelectTrigger id="edit-workflow" name="enforcementWorkflow">
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
                name="isActive"
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
