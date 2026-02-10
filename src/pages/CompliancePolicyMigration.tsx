import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  Moon,
  Shield,
  Calendar,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface MigrationStats {
  totalRecords: number;
  recordsUpdated: number;
  overnightDetected: number;
  eveningWarnings: number;
}

export function CompliancePolicyMigration() {
  const { user } = useAuthStore();
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<MigrationStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only super admin can access this (support both email variations)
  const isSuperAdmin = user?.email === 'don.squire@firstsecurity.co.nz' || 
                       user?.email === 'don.squires@firstsecurity.co.nz';

  const runMigration = async () => {
    if (!isSuperAdmin) {
      toast.error('Unauthorized: Super admin access required');
      return;
    }

    setIsRunning(true);
    setError(null);
    setStats(null);

    try {
      console.log('🚀 Starting compliance policy migration...');
      
      const { data, error: invokeError } = await supabase.functions.invoke('update-compliance-policy', {
        body: {},
      });

      if (invokeError) {
        // Check if it's a FunctionsHttpError
        if (invokeError.context) {
          try {
            const statusCode = invokeError.context.status || 500;
            const textContent = await invokeError.context.text();
            throw new Error(`[${statusCode}] ${textContent || invokeError.message}`);
          } catch (e) {
            throw new Error(invokeError.message);
          }
        }
        throw invokeError;
      }

      if (data && data.success) {
        setStats(data.stats);
        toast.success('✅ Compliance policy update completed successfully', {
          description: `${data.stats.recordsUpdated} records updated`,
          duration: 5000,
        });
      } else {
        throw new Error(data?.error || 'Migration failed');
      }
    } catch (err: any) {
      console.error('Migration failed:', err);
      setError(err.message || 'Unknown error occurred');
      toast.error('Migration failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIsRunning(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Alert variant="destructive">
          <Shield className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            This page is restricted to super administrators only.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Compliance Policy Migration</h1>
        <p className="text-muted-foreground">
          Apply updated time-based compliance rules to all existing vehicle records
        </p>
      </div>

      {/* Warning Alert */}
      <Alert className="border-amber-500 bg-amber-500/10">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <AlertTitle className="text-amber-600">Important Information</AlertTitle>
        <AlertDescription className="space-y-2 text-sm">
          <p>This migration will:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Analyze all existing vehicle records</li>
            <li>Add notes to records recorded after 20:00 (overnight confirmed)</li>
            <li>Add notes to records recorded between 15:00-20:00 (evening warning)</li>
            <li>Use actual calendar months instead of 30-day periods</li>
            <li>Not modify compliance status or delete data</li>
          </ul>
          <p className="font-semibold mt-2">This is a one-time migration and can be run multiple times safely.</p>
        </AlertDescription>
      </Alert>

      {/* Policy Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Updated Policy Rules
          </CardTitle>
          <CardDescription>New time-based and calendar month enforcement</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div className="flex gap-3 p-3 border rounded-lg">
              <Moon className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm">Overnight Confirmation (20:00 - 05:00)</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Records created during these hours are automatically marked as overnight stays
                </p>
              </div>
            </div>

            <div className="flex gap-3 p-3 border rounded-lg">
              <Clock className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm">Evening Warning (15:00 - 20:00)</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Records during evening hours flagged as possible overnight stays
                </p>
              </div>
            </div>

            <div className="flex gap-3 p-3 border rounded-lg">
              <Calendar className="h-5 w-5 text-purple-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm">Calendar Month Tracking</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Monthly limits now use actual calendar months (Feb = 28/29 days, May = 31 days, etc.)
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Run Migration */}
      <Card>
        <CardHeader>
          <CardTitle>Run Migration</CardTitle>
          <CardDescription>
            Process all existing records and apply updated compliance notes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={runMigration}
            disabled={isRunning}
            size="lg"
            className="w-full"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Processing Records...
              </>
            ) : (
              <>
                <RefreshCw className="h-5 w-5 mr-2" />
                Start Migration
              </>
            )}
          </Button>

          {isRunning && (
            <Alert className="border-blue-500 bg-blue-500/10">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <AlertTitle className="text-blue-600">Migration in Progress</AlertTitle>
              <AlertDescription className="text-sm">
                Processing all vehicle records. This may take a minute...
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Migration Failed</AlertTitle>
              <AlertDescription className="text-sm">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {stats && (
            <Alert className="border-green-500 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertTitle className="text-green-600">Migration Complete</AlertTitle>
              <AlertDescription>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="p-2 bg-background rounded">
                    <p className="text-xs text-muted-foreground">Total Records</p>
                    <p className="text-lg font-bold">{stats.totalRecords}</p>
                  </div>
                  <div className="p-2 bg-background rounded">
                    <p className="text-xs text-muted-foreground">Updated</p>
                    <p className="text-lg font-bold text-green-600">{stats.recordsUpdated}</p>
                  </div>
                  <div className="p-2 bg-background rounded">
                    <p className="text-xs text-muted-foreground">Overnight Detected</p>
                    <p className="text-lg font-bold text-blue-600">{stats.overnightDetected}</p>
                  </div>
                  <div className="p-2 bg-background rounded">
                    <p className="text-xs text-muted-foreground">Evening Warnings</p>
                    <p className="text-lg font-bold text-amber-600">{stats.eveningWarnings}</p>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="border-blue-500/50 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="text-sm">Post-Migration Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>Review the migration statistics above</li>
            <li>Check a few updated records in Vehicle Management to verify notes were added</li>
            <li>New vehicle recordings will automatically use the updated policy</li>
            <li>This migration can be run again if new historical data is imported</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
