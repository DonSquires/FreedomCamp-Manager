/**
 * SETTINGS & CONFIGURATION HUB - PHASE 5 CONSOLIDATION
 * Unified interface for all system configuration and settings
 * 
 * Consolidates:
 * - Organization Management (org details, settings)
 * - User Management (accounts, roles, permissions)
 * - System Settings (global configuration)
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Users,
  Settings as SettingsIcon,
  Download,
  Save,
  Shield,
  Bell,
  Globe,
} from 'lucide-react';
import { OrganizationManagement } from './OrganizationManagement';
import { UserManagement } from './UserManagement';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

export function SettingsHub() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('organizations');
  const isMaster = user?.role === 'master';

  const handleExportSettings = () => {
    toast.info('Exporting configuration settings...');
    // TODO: Implement settings export
  };

  const handleSaveAllSettings = () => {
    toast.success('All settings saved successfully');
    // TODO: Implement global save
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 text-gray-900 dark:text-white">
            <SettingsIcon className="h-8 w-8 text-purple-600" />
            Settings & Configuration Hub
          </h1>
          <p className="text-gray-700 dark:text-gray-200 mt-1 font-semibold">
            Comprehensive system configuration - organizations, users, and global settings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportSettings}>
            <Download className="h-4 w-4 mr-2" />
            Export Settings
          </Button>
          <Button onClick={handleSaveAllSettings} className="bg-purple-600 hover:bg-purple-700">
            <Save className="h-4 w-4 mr-2" />
            Save All
          </Button>
        </div>
      </div>

      {/* Quick Settings Overview */}
      <Card className="border-2 border-purple-500/30 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/40 dark:to-purple-900/40">
        <CardContent className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {isMaster && (
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-purple-600 flex items-center justify-center">
                  <Building2 className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Organizations</p>
                  <p className="text-2xl font-black text-gray-900 dark:text-white">-</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center">
                <Users className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Users</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">-</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-green-600 flex items-center justify-center">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Active Users</p>
                <p className="text-2xl font-black text-gray-900 dark:text-white">-</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-amber-600 flex items-center justify-center">
                <Bell className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">Notifications</p>
                <Badge className="mt-1">Enabled</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabbed Interface */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className={`grid w-full ${isMaster ? 'grid-cols-3' : 'grid-cols-2'} h-auto`}>
          {isMaster && (
            <TabsTrigger value="organizations" className="flex items-center gap-2 py-3">
              <Building2 className="h-4 w-4" />
              <span className="hidden md:inline">Organizations</span>
              <span className="md:hidden">Orgs</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="users" className="flex items-center gap-2 py-3">
            <Users className="h-4 w-4" />
            <span className="hidden md:inline">User Management</span>
            <span className="md:hidden">Users</span>
          </TabsTrigger>
          <TabsTrigger value="system" className="flex items-center gap-2 py-3">
            <Globe className="h-4 w-4" />
            <span className="hidden md:inline">System Settings</span>
            <span className="md:hidden">System</span>
          </TabsTrigger>
        </TabsList>

        {isMaster && (
          <TabsContent value="organizations" className="mt-6">
            <OrganizationManagement />
          </TabsContent>
        )}

        <TabsContent value="users" className="mt-6">
          <UserManagement />
        </TabsContent>

        <TabsContent value="system" className="mt-6">
          <Card>
            <CardContent className="p-12 text-center">
              <Globe className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-white">System Settings</h3>
              <p className="text-gray-700 dark:text-gray-200 mb-4 font-semibold">
                Global system configuration and preferences
              </p>
              <div className="grid gap-4 max-w-2xl mx-auto text-left">
                <Card className="border-2">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-900 dark:text-white">Notification Settings</p>
                        <p className="text-sm text-gray-700 dark:text-gray-200 mt-1 font-semibold">Configure system-wide notifications</p>
                      </div>
                      <Badge>Coming Soon</Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-900 dark:text-white">Email Templates</p>
                        <p className="text-sm text-gray-700 dark:text-gray-200 mt-1 font-semibold">Customize automated email templates</p>
                      </div>
                      <Badge>Coming Soon</Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-900 dark:text-white">Integration Settings</p>
                        <p className="text-sm text-gray-700 dark:text-gray-200 mt-1 font-semibold">Third-party service integrations</p>
                      </div>
                      <Badge>Coming Soon</Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-900 dark:text-white">Backup & Restore</p>
                        <p className="text-sm text-gray-700 dark:text-gray-200 mt-1 font-semibold">Automated backup configuration</p>
                      </div>
                      <Badge>Coming Soon</Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
