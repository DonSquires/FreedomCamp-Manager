/**
 * DATA CLEANUP UTILITY
 * 
 * Comprehensive data cleanup and recalculation tool:
 * - Zone correction (GPS-based reassignment)
 * - Duplicate detection and removal (8-hour window)
 * - Compliance recalculation with breach detection
 * 
 * Admin-only access
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wrench,
  MapPin,
  Copy,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { FunctionsHttpError } from '@supabase/supabase-js';

interface CleanupStats {
  observations_checked: number;
  zones_corrected: number;
  duplicates_removed: number;
  compliance_recalculated: number;
  breaches_created: number;
  errors: string[];
}

export function DataCleanupUtility() {
  const { user } = useAuthStore();
  const [scope, setScope] = useState<'ZONE' | 'ORG' | 'ALL'>(
    user?.role === 'master' ? 'ALL' : 'ORG'
  );
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [dateRange, setDateRange] = useState<'7' | '30' | '90' | 'all'>('30');
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<CleanupStats | null>(null);
  
  const [availableZones, setAvailableZones] = useState<any[]>([]);
  const [availableOrgs, setAvailableOrgs] = useState<any[]>([]);
  const [isLoadingZones, setIsLoadingZones] = useState(false);

  // Load zones for selection
  useEffect(() => {
    loadZones();
    if (user?.role === 'master') {
      loadOrganizations();
    }
  }, [user?.role]);

  const loadZones = async () => {
    setIsLoadingZones(true);
    try {
      let query = supabase
        .from('zones')
        .select('id, name, organization_id, is_active')
        .eq('is_active', true)
        .order('name');

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setAvailableZones(data || []);
    } catch (error: any) {
      toast.error('Failed to load zones: ' + error.message);
    } finally {
      setIsLoadingZones(false);
    }
  };

  const loadOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setAvailableOrgs(data || []);
    } catch (error: any) {
      toast.error('Failed to load organizations: ' + error.message);
    }
  };

  const handleRunCleanup = async () => {
    if (scope === 'ZONE' && selectedZones.length === 0) {
      toast.error('Please select at least one zone');
      return;
    }

    if (scope === 'ORG' && !selectedOrg) {
      toast.error('Please select an organization');
      return;
    }

    const confirmed = confirm(
      `⚠️ WARNING: This will:\n\n` +
      `1. Correct zones based on GPS (if accuracy < 100m)\n` +
      `2. Delete duplicate observations (same plate, same zone, within 8 hours)\n` +
      `3. Recalculate compliance for all affected observations\n` +
      `4. Create new breach alerts if violations found\n\n` +
      `Scope: ${scope}\n` +
      `Date Range: Last ${dateRange === 'all' ? 'All Time' : dateRange + ' days'}\n\n` +
      `This operation cannot be undone. Continue?`
    );

    if (!confirmed) return;

    setIsRunning(true);
    setStats(null);

    try {
      // Calculate date range
      let dateRangeStart: string | undefined;
      if (dateRange !== 'all') {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(dateRange));
        dateRangeStart = startDate.toISOString();
      }

      const params: any = {
        scope,
        dateRangeStart,
        dateRangeEnd: new Date().toISOString(),
      };

      if (scope === 'ZONE') {
        params.zoneIds = selectedZones;
      } else if (scope === 'ORG') {
        params.organizationId = selectedOrg || user?.organization_id; // Auto-fill for non-master users
      }

      console.log('🔧 Starting cleanup with params:', params);

      const { data, error } = await supabase.functions.invoke('cleanup-and-recalculate', {
        body: params,
      });

      if (error) {
        // Extract real error message from FunctionsHttpError
        let errorMessage = error.message || 'Unknown error';
        
        if (error instanceof FunctionsHttpError) {
          try {
            const errorText = await error.context?.text();
            const statusCode = error.context?.status ?? 500;
            
            if (errorText) {
              try {
                const errorJson = JSON.parse(errorText);
                errorMessage = `[Code: ${statusCode}] ${errorJson.error || errorJson.message || errorText}`;
              } catch {
                errorMessage = `[Code: ${statusCode}] ${errorText}`;
              }
            } else {
              errorMessage = `[Code: ${statusCode}] ${error.message || 'Edge Function error'}`;
            }
          } catch {
            errorMessage = error.message || 'Failed to read error details';
          }
        }
        
        console.error('Cleanup error details:', errorMessage);
        throw new Error(errorMessage);
      }

      if (data?.stats) {
        setStats(data.stats);
        toast.success('Cleanup completed successfully!');
      } else {
        throw new Error('No stats returned from cleanup');
      }
    } catch (error: any) {
      console.error('Cleanup failed:', error);
      toast.error('Recalculation failed: ' + error.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Wrench className="h-8 w-8 text-amber-600" />
          Data Cleanup & Recalculation
        </h1>
        <p className="text-muted-foreground mt-2">
          Comprehensive data cleanup: Zone correction → Duplicate removal → Compliance recalculation
        </p>
      </div>

      {/* Warning Card */}
      <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-2">
                ⚠️ Important Information
              </h3>
              <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
                <li>• <strong>Zone Correction:</strong> Uses GPS to move observations to correct zones (accuracy &lt; 100m)</li>
                <li>• <strong>Duplicate Removal:</strong> Deletes duplicate scans (same plate, same zone, within 8 hours)</li>
                <li>• <strong>Preserved Records:</strong> Observations with incidents/H&S reports are never deleted</li>
                <li>• <strong>Compliance Recalculation:</strong> Measures against zone matrix, monthly stays, homeless status</li>
                <li>• <strong>Irreversible:</strong> Deleted duplicates cannot be recovered</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Cleanup Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Scope Selection */}
          <div>
            <label className="text-sm font-medium mb-2 block">Cleanup Scope</label>
            <Select value={scope} onValueChange={(v) => setScope(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ZONE">Specific Zone(s)</SelectItem>
                <SelectItem value="ORG">Entire Organization</SelectItem>
                {user?.role === 'master' && (
                  <SelectItem value="ALL">All Organizations</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Zone Selection */}
          {scope === 'ZONE' && (
            <div>
              <label className="text-sm font-medium mb-2 block">Select Zone(s)</label>
              <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                {isLoadingZones ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : availableZones.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No zones available</p>
                ) : (
                  availableZones.map((zone) => (
                    <label key={zone.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted p-2 rounded">
                      <input
                        type="checkbox"
                        checked={selectedZones.includes(zone.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedZones([...selectedZones, zone.id]);
                          } else {
                            setSelectedZones(selectedZones.filter(id => id !== zone.id));
                          }
                        }}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">{zone.name}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {selectedZones.length} zone(s) selected
              </p>
            </div>
          )}

          {/* Auto-fill organization for non-master users */}
          {scope === 'ORG' && user?.role !== 'master' && (
            <div>
              <label className="text-sm font-medium mb-2 block">Organization</label>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm">Your organization will be processed</p>
              </div>
            </div>
          )}

          {/* Organization Selection */}
          {scope === 'ORG' && user?.role === 'master' && (
            <div>
              <label className="text-sm font-medium mb-2 block">Select Organization</label>
              <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose organization..." />
                </SelectTrigger>
                <SelectContent>
                  {availableOrgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date Range */}
          <div>
            <label className="text-sm font-medium mb-2 block">Date Range</label>
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 Days</SelectItem>
                <SelectItem value="30">Last 30 Days</SelectItem>
                <SelectItem value="90">Last 90 Days</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Scope Warning */}
          {scope === 'ALL' && (
            <Card className="border-red-500 bg-red-50 dark:bg-red-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-red-900 dark:text-red-100 mb-1">
                      ⚠️ System-Wide Recalculation
                    </h4>
                    <p className="text-sm text-red-800 dark:text-red-200">
                      This will process <strong>ALL</strong> observations across <strong>ALL</strong> zones and organizations. 
                      This may take several minutes.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {scope === 'ZONE' && selectedZones.length === 0 && (
            <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      Please select at least one zone above to continue.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {scope === 'ORG' && !selectedOrg && user?.role === 'master' && (
            <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      Please select an organization above to continue.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary of what will be processed */}
          {((scope === 'ZONE' && selectedZones.length > 0) || 
            (scope === 'ORG' && (selectedOrg || user?.role !== 'master')) || 
            scope === 'ALL') && (
            <Card className="bg-blue-50 dark:bg-blue-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="font-semibold text-blue-900 dark:text-blue-100">
                      Ready to Process
                    </h4>
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>Scope:</strong> {scope === 'ZONE' ? `${selectedZones.length} Zone(s)` : scope === 'ORG' ? 'Entire Organization' : 'All Organizations'}
                      <br />
                      <strong>Date Range:</strong> {dateRange === 'all' ? 'All Time' : `Last ${dateRange} days`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Run Button */}
          <Button
            onClick={handleRunCleanup}
            disabled={isRunning || (scope === 'ZONE' && selectedZones.length === 0) || (scope === 'ORG' && !selectedOrg && user?.role === 'master')}
            className="w-full h-14 text-lg font-bold"
            size="lg"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <RefreshCw className="h-5 w-5 mr-2" />
                Run Cleanup & Recalculation
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {stats && (
        <Card className="border-2 border-green-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-6 w-6" />
              Cleanup Completed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Observations Checked</p>
                <p className="text-3xl font-bold text-blue-600">{stats.observations_checked}</p>
              </div>
              
              <div className="p-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  Zones Corrected
                </p>
                <p className="text-3xl font-bold text-purple-600">{stats.zones_corrected}</p>
              </div>

              <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <Trash2 className="h-4 w-4" />
                  Duplicates Removed
                </p>
                <p className="text-3xl font-bold text-red-600">{stats.duplicates_removed}</p>
              </div>

              <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Compliance Recalculated</p>
                <p className="text-3xl font-bold text-green-600">{stats.compliance_recalculated}</p>
              </div>

              <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4" />
                  Breaches Created
                </p>
                <p className="text-3xl font-bold text-amber-600">{stats.breaches_created}</p>
              </div>

              {stats.errors.length > 0 && (
                <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                    <XCircle className="h-4 w-4" />
                    Errors
                  </p>
                  <p className="text-3xl font-bold text-red-600">{stats.errors.length}</p>
                </div>
              )}
            </div>

            {/* Error Details */}
            {stats.errors.length > 0 && (
              <Card className="border-red-200">
                <CardHeader>
                  <CardTitle className="text-base text-red-700">Error Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {stats.errors.map((error, idx) => (
                      <p key={idx} className="text-sm text-red-600 font-mono">
                        {error}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
