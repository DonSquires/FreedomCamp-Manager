/**
 * Officer Welfare Settings Management
 * Admin interface to configure auto-logoff and welfare check parameters per officer
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Shield,
  Heart,
  Clock,
  Users,
  Loader2,
  Save,
  AlertTriangle,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface OfficerSettings {
  user_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  auto_logoff_enabled: boolean;
  welfare_check_enabled: boolean;
  inactivity_warning_time: number;
  auto_logoff_time: number;
  gps_inactivity_threshold: number;
  admin_escalation_time: number;
  critical_escalation_time: number;
  investigation_exception_enabled: boolean;
  gps_ping_interval: number;
}

export function OfficerWelfareManagement() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [officers, setOfficers] = useState<OfficerSettings[]>([]);
  const [selectedOfficer, setSelectedOfficer] = useState<OfficerSettings | null>(null);
  const [organizations, setOrganizations] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('all');

  useEffect(() => {
    if (isMaster) {
      loadOrganizations();
    }
    loadOfficers();
  }, [isMaster, selectedOrg]);

  const loadOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setOrganizations(data || []);
    } catch (error: any) {
      console.error('Failed to load organizations:', error);
      toast.error('Failed to load organizations');
    }
  };

  const loadOfficers = async () => {
    setIsLoading(true);
    try {
      // Step 1: Get officers
      let officersQuery = supabase
        .from('user_profiles')
        .select('id, first_name, last_name, phone, organization_id')
        .eq('role', 'officer')
        .eq('is_active', true)
        .order('first_name');

      if (!isMaster) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user?.id)
          .single();

        if (profile?.organization_id) {
          officersQuery = officersQuery.eq('organization_id', profile.organization_id);
        }
      } else if (selectedOrg !== 'all') {
        officersQuery = officersQuery.eq('organization_id', selectedOrg);
      }

      const { data: officersData, error: officersError } = await officersQuery;
      if (officersError) throw officersError;

      if (!officersData || officersData.length === 0) {
        setOfficers([]);
        setIsLoading(false);
        return;
      }

      // Step 2: Get welfare settings for all officers
      const { data: settingsData, error: settingsError } = await supabase
        .from('officer_welfare_settings')
        .select('*')
        .in('user_id', officersData.map(o => o.id));

      if (settingsError) throw settingsError;

      // Step 3: Merge data
      const formattedOfficers: OfficerSettings[] = officersData.map(officer => {
        const settings = settingsData?.find(s => s.user_id === officer.id);
        
        return {
          user_id: officer.id,
          first_name: officer.first_name,
          last_name: officer.last_name,
          phone: officer.phone,
          auto_logoff_enabled: settings?.auto_logoff_enabled ?? true,
          welfare_check_enabled: settings?.welfare_check_enabled ?? true,
          inactivity_warning_time: settings?.inactivity_warning_time ?? 10,
          auto_logoff_time: settings?.auto_logoff_time ?? 20,
          gps_inactivity_threshold: settings?.gps_inactivity_threshold ?? 10,
          admin_escalation_time: settings?.admin_escalation_time ?? 5,
          critical_escalation_time: settings?.critical_escalation_time ?? 5,
          investigation_exception_enabled: settings?.investigation_exception_enabled ?? true,
          gps_ping_interval: settings?.gps_ping_interval ?? 30,
        };
      });

      setOfficers(formattedOfficers);
      
      if (formattedOfficers.length > 0 && !selectedOfficer) {
        setSelectedOfficer(formattedOfficers[0]);
      }

    } catch (error: any) {
      console.error('Failed to load officers:', error);
      toast.error('Failed to load officer settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!selectedOfficer) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('officer_welfare_settings')
        .upsert({
          user_id: selectedOfficer.user_id,
          organization_id: user?.organization_id,
          auto_logoff_enabled: selectedOfficer.auto_logoff_enabled,
          welfare_check_enabled: selectedOfficer.welfare_check_enabled,
          inactivity_warning_time: selectedOfficer.inactivity_warning_time,
          auto_logoff_time: selectedOfficer.auto_logoff_time,
          gps_inactivity_threshold: selectedOfficer.gps_inactivity_threshold,
          admin_escalation_time: selectedOfficer.admin_escalation_time,
          critical_escalation_time: selectedOfficer.critical_escalation_time,
          investigation_exception_enabled: selectedOfficer.investigation_exception_enabled,
          gps_ping_interval: selectedOfficer.gps_ping_interval,
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      toast.success('Welfare settings saved successfully');
      
      // Reload officers
      await loadOfficers();

    } catch (error: any) {
      console.error('Failed to save settings:', error);
      toast.error('Failed to save settings: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
          <Heart className="h-8 w-8 text-red-600" />
          Officer Welfare Management
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mt-1">
          Configure auto-logoff and welfare check settings for field officers
        </p>
      </div>

      {/* Organization Filter for Masters */}
      {isMaster && (
        <Card className="border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <Label className="text-base font-semibold min-w-[120px]">Organisation:</Label>
              <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Organisations</SelectItem>
                  {organizations.map(org => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Officer List */}
          <Card className="lg:col-span-1 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900">
            <CardHeader className="bg-gray-100 dark:bg-gray-800 border-b-2 border-gray-300 dark:border-gray-600">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Officers ({officers.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2 max-h-[600px] overflow-y-auto">
              {officers.map(officer => (
                <button
                  key={officer.user_id}
                  onClick={() => setSelectedOfficer(officer)}
                  className={`w-full p-3 rounded-lg border-2 text-left transition-colors ${
                    selectedOfficer?.user_id === officer.user_id
                      ? 'border-blue-500 bg-blue-100 dark:bg-blue-900/50'
                      : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-400 dark:hover:border-blue-500'
                  }`}
                >
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {officer.first_name} {officer.last_name}
                  </div>
                  {officer.phone && (
                    <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                      📞 {officer.phone}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    {officer.auto_logoff_enabled && (
                      <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950">
                        Auto-Logoff
                      </Badge>
                    )}
                    {officer.welfare_check_enabled && (
                      <Badge variant="outline" className="text-xs bg-blue-50 dark:bg-blue-950">
                        Welfare Check
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
              {officers.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No officers found</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Settings Panel */}
          {selectedOfficer && (
            <Card className="lg:col-span-2 border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900">
              <CardHeader className="bg-gray-100 dark:bg-gray-800 border-b-2 border-gray-300 dark:border-gray-600">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Settings for {selectedOfficer.first_name} {selectedOfficer.last_name}
                </CardTitle>
                <CardDescription>
                  Configure welfare monitoring and auto-logoff parameters
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-8">
                {/* Auto-Logoff Settings */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-amber-100 dark:bg-amber-900/50 rounded-lg border-2 border-amber-300 dark:border-amber-700">
                    <div className="flex items-center gap-3">
                      <Clock className="h-6 w-6 text-amber-600" />
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">Auto-Logoff System</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          Automatic logout based on vehicle scan inactivity
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={selectedOfficer.auto_logoff_enabled}
                      onCheckedChange={(checked) =>
                        setSelectedOfficer({ ...selectedOfficer, auto_logoff_enabled: checked })
                      }
                    />
                  </div>

                  {selectedOfficer.auto_logoff_enabled && (
                    <div className="ml-8 space-y-4">
                      <div>
                        <Label htmlFor="warning_time">
                          Inactivity Warning Time (minutes)
                        </Label>
                        <Input
                          id="warning_time"
                          type="number"
                          min="1"
                          max="60"
                          value={selectedOfficer.inactivity_warning_time}
                          onChange={(e) =>
                            setSelectedOfficer({
                              ...selectedOfficer,
                              inactivity_warning_time: parseInt(e.target.value),
                            })
                          }
                          className="mt-1 max-w-xs"
                        />
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          Send warning when no vehicle scans for this duration
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="logoff_time">
                          Auto-Logoff Time (minutes)
                        </Label>
                        <Input
                          id="logoff_time"
                          type="number"
                          min="1"
                          max="120"
                          value={selectedOfficer.auto_logoff_time}
                          onChange={(e) =>
                            setSelectedOfficer({
                              ...selectedOfficer,
                              auto_logoff_time: parseInt(e.target.value),
                            })
                          }
                          className="mt-1 max-w-xs"
                        />
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          Automatically log off when no vehicle scans for this duration
                        </p>
                      </div>

                      <div className="flex items-center gap-2 p-3 bg-blue-100 dark:bg-blue-900/50 rounded-lg border-2 border-blue-300 dark:border-blue-700">
                        <Shield className="h-4 w-4 text-blue-600" />
                        <div className="flex-1">
                          <Label htmlFor="investigation_exception" className="text-sm font-medium">
                            Skip if conducting investigation
                          </Label>
                        </div>
                        <Switch
                          id="investigation_exception"
                          checked={selectedOfficer.investigation_exception_enabled}
                          onCheckedChange={(checked) =>
                            setSelectedOfficer({
                              ...selectedOfficer,
                              investigation_exception_enabled: checked,
                            })
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Welfare Check Settings */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-red-100 dark:bg-red-900/50 rounded-lg border-2 border-red-300 dark:border-red-700">
                    <div className="flex items-center gap-3">
                      <Heart className="h-6 w-6 text-red-600" />
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">Welfare Check System</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          GPS-based inactivity monitoring and escalation
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={selectedOfficer.welfare_check_enabled}
                      onCheckedChange={(checked) =>
                        setSelectedOfficer({ ...selectedOfficer, welfare_check_enabled: checked })
                      }
                    />
                  </div>

                  {selectedOfficer.welfare_check_enabled && (
                    <div className="ml-8 space-y-4">
                      <div>
                        <Label htmlFor="gps_threshold">
                          GPS Inactivity Threshold (minutes)
                        </Label>
                        <Input
                          id="gps_threshold"
                          type="number"
                          min="1"
                          max="60"
                          value={selectedOfficer.gps_inactivity_threshold}
                          onChange={(e) =>
                            setSelectedOfficer({
                              ...selectedOfficer,
                              gps_inactivity_threshold: parseInt(e.target.value),
                            })
                          }
                          className="mt-1 max-w-xs"
                        />
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          Initial welfare check when GPS hasn't moved for this duration
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="admin_escalation">
                          Admin Escalation Time (minutes)
                        </Label>
                        <Input
                          id="admin_escalation"
                          type="number"
                          min="1"
                          max="30"
                          value={selectedOfficer.admin_escalation_time}
                          onChange={(e) =>
                            setSelectedOfficer({
                              ...selectedOfficer,
                              admin_escalation_time: parseInt(e.target.value),
                            })
                          }
                          className="mt-1 max-w-xs"
                        />
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          Escalate to HIGH PRIORITY if no response after this duration
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="critical_escalation">
                          Critical Escalation Time (minutes)
                        </Label>
                        <Input
                          id="critical_escalation"
                          type="number"
                          min="1"
                          max="30"
                          value={selectedOfficer.critical_escalation_time}
                          onChange={(e) =>
                            setSelectedOfficer({
                              ...selectedOfficer,
                              critical_escalation_time: parseInt(e.target.value),
                            })
                          }
                          className="mt-1 max-w-xs"
                        />
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          Escalate to CRITICAL PRIORITY after additional duration
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="gps_ping_interval">
                          GPS Ping Interval (seconds)
                        </Label>
                        <Input
                          id="gps_ping_interval"
                          type="number"
                          min="10"
                          max="300"
                          value={(selectedOfficer as any).gps_ping_interval || 30}
                          onChange={(e) =>
                            setSelectedOfficer({
                              ...selectedOfficer,
                              gps_ping_interval: parseInt(e.target.value),
                            } as any)
                          }
                          className="mt-1 max-w-xs"
                        />
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          How often the officer's device sends GPS location updates (10-300 seconds)
                        </p>
                      </div>

                      <div className="p-4 bg-amber-100 dark:bg-amber-900/50 rounded-lg border-2 border-amber-300 dark:border-amber-700">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                          <div className="text-sm text-gray-700 dark:text-gray-300">
                            <p className="font-semibold mb-1">Escalation Timeline:</p>
                            <ul className="space-y-1 list-disc list-inside">
                              <li>@ {selectedOfficer.gps_inactivity_threshold}min: Initial welfare check sent to officer</li>
                              <li>@ {selectedOfficer.gps_inactivity_threshold + selectedOfficer.admin_escalation_time}min: HIGH PRIORITY - Admin team notified</li>
                              <li>@ {selectedOfficer.gps_inactivity_threshold + selectedOfficer.admin_escalation_time + selectedOfficer.critical_escalation_time}min: CRITICAL PRIORITY - Masters notified with GPS location</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Save Button */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  <Button
                    onClick={handleSaveSettings}
                    disabled={isSaving}
                    className="bg-blue-600 hover:bg-blue-700 min-w-[200px]"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
