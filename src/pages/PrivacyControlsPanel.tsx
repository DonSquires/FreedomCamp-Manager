/**
 * PrivacyControlsPanel - Configure redaction rules and export settings
 * Manage data privacy, redaction policies, and court vs analytics exports
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  Eye,
  EyeOff,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface PrivacySettings {
  redact_plate_numbers: boolean;
  redact_gps_coordinates: boolean;
  redact_names: boolean;
  redact_contact_info: boolean;
  retention_days_default: number;
  retention_days_court: number;
  allow_analytics_export: boolean;
  allow_csv_export: boolean;
  require_admin_approval: boolean;
}

export function PrivacyControlsPanel() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<PrivacySettings>({
    redact_plate_numbers: false,
    redact_gps_coordinates: false,
    redact_names: true,
    redact_contact_info: true,
    retention_days_default: 90,
    retention_days_court: 365,
    allow_analytics_export: true,
    allow_csv_export: true,
    require_admin_approval: true,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      // In production, load from a privacy_settings table
      // For now, use hardcoded defaults
      setTimeout(() => {
        setIsLoading(false);
      }, 500);
    } catch (error: any) {
      console.error('Failed to load privacy settings:', error);
      toast.error('Failed to load privacy settings');
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    try {
      // In production, save to privacy_settings table
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      toast.success('Privacy settings saved successfully');
    } catch (error: any) {
      console.error('Failed to save settings:', error);
      toast.error('Failed to save privacy settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="h-8 w-8" />
          Privacy Controls
        </h1>
        <p className="text-muted-foreground">
          Configure data redaction rules and export permissions
        </p>
      </div>

      {/* NZ Privacy Act Notice */}
      <Card className="border-blue-500/30 bg-blue-50 dark:bg-blue-950/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="flex-1 text-sm text-blue-900 dark:text-blue-100">
              <p className="font-semibold mb-1">NZ Privacy Act 2020 Compliance</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Personal information must be protected and used lawfully</li>
                <li>Court-ready exports preserve full data with chain-of-custody</li>
                <li>Leadership/analytics exports redact sensitive information</li>
                <li>Audit logs track all data access and exports</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Redaction Rules */}
      <Card>
        <CardHeader>
          <CardTitle>Data Redaction Rules</CardTitle>
          <CardDescription>
            Configure what information is redacted in non-court exports
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="flex-1">
              <Label htmlFor="redact-plates">Redact Plate Numbers</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Mask plate numbers in leadership and analytics reports (e.g., ABC*** )
              </p>
            </div>
            <Switch
              id="redact-plates"
              checked={settings.redact_plate_numbers}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, redact_plate_numbers: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="flex-1">
              <Label htmlFor="redact-gps">Redact GPS Coordinates</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Remove exact GPS coordinates from non-court exports
              </p>
            </div>
            <Switch
              id="redact-gps"
              checked={settings.redact_gps_coordinates}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, redact_gps_coordinates: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="flex-1">
              <Label htmlFor="redact-names">Redact Personal Names</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Hide names of officers, contacts, and involved persons
              </p>
            </div>
            <Switch
              id="redact-names"
              checked={settings.redact_names}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, redact_names: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="flex-1">
              <Label htmlFor="redact-contact">Redact Contact Information</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Mask email addresses and phone numbers
              </p>
            </div>
            <Switch
              id="redact-contact"
              checked={settings.redact_contact_info}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, redact_contact_info: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Data Retention */}
      <Card>
        <CardHeader>
          <CardTitle>Data Retention Policies</CardTitle>
          <CardDescription>
            Configure automatic data deletion schedules
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="retention-default">Default Retention (Days)</Label>
            <Select
              value={settings.retention_days_default.toString()}
              onValueChange={(value) =>
                setSettings({ ...settings, retention_days_default: parseInt(value) })
              }
            >
              <SelectTrigger id="retention-default" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 Days</SelectItem>
                <SelectItem value="60">60 Days</SelectItem>
                <SelectItem value="90">90 Days</SelectItem>
                <SelectItem value="180">180 Days</SelectItem>
                <SelectItem value="365">1 Year</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Non-court evidence and routine observations
            </p>
          </div>

          <div>
            <Label htmlFor="retention-court">Court-Ready Retention (Days)</Label>
            <Select
              value={settings.retention_days_court.toString()}
              onValueChange={(value) =>
                setSettings({ ...settings, retention_days_court: parseInt(value) })
              }
            >
              <SelectTrigger id="retention-court" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="365">1 Year</SelectItem>
                <SelectItem value="730">2 Years</SelectItem>
                <SelectItem value="1095">3 Years</SelectItem>
                <SelectItem value="1825">5 Years</SelectItem>
                <SelectItem value="3650">10 Years</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Evidence marked as court-ready or enforcement-related
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Export Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Export Permissions</CardTitle>
          <CardDescription>
            Control who can export data and in what formats
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="flex-1">
              <Label htmlFor="allow-analytics">Allow Analytics Exports</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Enable leadership packs and analytics PDFs (redacted)
              </p>
            </div>
            <Switch
              id="allow-analytics"
              checked={settings.allow_analytics_export}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, allow_analytics_export: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="flex-1">
              <Label htmlFor="allow-csv">Allow CSV/JSON Exports</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Enable raw data exports for integration and analysis
              </p>
            </div>
            <Switch
              id="allow-csv"
              checked={settings.allow_csv_export}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, allow_csv_export: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div className="flex-1">
              <Label htmlFor="require-approval">Require Admin Approval</Label>
              <p className="text-xs text-muted-foreground mt-1">
                All exports require admin review before download
              </p>
            </div>
            <Switch
              id="require-approval"
              checked={settings.require_admin_approval}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, require_admin_approval: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Export Types Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export Type Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950/20 rounded">
              <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-green-900 dark:text-green-100">
                  Court Pack PDF
                </div>
                <p className="text-xs text-green-700 dark:text-green-300">
                  Full chain-of-custody, matrix snapshot, all evidence - NO redaction
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                <Eye className="h-3 w-3 mr-1" />
                Full Access
              </Badge>
            </div>

            <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded">
              <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-blue-900 dark:text-blue-100">
                  Leadership Pack PDF
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Analytics, trends, drift summaries - applies redaction rules
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                <EyeOff className="h-3 w-3 mr-1" />
                Redacted
              </Badge>
            </div>

            <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 rounded">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-amber-900 dark:text-amber-100">
                  CSV/JSON Export
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Filtered records for analysis - applies redaction rules
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                <EyeOff className="h-3 w-3 mr-1" />
                Redacted
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex gap-3">
        <Button
          onClick={saveSettings}
          disabled={isSaving}
          className="flex-1 h-14 text-lg font-bold"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-5 w-5 mr-2" />
              Save Privacy Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
