/**
 * Data Integrity Check - SIMPLE VERSION
 * Target V2 → Delete duplicates + Mark invalid plates → Process in batches
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, AlertTriangle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface IntegrityIssue {
  table: string;
  issue_type: 'duplicate' | 'orphaned' | 'invalid_plate';
  severity: 'critical' | 'warning';
  record_id: string;
  plate_number?: string;
  description: string;
  action_taken?: 'deleted' | 'marked' | 'none';
}

interface ProcessingStatus {
  isProcessing: boolean;
  currentBatch: number;
  totalBatches: number;
  processed: number;
  issuesFound: number;
  duplicatesDeleted: number;
  invalidPlatesMarked: number;
  issues: IntegrityIssue[];
}

export default function DataIntegrityCheck() {
  const [status, setStatus] = useState<ProcessingStatus>({
    isProcessing: false,
    currentBatch: 0,
    totalBatches: 0,
    processed: 0,
    issuesFound: 0,
    duplicatesDeleted: 0,
    invalidPlatesMarked: 0,
    issues: [],
  });

  const runIntegrityCheck = async () => {
    try {
      // Step 1: Get total count
      toast.info('Getting record count...');

      const { data: totalData, error: totalError } = await supabase.functions.invoke(
        'check-data-integrity',
        { body: { get_total: true } }
      );

      if (totalError) throw totalError;

      const totalRecords = totalData?.total || 0;

      if (totalRecords === 0) {
        toast.warning('No observations found');
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
        issuesFound: 0,
        duplicatesDeleted: 0,
        invalidPlatesMarked: 0,
        issues: [],
      });

      // Step 2: Process batches
      let offset = 0;
      let totalProcessed = 0;
      let totalDeleted = 0;
      let totalMarked = 0;
      let allIssues: IntegrityIssue[] = [];

      for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
        setStatus(prev => ({
          ...prev,
          currentBatch: batchNum,
        }));

        const { data: batchData, error: batchError } = await supabase.functions.invoke(
          'check-data-integrity',
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
        totalDeleted += batchData?.duplicates_deleted || 0;
        totalMarked += batchData?.invalid_plates_marked || 0;
        allIssues = [...allIssues, ...(batchData?.issues || [])];

        setStatus(prev => ({
          ...prev,
          processed: totalProcessed,
          issuesFound: allIssues.length,
          duplicatesDeleted: totalDeleted,
          invalidPlatesMarked: totalMarked,
          issues: allIssues,
        }));

        offset += batchSize;
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setStatus(prev => ({ ...prev, isProcessing: false }));

      if (allIssues.length === 0) {
        toast.success('✅ No data integrity issues found! System is healthy.');
      } else {
        toast.success(
          `✅ Complete!\n${totalDeleted} duplicates deleted\n${totalMarked} invalid plates marked`,
          { duration: 10000 }
        );
      }

    } catch (error: any) {
      setStatus(prev => ({ ...prev, isProcessing: false }));
      toast.error('Failed: ' + error.message);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-50 border-red-200 text-red-800';
      case 'warning': return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      default: return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <XCircle className="h-5 w-5 text-red-600" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      default: return <CheckCircle2 className="h-5 w-5 text-gray-600" />;
    }
  };

  const deletedCount = status.issues.filter(i => i.action_taken === 'deleted').length;
  const markedCount = status.issues.filter(i => i.action_taken === 'marked').length;
  const orphanedCount = status.issues.filter(i => i.issue_type === 'orphaned').length;

  return (
    <ResponsiveContainer maxWidth="2xl" padding="lg">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="h-8 w-8 text-blue-500" />
            Data Integrity Check
          </h1>
          <p className="text-muted-foreground mt-1">
            Process 80 records at a time - delete duplicates and mark invalid plates
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Integrity Check</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>What this does (targeting vehicle_observations_v2):</strong>
                <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                  <li><strong>Duplicates:</strong> Automatically DELETES duplicate observations (keeps first record)</li>
                  <li><strong>Invalid Plates:</strong> Marks plates with invalid NZ format for registry verification</li>
                  <li><strong>Orphaned:</strong> Reports plates not in canonical_vehicles (no action taken)</li>
                </ul>
              </AlertDescription>
            </Alert>

            <Button
              onClick={runIntegrityCheck}
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
                  Run Integrity Check
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
                <div className="text-center p-3 bg-red-50 dark:bg-red-950/20 rounded">
                  <div className="text-2xl font-bold text-red-600">{status.duplicatesDeleted}</div>
                  <div className="text-xs text-muted-foreground">Deleted</div>
                </div>
                <div className="text-center p-3 bg-amber-50 dark:bg-amber-950/20 rounded">
                  <div className="text-2xl font-bold text-amber-600">{status.invalidPlatesMarked}</div>
                  <div className="text-xs text-muted-foreground">Marked</div>
                </div>
                <div className="text-center p-3 bg-gray-50 dark:bg-gray-950/20 rounded">
                  <div className="text-2xl font-bold text-gray-600">{status.issuesFound}</div>
                  <div className="text-xs text-muted-foreground">Total Issues</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Summary */}
        {!status.isProcessing && status.issues.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Records Checked</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{status.processed.toLocaleString()}</div>
                </CardContent>
              </Card>

              <Card className={deletedCount > 0 ? 'border-red-200 bg-red-50' : ''}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-red-600">Duplicates Deleted</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-red-600">{deletedCount}</div>
                </CardContent>
              </Card>

              <Card className={markedCount > 0 ? 'border-amber-200 bg-amber-50' : ''}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-amber-600">Invalid Plates Marked</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-amber-600">{markedCount}</div>
                </CardContent>
              </Card>

              <Card className={orphanedCount > 0 ? 'border-yellow-200 bg-yellow-50' : ''}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-yellow-600">Orphaned Records</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-yellow-600">{orphanedCount}</div>
                </CardContent>
              </Card>
            </div>

            {/* Issues List */}
            <Card>
              <CardHeader>
                <CardTitle>Issues Found ({status.issues.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {status.issues.map((issue, index) => (
                    <div
                      key={`${issue.record_id}-${index}`}
                      className={`border rounded-lg p-4 ${getSeverityColor(issue.severity)}`}
                    >
                      <div className="flex items-start gap-3">
                        {getSeverityIcon(issue.severity)}
                        
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <Badge variant="outline" className="text-xs">
                              {issue.table}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {issue.issue_type.replace('_', ' ')}
                            </Badge>
                            {issue.action_taken && (
                              <Badge 
                                className={`text-xs ${
                                  issue.action_taken === 'deleted' 
                                    ? 'bg-red-600' 
                                    : issue.action_taken === 'marked' 
                                    ? 'bg-amber-600' 
                                    : 'bg-gray-600'
                                }`}
                              >
                                {issue.action_taken.toUpperCase()}
                              </Badge>
                            )}
                            {issue.plate_number && (
                              <Badge className="text-xs bg-gray-600">
                                {issue.plate_number}
                              </Badge>
                            )}
                          </div>
                          
                          <p className="text-sm font-medium">{issue.description}</p>
                          
                          <div className="text-xs text-muted-foreground mt-2">
                            Record ID: <code className="bg-black/5 px-1 py-0.5 rounded">{issue.record_id}</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* No Issues */}
        {!status.isProcessing && status.processed > 0 && status.issues.length === 0 && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="text-center py-12">
              <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-green-900 mb-2">All Clear!</h3>
              <p className="text-green-700">
                No data integrity issues found. Your system data is healthy.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </ResponsiveContainer>
  );
}
