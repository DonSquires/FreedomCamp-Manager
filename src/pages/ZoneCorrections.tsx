/**
 * Zone Corrections - SIMPLE VERSION
 * Target V2 → Test GPS against zones → Process 80 at a time
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MapPin, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface ZoneCorrection {
  observation_id: string;
  plate_number: string;
  old_zone_name: string;
  new_zone_name: string;
  recorded_at: string;
}

interface ProcessingStatus {
  isProcessing: boolean;
  currentBatch: number;
  totalBatches: number;
  processed: number;
  corrected: number;
  movedToOther: number;
  corrections: ZoneCorrection[];
}

export function ZoneCorrections() {
  const [status, setStatus] = useState<ProcessingStatus>({
    isProcessing: false,
    currentBatch: 0,
    totalBatches: 0,
    processed: 0,
    corrected: 0,
    movedToOther: 0,
    corrections: [],
  });

  const runZoneCorrection = async () => {
    try {
      // Step 1: Get total count
      toast.info('Getting record count...');

      const { data: totalData, error: totalError } = await supabase.functions.invoke(
        'correct-zone-assignments',
        { body: { get_total: true } }
      );

      if (totalError) throw totalError;

      const totalRecords = totalData?.total || 0;

      if (totalRecords === 0) {
        toast.warning('No observations with GPS coordinates found');
        return;
      }

      const batchSize = 80;
      const totalBatches = Math.ceil(totalRecords / batchSize);

      toast.success(`Found ${totalRecords.toLocaleString()} observations to check`);

      setStatus({
        isProcessing: true,
        currentBatch: 0,
        totalBatches,
        processed: 0,
        corrected: 0,
        movedToOther: 0,
        corrections: [],
      });

      // Step 2: Process batches
      let offset = 0;
      let totalProcessed = 0;
      let totalCorrected = 0;
      let totalMovedToOther = 0;
      let allCorrections: ZoneCorrection[] = [];

      for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
        setStatus(prev => ({
          ...prev,
          currentBatch: batchNum,
        }));

        const { data: batchData, error: batchError } = await supabase.functions.invoke(
          'correct-zone-assignments',
          {
            body: {
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
        totalCorrected += batchData?.corrected || 0;
        totalMovedToOther += batchData?.moved_to_other || 0;
        allCorrections = [...allCorrections, ...(batchData?.corrections || [])];

        setStatus(prev => ({
          ...prev,
          processed: totalProcessed,
          corrected: totalCorrected,
          movedToOther: totalMovedToOther,
          corrections: allCorrections,
        }));

        offset += batchSize;
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setStatus(prev => ({ ...prev, isProcessing: false }));

      if (totalCorrected === 0 && totalMovedToOther === 0) {
        toast.success('✅ All observations are in correct zones!');
      } else {
        toast.success(
          `✅ Complete!\n${totalCorrected} corrected\n${totalMovedToOther} moved to "Other"`,
          { duration: 10000 }
        );
      }

    } catch (error: any) {
      setStatus(prev => ({ ...prev, isProcessing: false }));
      toast.error('Failed: ' + error.message);
    }
  };

  const alreadyCorrect = status.processed - status.corrected - status.movedToOther;

  return (
    <ResponsiveContainer maxWidth="2xl" padding="lg">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <MapPin className="h-8 w-8 text-blue-500" />
            GPS Zone Corrections
          </h1>
          <p className="text-muted-foreground mt-1">
            Process 80 records at a time - check GPS coordinates against zone boundaries
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Zone Correction</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>What this checks (targeting vehicle_observations_v2):</strong>
                <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                  <li>Test GPS coordinates against zone geofences</li>
                  <li>Update zone_id if GPS shows vehicle is in different zone</li>
                  <li>Move to "Other" zone if GPS is outside all zones</li>
                  <li>Skip observations without GPS data</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Button
              onClick={runZoneCorrection}
              disabled={status.isProcessing}
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
                  Run Zone Correction
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
              
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-blue-50 dark:bg-blue-950/20 rounded">
                  <div className="text-2xl font-bold text-blue-600">{status.processed}</div>
                  <div className="text-xs text-muted-foreground">Processed</div>
                </div>
                <div className="text-center p-3 bg-green-50 dark:bg-green-950/20 rounded">
                  <div className="text-2xl font-bold text-green-600">{status.corrected}</div>
                  <div className="text-xs text-muted-foreground">Corrected</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Summary */}
        {!status.isProcessing && status.processed > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Checked</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{status.processed.toLocaleString()}</div>
                </CardContent>
              </Card>

              <Card className={status.corrected > 0 ? 'border-green-200 bg-green-50' : ''}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-green-600">Corrected</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-green-600">{status.corrected}</div>
                </CardContent>
              </Card>

              <Card className={status.movedToOther > 0 ? 'border-amber-200 bg-amber-50' : ''}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-amber-600">Moved to "Other"</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-amber-600">{status.movedToOther}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Already Correct</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{alreadyCorrect}</div>
                </CardContent>
              </Card>
            </div>

            {/* Corrections List */}
            {status.corrections.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Corrections Made ({status.corrections.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {status.corrections.map((correction, index) => (
                      <div
                        key={`${correction.observation_id}-${index}`}
                        className="border rounded-lg p-4 bg-green-50 dark:bg-green-950/20"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono font-bold text-lg">{correction.plate_number}</span>
                          <Badge variant="outline" className="text-xs">
                            {new Date(correction.recorded_at).toLocaleString('en-NZ', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </Badge>
                        </div>
                        
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="line-through">{correction.old_zone_name}</span>
                          <span>→</span>
                          <span className="text-green-600 font-semibold">{correction.new_zone_name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* No Corrections */}
        {!status.isProcessing && status.processed > 0 && status.corrected === 0 && status.movedToOther === 0 && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="text-center py-12">
              <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-green-900 mb-2">All Correct!</h3>
              <p className="text-green-700">
                All observations are assigned to correct zones based on GPS coordinates.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </ResponsiveContainer>
  );
}
