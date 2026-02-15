/**
 * DATABASE MAINTENANCE - MASTER USERS ONLY
 * 
 * Three independent maintenance operations:
 * 1. Zone Correction: GPS-based automatic zone reassignment
 * 2. Duplicate Detection: Find and remove duplicate observations
 * 3. Compliance Recalculation: Test observations against current zone rules
 * 
 * Each operation can be run independently with live progress tracking
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MapPin,
  Copy,
  RefreshCw,
  AlertTriangle,
  Shield,
  Database,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { ComplianceRecalculation } from './ComplianceRecalculation';
import { useAuthStore } from '@/stores/authStore';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export function DatabaseMaintenance() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('recalculation');

  // Zone Correction State
  const [zoneSelectedZones, setZoneSelectedZones] = useState<string[]>([]);
  const [isZoneCorrecting, setIsZoneCorrecting] = useState(false);
  const [zoneCorrectionResults, setZoneCorrectionResults] = useState<any>(null);
  const [zoneProgress, setZoneProgress] = useState({ processed: 0, corrected: 0 });

  // Duplicate Detection State
  const [dupSelectedZones, setDupSelectedZones] = useState<string[]>([]);
  const [isDupDetecting, setIsDupDetecting] = useState(false);
  const [dupDetectionResults, setDupDetectionResults] = useState<any>(null);
  const [dupProgress, setDupProgress] = useState({ processed: 0, removed: 0 });

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

  // Zone Correction
  const handleZoneCorrection = async () => {
    if (zoneSelectedZones.length === 0) {
      toast.error('Please select at least one zone');
      return;
    }

    setIsZoneCorrecting(true);
    setZoneCorrectionResults(null);
    setZoneProgress({ processed: 0, corrected: 0 });

    try {
      console.log('🗺️ Starting zone correction for zones:', zoneSelectedZones);
      
      const { data, error } = await supabase.functions.invoke('cleanup-and-recalculate', {
        body: {
          scope: 'ZONE',
          zoneIds: zoneSelectedZones,
        },
      });

      if (error) {
        console.error('❌ Zone correction error:', error);
        
        // Extract detailed error message
        let errorMessage = 'Zone correction failed';
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        
        throw new Error(errorMessage);
      }

      console.log('✅ Zone correction response:', data);

      if (!data || !data.processing_summary) {
        throw new Error('Invalid response from server - no processing summary');
      }

      setZoneCorrectionResults(data.processing_summary);
      setZoneProgress({
        processed: data.processing_summary.observations_checked || 0,
        corrected: data.processing_summary.zones_corrected || 0,
      });
      
      toast.success(
        `Zone correction complete! ${data.processing_summary.zones_corrected} observations corrected out of ${data.processing_summary.observations_checked} checked`,
        { duration: 6000 }
      );
    } catch (error: any) {
      console.error('❌ Zone correction failed:', error);
      toast.error('Zone correction failed: ' + (error.message || 'Unknown error'));
    } finally {
      setIsZoneCorrecting(false);
    }
  };

  // Duplicate Detection
  const handleDuplicateDetection = async () => {
    if (dupSelectedZones.length === 0) {
      toast.error('Please select at least one zone');
      return;
    }

    setIsDupDetecting(true);
    setDupDetectionResults(null);
    setDupProgress({ processed: 0, removed: 0 });

    try {
      console.log('🔍 Starting duplicate detection for zones:', dupSelectedZones);
      
      const { data, error } = await supabase.functions.invoke('cleanup-and-recalculate', {
        body: {
          scope: 'ZONE',
          zoneIds: dupSelectedZones,
        },
      });

      if (error) {
        console.error('❌ Duplicate detection error:', error);
        
        // Extract detailed error message
        let errorMessage = 'Duplicate detection failed';
        if (error instanceof Error) {
          errorMessage = error.message;
        }
        
        throw new Error(errorMessage);
      }

      console.log('✅ Duplicate detection response:', data);

      if (!data || !data.processing_summary) {
        throw new Error('Invalid response from server - no processing summary');
      }

      setDupDetectionResults(data.processing_summary);
      setDupProgress({
        processed: data.processing_summary.observations_checked || 0,
        removed: data.processing_summary.duplicates_removed || 0,
      });
      
      toast.success(
        `Duplicate detection complete! ${data.processing_summary.duplicates_removed} duplicates removed out of ${data.processing_summary.observations_checked} checked`,
        { duration: 6000 }
      );
    } catch (error: any) {
      console.error('❌ Duplicate detection failed:', error);
      toast.error('Duplicate detection failed: ' + (error.message || 'Unknown error'));
    } finally {
      setIsDupDetecting(false);
    }
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
    <ResponsiveContainer maxWidth="7xl" padding="md">
      <div className="space-y-4 md:space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2 md:gap-3">
            <Database className="h-6 w-6 md:h-8 md:w-8 text-purple-600" />
            Database Maintenance
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <Shield className="h-3 w-3 md:h-4 md:w-4 text-amber-600" />
            <span className="font-semibold text-amber-900 dark:text-amber-100">
              Master Users Only
            </span>
            <span>•</span>
            System-wide maintenance operations for data integrity and compliance accuracy
          </p>
        </div>

        {/* Warning Banner */}
        <Alert className="border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-xs md:text-sm text-amber-900 dark:text-amber-100">
            <p className="font-semibold mb-2">⚠️ Important Safety Notes</p>
            <ul className="space-y-1 text-xs md:text-sm">
              <li>
                <strong>Zone Correction:</strong> Uses GPS coordinates to automatically reassign observations to correct zones. Safe to run anytime.
              </li>
              <li>
                <strong>Duplicate Detection:</strong> Finds and removes duplicate observations within 8-hour window in same zone. Preserves observations with incidents/reports.
              </li>
              <li>
                <strong>Compliance Recalculation (Recommended):</strong> Tests all observations against current zone rules, updates monthly stays, creates breach alerts. Safe to run anytime.
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        {/* Tabbed Interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="zone-correction" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span className="hidden md:inline">Zone Correction</span>
              <span className="md:hidden">Zones</span>
            </TabsTrigger>
            <TabsTrigger value="duplicates" className="flex items-center gap-2">
              <Copy className="h-4 w-4" />
              <span className="hidden md:inline">Duplicate Detection</span>
              <span className="md:hidden">Duplicates</span>
            </TabsTrigger>
            <TabsTrigger value="recalculation" className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              <span className="hidden md:inline">Compliance Recalculation</span>
              <span className="md:hidden">Compliance</span>
            </TabsTrigger>
          </TabsList>

          {/* Zone Correction Tab */}
          <TabsContent value="zone-correction" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  GPS-Based Zone Correction
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <p className="font-semibold mb-2">What This Does:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>Uses GPS coordinates to find the correct zone for each observation</li>
                      <li>Automatically reassigns observations to the correct zone if GPS accuracy is good (&lt;100m)</li>
                      <li>Uses point-in-polygon matching for zones with boundaries</li>
                      <li>Falls back to distance-based matching for zones with center points</li>
                      <li>Only corrects observations with valid GPS data</li>
                    </ul>
                  </AlertDescription>
                </Alert>

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
                            disabled={isZoneCorrecting}
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

                {/* Run Button */}
                <Button
                  onClick={handleZoneCorrection}
                  disabled={isZoneCorrecting || zoneSelectedZones.length === 0}
                  className="w-full"
                >
                  {isZoneCorrecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Correcting Zones...
                    </>
                  ) : (
                    <>
                      <MapPin className="h-4 w-4 mr-2" />
                      Run Zone Correction
                    </>
                  )}
                </Button>

                {/* Processing Status */}
                {isZoneCorrecting && (
                  <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
                    <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                    <AlertDescription className="text-blue-900 dark:text-blue-100">
                      <p className="font-semibold mb-2">🔄 Processing Zone Corrections...</p>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="font-semibold">Processed:</span>
                          <div className="text-2xl font-bold">{zoneProgress.processed}</div>
                        </div>
                        <div>
                          <span className="font-semibold">Corrected:</span>
                          <div className="text-2xl font-bold text-blue-600">{zoneProgress.corrected}</div>
                        </div>
                      </div>
                      <p className="text-xs mt-2">Processing 300 records at a time...</p>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Results */}
                {!isZoneCorrecting && zoneCorrectionResults && (
                  <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-900 dark:text-green-100">
                      <p className="font-semibold mb-2">✅ Zone Correction Complete!</p>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="font-semibold">Observations Checked:</span>
                          <div className="text-2xl font-bold">{zoneCorrectionResults.observations_checked}</div>
                        </div>
                        <div>
                          <span className="font-semibold">Zones Corrected:</span>
                          <div className="text-2xl font-bold text-blue-600">{zoneCorrectionResults.zones_corrected}</div>
                        </div>
                      </div>
                      <p className="text-xs mt-2 text-muted-foreground">
                        Duration: {zoneCorrectionResults.duration_seconds}s • Batch size: 300 records
                      </p>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Duplicate Detection Tab */}
          <TabsContent value="duplicates" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Copy className="h-5 w-5 text-purple-600" />
                  Duplicate Detection & Removal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <p className="font-semibold mb-2">What This Does:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>Finds duplicate observations for the same plate number in the same zone</li>
                      <li>Only removes duplicates within 8-hour window</li>
                      <li>Keeps the newest observation, removes older duplicates</li>
                      <li>Preserves observations that have incidents or H&S reports attached</li>
                      <li>Helps clean up data from bulk scanning or repeated patrols</li>
                    </ul>
                  </AlertDescription>
                </Alert>

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
                            disabled={isDupDetecting}
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

                {/* Run Button */}
                <Button
                  onClick={handleDuplicateDetection}
                  disabled={isDupDetecting || dupSelectedZones.length === 0}
                  className="w-full"
                >
                  {isDupDetecting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Detecting Duplicates...
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Run Duplicate Detection
                    </>
                  )}
                </Button>

                {/* Processing Status */}
                {isDupDetecting && (
                  <Alert className="border-purple-500/50 bg-purple-50 dark:bg-purple-950/20">
                    <Loader2 className="h-4 w-4 text-purple-600 animate-spin" />
                    <AlertDescription className="text-purple-900 dark:text-purple-100">
                      <p className="font-semibold mb-2">🔄 Detecting Duplicates...</p>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="font-semibold">Processed:</span>
                          <div className="text-2xl font-bold">{dupProgress.processed}</div>
                        </div>
                        <div>
                          <span className="font-semibold">Removed:</span>
                          <div className="text-2xl font-bold text-purple-600">{dupProgress.removed}</div>
                        </div>
                      </div>
                      <p className="text-xs mt-2">Processing 300 records at a time...</p>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Results */}
                {!isDupDetecting && dupDetectionResults && (
                  <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-900 dark:text-green-100">
                      <p className="font-semibold mb-2">✅ Duplicate Detection Complete!</p>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="font-semibold">Observations Checked:</span>
                          <div className="text-2xl font-bold">{dupDetectionResults.observations_checked}</div>
                        </div>
                        <div>
                          <span className="font-semibold">Duplicates Removed:</span>
                          <div className="text-2xl font-bold text-purple-600">{dupDetectionResults.duplicates_removed}</div>
                        </div>
                      </div>
                      <p className="text-xs mt-2 text-muted-foreground">
                        Duration: {dupDetectionResults.duration_seconds}s • Batch size: 300 records
                      </p>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Compliance Recalculation Tab */}
          <TabsContent value="recalculation" className="mt-6">
            <ComplianceRecalculation />
          </TabsContent>
        </Tabs>
      </div>
    </ResponsiveContainer>
  );
}
