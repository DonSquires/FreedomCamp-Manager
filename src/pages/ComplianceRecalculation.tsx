/**
 * Compliance Recalculation - Batch processing with filters
 * Features:
 * - Organization/Zone selection
 * - Date range filtering
 * - 50-record batches
 * - Real-time progress tracking
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useOrganizations } from '@/hooks/useOrganizations';
import { useZones } from '@/hooks/useZones';
import { BatchOperationRunner } from '@/components/features/BatchOperationRunner';
import { AdminNavigationMenu } from '@/components/features/AdminNavigationMenu';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ComplianceRecalculation() {
  const { user } = useAuthStore();
  const isMaster = user?.role === 'master';

  // Filters
  const [selectedOrgId, setSelectedOrgId] = useState<string>(user?.organization_id || '');
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [readyToRun, setReadyToRun] = useState(false);

  // Data
  const { data: organizations } = useOrganizations();
  const { data: zones } = useZones(selectedOrgId);

  const handleZoneToggle = (zoneId: string) => {
    setSelectedZoneIds(prev => 
      prev.includes(zoneId) 
        ? prev.filter(id => id !== zoneId)
        : [...prev, zoneId]
    );
  };

  const selectAllZones = () => {
    if (zones) {
      setSelectedZoneIds(zones.map(z => z.id));
    }
  };

  const clearAllZones = () => {
    setSelectedZoneIds([]);
  };

  const validateAndProceed = () => {
    if (!selectedOrgId) {
      alert('Please select an organization');
      return;
    }

    setReadyToRun(true);
  };

  const resetFilters = () => {
    setReadyToRun(false);
    setSelectedZoneIds([]);
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <AdminNavigationMenu />

      <div className="container mx-auto p-6 max-w-7xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Compliance Recalculation</h1>
          <p className="text-muted-foreground">
            Recalculate compliance status for observations in batches of 50 records
          </p>
        </div>

        {!readyToRun ? (
          /* Configuration Panel */
          <Card className="p-6 space-y-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This tool recalculates compliance for existing observations based on current zone rules.
                Use this after changing compliance matrix settings or importing historical data.
              </AlertDescription>
            </Alert>

            {/* Organization Selection */}
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

            {/* Zone Selection */}
            {selectedOrgId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Zones ({selectedZoneIds.length} selected)</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={selectAllZones}
                      disabled={!zones || zones.length === 0}
                    >
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearAllZones}
                      disabled={selectedZoneIds.length === 0}
                    >
                      Clear All
                    </Button>
                  </div>
                </div>

                {zones && zones.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-4 border rounded-lg">
                    {zones.map(zone => (
                      <label
                        key={zone.id}
                        className={cn(
                          'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
                          selectedZoneIds.includes(zone.id)
                            ? 'bg-blue-50 border-blue-500 dark:bg-blue-950/30'
                            : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedZoneIds.includes(zone.id)}
                          onChange={() => handleZoneToggle(zone.id)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm font-medium">{zone.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-muted-foreground border rounded-lg">
                    No zones found for this organization
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Leave all zones unselected to process all zones in the organization
                </p>
              </div>
            )}

            {/* Date Range (Optional) */}
            <div className="space-y-2">
              <Label>Date Range (Optional)</Label>
              <div className="flex flex-col md:flex-row gap-4">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'justify-start text-left font-normal flex-1',
                        !dateFrom && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFrom ? format(dateFrom, 'PPP') : 'From date...'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={setDateFrom}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'justify-start text-left font-normal flex-1',
                        !dateTo && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateTo ? format(dateTo, 'PPP') : 'To date...'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dateTo}
                      onSelect={setDateTo}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <p className="text-xs text-muted-foreground">
                Leave dates empty to process all observations
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Configuration complete. Click Start to begin recalculation.
              </div>
              <Button onClick={validateAndProceed} size="lg">
                Start Recalculation
              </Button>
            </div>
          </Card>
        ) : (
          /* Operation Runner */
          <div className="space-y-6">
            <Button onClick={resetFilters} variant="outline">
              ← Back to Configuration
            </Button>

            <BatchOperationRunner
              operationType="recalculation"
              operationName="Compliance Recalculation"
              operationDescription="Recalculates compliance status for observations based on current zone rules and monthly stay limits"
              edgeFunctionName="recalculate-compliance-v2"
              organizationId={selectedOrgId}
              zoneIds={selectedZoneIds.length > 0 ? selectedZoneIds : undefined}
              dateRange={dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined}
              batchSize={50}
              onComplete={(stats) => {
                console.log('Recalculation complete:', stats);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
