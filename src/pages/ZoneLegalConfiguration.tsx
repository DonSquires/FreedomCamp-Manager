/**
 * Zone Legal Configuration - Configure legal details for Notice to Vacate generation
 * Admin only - set up organization details, land acts, and authorized signatories
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FileText,
  Shield,
  Plus,
  Edit,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  User,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface ZoneLegalConfig {
  id: string;
  zone_id: string;
  organization_id: string;
  org_office_name: string;
  org_building: string | null;
  org_street_address: string;
  org_po_box: string | null;
  org_city: string;
  org_postcode: string;
  org_country: string;
  org_phone: string | null;
  org_fax: string | null;
  org_email: string | null;
  org_website: string | null;
  legal_description: string;
  land_act: string;
  land_owner: string;
  managing_authority: string | null;
  max_stay_nights: number;
  max_consecutive_nights: number;
  self_contained_required: boolean;
  breach_template: string;
  enforcement_type: string;
  enforcement_authority: string | null;
  trespass_duration_years: number | null;
  fine_amount: number | null;
  vacate_hours: number;
  authorized_signatories: any[];
  zones?: { name: string };
}

export function ZoneLegalConfiguration() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'master';

  const [zones, setZones] = useState<any[]>([]);
  const [configs, setConfigs] = useState<ZoneLegalConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ZoneLegalConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    zone_id: '',
    org_office_name: '',
    org_building: '',
    org_street_address: '',
    org_po_box: '',
    org_city: '',
    org_postcode: '',
    org_country: 'New Zealand',
    org_phone: '',
    org_fax: '',
    org_email: '',
    org_website: '',
    legal_description: '',
    land_act: 'Land Act 1948',
    land_owner: '',
    managing_authority: '',
    max_stay_nights: 3,
    max_consecutive_nights: 3,
    self_contained_required: true,
    breach_template: '',
    enforcement_type: 'trespass',
    enforcement_authority: 'the Police',
    trespass_duration_years: 2,
    fine_amount: 200,
    vacate_hours: 4,
  });

  const [signatories, setSignatories] = useState<any[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);

  useEffect(() => {
    if (isAdmin) {
      loadZones();
      loadConfigs();
      loadAdminUsers();
    }
  }, [isAdmin]);

  const loadZones = async () => {
    try {
      let query = supabase
        .from('zones')
        .select('id, name, organization_id')
        .eq('is_active', true)
        .order('name');

      if (user?.role !== 'master') {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        if (profile?.organization_id) {
          query = query.eq('organization_id', profile.organization_id);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      setZones(data || []);
    } catch (error: any) {
      console.error('Failed to load zones:', error);
      toast.error('Failed to load zones');
    }
  };

  const loadConfigs = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('zone_legal_config')
        .select('*, zones(name)')
        .order('created_at', { ascending: false });

      if (user?.role !== 'master') {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        if (profile?.organization_id) {
          query = query.eq('organization_id', profile.organization_id);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      setConfigs(data || []);
    } catch (error: any) {
      console.error('Failed to load configs:', error);
      toast.error('Failed to load configurations');
    } finally {
      setIsLoading(false);
    }
  };

  const loadAdminUsers = async () => {
    try {
      let query = supabase
        .from('user_profiles')
        .select('id, first_name, last_name, email, role')
        .in('role', ['admin', 'master'])
        .order('first_name');

      if (user?.role !== 'master') {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        if (profile?.organization_id) {
          query = query.eq('organization_id', profile.organization_id);
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      setAdminUsers(data || []);
    } catch (error: any) {
      console.error('Failed to load admin users:', error);
    }
  };

  const handleEdit = (config: ZoneLegalConfig) => {
    setEditingConfig(config);
    setFormData({
      zone_id: config.zone_id,
      org_office_name: config.org_office_name,
      org_building: config.org_building || '',
      org_street_address: config.org_street_address,
      org_po_box: config.org_po_box || '',
      org_city: config.org_city,
      org_postcode: config.org_postcode,
      org_country: config.org_country,
      org_phone: config.org_phone || '',
      org_fax: config.org_fax || '',
      org_email: config.org_email || '',
      org_website: config.org_website || '',
      legal_description: config.legal_description,
      land_act: config.land_act,
      land_owner: config.land_owner,
      managing_authority: config.managing_authority || '',
      max_stay_nights: config.max_stay_nights,
      max_consecutive_nights: config.max_consecutive_nights,
      self_contained_required: config.self_contained_required,
      breach_template: config.breach_template,
      enforcement_type: config.enforcement_type,
      enforcement_authority: config.enforcement_authority || '',
      trespass_duration_years: config.trespass_duration_years || 2,
      fine_amount: config.fine_amount || 200,
      vacate_hours: config.vacate_hours,
    });
    setSignatories(config.authorized_signatories || []);
    setShowDialog(true);
  };

  const handleCreateNew = () => {
    setEditingConfig(null);
    setFormData({
      zone_id: '',
      org_office_name: '',
      org_building: '',
      org_street_address: '',
      org_po_box: '',
      org_city: '',
      org_postcode: '',
      org_country: 'New Zealand',
      org_phone: '',
      org_fax: '',
      org_email: '',
      org_website: '',
      legal_description: '',
      land_act: 'Land Act 1948',
      land_owner: '',
      managing_authority: '',
      max_stay_nights: 3,
      max_consecutive_nights: 3,
      self_contained_required: true,
      breach_template: '',
      enforcement_type: 'trespass',
      enforcement_authority: 'the Police',
      trespass_duration_years: 2,
      fine_amount: 200,
      vacate_hours: 4,
    });
    setSignatories([]);
    setShowDialog(true);
  };

  const handleAddSignatory = () => {
    setSignatories(prev => [...prev, {
      user_id: '',
      name: '',
      title: '',
      signature_url: '',
    }]);
  };

  const handleSave = async () => {
    if (!formData.zone_id || !formData.legal_description || !formData.land_owner) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (signatories.length === 0 || !signatories[0].user_id) {
      toast.error('At least one authorized signatory is required');
      return;
    }

    setIsSaving(true);

    try {
      const zone = zones.find(z => z.id === formData.zone_id);
      if (!zone) throw new Error('Zone not found');

      const configData = {
        ...formData,
        organization_id: zone.organization_id,
        authorized_signatories: signatories,
      };

      if (editingConfig) {
        const { error } = await supabase
          .from('zone_legal_config')
          .update(configData)
          .eq('id', editingConfig.id);

        if (error) throw error;
        toast.success('Legal configuration updated');
      } else {
        const { error } = await supabase
          .from('zone_legal_config')
          .insert(configData);

        if (error) throw error;
        toast.success('Legal configuration created');
      }

      setShowDialog(false);
      loadConfigs();
    } catch (error: any) {
      console.error('Failed to save config:', error);
      toast.error('Failed to save configuration: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <Shield className="h-16 w-16 mx-auto mb-4 text-gray-400 opacity-20" />
          <p className="text-gray-500">Admin access required</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
            <FileText className="h-8 w-8 text-blue-600" />
            Zone Legal Configuration
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Configure legal details for Notice to Vacate generation
          </p>
        </div>
        <Button onClick={handleCreateNew} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-2" />
          Add Configuration
        </Button>
      </div>

      {/* Configs List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : configs.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="h-16 w-16 mx-auto mb-4 text-gray-400 opacity-20" />
            <p className="text-gray-500">No legal configurations found</p>
            <p className="text-sm text-gray-400 mt-2">Create your first configuration to enable Notice to Vacate generation</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {configs.map(config => (
            <Card key={config.id} className="border-2 hover:border-blue-500 transition-colors">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                        {(config.zones as any)?.name}
                      </h3>
                      {config.authorized_signatories && config.authorized_signatories.length > 0 && (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm mt-4">
                      <div>
                        <p className="text-gray-600 dark:text-gray-300">Land Owner:</p>
                        <p className="font-semibold text-gray-900 dark:text-white">{config.land_owner}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 dark:text-gray-300">Land Act:</p>
                        <p className="font-semibold text-gray-900 dark:text-white">{config.land_act}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 dark:text-gray-300">Enforcement:</p>
                        <p className="font-semibold text-gray-900 dark:text-white capitalize">{config.enforcement_type}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 dark:text-gray-300">Authorized Signatories:</p>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {config.authorized_signatories?.length || 0}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(config)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Configuration Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingConfig ? 'Edit Legal Configuration' : 'Create Legal Configuration'}
            </DialogTitle>
            <DialogDescription>
              Configure organization details, land acts, and authorized signatories for Notice to Vacate generation
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Zone Selection */}
            <div>
              <Label htmlFor="zone">Zone <span className="text-red-500">*</span></Label>
              <Select
                value={formData.zone_id}
                onValueChange={(v) => setFormData(prev => ({ ...prev, zone_id: v }))}
                disabled={!!editingConfig}
              >
                <SelectTrigger id="zone" className="mt-1">
                  <SelectValue placeholder="Select zone" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map(zone => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Organization Details - Collapsed for brevity, add all fields similar to form */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Office Name <span className="text-red-500">*</span></Label>
                <Input
                  value={formData.org_office_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, org_office_name: e.target.value }))}
                  placeholder="e.g., Wellington Office"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>City <span className="text-red-500">*</span></Label>
                <Input
                  value={formData.org_city}
                  onChange={(e) => setFormData(prev => ({ ...prev, org_city: e.target.value }))}
                  placeholder="e.g., Wellington"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Legal Details */}
            <div>
              <Label>Legal Land Description <span className="text-red-500">*</span></Label>
              <Textarea
                value={formData.legal_description}
                onChange={(e) => setFormData(prev => ({ ...prev, legal_description: e.target.value }))}
                placeholder="e.g., Section 1, Parts Section 2 & Sections 3 - 11 SO 23940..."
                className="mt-1"
                rows={3}
              />
            </div>

            {/* Authorized Signatories */}
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Authorized Signatories <span className="text-red-500">*</span></Label>
                <Button type="button" variant="outline" size="sm" onClick={handleAddSignatory}>
                  <User className="h-4 w-4 mr-2" />
                  Add Signatory
                </Button>
              </div>

              {signatories.map((sig, index) => (
                <div key={index} className="grid grid-cols-2 gap-3 p-3 bg-white dark:bg-gray-900 rounded border">
                  <Select
                    value={sig.user_id}
                    onValueChange={(v) => {
                      const admin = adminUsers.find(a => a.id === v);
                      if (admin) {
                        const newSigs = [...signatories];
                        newSigs[index] = {
                          ...sig,
                          user_id: v,
                          name: `${admin.first_name} ${admin.last_name}`,
                        };
                        setSignatories(newSigs);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select admin user" />
                    </SelectTrigger>
                    <SelectContent>
                      {adminUsers.map(admin => (
                        <SelectItem key={admin.id} value={admin.id}>
                          {admin.first_name} {admin.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    value={sig.title}
                    onChange={(e) => {
                      const newSigs = [...signatories];
                      newSigs[index].title = e.target.value;
                      setSignatories(newSigs);
                    }}
                    placeholder="Title (e.g., Leader, Land and Waterways)"
                  />
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Save Configuration
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
