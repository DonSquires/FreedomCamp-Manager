/**
 * Zone Corrections - Fix observations with incorrect zone assignments
 * Features:
 * - Organization/Zone selection
 * - GPS-based zone verification
 * - Batch processing (50 records)
 * - Real-time progress tracking
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useOrganizations } from '@/hooks/useOrganizations';
import { BatchOperationRunner } from '@/components/features/BatchOperationRunner';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ZoneCorrections() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  const [selectedOrgId, setSelectedOrgId] = useState<string>(user?.organization_id || '');
  const [readyToRun, setReadyToRun] = useState(false);

  const { data: organizations } = useOrganizations();

  const validateAndProceed = () => {
    if (!selectedOrgId) {
      alert('Please select an organization');
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
          <h1 className="text-3xl font-bold mb-2">Zone Corrections</h1>
          <p className="text-muted-foreground">
            Verify and correct zone assignments based on GPS coordinates
          </p>
        </div>

        {!readyToRun ? (
          <Card className="p-6 space-y-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This tool checks all observations and corrects zone assignments based on GPS coordinates.
                Use this after creating new zones or importing historical data with approximate locations.
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

            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Zone corrections will be processed in batches of 50 records
              </div>
              <Button onClick={validateAndProceed} size="lg">
                Start Zone Corrections
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            <Button onClick={resetFilters} variant="outline">
              ← Back to Configuration
            </Button>

            <BatchOperationRunner
              operationType="zone_correction"
              operationName="Zone Corrections"
              operationDescription="Verifies and corrects zone assignments using GPS coordinates and zone boundaries"
              edgeFunctionName="zone-correction"
              organizationId={selectedOrgId}
              batchSize={50}
              onComplete={(stats) => {
                console.log('Zone corrections complete:', stats);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
