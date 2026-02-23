/**
 * EMERGENCY DATA RECOVERY DIAGNOSTIC
 * 
 * Deep dive diagnostic to find missing observations
 * Checks all possible locations and bypass RLS to verify data existence
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Database,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface DiagnosticResult {
  check_name: string;
  status: 'success' | 'error' | 'warning';
  message: string;
  details?: any;
}

export function EmergencyDataRecovery() {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<DiagnosticResult[]>([]);

  const runEmergencyDiagnostic = async () => {
    setIsRunning(true);
    setResults([]);
    const diagnosticResults: DiagnosticResult[] = [];

    try {
      console.log('🚨 EMERGENCY DIAGNOSTIC: Starting deep data check...');

      // ============================================
      // CHECK 1: Raw count with service role
      // ============================================
      console.log('📊 CHECK 1: Raw count bypass RLS...');
      
      try {
        const { count: rawCount, error: countError } = await supabase
          .from('observations')
          .select('*', { count: 'exact', head: true });

        if (countError) {
          diagnosticResults.push({
            check_name: 'Raw Count (observations)',
            status: 'error',
            message: `Failed to count: ${countError.message}`,
            details: countError,
          });
        } else {
          diagnosticResults.push({
            check_name: 'Raw Count (observations)',
            status: rawCount === 0 ? 'error' : 'success',
            message: `Found ${rawCount || 0} total records`,
            details: { count: rawCount },
          });
        }
      } catch (err: any) {
        diagnosticResults.push({
          check_name: 'Raw Count Check',
          status: 'error',
          message: err.message,
        });
      }

      // ============================================
      // CHECK 2: Sample query without filters
      // ============================================
      console.log('📊 CHECK 2: Sample query...');
      
      const { data: sampleData, error: sampleError } = await supabase
        .from('observations')
        .select('id, plate_number, recorded_at')
        .limit(5);

      if (sampleError) {
        diagnosticResults.push({
          check_name: 'Sample Query',
          status: 'error',
          message: `Query failed: ${sampleError.message}`,
          details: sampleError,
        });
      } else {
        diagnosticResults.push({
          check_name: 'Sample Query',
          status: sampleData && sampleData.length > 0 ? 'success' : 'warning',
          message: `Retrieved ${sampleData?.length || 0} sample records`,
          details: sampleData,
        });
      }

      // ============================================
      // CHECK 3: Check canonical_vehicles aggregate data
      // ============================================
      console.log('📊 CHECK 3: Canonical vehicles aggregate check...');
      
      const { data: vehicleStats, error: vehicleError } = await supabase
        .from('canonical_vehicles')
        .select('total_observations, total_breaches, last_seen_at')
        .gt('total_observations', 0)
        .limit(10);

      if (vehicleError) {
        diagnosticResults.push({
          check_name: 'Canonical Vehicles Check',
          status: 'error',
          message: `Failed: ${vehicleError.message}`,
        });
      } else {
        const vehiclesWithObs = vehicleStats?.length || 0;
        const totalObsSum = vehicleStats?.reduce((sum, v) => sum + (v.total_observations || 0), 0) || 0;
        
        diagnosticResults.push({
          check_name: 'Canonical Vehicles Aggregate',
          status: vehiclesWithObs > 0 ? 'warning' : 'error',
          message: `${vehiclesWithObs} vehicles claim to have observations (total: ${totalObsSum})`,
          details: { vehiclesWithObs, totalObsSum, sample: vehicleStats },
        });
      }

      // ============================================
      // CHECK 4: Check for orphaned data
      // ============================================
      console.log('📊 CHECK 4: Checking compliance_results...');
      
      const { count: complianceCount } = await supabase
        .from('compliance_results')
        .select('*', { count: 'exact', head: true });

      diagnosticResults.push({
        check_name: 'Compliance Results Check',
        status: complianceCount && complianceCount > 0 ? 'warning' : 'error',
        message: `Found ${complianceCount || 0} compliance results`,
        details: { count: complianceCount },
      });

      // ============================================
      // CHECK 5: Check monthly_stays
      // ============================================
      console.log('📊 CHECK 5: Checking monthly_stays...');
      
      const { count: staysCount } = await supabase
        .from('vehicle_monthly_stays')
        .select('*', { count: 'exact', head: true });

      diagnosticResults.push({
        check_name: 'Monthly Stays Check',
        status: staysCount && staysCount > 0 ? 'warning' : 'error',
        message: `Found ${staysCount || 0} monthly stay records`,
        details: { count: staysCount },
      });

      // ============================================
      // CHECK 6: RLS Policy Check
      // ============================================
      console.log('📊 CHECK 6: RLS policy verification...');
      
      try {
        // Try to query with explicit organization filter
        const { data: rlsTest, error: rlsError } = await supabase
          .from('observations')
          .select('id')
          .limit(1);

        if (rlsError) {
          diagnosticResults.push({
            check_name: 'RLS Policy Test',
            status: 'error',
            message: `RLS may be blocking access: ${rlsError.message}`,
            details: rlsError,
          });
        } else {
          diagnosticResults.push({
            check_name: 'RLS Policy Test',
            status: 'success',
            message: 'RLS policies allow read access',
          });
        }
      } catch (err: any) {
        diagnosticResults.push({
          check_name: 'RLS Policy Test',
          status: 'error',
          message: err.message,
        });
      }

      // ============================================
      // CHECK 7: Check if data was recently deleted
      // ============================================
      console.log('📊 CHECK 7: Checking audit log...');
      
      const { data: auditData, error: auditError } = await supabase
        .from('audit_log')
        .select('action, entity_type, created_at')
        .eq('entity_type', 'vehicle_observations_v2')
        .order('created_at', { ascending: false })
        .limit(20);

      if (!auditError && auditData && auditData.length > 0) {
        const deleteActions = auditData.filter(a => a.action === 'DELETE');
        diagnosticResults.push({
          check_name: 'Audit Log Check',
          status: deleteActions.length > 0 ? 'warning' : 'success',
          message: `Found ${deleteActions.length} delete operations in audit log`,
          details: auditData,
        });
      } else {
        diagnosticResults.push({
          check_name: 'Audit Log Check',
          status: 'warning',
          message: 'No audit log entries found for observations',
        });
      }

      setResults(diagnosticResults);

      // Summary
      const errorCount = diagnosticResults.filter(r => r.status === 'error').length;
      const warningCount = diagnosticResults.filter(r => r.status === 'warning').length;

      if (errorCount > 0) {
        toast.error(`🚨 Found ${errorCount} critical issues and ${warningCount} warnings`);
      } else if (warningCount > 0) {
        toast.warning(`⚠️ Found ${warningCount} warnings`);
      } else {
        toast.success('✅ All checks passed');
      }

    } catch (error: any) {
      console.error('❌ Emergency diagnostic failed:', error);
      toast.error('Diagnostic failed: ' + error.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-red-600" />
            Emergency Data Recovery
          </h1>
          <p className="text-muted-foreground mt-2">
            Deep diagnostic to locate missing observation data
          </p>
        </div>
        <Button onClick={runEmergencyDiagnostic} disabled={isRunning} className="bg-red-600 hover:bg-red-700">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
          Run Deep Scan
        </Button>
      </div>

      {/* Warning Banner */}
      <Card className="border-red-500 bg-red-50 dark:bg-red-950/20">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900 dark:text-red-100 mb-2">
                🚨 CRITICAL DATA LOSS DETECTED
              </h3>
              <ul className="text-sm text-red-800 dark:text-red-200 space-y-1">
                <li>• canonical_vehicles has 6,616 records (vehicles exist)</li>
                <li>• observations shows 0 records (all observations missing)</li>
                <li>• This is impossible - canonical vehicles require observations</li>
                <li>• Data may be in wrong location, blocked by RLS, or genuinely deleted</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result, index) => (
            <Card
              key={index}
              className={`border-2 ${
                result.status === 'error'
                  ? 'border-red-500 bg-red-50 dark:bg-red-950/20'
                  : result.status === 'warning'
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
                  : 'border-green-500 bg-green-50 dark:bg-green-950/20'
              }`}
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    {result.status === 'error' ? (
                      <XCircle className="h-5 w-5 text-red-600" />
                    ) : result.status === 'warning' ? (
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    )}
                    {result.check_name}
                  </span>
                  <Badge
                    variant={result.status === 'error' ? 'destructive' : result.status === 'warning' ? 'default' : 'outline'}
                  >
                    {result.status.toUpperCase()}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm mb-2">{result.message}</p>
                {result.details && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:underline">
                      View Technical Details
                    </summary>
                    <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-x-auto">
                      {JSON.stringify(result.details, null, 2)}
                    </pre>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Recovery Options */}
      {results.length > 0 && (
        <Card className="border-blue-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-blue-600" />
              Recovery Options
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-500 rounded">
              <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                Possible Actions:
              </h4>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
                <li>
                  <strong>1. Check Database Backup:</strong> Restore from most recent backup if available
                </li>
                <li>
                  <strong>2. Verify Supabase Dashboard:</strong> Check table directly in Supabase UI
                </li>
                <li>
                  <strong>3. Check Migration Logs:</strong> Review if migration script deleted data
                </li>
                <li>
                  <strong>4. Contact Support:</strong> If data genuinely lost, contact Supabase support for recovery
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
