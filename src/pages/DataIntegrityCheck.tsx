/**
 * Data Integrity Check - Verify and fix data consistency issues
 * Features:
 * - Organization/Zone selection
 * - Multiple integrity checks
 * - Batch processing (50 records)
 * - Detailed issue reporting
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useOrganizations } from '@/hooks/useOrganizations';
import { BatchOperationRunner } from '@/components/features/BatchOperationRunner';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface IntegrityCheck {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export default function DataIntegrityCheck() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [selectedOrgId, setSelectedOrgId] = useState<string>(user?.organization_id || '');
  const [readyToRun, setReadyToRun] = useState(false);
  const [checks, setChecks] = useState<IntegrityCheck[]>([
    {
      id: 'missing_photos',
      name: 'Missing Photos',
      description: 'Check for observations without photo evidence',
      enabled: true,
    },
    {
      id: 'orphaned_records',
      name: 'Orphaned Records',
      description: 'Find records referencing non-existent zones or vehicles',
      enabled: true,
    },
    {
      id: 'duplicate_observations',
      name: 'Duplicate Observations',
      description: 'Identify duplicate observations based on idempotency keys',
      enabled: true,
    },
    {
      id: 'invalid_gps',
      name: 'Invalid GPS Coordinates',
      description: 'Check for observations with missing or out-of-range GPS data',
      enabled: true,
    },
    {
      id: 'compliance_mismatch',
      name: 'Compliance Mismatches',
      description: 'Verify compliance_results match observation status',
      enabled: true,
    },
    {
      id: 'breach_alert_sync',
      name: 'Breach Alert Sync',
      description: 'Ensure breach_alerts exist for all non-compliant observations',
      enabled: true,
    },
  ]);

  const { data: organizations } = useOrganizations();

  const toggleCheck = (id: string) => {
    setChecks(prev =>
      prev.map(check =>
        check.id === id ? { ...check, enabled: !check.enabled } : check
      )
    );
  };

  const enableAll = () => {
    setChecks(prev => prev.map(check => ({ ...check, enabled: true })));
  };

  const disableAll = () => {
    setChecks(prev => prev.map(check => ({ ...check, enabled: false })));
  };

  const validateAndProceed = () => {
    if (!selectedOrgId) {
      alert('Please select an organization');
      return;
    }

    const enabledChecks = checks.filter(c => c.enabled);
    if (enabledChecks.length === 0) {
      alert('Please enable at least one integrity check');
      return;
    }

    setReadyToRun(true);
  };

  const resetFilters = () => {
    setReadyToRun(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <AdminNavigationMenu />

      <div className="container mx-auto p-6 max-w-7xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Data Integrity Check</h1>
          <p className="text-muted-foreground">
            Verify data consistency and fix integrity issues
          </p>
        </div>

        {!readyToRun ? (
          <Card className="p-6 space-y-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This tool performs comprehensive data integrity checks and can automatically fix common issues.
                Select which checks to run and review the results before applying fixes.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>Organization</Label>
              {isMaster ? (
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select organization..." />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations?.map(org => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="p-3 border rounded-lg bg-muted">
                  {organizations?.find(o => o.id === selectedOrgId)?.name || 'Current Organization'}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Integrity Checks ({checks.filter(c => c.enabled).length} enabled)</Label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={enableAll}>
                    Enable All
                  </Button>
                  <Button variant="outline" size="sm" onClick={disableAll}>
                    Disable All
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 border rounded-lg">
                {checks.map(check => (
                  <label
                    key={check.id}
                    className={cn(
                      'flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors',
                      check.enabled
                        ? 'bg-blue-50 border-blue-500 dark:bg-blue-950/30'
                        : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700'
                    )}
                  >
                    <Checkbox
                      checked={check.enabled}
                      onCheckedChange={() => toggleCheck(check.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium mb-1">{check.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {check.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Checks will be processed in batches of 50 records
              </div>
              <Button onClick={validateAndProceed} size="lg">
                Start Integrity Check
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            <Button onClick={resetFilters} variant="outline">
              ← Back to Configuration
            </Button>

            <BatchOperationRunner
              operationType="integrity_check"
              operationName="Data Integrity Check"
              operationDescription={`Running ${checks.filter(c => c.enabled).length} integrity checks`}
              edgeFunctionName="check-data-integrity"
              organizationId={selectedOrgId}
              batchSize={50}
              onComplete={(stats) => {
                console.log('Integrity check complete:', stats);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
