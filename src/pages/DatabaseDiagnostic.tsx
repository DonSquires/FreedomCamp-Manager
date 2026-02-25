/**
 * DATABASE DIAGNOSTIC TOOL
 * 
 * Critical diagnostic to understand why cleanup returns 0 observations
 * Shows exact counts in all observation tables and helps identify data location
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Database,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Table,
  Calendar,
  MapPin,
  Car,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';

interface TableStats {
  table_name: string;
  total_records: number;
  earliest_date: string | null;
  latest_date: string | null;
  unique_plates: number;
  unique_zones: number;
  sample_records: any[];
}

export function DatabaseDiagnostic() {
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<TableStats[]>([]);

  useEffect(() => {
    runDiagnostic();
  }, []);

  const runDiagnostic = async () => {
    setIsLoading(true);
    setStats([]);

    try {
      console.log('🔍 Running database diagnostic...');

      const results: TableStats[] = [];

      // ============================================
      // CHECK 1: observations (CURRENT TABLE)
      // ============================================
      console.log('📊 Checking observations...');
      
      const { data: v2Data, error: v2Error } = await supabase
        .from('observations')
        .select(`
          observation_id,
          plate_number,
          zone_id,
          recorded_at,
          organization_id
        `)
        .order('recorded_at', { ascending: false })
        .limit(10);

      if (v2Error) {
        console.error('Error querying observations:', v2Error);
      } else {
        const { count } = await supabase
          .from('observations')
          .select('*', { count: 'exact', head: true });

        const uniquePlates = new Set(v2Data?.map(r => r.plate_number) || []);
        const uniqueZones = new Set(v2Data?.map(r => r.zone_id) || []);

        const dates = v2Data?.map(r => r.recorded_at).filter(Boolean) || [];
        const earliest = dates.length > 0 ? dates[dates.length - 1] : null;
        const latest = dates.length > 0 ? dates[0] : null;

        results.push({
          table_name: 'observations ✅ CURRENT',
          total_records: count || 0,
          earliest_date: earliest,
          latest_date: latest,
          unique_plates: uniquePlates.size,
          unique_zones: uniqueZones.size,
          sample_records: v2Data || [],
        });

        console.log(`✅ observations: ${count || 0} records`);
        console.log(`   - Unique plates: ${uniquePlates.size}`);
        console.log(`   - Unique zones: ${uniqueZones.size}`);
        console.log(`   - Date range: ${earliest} → ${latest}`);
      }

      // ============================================
      // CHECK 2: vehicle_observations (LEGACY TABLE)
      // ============================================
      console.log('📊 Checking vehicle_observations (legacy)...');
      
      try {
        const { data: legacyData, error: legacyError } = await supabase
          .from('vehicle_observations')
          .select(`
            id,
            plate_number,
            zone_id,
            recorded_at,
            organization_id
          `)
          .order('recorded_at', { ascending: false })
          .limit(10);

        if (legacyError) {
          console.log('⚠️ Legacy table does not exist or cannot be accessed');
          results.push({
            table_name: 'vehicle_observations ❌ LEGACY',
            total_records: 0,
            earliest_date: null,
            latest_date: null,
            unique_plates: 0,
            unique_zones: 0,
            sample_records: [],
          });
        } else {
          const { count: legacyCount } = await supabase
            .from('vehicle_observations')
            .select('*', { count: 'exact', head: true });

          const uniquePlates = new Set(legacyData?.map(r => r.plate_number) || []);
          const uniqueZones = new Set(legacyData?.map(r => r.zone_id) || []);

          const dates = legacyData?.map(r => r.recorded_at).filter(Boolean) || [];
          const earliest = dates.length > 0 ? dates[dates.length - 1] : null;
          const latest = dates.length > 0 ? dates[0] : null;

          results.push({
            table_name: 'vehicle_observations ⚠️ LEGACY',
            total_records: legacyCount || 0,
            earliest_date: earliest,
            latest_date: latest,
            unique_plates: uniquePlates.size,
            unique_zones: uniqueZones.size,
            sample_records: legacyData || [],
          });

          console.log(`⚠️ vehicle_observations (legacy): ${legacyCount || 0} records`);
          if (legacyCount && legacyCount > 0) {
            console.log('🚨 WARNING: Legacy table still has data!');
          }
        }
      } catch (err) {
        console.log('Legacy table check failed (expected if table was dropped)');
        results.push({
          table_name: 'vehicle_observations ❌ LEGACY',
          total_records: 0,
          earliest_date: null,
          latest_date: null,
          unique_plates: 0,
          unique_zones: 0,
          sample_records: [],
        });
      }

      // ============================================
      // CHECK 3: canonical_vehicles
      // ============================================
      console.log('📊 Checking canonical_vehicles...');
      
      const { count: vehicleCount } = await supabase
        .from('canonical_vehicles')
        .select('*', { count: 'exact', head: true });

      const { data: vehicleSample } = await supabase
        .from('canonical_vehicles')
        .select('plate_number, total_observations, total_breaches, last_seen_at')
        .order('last_seen_at', { ascending: false })
        .limit(5);

      console.log(`✅ canonical_vehicles: ${vehicleCount || 0} records`);

      results.push({
        table_name: 'canonical_vehicles ✅ CURRENT',
        total_records: vehicleCount || 0,
        earliest_date: null,
        latest_date: null,
        unique_plates: vehicleCount || 0,
        unique_zones: 0,
        sample_records: vehicleSample || [],
      });

      setStats(results);

      // Summary
      const v2Count = results.find(r => r.table_name.includes('observations'))?.total_records || 0;
      const legacyCount = results.find(r => r.table_name.includes('vehicle_observations '))?.total_records || 0;

      if (v2Count === 0 && legacyCount > 0) {
        toast.error('🚨 CRITICAL: All observations are in LEGACY table! Data migration needed!');
      } else if (v2Count > 0) {
        toast.success(`✅ Found ${v2Count.toLocaleString()} observations in current table`);
      } else {
        toast.warning('⚠️ No observations found in any table');
      }

    } catch (error: any) {
      console.error('❌ Diagnostic failed:', error);
      toast.error('Diagnostic failed: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Database className="h-8 w-8 text-purple-600" />
            Database Diagnostic
          </h1>
          <p className="text-muted-foreground mt-2">
            Critical diagnostic to identify where observation data is stored
          </p>
        </div>
        <Button onClick={runDiagnostic} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Re-run Diagnostic
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 className="h-16 w-16 animate-spin text-purple-600 mb-4" />
          <p className="text-lg text-muted-foreground">Running database diagnostic...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {stats.map((stat, index) => {
            const isLegacy = stat.table_name.includes('LEGACY');
            const isCurrent = stat.table_name.includes('CURRENT');
            const hasData = stat.total_records > 0;

            return (
              <Card
                key={index}
                className={`border-2 ${
                  isLegacy && hasData
                    ? 'border-red-500 bg-red-50 dark:bg-red-950/20'
                    : isCurrent && hasData
                    ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                    : 'border-gray-300'
                }`}
              >
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Table className="h-5 w-5" />
                      {stat.table_name}
                    </span>
                    {hasData ? (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {stat.total_records.toLocaleString()} records
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Empty
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>

                {hasData && (
                  <CardContent className="space-y-4">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-3 bg-white dark:bg-gray-900 rounded border">
                        <div className="text-xs text-muted-foreground mb-1">Total Records</div>
                        <div className="text-2xl font-bold">{stat.total_records.toLocaleString()}</div>
                      </div>

                      {stat.unique_plates > 0 && (
                        <div className="p-3 bg-white dark:bg-gray-900 rounded border">
                          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                            <Car className="h-3 w-3" />
                            Unique Plates
                          </div>
                          <div className="text-2xl font-bold">{stat.unique_plates.toLocaleString()}</div>
                        </div>
                      )}

                      {stat.unique_zones > 0 && (
                        <div className="p-3 bg-white dark:bg-gray-900 rounded border">
                          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            Unique Zones
                          </div>
                          <div className="text-2xl font-bold">{stat.unique_zones.toLocaleString()}</div>
                        </div>
                      )}

                      {stat.earliest_date && stat.latest_date && (
                        <div className="p-3 bg-white dark:bg-gray-900 rounded border">
                          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            Date Range
                          </div>
                          <div className="text-xs font-mono">
                            {format(new Date(stat.earliest_date), 'MMM dd, yyyy')}
                            <br />→{' '}
                            {format(new Date(stat.latest_date), 'MMM dd, yyyy')}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Sample Records */}
                    {stat.sample_records.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Sample Records (Latest 10):</h4>
                        <div className="border rounded-lg overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-100 dark:bg-gray-800">
                                <tr>
                                  <th className="px-3 py-2 text-left">ID</th>
                                  <th className="px-3 py-2 text-left">Plate</th>
                                  {stat.sample_records[0]?.zone_id && <th className="px-3 py-2 text-left">Zone ID</th>}
                                  {stat.sample_records[0]?.recorded_at && <th className="px-3 py-2 text-left">Recorded At</th>}
                                  {stat.sample_records[0]?.total_observations !== undefined && (
                                    <>
                                      <th className="px-3 py-2 text-left">Observations</th>
                                      <th className="px-3 py-2 text-left">Breaches</th>
                                    </>
                                  )}
                                </tr>
                              </thead>
                              <tbody className="divide-y dark:divide-gray-700">
                                {stat.sample_records.map((record, idx) => (
                                  <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                                    <td className="px-3 py-2 font-mono text-xs">
                                      {record.observation_id?.slice(0, 8) || record.id?.slice(0, 8) || 'N/A'}
                                    </td>
                                    <td className="px-3 py-2 font-bold">{record.plate_number}</td>
                                    {record.zone_id && (
                                      <td className="px-3 py-2 font-mono text-xs">{record.zone_id.slice(0, 8)}</td>
                                    )}
                                    {record.recorded_at && (
                                      <td className="px-3 py-2">{format(new Date(record.recorded_at), 'MMM dd, HH:mm')}</td>
                                    )}
                                    {record.total_observations !== undefined && (
                                      <>
                                        <td className="px-3 py-2">{record.total_observations}</td>
                                        <td className="px-3 py-2">{record.total_breaches}</td>
                                      </>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Warning for legacy data */}
                    {isLegacy && hasData && (
                      <div className="p-4 bg-red-100 dark:bg-red-950/40 border border-red-500 rounded-lg">
                        <div className="flex items-start gap-3">
                          <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                          <div>
                            <h4 className="font-semibold text-red-900 dark:text-red-100 mb-1">
                              🚨 CRITICAL: Legacy Data Detected
                            </h4>
                            <p className="text-sm text-red-800 dark:text-red-200">
                              This table contains {stat.total_records.toLocaleString()} observations that should be migrated to
                              observations. The cleanup function only works with the new table structure.
                            </p>
                            <p className="text-sm text-red-800 dark:text-red-200 mt-2">
                              <strong>Action Required:</strong> Run data migration to move all records from vehicle_observations
                              → observations
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}

          {/* Summary Card */}
          {stats.length > 0 && (
            <Card className="border-2 border-blue-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-blue-600" />
                  Diagnostic Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const v2Count = stats.find(s => s.table_name.includes('observations'))?.total_records || 0;
                  const legacyCount = stats.find(s => s.table_name.includes('vehicle_observations '))?.total_records || 0;
                  const vehicleCount = stats.find(s => s.table_name.includes('canonical_vehicles'))?.total_records || 0;

                  if (v2Count === 0 && legacyCount > 0) {
                    return (
                      <div className="p-4 bg-red-100 dark:bg-red-950/40 border border-red-500 rounded">
                        <p className="font-semibold text-red-900 dark:text-red-100">
                          ❌ All {legacyCount.toLocaleString()} observations are in the LEGACY table
                        </p>
                        <p className="text-sm text-red-800 dark:text-red-200 mt-2">
                          The cleanup function queries observations which is empty. You need to migrate data from
                          the legacy table first.
                        </p>
                      </div>
                    );
                  } else if (v2Count > 0 && legacyCount > 0) {
                    return (
                      <div className="p-4 bg-amber-100 dark:bg-amber-950/40 border border-amber-500 rounded">
                        <p className="font-semibold text-amber-900 dark:text-amber-100">
                          ⚠️ Data split across tables
                        </p>
                        <ul className="text-sm text-amber-800 dark:text-amber-200 mt-2 space-y-1">
                          <li>• observations (current): {v2Count.toLocaleString()} records</li>
                          <li>• vehicle_observations (legacy): {legacyCount.toLocaleString()} records</li>
                        </ul>
                        <p className="text-sm text-amber-800 dark:text-amber-200 mt-2">
                          Complete migration needed to consolidate all data in observations
                        </p>
                      </div>
                    );
                  } else if (v2Count > 0) {
                    return (
                      <div className="p-4 bg-green-100 dark:bg-green-950/40 border border-green-500 rounded">
                        <p className="font-semibold text-green-900 dark:text-green-100">
                          ✅ Data correctly located in observations
                        </p>
                        <ul className="text-sm text-green-800 dark:text-green-200 mt-2 space-y-1">
                          <li>• {v2Count.toLocaleString()} observations in current table</li>
                          <li>• {vehicleCount.toLocaleString()} canonical vehicles</li>
                          <li>• Cleanup function should work correctly</li>
                        </ul>
                      </div>
                    );
                  } else {
                    return (
                      <div className="p-4 bg-gray-100 dark:bg-gray-900/40 border border-gray-500 rounded">
                        <p className="font-semibold text-gray-900 dark:text-gray-100">
                          ⚠️ No observation data found in any table
                        </p>
                        <p className="text-sm text-gray-800 dark:text-gray-200 mt-2">
                          Start scanning vehicles in the Field Officer Portal to populate the database.
                        </p>
                      </div>
                    );
                  }
                })()}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
