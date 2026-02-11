/**
 * System Diagnostics Page - Debug data access issues
 * 
 * This page helps diagnose:
 * - User profile and role configuration
 * - Organization assignments
 * - RLS policy application
 * - Data visibility issues
 * - Query performance
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Shield,
  User,
  Building2,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface DiagnosticResult {
  test: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: any;
  error?: string;
}

export function SystemDiagnostics() {
  const { user } = useAuthStore();
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<DiagnosticResult[]>([]);

  const runDiagnostics = async () => {
    setIsRunning(true);
    const diagnosticResults: DiagnosticResult[] = [];

    try {
      // Test 1: User Authentication
      console.log('🧪 [DIAGNOSTIC] Test 1: User Authentication');
      if (user?.id) {
        diagnosticResults.push({
          test: 'User Authentication',
          status: 'pass',
          message: 'User is authenticated',
          details: { user_id: user.id, email: user.email },
        });
      } else {
        diagnosticResults.push({
          test: 'User Authentication',
          status: 'fail',
          message: 'User is not authenticated',
        });
      }

      // Test 2: User Profile
      console.log('🧪 [DIAGNOSTIC] Test 2: User Profile');
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('id, email, role, organization_id, is_active, permissions, organizations(id, name)')
        .eq('id', user?.id)
        .single();

      if (profileError || !profile) {
        diagnosticResults.push({
          test: 'User Profile',
          status: 'fail',
          message: 'Failed to load user profile',
          error: profileError?.message,
        });
      } else {
        diagnosticResults.push({
          test: 'User Profile',
          status: 'pass',
          message: `Profile loaded: ${profile.email} (${profile.role})`,
          details: {
            role: profile.role,
            organization_id: profile.organization_id,
            organization_name: (profile.organizations as any)?.name,
            is_active: profile.is_active,
            permissions: profile.permissions,
          },
        });

        if (!profile.organization_id) {
          diagnosticResults.push({
            test: 'Organization Assignment',
            status: 'fail',
            message: 'User has no organization assigned',
            details: { user_id: user?.id },
          });
        } else {
          diagnosticResults.push({
            test: 'Organization Assignment',
            status: 'pass',
            message: `Assigned to: ${(profile.organizations as any)?.name}`,
            details: { organization_id: profile.organization_id },
          });
        }
      }

      // Test 3: RLS Helper Functions
      console.log('🧪 [DIAGNOSTIC] Test 3: RLS Helper Functions');
      try {
        const { data: rlsData, error: rlsError } = await supabase.rpc('get_user_role', {});
        
        if (rlsError) {
          diagnosticResults.push({
            test: 'RLS Functions',
            status: 'warning',
            message: 'RLS helper functions may have issues',
            error: rlsError.message,
          });
        } else {
          diagnosticResults.push({
            test: 'RLS Functions',
            status: 'pass',
            message: `RLS functions working: Role = ${rlsData}`,
            details: { role: rlsData },
          });
        }
      } catch (error: any) {
        diagnosticResults.push({
          test: 'RLS Functions',
          status: 'warning',
          message: 'Could not test RLS functions',
          error: error.message,
        });
      }

      // Test 4: Canonical Vehicles Access
      console.log('🧪 [DIAGNOSTIC] Test 4: Canonical Vehicles Access');
      const { data: vehicles, error: vehiclesError } = await supabase
        .from('canonical_vehicles')
        .select('plate_number, total_observations, last_seen_at')
        .limit(10);

      if (vehiclesError) {
        diagnosticResults.push({
          test: 'Canonical Vehicles Access',
          status: 'fail',
          message: 'Cannot access canonical_vehicles table',
          error: vehiclesError.message,
        });
      } else {
        diagnosticResults.push({
          test: 'Canonical Vehicles Access',
          status: 'pass',
          message: `Can access canonical_vehicles: ${vehicles?.length || 0} records fetched`,
          details: { count: vehicles?.length },
        });
      }

      // Test 5: Observations Access (filtered by org)
      console.log('🧪 [DIAGNOSTIC] Test 5: Observations Access');
      let obsQuery = supabase
        .from('vehicle_observations_v2')
        .select('observation_id, plate_number, organization_id, recorded_at', { count: 'exact' })
        .limit(10);

      if (profile?.organization_id && profile?.role !== 'master') {
        obsQuery = obsQuery.eq('organization_id', profile.organization_id);
      }

      const { data: observations, error: obsError, count: obsCount } = await obsQuery;

      if (obsError) {
        diagnosticResults.push({
          test: 'Observations Access',
          status: 'fail',
          message: 'Cannot access vehicle_observations_v2 table',
          error: obsError.message,
        });
      } else {
        diagnosticResults.push({
          test: 'Observations Access',
          status: 'pass',
          message: `Can access observations: ${obsCount || 0} total records`,
          details: {
            count: obsCount,
            sample_size: observations?.length,
            filtered_by_org: profile?.role !== 'master',
          },
        });
      }

      // Test 6: Zones Access
      console.log('🧪 [DIAGNOSTIC] Test 6: Zones Access');
      let zonesQuery = supabase
        .from('zones')
        .select('id, name, organization_id', { count: 'exact' })
        .eq('is_active', true);

      if (profile?.organization_id && profile?.role !== 'master') {
        zonesQuery = zonesQuery.eq('organization_id', profile.organization_id);
      }

      const { data: zones, error: zonesError, count: zonesCount } = await zonesQuery;

      if (zonesError) {
        diagnosticResults.push({
          test: 'Zones Access',
          status: 'fail',
          message: 'Cannot access zones table',
          error: zonesError.message,
        });
      } else {
        diagnosticResults.push({
          test: 'Zones Access',
          status: 'pass',
          message: `Can access zones: ${zonesCount || 0} zones available`,
          details: { count: zonesCount },
        });
      }

      // Test 7: Recent Activity Check
      console.log('🧪 [DIAGNOSTIC] Test 7: Recent Activity');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      let recentObsQuery = supabase
        .from('vehicle_observations_v2')
        .select('observation_id', { count: 'exact' })
        .gte('recorded_at', yesterday.toISOString());

      if (profile?.organization_id && profile?.role !== 'master') {
        recentObsQuery = recentObsQuery.eq('organization_id', profile.organization_id);
      }

      const { count: recentCount, error: recentError } = await recentObsQuery;

      if (recentError) {
        diagnosticResults.push({
          test: 'Recent Activity',
          status: 'warning',
          message: 'Could not check recent activity',
          error: recentError.message,
        });
      } else {
        diagnosticResults.push({
          test: 'Recent Activity',
          status: recentCount && recentCount > 0 ? 'pass' : 'warning',
          message: `${recentCount || 0} observations in last 24 hours`,
          details: { count: recentCount },
        });
      }

      // Test 8: Monthly Stays Access
      console.log('🧪 [DIAGNOSTIC] Test 8: Monthly Stays Access');
      let monthlyStaysQuery = supabase
        .from('vehicle_monthly_stays')
        .select('id', { count: 'exact' })
        .limit(10);

      if (profile?.organization_id && profile?.role !== 'master') {
        monthlyStaysQuery = monthlyStaysQuery.eq('organization_id', profile.organization_id);
      }

      const { count: staysCount, error: staysError } = await monthlyStaysQuery;

      if (staysError) {
        diagnosticResults.push({
          test: 'Monthly Stays Access',
          status: 'fail',
          message: 'Cannot access vehicle_monthly_stays table',
          error: staysError.message,
        });
      } else {
        diagnosticResults.push({
          test: 'Monthly Stays Access',
          status: 'pass',
          message: `Can access monthly stays: ${staysCount || 0} records`,
          details: { count: staysCount },
        });
      }

      setResults(diagnosticResults);
      
      const failCount = diagnosticResults.filter(r => r.status === 'fail').length;
      const warnCount = diagnosticResults.filter(r => r.status === 'warning').length;
      
      if (failCount > 0) {
        toast.error(`Diagnostics complete: ${failCount} failures, ${warnCount} warnings`);
      } else if (warnCount > 0) {
        toast.warning(`Diagnostics complete: ${warnCount} warnings`);
      } else {
        toast.success('All diagnostics passed!');
      }

    } catch (error: any) {
      console.error('❌ [DIAGNOSTIC] Fatal error:', error);
      diagnosticResults.push({
        test: 'System Health',
        status: 'fail',
        message: 'Critical diagnostic failure',
        error: error.message,
      });
      setResults(diagnosticResults);
      toast.error('Diagnostic tests failed: ' + error.message);
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: 'pass' | 'fail' | 'warning') => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'fail':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-amber-600" />;
    }
  };

  const getStatusColor = (status: 'pass' | 'fail' | 'warning') => {
    switch (status) {
      case 'pass':
        return 'border-green-500/30 bg-green-50 dark:bg-green-950/20';
      case 'fail':
        return 'border-red-500/30 bg-red-50 dark:bg-red-950/20';
      case 'warning':
        return 'border-amber-500/30 bg-amber-50 dark:bg-amber-950/20';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold mb-1 flex items-center gap-3">
            <Activity className="h-8 w-8 text-primary" />
            System Diagnostics
          </h2>
          <p className="text-muted-foreground">
            Debug data access issues and verify system configuration
          </p>
        </div>
        <Button onClick={runDiagnostics} disabled={isRunning}>
          {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Run Diagnostics
        </Button>
      </div>

      {/* Results Summary */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-2 border-green-500/30 bg-green-50 dark:bg-green-950/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-green-700 dark:text-green-300">Passed</div>
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div className="text-3xl font-bold text-green-600 mt-1">
                {results.filter(r => r.status === 'pass').length}
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-amber-700 dark:text-amber-300">Warnings</div>
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div className="text-3xl font-bold text-amber-600 mt-1">
                {results.filter(r => r.status === 'warning').length}
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-red-500/30 bg-red-50 dark:bg-red-950/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-red-700 dark:text-red-300">Failed</div>
                <XCircle className="h-5 w-5 text-red-600" />
              </div>
              <div className="text-3xl font-bold text-red-600 mt-1">
                {results.filter(r => r.status === 'fail').length}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Diagnostic Results */}
      <div className="space-y-3">
        {results.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Click "Run Diagnostics" to test system configuration</p>
            </CardContent>
          </Card>
        ) : (
          results.map((result, index) => (
            <Card key={index} className={`border-2 ${getStatusColor(result.status)}`}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(result.status)}
                    <span>{result.test}</span>
                  </div>
                  <Badge variant={result.status === 'pass' ? 'default' : result.status === 'fail' ? 'destructive' : 'secondary'}>
                    {result.status.toUpperCase()}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium mb-2">{result.message}</p>
                
                {result.error && (
                  <div className="mt-2 p-2 bg-red-100 dark:bg-red-950/30 rounded text-xs text-red-900 dark:text-red-100 font-mono">
                    <strong>Error:</strong> {result.error}
                  </div>
                )}

                {result.details && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      View Details
                    </summary>
                    <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                      {JSON.stringify(result.details, null, 2)}
                    </pre>
                  </details>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Instructions */}
      <Card className="border-2 border-blue-500/30 bg-blue-50 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 text-blue-900 dark:text-blue-100">
            <Eye className="h-4 w-4" />
            Diagnostic Guide
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-blue-800 dark:text-blue-200">
          <p>
            <strong>User Authentication:</strong> Verifies you are logged in
          </p>
          <p>
            <strong>User Profile:</strong> Checks your role, organization assignment, and permissions
          </p>
          <p>
            <strong>Organization Assignment:</strong> Confirms you have an organization (required for non-master users)
          </p>
          <p>
            <strong>RLS Functions:</strong> Tests database security helper functions
          </p>
          <p>
            <strong>Table Access Tests:</strong> Verifies you can read from canonical_vehicles, observations, zones, and monthly_stays
          </p>
          <p>
            <strong>Recent Activity:</strong> Checks if there's data in the last 24 hours
          </p>
          <p className="mt-4 text-xs italic">
            If you see failures or warnings, take a screenshot and contact the system administrator with the error details.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
