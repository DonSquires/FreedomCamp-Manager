/**
 * Compliance Recalculation - SIMPLE VERSION
 * Select zones + date range → Process 80 at a time
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, Calendar } from 'lucide-react';
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

export function ComplianceRecalculation() {
  const { user } = useAuthStore();

  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<string>('last_30_days');
  const [status, setStatus] = useState<ProcessingStatus>({
    isProcessing: false,
    currentBatch: 0,
    totalBatches: 0,
    processed: 0,
    complianceChanged: 0,
    breachesCreated: 0,
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

      const batchSize = 80;
      const totalBatches = Math.ceil(totalRecords / batchSize);

      toast.success(`Found ${totalRecords.toLocaleString()} observations to process`);

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

      // Step 2: Process batches
      let offset = 0;
      let totalProcessed = 0;
      let totalChanged = 0;
      let totalBreaches = 0;

      for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
        setStatus(prev => ({
          ...prev,
          currentBatch: batchNum,
        }));

        const { data: batchData, error: batchError } = await supabase.functions.invoke(
          'recalculate-compliance-v2',
          {
            body: {
              zoneIds: selectedZones,
              dateRangeStart,
              dateRangeEnd,
              offset,
              batch_size: batchSize,
            },
          }
        );

        if (batchError) {
          console.error('Batch error:', batchError);
          offset += batchSize;
          continue;
        }

        totalProcessed += batchData?.processed || 0;
        totalChanged += batchData?.complianceChanged || 0;
        totalBreaches += batchData?.breachesCreated || 0;
        const skipped = batchData?.skippedNoMatrix || 0;
        const zonesWithoutMatrix = batchData?.zonesWithoutMatrix || [];

        setStatus(prev => ({
          ...prev,
          processed: totalProcessed,
          complianceChanged: totalChanged,
          breachesCreated: totalBreaches,
          skippedNoMatrix: prev.skippedNoMatrix + skipped,
          zonesWithoutMatrix: Array.from(new Set([...prev.zonesWithoutMatrix, ...zonesWithoutMatrix])),
        }));

        offset += batchSize;
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setStatus(prev => ({ ...prev, isProcessing: false }));

      toast.success(
        `✅ Complete!\n${totalProcessed.toLocaleString()} processed\n${totalChanged.toLocaleString()} changed\n${totalBreaches.toLocaleString()} breaches`,
        { duration: 10000 }
      );

    } catch (error: any) {
      setStatus(prev => ({ ...prev, isProcessing: false }));
      toast.error('Failed: ' + error.message);
    }
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
            Process 80 records at a time - select zones and date range
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
                Processing 80 records at a time. Keep this page open during processing.
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
              <CardTitle className="text-base">Processing Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={(status.currentBatch / status.totalBatches) * 100} className="h-3" />
              
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/20 rounded">
                  <div className="text-2xl font-bold text-blue-600">{status.processed}</div>
                  <div className="text-xs text-muted-foreground">Processed</div>
                </div>
                <div className="text-center p-3 bg-amber-50 dark:bg-amber-950/20 rounded">
                  <div className="text-2xl font-bold text-amber-600">{status.complianceChanged}</div>
                  <div className="text-xs text-muted-foreground">Changed</div>
                </div>
                <div className="text-center p-3 bg-red-50 dark:bg-red-950/20 rounded">
                  <div className="text-2xl font-bold text-red-600">{status.breachesCreated}</div>
                  <div className="text-xs text-muted-foreground">Breaches</div>
                </div>
                {status.skippedNoMatrix > 0 && (
                  <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded border border-yellow-300">
                    <div className="text-2xl font-bold text-yellow-600">{status.skippedNoMatrix}</div>
                    <div className="text-xs text-muted-foreground">Skipped (No Matrix)</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ResponsiveContainer>
  );
}
