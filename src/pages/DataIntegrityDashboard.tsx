/**
 * Data Integrity Dashboard - Verify All Tables are Properly Populated
 * 
 * Checks:
 * 1. observations → canonical_vehicles mapping
 * 2. vehicle_monthly_stays population
 * 3. compliance_results linking
 * 4. breach_alerts creation
 * 5. Orphaned records detection
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Database,
  TrendingUp,
} from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface IntegrityCheck {
  name: string;
  description: string;
  status: 'pending' | 'checking' | 'passed' | 'failed' | 'warning';
  result?: {
    expected: number;
    actual: number;
    missing?: number;
    percentage?: number;
    details?: any;
  };
  action?: string;
}

export function DataIntegrityDashboard() {
  const queryClient = useQueryClient();
  const [checks, setChecks] = useState<IntegrityCheck[]>([
    {
      name: 'Canonical Vehicles',
      description: 'Every observation should have a canonical vehicle record',
      status: 'pending',
    },
    {
      name: 'Monthly Stays Population',
      description: 'vehicle_monthly_stays should track all observations',
      status: 'pending',
      action: 'backfill_monthly_stays_from_observations',
    },
    {
      name: 'Compliance Results',
      description: 'Recent observations should have compliance results',
      status: 'pending',
    },
    {
      name: 'Breach Alerts',
      description: 'Non-compliant observations should have breach alerts',
      status: 'pending',
    },
    {
      name: 'Orphaned Observations',
      description: 'Observations without valid zone/organization references',
      status: 'pending',
    },
    {
      name: 'Duplicate Observations',
      description: 'Check for duplicate records in observations',
      status: 'pending',
    },
    {
      name: 'Duplicate Monthly Stays',
      description: 'Check for duplicate records in vehicle_monthly_stays',
      status: 'pending',
    },
  ]);

  const runIntegrityChecksMutation = useMutation({
    mutationFn: async () => {
      const results: IntegrityCheck[] = [...checks];

      // CHECK 1: Canonical Vehicles
      results[0].status = 'checking';
      setChecks([...results]);

      const { data: obsCount } = await supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true });

      const { data: canonicalCount } = await supabase
        .from('canonical_vehicles')
        .select('plate_number', { count: 'exact', head: true });

      // Get observations with missing canonical vehicles
      const { data: orphanedObs } = await supabase
        .from('observations')
        .select('plate_number')
        .not('plate_number', 'in', `(SELECT plate_number FROM canonical_vehicles)`)
        .limit(10);

      const uniquePlatesInObs = await supabase.rpc('get_unique_plate_count_from_observations');

      results[0].result = {
        expected: uniquePlatesInObs || 0,
        actual: canonicalCount || 0,
        missing: (uniquePlatesInObs || 0) - (canonicalCount || 0),
        percentage: uniquePlatesInObs ? ((canonicalCount || 0) / uniquePlatesInObs) * 100 : 0,
        details: { orphanedSample: orphanedObs?.slice(0, 5) },
      };
      results[0].status = results[0].result.missing === 0 ? 'passed' : 'failed';
      setChecks([...results]);

      // CHECK 2: Monthly Stays Population
      results[1].status = 'checking';
      setChecks([...results]);

      const { data: monthlyStaysCount } = await supabase
        .from('vehicle_monthly_stays')
        .select('id', { count: 'exact', head: true });

      // Get observations grouped by plate/zone/month that should have monthly stays
      const { data: expectedStays } = await supabase.rpc('get_expected_monthly_stays_count');

      results[1].result = {
        expected: expectedStays || 0,
        actual: monthlyStaysCount || 0,
        missing: (expectedStays || 0) - (monthlyStaysCount || 0),
        percentage: expectedStays ? ((monthlyStaysCount || 0) / expectedStays) * 100 : 0,
      };
      results[1].status = results[1].result.percentage >= 95 ? 'passed' : 
                          results[1].result.percentage >= 50 ? 'warning' : 'failed';
      setChecks([...results]);

      // CHECK 3: Compliance Results
      results[2].status = 'checking';
      setChecks([...results]);

      // Check last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const { data: recentObs } = await supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })
        .gte('recorded_at', ninetyDaysAgo.toISOString());

      const { data: complianceCount } = await supabase
        .from('compliance_results')
        .select('id', { count: 'exact', head: true });

      results[2].result = {
        expected: recentObs || 0,
        actual: complianceCount || 0,
        missing: (recentObs || 0) - (complianceCount || 0),
        percentage: recentObs ? ((complianceCount || 0) / recentObs) * 100 : 0,
      };
      results[2].status = results[2].result.percentage >= 90 ? 'passed' : 
                          results[2].result.percentage >= 50 ? 'warning' : 'failed';
      setChecks([...results]);

      // CHECK 4: Breach Alerts
      results[3].status = 'checking';
      setChecks([...results]);

      const { data: nonCompliantCount } = await supabase
        .from('compliance_results')
        .select('id', { count: 'exact', head: true })
        .eq('is_compliant', false);

      const { data: breachAlertsCount } = await supabase
        .from('breach_alerts')
        .select('id', { count: 'exact', head: true });

      results[3].result = {
        expected: nonCompliantCount || 0,
        actual: breachAlertsCount || 0,
        missing: Math.max(0, (nonCompliantCount || 0) - (breachAlertsCount || 0)),
        percentage: nonCompliantCount ? ((breachAlertsCount || 0) / nonCompliantCount) * 100 : 100,
      };
      results[3].status = results[3].result.percentage >= 80 ? 'passed' : 
                          results[3].result.percentage >= 40 ? 'warning' : 'failed';
      setChecks([...results]);

      // CHECK 5: Orphaned Observations
      results[4].status = 'checking';
      setChecks([...results]);

      const { data: orphanedZones } = await supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })
        .is('zone_id', null);

      const { data: orphanedOrgs } = await supabase
        .from('observations')
        .select('observation_id', { count: 'exact', head: true })
        .is('organization_id', null);

      results[4].result = {
        expected: obsCount || 0,
        actual: (obsCount || 0) - (orphanedZones || 0) - (orphanedOrgs || 0),
        missing: (orphanedZones || 0) + (orphanedOrgs || 0),
        percentage: obsCount ? (((obsCount || 0) - (orphanedZones || 0) - (orphanedOrgs || 0)) / obsCount) * 100 : 100,
        details: { orphanedZones, orphanedOrgs },
      };
      results[4].status = results[4].result.missing === 0 ? 'passed' : 'warning';
      setChecks([...results]);

      // CHECK 6: Duplicate Observations in observations
      results[5].status = 'checking';
      setChecks([...results]);

      // Check for duplicates based on unique constraint (plate_number, zone_id, recorded_at, organization_id)
      const { data: duplicateObs, error: dupObsError } = await supabase.rpc(
        'check_duplicate_observations'
      );

      if (dupObsError) {
        console.error('Error checking duplicate observations:', dupObsError);
        results[5].status = 'failed';
        results[5].result = {
          expected: obsCount || 0,
          actual: 0,
          missing: 0,
          percentage: 0,
          details: { error: dupObsError.message },
        };
      } else {
        const duplicateCount = duplicateObs || 0;
        results[5].result = {
          expected: obsCount || 0,
          actual: (obsCount || 0) - duplicateCount,
          missing: duplicateCount,
          percentage: obsCount ? (((obsCount || 0) - duplicateCount) / obsCount) * 100 : 100,
          details: { duplicates: duplicateCount },
        };
        results[5].status = duplicateCount === 0 ? 'passed' : 'failed';
      }
      setChecks([...results]);

      // CHECK 7: Duplicate Monthly Stays
      results[6].status = 'checking';
      setChecks([...results]);

      // Check for duplicates based on unique constraint (plate_number, organization_id, zone_id, calendar_month)
      const { data: duplicateStays, error: dupStaysError } = await supabase.rpc(
        'check_duplicate_monthly_stays'
      );

      if (dupStaysError) {
        console.error('Error checking duplicate monthly stays:', dupStaysError);
        results[6].status = 'failed';
        results[6].result = {
          expected: monthlyStaysCount || 0,
          actual: 0,
          missing: 0,
          percentage: 0,
          details: { error: dupStaysError.message },
        };
      } else {
        const duplicateStaysCount = duplicateStays || 0;
        results[6].result = {
          expected: monthlyStaysCount || 0,
          actual: (monthlyStaysCount || 0) - duplicateStaysCount,
          missing: duplicateStaysCount,
          percentage: monthlyStaysCount ? (((monthlyStaysCount || 0) - duplicateStaysCount) / monthlyStaysCount) * 100 : 100,
          details: { duplicates: duplicateStaysCount },
        };
        results[6].status = duplicateStaysCount === 0 ? 'passed' : 'failed';
      }
      setChecks([...results]);

      return results;
    },
    onSuccess: (results) => {
      setChecks(results);
      const failed = results.filter(r => r.status === 'failed').length;
      const warnings = results.filter(r => r.status === 'warning').length;

      if (failed === 0 && warnings === 0) {
        toast.success('✅ All integrity checks passed!');
      } else if (failed > 0) {
        toast.error(`❌ ${failed} checks failed, ${warnings} warnings`);
      } else {
        toast.warning(`⚠️ ${warnings} checks have warnings`);
      }
    },
    onError: (error: any) => {
      toast.error('Failed to run integrity checks: ' + error.message);
    },
  });

  const fixMonthlyStaysMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('backfill_monthly_stays_from_observations');
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('✅ Monthly stays backfilled successfully!');
      queryClient.invalidateQueries({ queryKey: ['integrity_checks'] });
      runIntegrityChecksMutation.mutate();
    },
    onError: (error: any) => {
      toast.error('Failed to backfill monthly stays: ' + error.message);
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-amber-500" />;
      case 'checking':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      default:
        return <Database className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      passed: 'default',
      failed: 'destructive',
      warning: 'secondary',
      checking: 'outline',
      pending: 'outline',
    };
    return <Badge variant={variants[status]}>{status.toUpperCase()}</Badge>;
  };

  return (
    <ResponsiveContainer maxWidth="2xl" padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Database className="h-8 w-8 text-blue-500" />
            Data Integrity Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Verify all tables are properly populated and linked
          </p>
        </div>

        {/* Run Checks Button */}
        <Card>
          <CardContent className="pt-6">
            <Button
              onClick={() => runIntegrityChecksMutation.mutate()}
              disabled={runIntegrityChecksMutation.isPending}
              className="w-full h-12"
              size="lg"
            >
              {runIntegrityChecksMutation.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Running Checks...
                </>
              ) : (
                <>
                  <RefreshCw className="h-5 w-5 mr-2" />
                  Run Integrity Checks
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Integrity Checks */}
        <div className="space-y-4">
          {checks.map((check, index) => (
            <Card key={index} className={
              check.status === 'failed' ? 'border-red-500' :
              check.status === 'warning' ? 'border-amber-500' :
              check.status === 'passed' ? 'border-green-500' : ''
            }>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {getStatusIcon(check.status)}
                    <div>
                      <CardTitle className="text-base">{check.name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {check.description}
                      </p>
                    </div>
                  </div>
                  {getStatusBadge(check.status)}
                </div>
              </CardHeader>

              {check.result && (
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Expected</p>
                      <p className="text-lg font-bold">{check.result.expected.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Actual</p>
                      <p className="text-lg font-bold">{check.result.actual.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Missing</p>
                      <p className="text-lg font-bold text-red-600">
                        {check.result.missing?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Coverage</p>
                      <p className="text-lg font-bold">
                        {check.result.percentage?.toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  {check.status === 'failed' && check.action && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Action Required</AlertTitle>
                      <AlertDescription className="mt-2">
                        <p className="mb-3">
                          {check.result.missing} records are missing. This will cause incorrect compliance calculations.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (check.action === 'backfill_monthly_stays_from_observations') {
                              fixMonthlyStaysMutation.mutate();
                            }
                          }}
                          disabled={fixMonthlyStaysMutation.isPending}
                        >
                          {fixMonthlyStaysMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Fixing...
                            </>
                          ) : (
                            <>
                              <TrendingUp className="h-4 w-4 mr-2" />
                              Run {check.action}
                            </>
                          )}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {check.result.details && (
                    <div className="mt-3 p-3 bg-muted rounded">
                      <p className="text-xs font-semibold mb-2">Additional Details:</p>
                      <div className="space-y-1 text-xs">
                        {Object.entries(check.result.details).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2">
                            <span className="font-semibold text-muted-foreground">{key.replace(/_/g, ' ')}:</span>
                            <span className="font-mono">
                              {typeof value === 'object' 
                                ? Array.isArray(value) 
                                  ? `${value.length} items`
                                  : JSON.stringify(value)
                                : String(value)
                              }
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </div>
    </ResponsiveContainer>
  );
}
