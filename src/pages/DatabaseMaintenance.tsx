
/**
 * DATABASE MAINTENANCE - MASTER USERS ONLY
 * 
 * Four independent lightweight maintenance operations:
 * 1. Zone Correction: GPS-based automatic zone reassignment (zone-correction function)
 * 2. Duplicate Detection: Find and remove duplicate observations (duplicate-detection function)
 * 3. Compliance Recalculation: Full recalculation page (embedded component)
 * 4. Vehicle Enrichment: Enrich vehicle data from external sources (enrich-vehicle-worker function)
 * 
 * Each operation runs separately with live progress tracking
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertTriangle,
  Shield,
  MapPin,
  Copy,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Calendar,
  Database,
} from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { ComplianceRecalculation } from './ComplianceRecalculation';

const BATCH_SIZE = 50;

export function DatabaseMaintenance() {
  const { user } = useAuthStore();

  // Zone Correction State
  const [zoneSelectedZones, setZoneSelectedZones] = useState<string[]>([]);
  const [zoneDatePreset, setZoneDatePreset] = useState<string>('last_30_days');
  const [zoneProcessing, setZoneProcessing] = useState(false);
  const [zoneProcessed, setZoneProcessed] = useState(0);
  const [zoneCorrected, setZoneCorrected] = useState(0);
  const [zoneCurrentBatch, setZoneCurrentBatch] = useState(0);
  const [zoneTotalBatches, setZoneTotalBatches] = useState(0);

  // Duplicate Detection State
  const [dupSelectedZones, setDupSelectedZones] = useState<string[]>([]);
  const [dupDatePreset, setDupDatePreset] = useState<string>('last_30_days');
  const [dupProcessing, setDupProcessing] = useState(false);
  const [dupProcessed, setDupProcessed] = useState(0);
  const [dupRemoved, setDupRemoved] = useState(0);
  const [dupCurrentBatch, setDupCurrentBatch] = useState(0);
  const [dupTotalBatches, setDupTotalBatches] = useState(0);

  // Vehicle Enrichment State
  const [enrichProcessing, setEnrichProcessing] = useState(false);
  const [enrichProcessed, setEnrichProcessed] = useState(0);
  const [enrichEnriched, setEnrichEnriched] = useState(0);
  const [enrichFailed, setEnrichFailed] = useState(0);
  const [enrichCurrentBatch, setEnrichCurrentBatch] = useState(0);
  const [enrichTotalBatches, setEnrichTotalBatches] = useState(0);

  // Check if user is master
  const isMaster = user?.role === 'master';

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
    enabled: isMaster,
  });

  // Helper: Calculate date range
  const getDateRange = (preset: string) => {
    let dateRangeStart: string | undefined;
    let dateRangeEnd: string | undefined;

    if (preset !== 'all_time') {
      const today = new Date();
      dateRangeEnd = today.toISOString().split('T')[0];

      if (preset === 'last_7_days') {
        const start = new Date();
        start.setDate(start.getDate() - 7);
        dateRangeStart = start.toISOString().split('T')[0];
      } else if (preset === 'last_30_days') {
        const start = new Date();
        start.setDate(start.getDate() - 30);
        dateRangeStart = start.toISOString().split('T')[0];
      } else if (preset === 'last_90_days') {
        const start = new Date();
        start.setDate(start.getDate() - 90);
        dateRangeStart = start.toISOString().split('T')[0];
      }
    }

    return { dateRangeStart, dateRangeEnd };
  };

  // Zone Correction Handler
  const handleRunZoneCorrection = async () => {
    if (zoneSelectedZones.length === 0) {
      toast.error('⚠️ Please select at least one zone');
      return;
    }

    const { dateRangeStart, dateRangeEnd } = getDateRange(zoneDatePreset);
    const startTime = Date.now();

    try {
      toast.info('🗺️ Starting zone correction...');

      setZoneProcessing(true);
      setZoneProcessed(0);
      setZoneCorrected(0);
      setZoneCurrentBatch(0);
      setZoneTotalBatches(0);

      // Step 1: Get total count
      const { data: totalData, error: totalError } = await supabase.functions.invoke(
        'zone-correction',
        {
          body: {
            zoneIds: zoneSelectedZones,
            dateRangeStart,
            dateRangeEnd,
            get_total: true,
          },
        }
      );

      if (totalError) throw totalError;

      const totalObservations = totalData.total || 0;
      console.log('📊 Total observations with GPS:', totalObservations);

      if (totalObservations === 0) {
        toast.info('No observations with GPS data found');
        setZoneProcessing(false);
        return;
      }

      // Step 2: Process in batches
      const batches = Math.ceil(totalObservations / BATCH_SIZE);
      setZoneTotalBatches(batches);

      let totalProcessed = 0;
      let totalCorrected = 0;

      for (let i = 0; i < batches; i++) {
        const offset = i * BATCH_SIZE;
        setZoneCurrentBatch(i + 1);

        const { data: batchData, error: batchError } = await supabase.functions.invoke(
          'zone-correction',
          {
            body: {
              zoneIds: zoneSelectedZones,
              dateRangeStart,
              dateRangeEnd,
              get_total: false,
              offset,
              batch_size: BATCH_SIZE,
            },
          }
        );

        if (batchError) throw batchError;

        totalProcessed += batchData.processed || 0;
        totalCorrected += batchData.corrected || 0;

        setZoneProcessed(totalProcessed);
        setZoneCorrected(totalCorrected);
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      setZoneProcessing(false);

      toast.success(`✅ Zone correction complete! ${totalCorrected} zones fixed in ${duration}s`);

    } catch (error: any) {
      setZoneProcessing(false);
      console.error('❌ Zone correction failed:', error);
      toast.error('Failed: ' + error.message);
    }
  };

  // Vehicle Enrichment Handler
  const handleRunEnrichment = async () => {
    const startTime = Date.now();

    try {
      toast.info('🔄 Starting vehicle enrichment...');

      setEnrichProcessing(true);
      setEnrichProcessed(0);
      setEnrichEnriched(0);
      setEnrichFailed(0);
      setEnrichCurrentBatch(0);
      setEnrichTotalBatches(0);

      // Step 1: Get total count of vehicles needing enrichment
      const { data: totalData, error: totalError } = await supabase.functions.invoke(
        'enrich-vehicle-worker',
        {
          body: {
            get_total: true,
          },
        }
      );

      if (totalError) throw totalError;

      const totalVehicles = totalData.total || 0;
      console.log('📊 Total vehicles to enrich:', totalVehicles);

      if (totalVehicles === 0) {
        toast.info('No vehicles need enrichment');
        setEnrichProcessing(false);
        return;
      }

      // Step 2: Process in batches
      const batches = Math.ceil(totalVehicles / BATCH_SIZE);
      setEnrichTotalBatches(batches);

      let totalProcessed = 0;
      let totalEnriched = 0;
      let totalFailed = 0;

      for (let i = 0; i < batches; i++) {
        const offset = i * BATCH_SIZE;
        setEnrichCurrentBatch(i + 1);

        const { data: batchData, error: batchError } = await supabase.functions.invoke(
          'enrich-vehicle-worker',
          {
            body: {
              get_total: false,
              offset,
              batch_size: BATCH_SIZE,
            },
          }
        );

        if (batchError) throw batchError;

        totalProcessed += batchData.processed || 0;
        totalEnriched += batchData.enriched || 0;
        totalFailed += batchData.failed || 0;

        setEnrichProcessed(totalProcessed);
        setEnrichEnriched(totalEnriched);
        setEnrichFailed(totalFailed);
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      setEnrichProcessing(false);

      toast.success(`✅ Vehicle enrichment complete! ${totalEnriched} vehicles enriched, ${totalFailed} failed in ${duration}s`);

    } catch (error: any) {
      setEnrichProcessing(false);
      console.error('❌ Vehicle enrichment failed:', error);
      toast.error('Failed: ' + error.message);
    }
  };

  // Duplicate Detection Handler
  const handleRunDuplicateDetection = async () => {
    if (dupSelectedZones.length === 0) {
      toast.error('⚠️ Please select at least one zone');
      return;
    }

    const { dateRangeStart, dateRangeEnd } = getDateRange(dupDatePreset);
    const startTime = Date.now();

    try {
      toast.info('🔍 Starting duplicate detection...');

      setDupProcessing(true);
      setDupProcessed(0);
      setDupRemoved(0);
      setDupCurrentBatch(0);
      setDupTotalBatches(0);

      // Step 1: Get total count
      const { data: totalData, error: totalError } = await supabase.functions.invoke(
        'duplicate-detection',
        {
          body: {
            zoneIds: dupSelectedZones,
            dateRangeStart,
            dateRangeEnd,
            get_total: true,
          },
        }
      );

      if (totalError) throw totalError;

      const totalObservations = totalData.total || 0;
      console.log('📊 Total observations to check:', totalObservations);

      if (totalObservations === 0) {
        toast.info('No observations found');
        setDupProcessing(false);
        return;
      }

      // Step 2: Process in batches
      const batches = Math.ceil(totalObservations / BATCH_SIZE);
      setDupTotalBatches(batches);

      let totalProcessed = 0;
      let totalRemoved = 0;

      for (let i = 0; i < batches; i++) {
        const offset = i * BATCH_SIZE;
        setDupCurrentBatch(i + 1);

        const { data: batchData, error: batchError } = await supabase.functions.invoke(
          'duplicate-detection',
          {
            body: {
              zoneIds: dupSelectedZones,
              dateRangeStart,
              dateRangeEnd,
              get_total: false,
              offset,
              batch_size: BATCH_SIZE,
            },
          }
        );

        if (batchError) throw batchError;

        totalProcessed += batchData.processed || 0;
        totalRemoved += batchData.removed || 0;

        setDupProcessed(totalProcessed);
        setDupRemoved(totalRemoved);
      }

      const duration = Math.round((Date.now() - startTime) / 1000);
      setDupProcessing(false);

      toast.success(`✅ Duplicate detection complete! ${totalRemoved} duplicates removed in ${duration}s`);

    } catch (error: any) {
      setDupProcessing(false);
      console.error('❌ Duplicate detection failed:', error);
      toast.error('Failed: ' + error.message);
    }
  };

  const dateRangeLabels: Record<string, string> = {
    all_time: 'All Time',
    last_7_days: 'Last 7 Days',
    last_30_days: 'Last 30 Days',
    last_90_days: 'Last 90 Days',
  };

  if (!isMaster) {
    return (
      <ResponsiveContainer maxWidth="3xl" padding="md">
        <Alert className="border-red-500/50 bg-red-50 dark:bg-red-950/20">
          <Shield className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-900 dark:text-red-100">
            <strong>Access Denied:</strong> This page is restricted to master users only.
            These operations can affect the entire database and should only be performed by system administrators.
          </AlertDescription>
        </Alert>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer maxWidth="2xl" padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="h-8 w-8 text-blue-600" />
            Database Maintenance
          </h1>
          <p className="text-muted-foreground mt-1">
            Four independent lightweight operations - run them separately as needed
          </p>
        </div>

        {/* Tabs for Different Operations */}
        <Tabs defaultValue="zone-correction" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="zone-correction" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Zone Correction
            </TabsTrigger>
            <TabsTrigger value="duplicate-detection" className="flex items-center gap-2">
              <Copy className="h-4 w-4" />
              Duplicate Detection
            </TabsTrigger>
            <TabsTrigger value="enrichment" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Vehicle Enrichment
            </TabsTrigger>
            <TabsTrigger value="compliance-recalculation" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Compliance Recalculation
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: ZONE CORRECTION */}
          <TabsContent value="zone-correction" className="space-y-6">
            <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
              <MapPin className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-900 dark:text-blue-100">
                <strong>Zone Correction:</strong> Uses GPS coordinates (less than 100m accuracy) to automatically reassign observations to the correct zones using point-in-polygon or distance-based matching.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>Zone Correction Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Zone Selection */}
                <div className="space-y-2">
                  <Label>Select Zones *</Label>
                  <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                    {zones.length === 0 ? (
                      <div className="text-center py-4 text-sm text-muted-foreground">
                        No zones available
                      </div>
                    ) : (
                      zones.map((zone) => (
                        <label
                          key={zone.id}
                          className="flex items-center gap-2 p-2 hover:bg-muted rounded cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={zoneSelectedZones.includes(zone.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setZoneSelectedZones([...zoneSelectedZones, zone.id]);
                              } else {
                                setZoneSelectedZones(zoneSelectedZones.filter((id) => id !== zone.id));
                              }
                            }}
                            disabled={zoneProcessing}
                            className="h-4 w-4"
                          />
                          <span className="text-sm font-medium flex-1">{zone.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {(zone.organization as any)?.name}
                          </Badge>
                        </label>
                      ))
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ✅ {zoneSelectedZones.length} zone{zoneSelectedZones.length !== 1 ? 's' : ''} selected
                  </p>
                </div>

                {/* Date Range */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Date Range
                  </Label>
                  <Select value={zoneDatePreset} onValueChange={setZoneDatePreset} disabled={zoneProcessing}>
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
                  <p className="text-xs text-muted-foreground">
                    Selected: <span className="font-semibold">{dateRangeLabels[zoneDatePreset]}</span>
                  </p>
                </div>

                <Button
                  onClick={handleRunZoneCorrection}
                  disabled={zoneProcessing || zoneSelectedZones.length === 0}
                  className="w-full h-12"
                  size="lg"
                >
                  {zoneProcessing ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Processing Batch {zoneCurrentBatch}/{zoneTotalBatches}...
                    </>
                  ) : (
                    <>
                      <MapPin className="h-5 w-5 mr-2" />
                      Run Zone Correction
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Zone Correction Progress */}
            {zoneProcessing && (
              <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950/20">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <AlertDescription>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Progress value={(zoneCurrentBatch / zoneTotalBatches) * 100} className="h-2 flex-1" />
                      <span className="text-sm font-bold text-blue-600">
                        {Math.round((zoneCurrentBatch / zoneTotalBatches) * 100)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="p-2 bg-white dark:bg-gray-900 rounded">
                        <div className="text-2xl font-black text-blue-600">{zoneProcessed}</div>
                        <div className="text-xs text-muted-foreground">Processed</div>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-900 rounded">
                        <div className="text-2xl font-black text-green-600">{zoneCorrected}</div>
                        <div className="text-xs text-muted-foreground">Corrected</div>
                      </div>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* TAB 2: DUPLICATE DETECTION */}
          <TabsContent value="duplicate-detection" className="space-y-6">
            <Alert className="border-purple-500/50 bg-purple-50 dark:bg-purple-950/20">
              <Copy className="h-4 w-4 text-purple-600" />
              <AlertDescription className="text-purple-900 dark:text-purple-100">
                <strong>Duplicate Detection:</strong> Finds duplicate observations within 8-hour window in the same zone. Keeps the first (oldest) record, removes newer duplicates. Preserves observations with incidents/reports.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>Duplicate Detection Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Zone Selection */}
                <div className="space-y-2">
                  <Label>Select Zones *</Label>
                  <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                    {zones.length === 0 ? (
                      <div className="text-center py-4 text-sm text-muted-foreground">
                        No zones available
                      </div>
                    ) : (
                      zones.map((zone) => (
                        <label
                          key={zone.id}
                          className="flex items-center gap-2 p-2 hover:bg-muted rounded cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={dupSelectedZones.includes(zone.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setDupSelectedZones([...dupSelectedZones, zone.id]);
                              } else {
                                setDupSelectedZones(dupSelectedZones.filter((id) => id !== zone.id));
                              }
                            }}
                            disabled={dupProcessing}
                            className="h-4 w-4"
                          />
                          <span className="text-sm font-medium flex-1">{zone.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {(zone.organization as any)?.name}
                          </Badge>
                        </label>
                      ))
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ✅ {dupSelectedZones.length} zone{dupSelectedZones.length !== 1 ? 's' : ''} selected
                  </p>
                </div>

                {/* Date Range */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Date Range
                  </Label>
                  <Select value={dupDatePreset} onValueChange={setDupDatePreset} disabled={dupProcessing}>
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
                  <p className="text-xs text-muted-foreground">
                    Selected: <span className="font-semibold">{dateRangeLabels[dupDatePreset]}</span>
                  </p>
                </div>

                <Button
                  onClick={handleRunDuplicateDetection}
                  disabled={dupProcessing || dupSelectedZones.length === 0}
                  className="w-full h-12"
                  size="lg"
                >
                  {dupProcessing ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Processing Batch {dupCurrentBatch}/{dupTotalBatches}...
                    </>
                  ) : (
                    <>
                      <Copy className="h-5 w-5 mr-2" />
                      Run Duplicate Detection
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Duplicate Detection Progress */}
            {dupProcessing && (
              <Alert className="border-purple-500 bg-purple-50 dark:bg-purple-950/20">
                <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                <AlertDescription>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Progress value={(dupCurrentBatch / dupTotalBatches) * 100} className="h-2 flex-1" />
                      <span className="text-sm font-bold text-purple-600">
                        {Math.round((dupCurrentBatch / dupTotalBatches) * 100)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="p-2 bg-white dark:bg-gray-900 rounded">
                        <div className="text-2xl font-black text-blue-600">{dupProcessed}</div>
                        <div className="text-xs text-muted-foreground">Processed</div>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-900 rounded">
                        <div className="text-2xl font-black text-purple-600">{dupRemoved}</div>
                        <div className="text-xs text-muted-foreground">Removed</div>
                      </div>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* TAB 3: VEHICLE ENRICHMENT */}
          <TabsContent value="enrichment" className="space-y-6">
            <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
              <Database className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-900 dark:text-green-100">
                <strong>Vehicle Enrichment:</strong> Fetches additional vehicle data from external sources (MotorWeb, NZSCV registry) to populate make, model, year, color, and self-contained status for canonical vehicles.
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>Vehicle Enrichment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-900 dark:text-amber-100">
                    This operation will enrich all canonical vehicles with missing data from external APIs. This may take several minutes depending on the number of vehicles.
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={handleRunEnrichment}
                  disabled={enrichProcessing}
                  className="w-full h-12 bg-green-600 hover:bg-green-700"
                  size="lg"
                >
                  {enrichProcessing ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Processing Batch {enrichCurrentBatch}/{enrichTotalBatches}...
                    </>
                  ) : (
                    <>
                      <Database className="h-5 w-5 mr-2" />
                      Run Vehicle Enrichment
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Vehicle Enrichment Progress */}
            {enrichProcessing && (
              <Alert className="border-green-500 bg-green-50 dark:bg-green-950/20">
                <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                <AlertDescription>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Progress value={(enrichCurrentBatch / enrichTotalBatches) * 100} className="h-2 flex-1" />
                      <span className="text-sm font-bold text-green-600">
                        {Math.round((enrichCurrentBatch / enrichTotalBatches) * 100)}%
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 bg-white dark:bg-gray-900 rounded">
                        <div className="text-2xl font-black text-blue-600">{enrichProcessed}</div>
                        <div className="text-xs text-muted-foreground">Processed</div>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-900 rounded">
                        <div className="text-2xl font-black text-green-600">{enrichEnriched}</div>
                        <div className="text-xs text-muted-foreground">Enriched</div>
                      </div>
                      <div className="p-2 bg-white dark:bg-gray-900 rounded">
                        <div className="text-2xl font-black text-red-600">{enrichFailed}</div>
                        <div className="text-xs text-muted-foreground">Failed</div>
                      </div>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* TAB 4: COMPLIANCE RECALCULATION */}
          <TabsContent value="compliance-recalculation">
            <ComplianceRecalculation />
          </TabsContent>
        </Tabs>
      </div>
    </ResponsiveContainer>
  );
}
