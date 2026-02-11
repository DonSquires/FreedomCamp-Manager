import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Database, ArrowRight, CheckCircle, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';

interface MigrationStats {
  oldRecordsCount: number;
  newRecordsCount: number;
  recordsMigrated: number;
  recordsFailed: number;
  inProgress: boolean;
  progress: number;
}

export function DataMigrationUtility() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<MigrationStats>({
    oldRecordsCount: 0,
    newRecordsCount: 0,
    recordsMigrated: 0,
    recordsFailed: 0,
    inProgress: false,
    progress: 0,
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);

  const analyzeData = async () => {
    setIsAnalyzing(true);
    try {
      // Count old vehicle_records
      const { count: oldCount, error: oldError } = await supabase
        .from('vehicle_records')
        .select('*', { count: 'exact', head: true });

      if (oldError) throw oldError;

      // Count new vehicle_observations_v2
      const { count: newCount, error: newError } = await supabase
        .from('vehicle_observations_v2')
        .select('*', { count: 'exact', head: true });

      if (newError) throw newError;

      setStats({
        ...stats,
        oldRecordsCount: oldCount || 0,
        newRecordsCount: newCount || 0,
      });
      setAnalyzed(true);
      toast.success('Analysis complete');
    } catch (error: any) {
      console.error('Analysis failed:', error);
      toast.error('Analysis failed: ' + error.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const migrateRecords = async () => {
    if (!user || user.role !== 'admin' && user.role !== 'master') {
      toast.error('Admin privileges required for migration');
      return;
    }

    setStats({ ...stats, inProgress: true, recordsMigrated: 0, recordsFailed: 0, progress: 0 });

    try {
      toast.info('🚀 Starting migration from vehicle_records to vehicle_observations_v2...');

      // Fetch all vehicle_records in batches
      const batchSize = 100;
      let offset = 0;
      let hasMore = true;
      let totalMigrated = 0;
      let totalFailed = 0;

      while (hasMore) {
        const { data: oldRecords, error: fetchError } = await supabase
          .from('vehicle_records')
          .select('*')
          .range(offset, offset + batchSize - 1);

        if (fetchError) throw fetchError;

        if (!oldRecords || oldRecords.length === 0) {
          hasMore = false;
          break;
        }

        // Transform and insert into vehicle_observations_v2
        const transformedRecords = oldRecords.map(record => ({
          plate_number: record.plate_number,
          vehicle_make: record.vehicle_make,
          vehicle_model: record.vehicle_model,
          vehicle_color: record.vehicle_color,
          self_contained: record.is_self_contained || false,
          self_contained_expiry: null, // Not in old schema
          photo: record.evidence_photos?.[0] || null, // Take first photo
          photo_hash: null, // Will be generated if needed
          gps_latitude: record.gps_latitude,
          gps_longitude: record.gps_longitude,
          gps_accuracy: record.gps_accuracy,
          recorded_at: record.recorded_at,
          organization_id: record.organization_id,
          zone_id: record.zone_id,
          recorded_by: record.recorded_by,
          officer_notes: record.notes || '',
          has_notes: !!record.notes,
          notes_reference_previous: false,
          has_hs_incident: false,
          hs_incident_id: null,
          has_incident: false,
          incident_id: null,
          has_homeless_claim: record.homeless_claimed || false,
          homeless_claim_notes: record.homeless_confirmation_notes || '',
          breach_warning: !record.is_compliant,
          breach_warning_reason: record.followup_reason || null,
          is_breach: !record.is_compliant,
          breach_type: !record.is_compliant ? 'compliance_violation' : null,
          breach_details: record.behavioral_flags ? { flags: record.behavioral_flags } : null,
          breach_detected_at: !record.is_compliant ? record.recorded_at : null,
          compliance_snapshot: null,
          is_compliant: record.is_compliant,
        }));

        // Batch insert (upsert to avoid duplicates)
        const { error: insertError } = await supabase
          .from('vehicle_observations_v2')
          .upsert(transformedRecords, { 
            onConflict: 'plate_number,zone_id,recorded_at,organization_id',
            ignoreDuplicates: true 
          });

        if (insertError) {
          console.error('Batch insert error:', insertError);
          totalFailed += oldRecords.length;
        } else {
          totalMigrated += oldRecords.length;
        }

        offset += batchSize;
        const progress = Math.min(100, (offset / stats.oldRecordsCount) * 100);
        
        setStats(prev => ({
          ...prev,
          recordsMigrated: totalMigrated,
          recordsFailed: totalFailed,
          progress,
        }));
      }

      toast.success(`✅ Migration complete! ${totalMigrated} records migrated, ${totalFailed} failed`);
      
      // Re-analyze after migration
      await analyzeData();
    } catch (error: any) {
      console.error('Migration failed:', error);
      toast.error('Migration failed: ' + error.message);
    } finally {
      setStats(prev => ({ ...prev, inProgress: false }));
    }
  };

  const canMigrate = user?.role === 'admin' || user?.role === 'master';

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-6">
      <div>
        <h2 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Database className="h-8 w-8" />
          Data Migration Utility
        </h2>
        <p className="text-muted-foreground">
          Migrate records from old schema (vehicle_records) to new schema (vehicle_observations_v2)
        </p>
      </div>

      {/* Warning */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Before migrating:</strong> This will copy all vehicle_records to vehicle_observations_v2. 
          Existing records in the new table will not be duplicated. Admin privileges required.
        </AlertDescription>
      </Alert>

      {/* Analysis Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Database Analysis</span>
            <Button 
              onClick={analyzeData} 
              disabled={isAnalyzing}
              variant="outline"
              size="sm"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  {analyzed ? 'Re-analyze' : 'Analyze'}
                </>
              )}
            </Button>
          </CardTitle>
          <CardDescription>
            Check how many records exist in old vs new tables
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Old Table */}
            <div className="text-center p-6 border rounded-lg bg-red-500/5 border-red-500/20">
              <p className="text-sm text-muted-foreground mb-2">Old Schema</p>
              <p className="text-xs font-mono text-muted-foreground mb-3">vehicle_records</p>
              <p className="text-4xl font-bold text-red-500">
                {analyzed ? stats.oldRecordsCount.toLocaleString() : '--'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">Records to migrate</p>
            </div>

            {/* Arrow */}
            <div className="flex items-center justify-center">
              <ArrowRight className="h-12 w-12 text-muted-foreground" />
            </div>

            {/* New Table */}
            <div className="text-center p-6 border rounded-lg bg-green-500/5 border-green-500/20">
              <p className="text-sm text-muted-foreground mb-2">New Schema</p>
              <p className="text-xs font-mono text-muted-foreground mb-3">vehicle_observations_v2</p>
              <p className="text-4xl font-bold text-green-500">
                {analyzed ? stats.newRecordsCount.toLocaleString() : '--'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">Existing records</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Migration Card */}
      <Card className={stats.inProgress ? 'border-primary' : ''}>
        <CardHeader>
          <CardTitle>Migration Process</CardTitle>
          <CardDescription>
            Copy all vehicle_records to vehicle_observations_v2 with schema transformation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!canMigrate && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Admin or Master role required to perform migration
              </AlertDescription>
            </Alert>
          )}

          {stats.inProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Migration Progress</span>
                <span className="font-mono">{Math.round(stats.progress)}%</span>
              </div>
              <Progress value={stats.progress} className="h-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>✅ Migrated: {stats.recordsMigrated.toLocaleString()}</span>
                <span>❌ Failed: {stats.recordsFailed.toLocaleString()}</span>
              </div>
            </div>
          )}

          {stats.recordsMigrated > 0 && !stats.inProgress && (
            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <p className="font-semibold text-green-600">Migration Complete!</p>
              </div>
              <div className="text-sm text-green-600 space-y-1">
                <p>✅ Successfully migrated: {stats.recordsMigrated.toLocaleString()} records</p>
                {stats.recordsFailed > 0 && (
                  <p>❌ Failed: {stats.recordsFailed.toLocaleString()} records</p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Ready to migrate?</p>
              <p className="text-xs text-muted-foreground">
                This process may take several minutes depending on record count
              </p>
            </div>
            <Button
              onClick={migrateRecords}
              disabled={!analyzed || stats.inProgress || !canMigrate || stats.oldRecordsCount === 0}
              size="lg"
            >
              {stats.inProgress ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Migrating...
                </>
              ) : (
                <>
                  <Database className="h-4 w-4 mr-2" />
                  Start Migration
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Schema Differences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Schema Transformation Details</CardTitle>
          <CardDescription>
            How data is transformed from old to new schema
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
              <div>
                <Badge variant="outline" className="mb-2">Old Field</Badge>
                <p className="font-mono text-xs">vehicle_records.id</p>
              </div>
              <div>
                <Badge variant="outline" className="mb-2">New Field</Badge>
                <p className="font-mono text-xs">vehicle_observations_v2.observation_id</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
              <div>
                <Badge variant="outline" className="mb-2">Old Field</Badge>
                <p className="font-mono text-xs">is_self_contained</p>
              </div>
              <div>
                <Badge variant="outline" className="mb-2">New Field</Badge>
                <p className="font-mono text-xs">self_contained</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
              <div>
                <Badge variant="outline" className="mb-2">Old Field</Badge>
                <p className="font-mono text-xs">evidence_photos[0]</p>
              </div>
              <div>
                <Badge variant="outline" className="mb-2">New Field</Badge>
                <p className="font-mono text-xs">photo</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
              <div>
                <Badge variant="outline" className="mb-2">Old Field</Badge>
                <p className="font-mono text-xs">notes</p>
              </div>
              <div>
                <Badge variant="outline" className="mb-2">New Field</Badge>
                <p className="font-mono text-xs">officer_notes</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded">
              <div>
                <Badge variant="outline" className="mb-2">Old Field</Badge>
                <p className="font-mono text-xs">homeless_claimed</p>
              </div>
              <div>
                <Badge variant="outline" className="mb-2">New Field</Badge>
                <p className="font-mono text-xs">has_homeless_claim</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
