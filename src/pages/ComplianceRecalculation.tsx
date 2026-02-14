/**
 * Compliance Recalculation - BACKGROUND PROCESSING VERSION
 * Select zones + date range → Process in background with live updates
 * User can navigate away - progress tracked via realtime subscriptions
 * Completion requires user acknowledgment
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
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, Calendar, XCircle, PartyPopper } from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

interface ProcessingStatus {
  isProcessing: boolean;
  currentBatch: number;
  totalBatches: number;
  processed: number;
  complianceChanged: number;
  breachesCreated: number;
  skippedNoMatrix: number;
  zonesWithoutMatrix: string[];
}

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
  const [status, setStatus] = useState<ProcessingStatus>({
    isProcessing: false,
    currentBatch: 0,
    totalBatches: 0,
    processed: 0,
    complianceChanged: 0,
    breachesCreated: 0,
    skippedNoMatrix: 0,
    zonesWithoutMatrix: [],
  });

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
        setStatus({
          isProcessing: true,
          currentBatch: 0,
          totalBatches: 0,
          processed: data.observations_processed || 0,
          complianceChanged: data.compliance_changed || 0,
          breachesCreated: 0,
          skippedNoMatrix: 0,
          zonesWithoutMatrix: [],
        });
        toast.info('Resuming active recalculation...');
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

          setStatus((prev) => ({
            ...prev,
            processed: updated.observations_processed || prev.processed,
            complianceChanged: updated.compliance_changed || prev.complianceChanged,
          }));

          // Check if completed
          if (updated.status === 'completed' || updated.status === 'failed') {
            setStatus((prev) => ({ ...prev, isProcessing: false }));
            setCompletionData(updated);
            setShowCompletionDialog(true);
            setActiveActionId(null);

            if (updated.status === 'completed') {
              toast.success('✅ Recalculation completed!');
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
      toast.error('Please select at least one zone');
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
      // Step 1: Get total count
      toast.info('Getting record count...');
      
      const { data: totalData, error: totalError } = await supabase.functions.invoke(
        'recalculate-compliance-v2',
        {
          body: {
            zoneIds: selectedZones,
            dateRangeStart,
            dateRangeEnd,
            get_total: true,
          },
        }
      );

      if (totalError) throw totalError;

      const totalRecords = totalData?.total || 0;

      if (totalRecords === 0) {
        toast.warning('No observations found for selected zones and date range');
        return;
      }

      const batchSize = 150;
      const totalBatches = Math.ceil(totalRecords / batchSize);

      toast.info(`Starting recalculation for ${totalRecords.toLocaleString()} observations...`);

      setStatus({
        isProcessing: true,
        currentBatch: 0,
        totalBatches,
        processed: 0,
        complianceChanged: 0,
        breachesCreated: 0,
        skippedNoMatrix: 0,
        zonesWithoutMatrix: [],
      });

      // Step 2: Trigger background recalculation via Edge Function
      const { data: actionData, error: actionError } = await supabase.functions.invoke(
        'recalculate-compliance',
        {
          body: {
            scope_type: 'ZONE',
            zone_ids: selectedZones,
            date_range_start: dateRangeStart,
            date_range_end: dateRangeEnd,
          },
        }
      );

      if (actionError) throw actionError;

      // Set active action ID to start realtime subscription
      setActiveActionId(actionData.action_id);
      console.log('🚀 Recalculation started, action ID:', actionData.action_id);

      toast.info('✅ Recalculation initiated! Processing in background...');

    } catch (error: any) {
      setStatus(prev => ({ ...prev, isProcessing: false }));
      setActiveActionId(null);
      toast.error('Failed to start: ' + error.message);
    }
  };

  const handleAcknowledgeCompletion = () => {
    setShowCompletionDialog(false);
    setCompletionData(null);
    setStatus({
      isProcessing: false,
      currentBatch: 0,
      totalBatches: 0,
      processed: 0,
      complianceChanged: 0,
      breachesCreated: 0,
      skippedNoMatrix: 0,
      zonesWithoutMatrix: [],
    });
  };

  return (
    <ResponsiveContainer maxWidth="2xl" padding="lg">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <RefreshCw className="h-8 w-8 text-blue-500" />
            Compliance Recalculation
          </h1>
          <p className="text-muted-foreground mt-1">
            Process 150 records at a time - select zones and date range
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Zones */}
            <div className="space-y-2">
              <Label>Select Zones *</Label>
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
              <p className="text-xs text-muted-foreground">
                {selectedZones.length} zone(s) selected
              </p>
            </div>

            {/* Date Range */}
            <div className="space-y-2">
              <Label>
                <Calendar className="h-4 w-4 inline mr-2" />
                Date Range
              </Label>
              <Select value={datePreset} onValueChange={setDatePreset} disabled={status.isProcessing}>
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
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Processing 150 records at a time. Keep this page open during processing.
              </AlertDescription>
            </Alert>

            <Button
              onClick={handleRunRecalculation}
              disabled={status.isProcessing || selectedZones.length === 0}
              className="w-full h-12"
              size="lg"
            >
              {status.isProcessing ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Batch {status.currentBatch}/{status.totalBatches}...
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

        {/* Progress */}
        {status.isProcessing && (
          <Card className="border-2 border-blue-500">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                Processing Status
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Running in background - you can navigate away
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Progress value={100} className="h-3 flex-1" />
                <span className="text-sm font-medium text-blue-600 animate-pulse">Live</span>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                  <div className="text-3xl font-bold text-blue-600">{status.processed.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground mt-1">Processed</div>
                </div>
                <div className="text-center p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                  <div className="text-3xl font-bold text-amber-600">{status.complianceChanged.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground mt-1">Changed</div>
                </div>
              </div>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Updates streaming live from database. Do not close browser completely.
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
                    Recalculation Complete!
                  </>
                ) : (
                  <>
                    <XCircle className="h-6 w-6 text-red-500" />
                    Recalculation Failed
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
                    <div className="grid grid-cols-2 gap-3">
                      <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200">
                        <div className="text-3xl font-bold text-blue-600">
                          {(completionData.observations_processed || 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">Observations Processed</div>
                      </div>
                      <div className="text-center p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200">
                        <div className="text-3xl font-bold text-amber-600">
                          {(completionData.compliance_changed || 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">Compliance Changed</div>
                      </div>
                    </div>

                    {completionData.drift_events_created > 0 && (
                      <div className="text-center p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200">
                        <div className="text-2xl font-bold text-purple-600">
                          {completionData.drift_events_created}
                        </div>
                        <div className="text-xs text-muted-foreground">Drift Events Created</div>
                      </div>
                    )}

                    <div className="text-center text-sm text-muted-foreground">
                      Completed in <span className="font-semibold">{completionData.duration_seconds}s</span>
                    </div>
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
                className="w-full"
                size="lg"
              >
                <CheckCircle2 className="h-5 w-5 mr-2" />
                Acknowledge & Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ResponsiveContainer>
  );
}
