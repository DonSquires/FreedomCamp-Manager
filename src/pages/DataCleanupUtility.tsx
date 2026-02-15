/**
 * COMPLIANCE RECALCULATION - MOBILE-FRIENDLY VERSION
 * Standalone compliance recalculation with live background processing
 * 
 * Recalculates compliance for all observations in selected zones/date range:
 * - Tests each observation against zone compliance matrix
 * - Updates monthly stay counters
 * - Detects breaches and creates alerts
 * - Updates compliance results table
 * 
 * Features:
 * - Mobile-responsive design
 * - Human-readable progress reporting
 * - Background processing with live updates
 * - Batch processing (300 records at a time)
 * - User can navigate away during processing
 * - Completion requires acknowledgment
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, Calendar, XCircle, PartyPopper, MapPin } from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

interface RecalculationAction {
  id: string;
  scope_type: string;
  observations_processed: number;
  compliance_changed: number;
  drift_events_created: number;
  status: 'running' | 'completed' | 'failed';
  error_message?: string;
  performed_at: string;
  completed_at?: string;
  duration_seconds?: number;
}

export function ComplianceRecalculation() {
  const { user } = useAuthStore();

  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<string>('last_30_days');
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [completionData, setCompletionData] = useState<RecalculationAction | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [complianceChanged, setComplianceChanged] = useState(0);
  const [isCancelling, setIsCancelling] = useState(false);

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

  // Check for active recalculation on mount
  useEffect(() => {
    const checkActiveRecalculation = async () => {
      if (!user?.id) return;

      const { data } = await supabase
        .from('admin_recalculation_actions')
        .select('*')
        .eq('performed_by', user.id)
        .eq('status', 'running')
        .order('performed_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setActiveActionId(data.id);
        setIsProcessing(true);
        setProcessed(data.observations_processed || 0);
        setComplianceChanged(data.compliance_changed || 0);
        toast.info('📊 Resuming active recalculation...');
      }
    };

    checkActiveRecalculation();
  }, [user?.id]);

  // Realtime subscription for background updates
  useEffect(() => {
    if (!activeActionId) return;

    console.log('📡 Setting up realtime subscription for action:', activeActionId);

    const channel = supabase
      .channel(`recalculation_${activeActionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'admin_recalculation_actions',
          filter: `id=eq.${activeActionId}`,
        },
        (payload) => {
          const updated = payload.new as RecalculationAction;
          console.log('📊 Recalculation update:', updated);

          setProcessed(updated.observations_processed || 0);
          setComplianceChanged(updated.compliance_changed || 0);

          // Check if completed
          if (updated.status === 'completed' || updated.status === 'failed') {
            setIsProcessing(false);
            setCompletionData(updated);
            setShowCompletionDialog(true);
            setActiveActionId(null);

            if (updated.status === 'completed') {
              toast.success('✅ Compliance recalculation completed!');
            } else {
              toast.error('❌ Recalculation failed: ' + updated.error_message);
            }
          }
        }
      )
      .subscribe();

    return () => {
      console.log('🔌 Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [activeActionId]);

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

    try {
      toast.info('🚀 Starting compliance recalculation...');

      setIsProcessing(true);
      setProcessed(0);
      setComplianceChanged(0);

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

      // Create tracking record
      const { data: actionRecord, error: actionError } = await supabase
        .from('admin_recalculation_actions')
        .insert({
          scope_type: 'ZONE',
          target_zone_ids: selectedZones,
          date_range_start: dateRangeStart || null,
          date_range_end: dateRangeEnd || null,
          observations_processed: 0,
          compliance_changed: 0,
          drift_events_created: 0,
          status: 'running',
          performed_by: user?.id,
          performed_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (actionError) throw actionError;

      const actionId = actionRecord.id;
      setActiveActionId(actionId);

      // Step 2: Process in batches
      const BATCH_SIZE = 300;
      const totalBatches = Math.ceil(totalObservations / BATCH_SIZE);
      let totalProcessed = 0;
      let totalComplianceChanged = 0;
      let totalBreaches = 0;

      for (let i = 0; i < totalBatches; i++) {
        const offset = i * BATCH_SIZE;

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
          console.error('Batch error:', batchError);
          throw batchError;
        }

        totalProcessed += batchData.processed || 0;
        totalComplianceChanged += batchData.complianceChanged || 0;
        totalBreaches += batchData.breachesCreated || 0;

        // Update tracking record
        await supabase
          .from('admin_recalculation_actions')
          .update({
            observations_processed: totalProcessed,
            compliance_changed: totalComplianceChanged,
            drift_events_created: totalBreaches,
          })
          .eq('id', actionId);

        console.log(`Batch ${i + 1}/${totalBatches} complete: ${totalProcessed}/${totalObservations} processed`);
      }

      // Mark as completed
      const { error: completeError } = await supabase
        .from('admin_recalculation_actions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', actionId);

      if (completeError) throw completeError;

      const actionData = {
        action_id: actionId,
      };

      if (actionError) throw actionError;

      // Set active action ID to start realtime subscription
      setActiveActionId(actionData.action_id);
      console.log('🚀 Recalculation started, action ID:', actionData.action_id);

      toast.success('✅ Recalculation initiated! Processing in background...', {
        description: 'You can navigate away - we\'ll notify you when done.',
        duration: 5000,
      });

    } catch (error: any) {
      setIsProcessing(false);
      setActiveActionId(null);
      console.error('❌ Recalculation failed:', error);
      toast.error('Failed to start: ' + error.message);
    }
  };

  const handleAcknowledgeCompletion = () => {
    setShowCompletionDialog(false);
    setCompletionData(null);
    setProcessed(0);
    setComplianceChanged(0);
  };

  const handleCancel = async () => {
    if (!activeActionId) return;

    setIsCancelling(true);
    try {
      // Update the action status to 'failed' with cancellation message
      const { error } = await supabase
        .from('admin_recalculation_actions')
        .update({
          status: 'failed',
          error_message: 'Cancelled by user',
          completed_at: new Date().toISOString(),
        })
        .eq('id', activeActionId);

      if (error) throw error;

      setIsProcessing(false);
      setActiveActionId(null);
      setProcessed(0);
      setComplianceChanged(0);
      toast.info('Recalculation cancelled');
    } catch (error: any) {
      console.error('Failed to cancel:', error);
      toast.error('Failed to cancel: ' + error.message);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRefreshStatus = async () => {
    if (!activeActionId) return;

    try {
      const { data, error } = await supabase
        .from('admin_recalculation_actions')
        .select('*')
        .eq('id', activeActionId)
        .single();

      if (error) throw error;

      if (data) {
        setProcessed(data.observations_processed || 0);
        setComplianceChanged(data.compliance_changed || 0);
        toast.success('Status refreshed');
      }
    } catch (error: any) {
      console.error('Failed to refresh status:', error);
      toast.error('Failed to refresh status');
    }
  };

  const dateRangeLabels: Record<string, string> = {
    all_time: 'All Time',
    last_7_days: 'Last 7 Days',
    last_30_days: 'Last 30 Days',
    last_90_days: 'Last 90 Days',
  };

  return (
    <ResponsiveContainer maxWidth="3xl" padding="md">
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2 md:gap-3">
            <RefreshCw className="h-6 w-6 md:h-8 md:w-8 text-blue-600" />
            Compliance Recalculation
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Recalculate compliance for observations using current zone rules and matrix settings
          </p>
        </div>

        {/* Important Information */}
        <Alert className="border-2 border-blue-500/30 bg-blue-50 dark:bg-blue-950/20">
          <AlertTriangle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-xs md:text-sm">
            <p className="font-semibold mb-2">ℹ️ What This Does</p>
            <ul className="space-y-1 text-xs md:text-sm">
              <li>
                <span className="font-semibold">✅ Tests Compliance:</span> Checks each observation against zone-specific compliance matrix rules
              </li>
              <li>
                <span className="font-semibold">📊 Updates Statistics:</span> Recalculates monthly stays, consecutive nights, and breach counters
              </li>
              <li>
                <span className="font-semibold">🚨 Creates Alerts:</span> Generates breach alerts for non-compliant observations
              </li>
              <li>
                <span className="font-semibold">📈 Batch Processing:</span> Processes 300 records at a time for optimal performance
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        {/* Configuration */}
        <Card className="border-2">
          <CardHeader className="p-3 md:p-6">
            <CardTitle className="text-base md:text-lg">Settings</CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-6 space-y-4 md:space-y-6">
            {/* Zones Selection */}
            <div className="space-y-2">
              <Label className="text-sm md:text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Select Zones *
              </Label>
              <div className="border rounded-lg p-2 md:p-3 max-h-48 md:max-h-64 overflow-y-auto space-y-1 md:space-y-2">
                {zones.length === 0 ? (
                  <div className="text-center py-4 text-xs md:text-sm text-muted-foreground">
                    No zones available
                  </div>
                ) : (
                  zones.map((zone) => (
                    <label
                      key={zone.id}
                      className="flex items-center gap-2 p-1.5 md:p-2 hover:bg-muted rounded cursor-pointer transition-colors"
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
                        className="h-3.5 w-3.5 md:h-4 md:w-4"
                      />
                      <span className="text-xs md:text-sm font-medium flex-1">{zone.name}</span>
                      <Badge variant="outline" className="text-[10px] md:text-xs">
                        {(zone.organization as any)?.name}
                      </Badge>
                    </label>
                  ))
                )}
              </div>
              <p className="text-[10px] md:text-xs text-muted-foreground">
                ✅ {selectedZones.length} zone{selectedZones.length !== 1 ? 's' : ''} selected
              </p>
            </div>

            {/* Date Range */}
            <div className="space-y-2">
              <Label className="text-sm md:text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Date Range
              </Label>
              <Select value={datePreset} onValueChange={setDatePreset} disabled={isProcessing}>
                <SelectTrigger className="text-sm md:text-base h-9 md:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_time">All Time</SelectItem>
                  <SelectItem value="last_7_days">Last 7 Days</SelectItem>
                  <SelectItem value="last_30_days">Last 30 Days</SelectItem>
                  <SelectItem value="last_90_days">Last 90 Days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] md:text-xs text-muted-foreground">
                Selected: <span className="font-semibold">{dateRangeLabels[datePreset]}</span>
              </p>
            </div>

            {/* Start Button */}
            <Button
              onClick={handleRunRecalculation}
              disabled={isProcessing || selectedZones.length === 0}
              className="w-full h-11 md:h-12 text-sm md:text-base"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 md:h-5 md:w-5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 md:h-5 md:w-5 mr-2" />
                  Start Compliance Recalculation
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Processing Status - Mobile Optimized */}
        {isProcessing && (
          <Card className="border-2 border-blue-500 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/40">
            <CardHeader className="p-3 md:p-6 pb-2 md:pb-3">
              <CardTitle className="text-sm md:text-base flex items-center gap-2">
                <Loader2 className="h-4 w-4 md:h-5 md:w-5 animate-spin text-blue-600" />
                <span className="text-blue-900 dark:text-blue-100">Processing in Background</span>
              </CardTitle>
              <p className="text-[10px] md:text-xs text-blue-700 dark:text-blue-200 mt-1">
                ✅ You can navigate away - we'll notify you when done
              </p>
            </CardHeader>
            <CardContent className="p-3 md:p-6 pt-2 md:pt-3 space-y-3 md:space-y-4">
              {/* Progress Bar */}
              <div className="flex items-center gap-2 md:gap-3">
                <Progress value={100} className="h-2 md:h-3 flex-1" />
                <Badge className="text-[10px] md:text-xs bg-blue-600 animate-pulse">LIVE</Badge>
              </div>

              {/* Control Buttons */}
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleRefreshStatus}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={!activeActionId}
                >
                  <RefreshCw className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                  Refresh Status
                </Button>
                <Button
                  onClick={handleCancel}
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  disabled={isCancelling || !activeActionId}
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                      Cancel
                    </>
                  )}
                </Button>
              </div>

              {/* Stats - Mobile Responsive Grid */}
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                <div className="text-center p-3 md:p-4 bg-white dark:bg-gray-900 rounded-lg border-2 border-blue-300">
                  <div className="text-2xl md:text-3xl font-black text-blue-600">
                    {processed.toLocaleString()}
                  </div>
                  <div className="text-[10px] md:text-xs text-muted-foreground mt-1 font-semibold">
                    Records Checked
                  </div>
                </div>
                <div className="text-center p-3 md:p-4 bg-white dark:bg-gray-900 rounded-lg border-2 border-amber-300">
                  <div className="text-2xl md:text-3xl font-black text-amber-600">
                    {complianceChanged.toLocaleString()}
                  </div>
                  <div className="text-[10px] md:text-xs text-muted-foreground mt-1 font-semibold">
                    Compliance Updated
                  </div>
                </div>
              </div>

              <Alert className="border-blue-300 bg-blue-50 dark:bg-blue-950/30">
                <AlertTriangle className="h-3 w-3 md:h-4 md:w-4 text-blue-600" />
                <AlertDescription className="text-[10px] md:text-xs text-blue-900 dark:text-blue-100">
                  <span className="font-semibold">💡 Progress updates streaming live from database.</span>
                  <br className="hidden md:block" />
                  Keep browser open but feel free to switch tabs.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}

        {/* Completion Dialog - Mobile Optimized */}
        <Dialog open={showCompletionDialog} onOpenChange={() => {}}>
          <DialogContent
            className="w-[95vw] max-w-md mx-auto p-4 md:p-6"
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg md:text-xl">
                {completionData?.status === 'completed' ? (
                  <>
                    <PartyPopper className="h-5 w-5 md:h-6 md:w-6 text-green-500" />
                    <span>Recalculation Complete! 🎉</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 md:h-6 md:w-6 text-red-500" />
                    <span>Recalculation Failed</span>
                  </>
                )}
              </DialogTitle>
              <DialogDescription className="text-xs md:text-sm">
                {completionData?.status === 'completed'
                  ? 'All observations have been reprocessed successfully.'
                  : 'The recalculation encountered an error.'}
              </DialogDescription>
            </DialogHeader>

            {completionData && (
              <div className="space-y-3 md:space-y-4 py-3 md:py-4">
                {completionData.status === 'completed' ? (
                  <>
                    {/* Results Grid - Mobile Optimized */}
                    <div className="grid grid-cols-2 gap-2 md:gap-3">
                      <div className="text-center p-3 md:p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border-2 border-blue-300">
                        <div className="text-2xl md:text-3xl font-black text-blue-600">
                          {(completionData.observations_processed || 0).toLocaleString()}
                        </div>
                        <div className="text-[10px] md:text-xs text-muted-foreground mt-1">
                          Records Processed
                        </div>
                      </div>
                      <div className="text-center p-3 md:p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border-2 border-amber-300">
                        <div className="text-2xl md:text-3xl font-black text-amber-600">
                          {(completionData.compliance_changed || 0).toLocaleString()}
                        </div>
                        <div className="text-[10px] md:text-xs text-muted-foreground mt-1">
                          Compliance Changed
                        </div>
                      </div>
                    </div>

                    {completionData.drift_events_created > 0 && (
                      <div className="text-center p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg border-2 border-purple-300">
                        <div className="text-xl md:text-2xl font-black text-purple-600">
                          {completionData.drift_events_created}
                        </div>
                        <div className="text-[10px] md:text-xs text-muted-foreground">
                          Drift Events Detected
                        </div>
                      </div>
                    )}

                    {/* Duration */}
                    <div className="text-center p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-300">
                      <p className="text-xs md:text-sm text-green-900 dark:text-green-100">
                        ⏱️ Completed in{' '}
                        <span className="font-black text-base md:text-lg">
                          {completionData.duration_seconds}s
                        </span>
                      </p>
                    </div>

                    {/* Success Message */}
                    <Alert className="border-green-500 bg-green-50 dark:bg-green-950/20">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <AlertDescription className="text-xs md:text-sm text-green-900 dark:text-green-100">
                        <span className="font-semibold">✅ All done!</span> Your compliance data has been
                        updated and is now accurate.
                      </AlertDescription>
                    </Alert>
                  </>
                ) : (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs md:text-sm">
                      {completionData.error_message || 'Unknown error occurred'}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                onClick={handleAcknowledgeCompletion}
                className="w-full h-10 md:h-11 text-sm md:text-base"
                size="lg"
              >
                <CheckCircle2 className="h-4 w-4 md:h-5 md:w-5 mr-2" />
                Got It - Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ResponsiveContainer>
  );
}
