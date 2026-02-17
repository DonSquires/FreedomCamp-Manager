/**
 * Organization Management
 * Hierarchical organization management with enforcement workflow configuration
 * Master users only - controls the entire organization tree
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Building2,
  Plus,
  Edit,
  Trash2,
  ChevronRight,
  ChevronDown,
  Users,
  MapPin,
  Shield,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface Organization {
  id: string;
  name: string;
  parent_organization_id: string | null;
  organization_level: number;
  organization_type: 'security_company' | 'client' | 'contractor';
  enforcement_workflow: 'admin_first' | 'officer_first';
  contact_email: string | null;
  contact_phone: string | null;
  is_active: boolean;
  user_count?: number;
  zone_count?: number;
  children?: Organization[];
}

export function OrganizationManagement() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [isLoading, setIsLoading] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  
  // Edit modal state
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    parent_organization_id: '',
    organization_type: 'client' as Organization['organization_type'],
    enforcement_workflow: 'admin_first' as Organization['enforcement_workflow'],
    contact_email: '',
    contact_phone: '',
    is_active: true,
  });

  // Load organizations
  const loadOrganizations = async () => {
    setIsLoading(true);
    try {
      console.log('📊 Loading organizations...');

      // Get all organizations
      const { data: orgs, error: orgsError } = await supabase
        .from('organizations')
        .select('*')
        .order('organization_level', { ascending: true })
        .order('name', { ascending: true });

      if (orgsError) throw orgsError;

      // Get user counts per org
      const { data: userCounts, error: usersError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('is_active', true);

      if (usersError) throw usersError;

      // Get zone counts per org
      const { data: zoneCounts, error: zonesError } = await supabase
        .from('zones')
        .select('organization_id')
        .eq('is_active', true);

      if (zonesError) throw zonesError;

      // Count users and zones per org
      const userCountMap = new Map<string, number>();
      const zoneCountMap = new Map<string, number>();

      (userCounts || []).forEach(u => {
        if (u.organization_id) {
          userCountMap.set(u.organization_id, (userCountMap.get(u.organization_id) || 0) + 1);
        }
      });

      (zoneCounts || []).forEach(z => {
        zoneCountMap.set(z.organization_id, (zoneCountMap.get(z.organization_id) || 0) + 1);
      });

      // Build hierarchical structure
      const orgMap = new Map<string, Organization>();
      (orgs || []).forEach(org => {
        orgMap.set(org.id, {
          ...org,
          user_count: userCountMap.get(org.id) || 0,
          zone_count: zoneCountMap.get(org.id) || 0,
          children: [],
        });
      });

      // Build tree
      const roots: Organization[] = [];
      orgMap.forEach(org => {
        if (org.parent_organization_id && orgMap.has(org.parent_organization_id)) {
          const parent = orgMap.get(org.parent_organization_id)!;
          parent.children!.push(org);
        } else {
          roots.push(org);
        }
      });

      setOrganizations(roots);
      console.log(`✅ Loaded ${orgs?.length || 0} organizations`);

    } catch (error: any) {
      console.error('Failed to load organizations:', error);
      toast.error('Failed to load organizations');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isMaster) {
      loadOrganizations();
    }
  }, [isMaster]);

  const toggleExpand = (orgId: string) => {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  };

  const handleCreate = () => {
    setEditingOrg(null);
    setFormData({
      name: '',
      parent_organization_id: '',
      organization_type: 'client',
      enforcement_workflow: 'admin_first',
      contact_email: '',
      contact_phone: '',
      is_active: true,
    });
    setIsEditModalOpen(true);
  };

  const handleEdit = (org: Organization) => {
    setEditingOrg(org);
    setFormData({
      name: org.name,
      parent_organization_id: org.parent_organization_id || '',
      organization_type: org.organization_type,
      enforcement_workflow: org.enforcement_workflow,
      contact_email: org.contact_email || '',
      contact_phone: org.contact_phone || '',
      is_active: org.is_active,
    });
    setIsEditModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Organization name is required');
      return;
    }

    setIsSaving(true);
    try {
      if (editingOrg) {
        // Update existing
        const { error } = await supabase
          .from('organizations')
          .update({
            name: formData.name.trim(),
            parent_organization_id: formData.parent_organization_id || null,
            organization_type: formData.organization_type,
            enforcement_workflow: formData.enforcement_workflow,
            contact_email: formData.contact_email || null,
            contact_phone: formData.contact_phone || null,
            is_active: formData.is_active,
          })
          .eq('id', editingOrg.id);

        if (error) throw error;
        toast.success('Organization updated successfully');
      } else {
        // Create new
        const { error } = await supabase
          .from('organizations')
          .insert({
            name: formData.name.trim(),
            parent_organization_id: formData.parent_organization_id || null,
            organization_type: formData.organization_type,
            enforcement_workflow: formData.enforcement_workflow,
            contact_email: formData.contact_email || null,
            contact_phone: formData.contact_phone || null,
            is_active: formData.is_active,
          });

        if (error) throw error;
        toast.success('Organization created successfully');
      }

      setIsEditModalOpen(false);
      loadOrganizations();
    } catch (error: any) {
      console.error('Failed to save organization:', error);
      toast.error(error.message || 'Failed to save organization');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (org: Organization) => {
    if (org.children && org.children.length > 0) {
      toast.error('Cannot delete organization with child organizations');
      return;
    }

    if ((org.user_count || 0) > 0) {
      toast.error(`Cannot delete organization with ${org.user_count} active users`);
      return;
    }

    if ((org.zone_count || 0) > 0) {
      toast.error(`Cannot delete organization with ${org.zone_count} active zones`);
      return;
    }

    if (!confirm(`Are you sure you want to delete "${org.name}"?`)) {
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
      toast.error(error.message || 'Failed to delete organization');
    }
  };

  const renderOrgTree = (org: Organization, depth: number = 0) => {
    const hasChildren = org.children && org.children.length > 0;
    const isExpanded = expandedOrgs.has(org.id);

    return (
      <div key={org.id} style={{ marginLeft: `${depth * 24}px` }}>
        <Card className={`mb-2 ${!org.is_active ? 'opacity-50' : ''}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                {hasChildren && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpand(org.id)}
                    className="h-6 w-6 p-0"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                )}
                {!hasChildren && <div className="w-6" />}

                <Building2 className="h-5 w-5 text-primary" />

                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold">{org.name}</h4>
                    <Badge variant="outline" className="text-xs">
                      Level {org.organization_level}
                    </Badge>
                    <Badge variant="outline" className="text-xs capitalize">
                      {org.organization_type.replace('_', ' ')}
                    </Badge>
                    {!org.is_active && (
                      <Badge variant="destructive" className="text-xs">
                        Inactive
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {org.user_count || 0} users
                    </div>
                    <div className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {org.zone_count || 0} zones
                    </div>
                    <div className="flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      {org.enforcement_workflow === 'admin_first' ? 'Admin First' : 'Officer First'}
                    </div>
                  </div>

                  {org.contact_email && (
                    <div className="text-xs text-muted-foreground mt-1">
                      📧 {org.contact_email}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleEdit(org)}>
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(org)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {hasChildren && isExpanded && (
          <div className="mt-2">
            {org.children!.map(child => renderOrgTree(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!isMaster) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h3 className="text-xl font-bold mb-2">Master Access Required</h3>
          <p className="text-muted-foreground">
            Only master users can manage organizations
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Building2 className="h-8 w-8 text-primary" />
            Organization Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage organization hierarchy and enforcement workflows
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadOrganizations} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Organization
          </Button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Building2 className="h-8 w-8 text-primary" />
              <div>
                <div className="text-2xl font-bold">{organizations.length}</div>
                <div className="text-sm text-muted-foreground">Root Organizations</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-300 bg-green-50 dark:bg-green-950/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-green-600" />
              <div>
                <div className="text-sm text-muted-foreground">Enforcement Workflows</div>
                <div className="text-xs text-green-700 dark:text-green-400 font-medium mt-1">
                  Configured per organization
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-blue-600" />
              <div>
                <div className="text-sm text-muted-foreground">Hierarchical Structure</div>
                <div className="text-xs text-blue-700 dark:text-blue-400 font-medium mt-1">
                  Auto-calculated levels
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Organization Tree */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      ) : organizations.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-bold mb-2">No Organizations</h3>
            <p className="text-muted-foreground mb-4">
              Create your first organization to get started
            </p>
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create Organization
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div>
          {organizations.map(org => renderOrgTree(org))}
        </div>
      )}

      {/* Edit Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingOrg ? 'Edit Organization' : 'Create Organization'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Organization Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., First Security NZ"
              />
            </div>

            <div className="space-y-2">
              <Label>Parent Organization</Label>
              <Select
                value={formData.parent_organization_id}
                onValueChange={(value) => setFormData({ ...formData, parent_organization_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None (Root Organization)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None (Root Organization)</SelectItem>
                  {/* Flatten all orgs for parent selection */}
                  {(() => {
                    const flatOrgs: Organization[] = [];
                    const flatten = (orgs: Organization[]) => {
                      orgs.forEach(org => {
                        if (!editingOrg || org.id !== editingOrg.id) {
                          flatOrgs.push(org);
                        }
                        if (org.children) flatten(org.children);
                      });
                    };
                    flatten(organizations);
                    return flatOrgs.map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {'  '.repeat(org.organization_level - 1)}
                        {org.name} (Level {org.organization_level})
                      </SelectItem>
                    ));
                  })()}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Organization Type</Label>
                <Select
                  value={formData.organization_type}
                  onValueChange={(value: any) => setFormData({ ...formData, organization_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="security_company">Security Company</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                  </SelectContent>
                </Select>
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
                    <SelectItem value="admin_first">Admin First (Approval Required)</SelectItem>
                    <SelectItem value="officer_first">Officer First (Direct Action)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
                value={formData.contact_phone}
                onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                placeholder="+64 21 123 4567"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="h-4 w-4"
              />
              <Label htmlFor="is_active">Active Organization</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingOrg ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
