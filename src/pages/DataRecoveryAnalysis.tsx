/**
 * DATA RECOVERY ANALYSIS
 * 
 * Analyzes what observation data can be recovered from related tables
 * Checks vehicle_monthly_stays, compliance_results, incidents, enforcement_actions
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Database,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

interface RecoverySource {
  table_name: string;
  record_count: number;
  has_observation_ids: boolean;
  sample_data: any[];
  recovery_potential: 'high' | 'medium' | 'low' | 'none';
  notes: string;
}

interface RecoveryPlan {
  total_recoverable: number;
  unique_observation_ids: number;
  data_sources: RecoverySource[];
  what_we_keep: string[];
  what_we_lose: string[];
}

export function DataRecoveryAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [recoveryPlan, setRecoveryPlan] = useState<RecoveryPlan | null>(null);

  const analyzeRecoveryPotential = async () => {
    setIsAnalyzing(true);
    setRecoveryPlan(null);

    try {
      console.log('🔍 RECOVERY ANALYSIS: Checking all data sources...');
      
      const sources: RecoverySource[] = [];
      const allObservationIds = new Set<string>();

      // ============================================
      // SOURCE 1: vehicle_monthly_stays
      // ============================================
      console.log('📊 Analyzing vehicle_monthly_stays...');
      
      const { data: monthlyStays, error: staysError } = await supabase
        .from('vehicle_monthly_stays')
        .select('*')
        .limit(1000);

      if (!staysError && monthlyStays) {
        // Extract observation_ids from monthly_stays
        let obsIdsFromStays = 0;
        monthlyStays.forEach(stay => {
          if (stay.observation_ids && Array.isArray(stay.observation_ids)) {
            stay.observation_ids.forEach((id: string) => allObservationIds.add(id));
            obsIdsFromStays += stay.observation_ids.length;
          }
        });

        sources.push({
          table_name: 'vehicle_monthly_stays',
          record_count: monthlyStays.length,
          has_observation_ids: obsIdsFromStays > 0,
          sample_data: monthlyStays.slice(0, 3),
          recovery_potential: obsIdsFromStays > 0 ? 'high' : 'medium',
          notes: `Contains ${obsIdsFromStays} observation IDs across ${monthlyStays.length} monthly stay records. Can recover plate, zone, month, nights stayed.`,
        });
      }

      // ============================================
      // SOURCE 2: compliance_results
      // ============================================
      console.log('📊 Analyzing compliance_results...');
      
      const { data: complianceResults, error: compError } = await supabase
        .from('compliance_results')
        .select('observation_id, zone_id, evaluated_at')
        .not('observation_id', 'is', null)
        .limit(1000);

      if (!compError && complianceResults && complianceResults.length > 0) {
        complianceResults.forEach(result => {
          if (result.observation_id) allObservationIds.add(result.observation_id);
        });

        sources.push({
          table_name: 'compliance_results',
          record_count: complianceResults.length,
          has_observation_ids: true,
          sample_data: complianceResults.slice(0, 3),
          recovery_potential: 'medium',
          notes: `${complianceResults.length} compliance results with observation references. Can recover zone and timestamp.`,
        });
      } else {
        sources.push({
          table_name: 'compliance_results',
          record_count: 0,
          has_observation_ids: false,
          sample_data: [],
          recovery_potential: 'none',
          notes: 'No compliance results found.',
        });
      }

      // ============================================
      // SOURCE 3: incidents
      // ============================================
      console.log('📊 Analyzing incidents...');
      
      const { data: incidents, error: incError } = await supabase
        .from('incidents')
        .select('id, plate_number, zone_id, happened_at, gps_latitude, gps_longitude')
        .not('plate_number', 'is', null)
        .limit(1000);

      if (!incError && incidents && incidents.length > 0) {
        sources.push({
          table_name: 'incidents',
          record_count: incidents.length,
          has_observation_ids: false,
          sample_data: incidents.slice(0, 3),
          recovery_potential: 'low',
          notes: `${incidents.length} incidents with plate/zone/GPS data. Can create placeholder observations.`,
        });
      }

      // ============================================
      // SOURCE 4: enforcement_actions
      // ============================================
      console.log('📊 Analyzing enforcement_actions...');
      
      const { data: enforcement, error: enfError } = await supabase
        .from('enforcement_actions')
        .select('observation_id, plate_number, zone_id, recorded_at')
        .not('observation_id', 'is', null)
        .limit(1000);

      if (!enfError && enforcement && enforcement.length > 0) {
        enforcement.forEach(action => {
          if (action.observation_id) allObservationIds.add(action.observation_id);
        });

        sources.push({
          table_name: 'enforcement_actions',
          record_count: enforcement.length,
          has_observation_ids: true,
          sample_data: enforcement.slice(0, 3),
          recovery_potential: 'medium',
          notes: `${enforcement.length} enforcement actions with observation IDs.`,
        });
      }

      // ============================================
      // SOURCE 5: breach_alerts
      // ============================================
      console.log('📊 Analyzing breach_alerts...');
      
      const { data: breaches, error: breachError } = await supabase
        .from('breach_alerts')
        .select('observation_id, plate_number, zone_id, created_at')
        .not('observation_id', 'is', null)
        .limit(1000);

      if (!breachError && breaches && breaches.length > 0) {
        breaches.forEach(breach => {
          if (breach.observation_id) allObservationIds.add(breach.observation_id);
        });

        sources.push({
          table_name: 'breach_alerts',
          record_count: breaches.length,
          has_observation_ids: true,
          sample_data: breaches.slice(0, 3),
          recovery_potential: 'medium',
          notes: `${breaches.length} breach alerts with observation IDs.`,
        });
      }

      // ============================================
      // Generate Recovery Plan
      // ============================================
      const plan: RecoveryPlan = {
        total_recoverable: allObservationIds.size,
        unique_observation_ids: allObservationIds.size,
        data_sources: sources,
        what_we_keep: [
          '✅ Plate numbers',
          '✅ Zone associations',
          '✅ Approximate timestamps (month or date)',
          '✅ Organization IDs',
          '✅ Observation UUIDs (where available)',
          '✅ Monthly stay patterns',
        ],
        what_we_lose: [
          '❌ Exact GPS coordinates',
          '❌ Photos and evidence',
          '❌ Officer notes',
          '❌ Exact scan timestamps (only month available)',
          '❌ GPS accuracy data',
          '❌ Patrol session associations',
        ],
      };

      setRecoveryPlan(plan);

      if (allObservationIds.size > 0) {
        toast.success(`Found ${allObservationIds.size} recoverable observation IDs!`);
      } else {
        toast.warning('No observation IDs found in any table');
      }

    } catch (error: any) {
      console.error('❌ Recovery analysis failed:', error);
      toast.error('Analysis failed: ' + error.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const executeRecovery = async () => {
    if (!recoveryPlan) return;

    const confirmed = window.confirm(
      `This will attempt to recover ${recoveryPlan.unique_observation_ids} observations from available data.\n\n` +
      `⚠️ WARNING: This creates PLACEHOLDER records based on monthly_stays and other tables.\n\n` +
      `You will LOSE:\n` +
      recoveryPlan.what_we_lose.join('\n') + '\n\n' +
      'Proceed with recovery?'
    );

    if (!confirmed) return;

    toast.info('Recovery script generation coming next...');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Database className="h-8 w-8 text-blue-600" />
            Data Recovery Analysis
          </h1>
          <p className="text-muted-foreground mt-2">
            Analyze what observation data can be recovered from related tables
          </p>
        </div>
        <Button onClick={analyzeRecoveryPotential} disabled={isAnalyzing}>
          {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Analyze Recovery Options
        </Button>
      </div>

      {recoveryPlan && (
        <>
          {/* Summary Card */}
          <Card className="border-blue-500 bg-blue-50 dark:bg-blue-950/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Recovery Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Unique Observation IDs Found</p>
                  <p className="text-3xl font-bold text-blue-600">{recoveryPlan.unique_observation_ids.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Data Sources Available</p>
                  <p className="text-3xl font-bold text-green-600">{recoveryPlan.data_sources.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Data Sources */}
          <div className="space-y-3">
            <h2 className="text-xl font-bold">Available Data Sources</h2>
            {recoveryPlan.data_sources.map((source, index) => (
              <Card key={index} className={`border-2 ${
                source.recovery_potential === 'high' ? 'border-green-500 bg-green-50 dark:bg-green-950/20' :
                source.recovery_potential === 'medium' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' :
                source.recovery_potential === 'low' ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20' :
                'border-gray-500 bg-gray-50 dark:bg-gray-950/20'
              }`}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <Database className="h-5 w-5" />
                      {source.table_name}
                    </span>
                    <Badge variant={
                      source.recovery_potential === 'high' ? 'default' :
                      source.recovery_potential === 'medium' ? 'secondary' :
                      'outline'
                    }>
                      {source.recovery_potential.toUpperCase()} POTENTIAL
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Records Found:</span>
                      <span className="font-semibold">{source.record_count.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Has Observation IDs:</span>
                      <span className="font-semibold">
                        {source.has_observation_ids ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                        )}
                      </span>
                    </div>
                    <p className="text-sm mt-2 p-2 bg-white dark:bg-gray-900 rounded">
                      {source.notes}
                    </p>
                    {source.sample_data.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:underline">
                          View Sample Data
                        </summary>
                        <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-x-auto">
                          {JSON.stringify(source.sample_data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* What We Keep vs Lose */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-green-500">
              <CardHeader>
                <CardTitle className="text-base">✅ What We Can Recover</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {recoveryPlan.what_we_keep.map((item, i) => (
                    <li key={i} className="text-green-700 dark:text-green-300">{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="border-red-500">
              <CardHeader>
                <CardTitle className="text-base">❌ What We Lose Forever</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {recoveryPlan.what_we_lose.map((item, i) => (
                    <li key={i} className="text-red-700 dark:text-red-300">{item}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Recovery Action */}
          {recoveryPlan.unique_observation_ids > 0 && (
            <Card className="border-blue-500 bg-blue-50 dark:bg-blue-950/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-blue-900 dark:text-blue-100 mb-2">
                      Ready to Execute Recovery?
                    </h3>
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      This will create placeholder observations from available data sources
                    </p>
                  </div>
                  <Button onClick={executeRecovery} className="bg-blue-600 hover:bg-blue-700">
                    <Download className="h-4 w-4 mr-2" />
                    Generate Recovery Script
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
