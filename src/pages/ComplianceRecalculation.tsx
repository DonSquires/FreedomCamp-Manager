/**
 * Compliance Recalculation - FRONTEND BATCHING VERSION
 * Pure frontend-driven batching with local progress tracking
 * No database tracking - all progress shown live in UI
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, Calendar, XCircle, PartyPopper } from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

interface CompletionData {
  status: 'completed' | 'failed';
  observations_processed: number;
  compliance_changed: number;
  breaches_created: number;
  duration_seconds: number;
  error_message?: string;
}

export function ComplianceRecalculation() {
  const { user } = useAuthStore();

  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<string>('last_30_days');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [complianceChanged, setComplianceChanged] = useState(0);
  const [breachesCreated, setBreachesCreated] = useState(0);
  const [skippedNoMatrix, setSkippedNoMatrix] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [completionData, setCompletionData] = useState<CompletionData | null>(null);

  // Fetch zones
  const { data: zones = [] } = useQuery({
    queryKey: ['zones', user?.organization_id],
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

  const handleRunRecalculation = async () => {
    if (selectedZones.length === 0) {
      toast.error('⚠️ Please select at least one zone');
      return;
    }

    // Calculate date range
    let dateRangeStart: string | undefined;
    let dateRangeEnd: string | undefined;

    if (datePreset !== 'all_time') {
      const today = new Date();
      dateRangeEnd = today.toISOString().split('T')[0];

      if (datePreset === 'last_7_days') {
        const start = new Date();
        start.setDate(start.getDate() - 7);
        dateRangeStart = start.toISOString().split('T')[0];
      } else if (datePreset === 'last_30_days') {
        const start = new Date();
        start.setDate(start.getDate() - 30);
        dateRangeStart = start.toISOString().split('T')[0];
      } else if (datePreset === 'last_90_days') {
        const start = new Date();
        start.setDate(start.getDate() - 90);
        dateRangeStart = start.toISOString().split('T')[0];
      }
    }

    const startTime = Date.now();
    
    try {
      toast.info('🚀 Starting compliance recalculation...');

      setIsProcessing(true);
      setProcessed(0);
      setComplianceChanged(0);
      setBreachesCreated(0);
      setSkippedNoMatrix(0);
      setCurrentBatch(0);
      setTotalBatches(0);

      // Step 1: Get total count
      const { data: totalData, error: totalError } = await supabase.functions.invoke(
        'recalculate-compliance-v2',
        {
          body: {
            zoneIds: selectedZones,
            dateRangeStart: dateRangeStart,
            dateRangeEnd: dateRangeEnd,
            get_total: true,
          },
        }
      );

      if (totalError) throw totalError;

      const totalObservations = totalData.total || 0;
      console.log('📊 Total observations to process:', totalObservations);

      if (totalObservations === 0) {
        toast.info('No observations found in selected zones/date range');
        setIsProcessing(false);
        return;
      }

      // Step 2: Process in batches (Frontend-driven)
      const BATCH_SIZE = 150;
      const batches = Math.ceil(totalObservations / BATCH_SIZE);
      setTotalBatches(batches);
      
      let totalProcessed = 0;
      let totalComplianceChanged = 0;
      let totalBreaches = 0;
      let totalSkipped = 0;

      console.log(`📦 Processing ${totalObservations} observations in ${batches} batches of 150`);

      for (let i = 0; i < batches; i++) {
        const offset = i * BATCH_SIZE;
        setCurrentBatch(i + 1);

        console.log(`📦 Batch ${i + 1}/${batches}: Processing observations ${offset + 1}-${Math.min(offset + BATCH_SIZE, totalObservations)}...`);

        const { data: batchData, error: batchError } = await supabase.functions.invoke(
          'recalculate-compliance-v2',
          {
            body: {
              zoneIds: selectedZones,
              dateRangeStart: dateRangeStart,
              dateRangeEnd: dateRangeEnd,
              get_total: false,
              offset: offset,
              batch_size: BATCH_SIZE,
            },
          }
        );

        if (batchError) {
          console.error('❌ Batch error:', batchError);
          throw batchError;
        }

        totalProcessed += batchData.processed || 0;
        totalComplianceChanged += batchData.complianceChanged || 0;
        totalBreaches += batchData.breachesCreated || 0;
        totalSkipped += batchData.skippedNoMatrix || 0;

        // Update frontend state (live progress)
        setProcessed(totalProcessed);
        setComplianceChanged(totalComplianceChanged);
        setBreachesCreated(totalBreaches);
        setSkippedNoMatrix(totalSkipped);

        console.log(`✅ Batch ${i + 1}/${batches} complete: ${totalProcessed}/${totalObservations} processed, ${totalComplianceChanged} changed, ${totalBreaches} breaches, ${totalSkipped} skipped`);
      }

      // Calculate duration
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);

      // Show completion dialog
      setCompletionData({
        status: 'completed',
        observations_processed: totalProcessed,
        compliance_changed: totalComplianceChanged,
        breaches_created: totalBreaches,
        duration_seconds: durationSeconds,
      });
      
      setShowCompletionDialog(true);
      setIsProcessing(false);

      console.log(`✅ Recalculation complete: ${totalProcessed} processed, ${totalComplianceChanged} changed, ${totalBreaches} breaches in ${durationSeconds}s`);

      toast.success(`✅ Recalculation complete! ${totalProcessed} records processed in ${durationSeconds}s`);

    } catch (error: any) {
      setIsProcessing(false);
      console.error('❌ Recalculation failed:', error);
      toast.error('Failed: ' + error.message);
      
      // Show error in completion dialog
      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      setCompletionData({
        status: 'failed',
        observations_processed: processed,
        compliance_changed: complianceChanged,
        breaches_created: 0,
        duration_seconds: durationSeconds,
        error_message: error.message,
      });
      setShowCompletionDialog(true);
    }
  };

  const handleAcknowledgeCompletion = () => {
    setShowCompletionDialog(false);
    setCompletionData(null);
    setProcessed(0);
    setComplianceChanged(0);
    setBreachesCreated(0);
    setSkippedNoMatrix(0);
    setCurrentBatch(0);
    setTotalBatches(0);
  };

  const dateRangeLabels: Record<string, string> = {
    all_time: 'All Time',
    last_7_days: 'Last 7 Days',
    last_30_days: 'Last 30 Days',
    last_90_days: 'Last 90 Days',
  };

  const progressPercent = totalBatches > 0 ? (currentBatch / totalBatches) * 100 : 0;

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
            Frontend-driven batching - processes 150 records at a time with live progress
          </p>
        </div>

        {/* Configuration Card */}
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Zones Selection */}
            <div className="space-y-2">
              <Label>Select Zones *</Label>
              <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                {zones.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    No zones available
                  </div>
                ) : (
                  zones.map((zone) => (
                    <label
                      key={zone.id}
                      className="flex items-center gap-2 p-2 hover:bg-muted rounded cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedZones.includes(zone.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedZones([...selectedZones, zone.id]);
                          } else {
                            setSelectedZones(selectedZones.filter((id) => id !== zone.id));
                          }
                        }}
                        disabled={isProcessing}
                        className="h-4 w-4"
                      />
                      <span className="text-sm font-medium flex-1">{zone.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {(zone.organization as any)?.name}
                      </Badge>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                ✅ {selectedZones.length} zone{selectedZones.length !== 1 ? 's' : ''} selected
              </p>
            </div>

            {/* Date Range */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Date Range
              </Label>
              <Select value={datePreset} onValueChange={setDatePreset} disabled={isProcessing}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_time">All Time</SelectItem>
                  <SelectItem value="last_7_days">Last 7 Days</SelectItem>
                  <SelectItem value="last_30_days">Last 30 Days</SelectItem>
                  <SelectItem value="last_90_days">Last 90 Days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-semibold">{dateRangeLabels[datePreset]}</span>
              </p>
            </div>

            {/* Info Alert */}
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>What this does:</strong> Tests each observation against current zone compliance rules,
                updates monthly stays, creates breach alerts. Processing 150 records per batch.
              </AlertDescription>
            </Alert>

            {/* Start Button */}
            <Button
              onClick={handleRunRecalculation}
              disabled={isProcessing || selectedZones.length === 0}
              className="w-full h-12"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Processing Batch {currentBatch}/{totalBatches}...
                </>
              ) : (
                <>
                  <RefreshCw className="h-5 w-5 mr-2" />
                  Start Compliance Recalculation
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Processing Status */}
        {isProcessing && (
          <Card className="border-2 border-blue-500 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <span className="text-blue-900 dark:text-blue-100">Processing in Progress</span>
              </CardTitle>
              <p className="text-xs text-blue-700 dark:text-blue-200 mt-1">
                ⚠️ Keep this page open until complete
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Progress value={progressPercent} className="h-3 flex-1" />
                  <span className="text-sm font-bold text-blue-600">{Math.round(progressPercent)}%</span>
                </div>
                <p className="text-xs text-center text-muted-foreground">
                  Batch {currentBatch} of {totalBatches} • 150 records per batch
                </p>
              </div>

              {/* Stats Grid - 4 Metrics (matching screenshot) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-white dark:bg-gray-900 rounded-lg border-2 border-blue-300">
                  <div className="text-3xl font-black text-blue-600">
                    {processed.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-semibold">
                    Processed
                  </div>
                </div>
                <div className="text-center p-3 bg-white dark:bg-gray-900 rounded-lg border-2 border-amber-300">
                  <div className="text-3xl font-black text-amber-600">
                    {complianceChanged.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-semibold">
                    Changed
                  </div>
                </div>
                <div className="text-center p-3 bg-white dark:bg-gray-900 rounded-lg border-2 border-red-300">
                  <div className="text-3xl font-black text-red-600">
                    {breachesCreated.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-semibold">
                    Breaches
                  </div>
                </div>
                <div className="text-center p-3 bg-white dark:bg-gray-900 rounded-lg border-2 border-yellow-300">
                  <div className="text-3xl font-black text-yellow-600">
                    {skippedNoMatrix.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-semibold">
                    Skipped (No Matrix)
                  </div>
                </div>
              </div>

              <Alert className="border-blue-300 bg-blue-50 dark:bg-blue-950/30">
                <AlertTriangle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-xs text-blue-900 dark:text-blue-100">
                  <span className="font-semibold">💡 Processing batches on frontend.</span>
                  <br />
                  Live progress updates - do not close this page.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}

        {/* Completion Dialog */}
        <Dialog open={showCompletionDialog} onOpenChange={() => {}}>
          <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                {completionData?.status === 'completed' ? (
                  <>
                    <PartyPopper className="h-6 w-6 text-green-500" />
                    <span>Recalculation Complete! 🎉</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-6 w-6 text-red-500" />
                    <span>Recalculation Failed</span>
                  </>
                )}
              </DialogTitle>
              <DialogDescription>
                {completionData?.status === 'completed'
                  ? 'All observations have been reprocessed successfully.'
                  : 'The recalculation encountered an error.'}
              </DialogDescription>
            </DialogHeader>

            {completionData && (
              <div className="space-y-4 py-4">
                {completionData.status === 'completed' ? (
                  <>
                    {/* Results Grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border-2 border-blue-300">
                        <div className="text-3xl font-black text-blue-600">
                          {(completionData.observations_processed || 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Records Processed
                        </div>
                      </div>
                      <div className="text-center p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border-2 border-amber-300">
                        <div className="text-3xl font-black text-amber-600">
                          {(completionData.compliance_changed || 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          Compliance Changed
                        </div>
                      </div>
                    </div>

                    {completionData.breaches_created > 0 && (
                      <div className="text-center p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border-2 border-red-300">
                        <div className="text-2xl font-black text-red-600">
                          {completionData.breaches_created}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Breaches Created
                        </div>
                      </div>
                    )}

                    {/* Duration */}
                    <div className="text-center p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-300">
                      <p className="text-sm text-green-900 dark:text-green-100">
                        ⏱️ Completed in{' '}
                        <span className="font-black text-lg">
                          {completionData.duration_seconds}s
                        </span>
                      </p>
                    </div>

                    {/* Success Message */}
                    <Alert className="border-green-500 bg-green-50 dark:bg-green-950/20">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <AlertDescription className="text-sm text-green-900 dark:text-green-100">
                        <span className="font-semibold">✅ All done!</span> Your compliance data has been
                        updated and is now accurate.
                      </AlertDescription>
                    </Alert>
                  </>
                ) : (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                      {completionData.error_message || 'Unknown error occurred'}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                onClick={handleAcknowledgeCompletion}
                className="w-full h-11"
                size="lg"
              >
                <CheckCircle2 className="h-5 w-5 mr-2" />
                Got It - Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ResponsiveContainer>
  );
}
