/**
 * Compliance Recalculation - Batch Processing (80 records at a time)
 * 
 * Simplified working version with batch processing:
 * - Select zones and date range
 * - Processes 80 records per batch to avoid timeouts
 * - Shows real-time progress
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Alert,
  AlertDescription,
} from '@/components/ui/alert';
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  MapPin,
  Activity,
} from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';

interface ProcessingStatus {
  isProcessing: boolean;
  currentBatch: number;
  totalBatches: number;
  currentStatus: string;
  processed: number;
  complianceChanged: number;
  breachAlertsCreated: number;
  errors: number;
  progressPercent: number;
}

export function ComplianceRecalculation() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<string>('last_30_days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Processing state
  const [status, setStatus] = useState<ProcessingStatus>({
    isProcessing: false,
    currentBatch: 0,
    totalBatches: 0,
    currentStatus: '',
    processed: 0,
    complianceChanged: 0,
    breachAlertsCreated: 0,
    errors: 0,
    progressPercent: 0,
  });

  // Fetch zones
  const { data: zones = [] } = useQuery({
    queryKey: ['zones_for_recalc', user?.organization_id],
    queryFn: async () => {
      let query = supabase
        .from('zones')
        .select('id, name, organization:organizations(name)')
        .eq('is_active', true)
        .order('name');

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch recent history
  const { data: recentActions } = useQuery({
    queryKey: ['recalculation_history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_recalculation_actions')
        .select(`
          *,
          performed_by_user:user_profiles!admin_recalculation_actions_performed_by_fkey(first_name, last_name)
        `)
        .order('performed_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  // Helper to extract error message
  const extractErrorMessage = async (error: any): Promise<string> => {
    let errorMessage = error.message || 'Unknown error';
    if (error instanceof FunctionsHttpError) {
      try {
        const textContent = await error.context.text();
        errorMessage = `[Code: ${error.context.status}] ${textContent || errorMessage}`;
      } catch {
        errorMessage = `[Code: ${error.context.status}] Failed to read error details`;
      }
    }
    return errorMessage;
  };

  // Run recalculation with batching
  const handleRunRecalculation = async () => {
    // Validation
    if (selectedZones.length === 0) {
      toast.error('Please select at least one zone');
      return;
    }
    if (datePreset === 'custom' && (!customStartDate || !customEndDate)) {
      toast.error('Please select custom date range');
      return;
    }

    // Build date range
    let dateRangeStart: string | undefined;
    let dateRangeEnd: string | undefined;

    if (datePreset !== 'all_time') {
      const today = new Date();
      dateRangeEnd = today.toISOString().split('T')[0];

      if (datePreset === 'last_7_days') {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        dateRangeStart = startDate.toISOString().split('T')[0];
      } else if (datePreset === 'last_30_days') {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        dateRangeStart = startDate.toISOString().split('T')[0];
      } else if (datePreset === 'last_90_days') {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        dateRangeStart = startDate.toISOString().split('T')[0];
      } else if (datePreset === 'custom') {
        dateRangeStart = customStartDate;
        dateRangeEnd = customEndDate;
      }
    }

    try {
      // Step 1: Get total count
      console.log('🔍 Getting total observation count...');
      
      const { data: totalData, error: totalError } = await supabase.functions.invoke('recalculate-compliance-v2', {
        body: { 
          scope: 'ZONE',
          zoneIds: selectedZones,
          dateRangeStart,
          dateRangeEnd,
          get_total: true 
        },
      });

      if (totalError) {
        const errorMessage = await extractErrorMessage(totalError);
        console.error('❌ Total count failed:', errorMessage);
        throw new Error(errorMessage);
      }

      const totalObservations = totalData?.total_observations || 0;
      const batchSize = 80;  // Process 80 records at a time
      const totalBatches = Math.ceil(totalObservations / batchSize);

      console.log(`📊 Found ${totalObservations} observations - will process in ${totalBatches} batches of ${batchSize}`);
      toast.info(`Starting recalculation: ${totalObservations.toLocaleString()} observations`);

      if (totalObservations === 0) {
        toast.warning('No observations found for selected zones and date range');
        return;
      }

      // Initialize status
      setStatus({
        isProcessing: true,
        currentBatch: 0,
        totalBatches,
        currentStatus: 'Starting...',
        processed: 0,
        complianceChanged: 0,
        breachAlertsCreated: 0,
        errors: 0,
        progressPercent: 0,
      });

      // Step 2: Process batches sequentially
      let offset = 0;
      let totalProcessed = 0;
      let totalComplianceChanged = 0;
      let totalBreachAlerts = 0;
      let totalErrors = 0;

      for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
        console.log(`📦 Processing batch ${batchNum}/${totalBatches} (offset: ${offset})`);

        // Update status - starting batch
        setStatus(prev => ({
          ...prev,
          currentBatch: batchNum,
          currentStatus: `Processing batch ${batchNum} of ${totalBatches}...`,
          progressPercent: Math.round((batchNum - 1) / totalBatches * 100),
        }));

        // Process this batch
        const { data: batchData, error: batchError } = await supabase.functions.invoke('recalculate-compliance-v2', {
          body: {
            scope: 'ZONE',
            zoneIds: selectedZones,
            dateRangeStart,
            dateRangeEnd,
            batch_size: batchSize,
            offset: offset,
          },
        });

        if (batchError) {
          const errorMessage = await extractErrorMessage(batchError);
          console.error(`❌ Batch ${batchNum} failed:`, errorMessage);
          totalErrors++;
          
          // Continue with next batch even if one fails
          offset += batchSize;
          continue;
        }

        // Update totals
        const summary = batchData?.summary || {};
        totalProcessed += summary.processed || 0;
        totalComplianceChanged += summary.complianceChanged || 0;
        totalBreachAlerts += summary.breachAlertsCreated || 0;
        totalErrors += summary.errors || 0;

        // Update status with progress
        setStatus(prev => ({
          ...prev,
          currentBatch: batchNum,
          currentStatus: `Batch ${batchNum} complete - ${summary.processed || 0} records processed`,
          processed: totalProcessed,
          complianceChanged: totalComplianceChanged,
          breachAlertsCreated: totalBreachAlerts,
          errors: totalErrors,
          progressPercent: Math.round(batchNum / totalBatches * 100),
        }));

        console.log(`✅ Batch ${batchNum} complete: ${summary.processed} processed, ${summary.complianceChanged} changed`);

        // Move to next batch
        offset += batchSize;

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Complete
      setStatus(prev => ({
        ...prev,
        isProcessing: false,
        currentStatus: 'Complete',
        progressPercent: 100,
      }));

      queryClient.invalidateQueries({ queryKey: ['recalculation_history'] });

      toast.success(
        `✅ Recalculation complete!\n` +
        `${totalProcessed.toLocaleString()} observations processed\n` +
        `${totalComplianceChanged.toLocaleString()} compliance changed\n` +
        `${totalBreachAlerts.toLocaleString()} breach alerts created`,
        { duration: 10000 }
      );

    } catch (error: any) {
      console.error('❌ Recalculation failed:', error);
      setStatus(prev => ({ ...prev, isProcessing: false }));
      toast.error('Recalculation failed: ' + error.message, { duration: 10000 });
    }
  };

  return (
    <ResponsiveContainer maxWidth="2xl" padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <RefreshCw className="h-8 w-8 text-blue-500" />
            Compliance Recalculation
          </h1>
          <p className="text-muted-foreground mt-1">
            Process 80 records at a time to avoid timeouts
          </p>
        </div>

        {/* Configuration Card */}
        <Card>
          <CardHeader>
            <CardTitle>Recalculation Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Zone Selection */}
            <div className="space-y-2">
              <Label>Select Zones *</Label>
              {zones.length === 0 ? (
                <div className="border rounded-lg p-4 text-center text-sm text-muted-foreground">
                  Loading zones...
                </div>
              ) : (
                <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                  {zones.map((zone) => (
                    <label key={zone.id} className="flex items-center gap-2 p-2 hover:bg-muted rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedZones.includes(zone.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedZones([...selectedZones, zone.id]);
                          } else {
                            setSelectedZones(selectedZones.filter(id => id !== zone.id));
                          }
                        }}
                        disabled={status.isProcessing}
                        className="h-4 w-4"
                      />
                      <span className="text-sm font-medium">{zone.name}</span>
                      <Badge variant="outline" className="text-xs ml-auto">
                        {(zone.organization as any)?.name}
                      </Badge>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <p className="text-muted-foreground">
                  {selectedZones.length} zone(s) selected
                </p>
                {selectedZones.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedZones([])}
                    className="h-6 text-xs"
                  >
                    Clear All
                  </Button>
                )}
              </div>
            </div>

            {/* Date Range */}
            <div className="space-y-2">
              <Label htmlFor="date-preset">
                <Calendar className="h-4 w-4 inline mr-2" />
                Date Range
              </Label>
              <Select value={datePreset} onValueChange={setDatePreset} disabled={status.isProcessing}>
                <SelectTrigger id="date-preset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_time">All Time</SelectItem>
                  <SelectItem value="last_7_days">Last 7 Days</SelectItem>
                  <SelectItem value="last_30_days">Last 30 Days</SelectItem>
                  <SelectItem value="last_90_days">Last 90 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {datePreset === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="start-date">Start Date</Label>
                  <input
                    id="start-date"
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    disabled={status.isProcessing}
                    className="mt-1 w-full p-2 border rounded-md"
                  />
                </div>
                <div>
                  <Label htmlFor="end-date">End Date</Label>
                  <input
                    id="end-date"
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    disabled={status.isProcessing}
                    className="mt-1 w-full p-2 border rounded-md"
                  />
                </div>
              </div>
            )}

            {/* Warning */}
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Processing 80 records at a time. Large datasets will take time. Keep this page open during processing.
              </AlertDescription>
            </Alert>

            {/* Run Button */}
            <Button
              onClick={handleRunRecalculation}
              disabled={status.isProcessing || selectedZones.length === 0}
              className="w-full h-12"
              size="lg"
            >
              {status.isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Processing Batch {status.currentBatch}/{status.totalBatches}...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  Start Recalculation
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Real-Time Processing Status */}
        {status.isProcessing && (
          <Card className="border-2 border-blue-500">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 animate-pulse text-blue-500" />
                Processing Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Overall Progress</span>
                  <span className="text-muted-foreground">
                    Batch {status.currentBatch} of {status.totalBatches}
                  </span>
                </div>
                <Progress value={status.progressPercent} className="h-3" />
                <p className="text-xs text-muted-foreground text-center">
                  {status.progressPercent}% complete
                </p>
              </div>

              {/* Current Status */}
              <div className="p-3 bg-muted/50 rounded border">
                <p className="text-sm font-medium mb-1">Status:</p>
                <p className="text-xs text-muted-foreground">{status.currentStatus}</p>
              </div>

              {/* Live Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/20 rounded border">
                  <div className="text-2xl font-bold text-blue-600">{status.processed.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground mt-1">Processed</div>
                </div>
                <div className="text-center p-3 bg-amber-50 dark:bg-amber-950/20 rounded border">
                  <div className="text-2xl font-bold text-amber-600">{status.complianceChanged.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground mt-1">Changed</div>
                </div>
                <div className="text-center p-3 bg-red-50 dark:bg-red-950/20 rounded border">
                  <div className="text-2xl font-bold text-red-600">{status.breachAlertsCreated.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground mt-1">Breaches</div>
                </div>
                <div className="text-center p-3 bg-gray-50 dark:bg-gray-900 rounded border">
                  <div className="text-2xl font-bold text-gray-600">{status.errors.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground mt-1">Errors</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Recalculations</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActions && recentActions.length > 0 ? (
              <div className="space-y-3">
                {recentActions.map((action: any) => (
                  <div key={action.id} className="p-4 bg-muted/50 rounded-lg border">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <Badge variant={
                          action.status === 'completed' ? 'default' :
                          action.status === 'running' ? 'secondary' : 'destructive'
                        }>
                          {action.status.toUpperCase()}
                        </Badge>
                        <span className="ml-2 text-sm font-semibold">
                          {action.scope_type} Scope
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(action.performed_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Processed</p>
                        <p className="font-semibold">{action.observations_processed?.toLocaleString() || 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Changed</p>
                        <p className="font-semibold text-amber-600">{action.compliance_changed?.toLocaleString() || 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Duration</p>
                        <p className="font-semibold">
                          {action.duration_seconds ? `${action.duration_seconds}s` : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-muted-foreground py-8">
                No recent recalculations
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </ResponsiveContainer>
  );
}
