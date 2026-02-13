/**
 * COMPREHENSIVE RECALCULATION - ALL-IN-ONE INTERFACE
 * 
 * Complete data cleanup and compliance recalculation:
 * 1. Duplicate Detection (max 2/day: morning + evening, exceptions for incidents)
 * 2. Data Integrity Checks
 * 3. Zone Corrections (GPS-based)
 * 4. Compliance Recalculation
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Building2,
  MapPin,
} from 'lucide-react';
import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';

interface RecalculationParams {
  scope: 'ZONE' | 'ORG' | 'BUILD';
  zoneIds?: string[];
  orgIds?: string[];
  dateRangeStart?: string;
  dateRangeEnd?: string;
}

export function ComplianceRecalculation() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isMaster = user?.role === 'master';

  const [scope, setScope] = useState<'ZONE' | 'ORG' | 'BUILD'>('ZONE');
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<string>('last_90_days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  
  // Sequential processing state
  const [processingOrgs, setProcessingOrgs] = useState<any[]>([]);
  const [currentOrgIndex, setCurrentOrgIndex] = useState(0);
  const [currentZoneIndex, setCurrentZoneIndex] = useState(0);
  const [currentOrgZones, setCurrentOrgZones] = useState<any[]>([]);
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  const [totalProcessed, setTotalProcessed] = useState(0);
  const [totalChanged, setTotalChanged] = useState(0);
  const [totalBreachAlerts, setTotalBreachAlerts] = useState(0);
  
  // Batch processing state
  const [batchSize] = useState(250);  // Process 250 observations at a time
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);

  // Fetch zones
  const { data: zones } = useQuery({
    queryKey: ['zones_for_recalc', user?.organization_id],
    queryFn: async () => {
      let query = supabase
        .from('zones')
        .select('id, name, organization:organizations(name)')
        .eq('is_active', true)
        .order('name');

      if (!isMaster && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch organizations
  const { data: organizations } = useQuery({
    queryKey: ['organizations_for_recalc'],
    queryFn: async () => {
      let query = supabase
        .from('organizations')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (!isMaster && user?.organization_id) {
        query = query.eq('id', user.organization_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: isMaster || scope === 'ORG',
  });

  // Fetch recent history
  const { data: recentActions } = useQuery({
    queryKey: ['recalculation_history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('admin_recalculation_actions')
        .select(`
          *,
          performed_by_user:user_profiles!admin_recalculation_actions_performed_by_fkey(first_name, last_name)
        `)
        .order('performed_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
  });

  // Run recalculation mutation (simplified single request)
  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const params: RecalculationParams = { scope };

      // Set zone/org IDs based on scope
      if (scope === 'ZONE') {
        params.zoneIds = selectedZones;
      } else if (scope === 'ORG') {
        params.orgIds = selectedOrgs;
      }

      // Set date range (FIX: Create separate Date objects)
      if (datePreset !== 'all_time') {
        const today = new Date();
        params.dateRangeEnd = today.toISOString().split('T')[0];

        if (datePreset === 'last_7_days') {
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 7);
          params.dateRangeStart = startDate.toISOString().split('T')[0];
        } else if (datePreset === 'last_30_days') {
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 30);
          params.dateRangeStart = startDate.toISOString().split('T')[0];
        } else if (datePreset === 'last_90_days') {
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 90);
          params.dateRangeStart = startDate.toISOString().split('T')[0];
        } else if (datePreset === 'custom') {
          params.dateRangeStart = customStartDate;
          params.dateRangeEnd = customEndDate;
        }
      }

      console.log('🚀 Starting comprehensive recalculation:', params);

      // Single request to edge function
      const { data, error } = await supabase.functions.invoke('comprehensive-recalculation', {
        body: params,
      });

      if (error) {
        let errorMessage = error.message || 'Unknown error';
        if (error instanceof FunctionsHttpError) {
          try {
            const textContent = await error.context.text();
            errorMessage = `[Code: ${error.context.status}] ${textContent || errorMessage}`;
          } catch {
            errorMessage = `[Code: ${error.context.status}] Failed to read error details`;
          }
        }
        throw new Error(errorMessage);
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['recalculation_history'] });
      const summary = data.summary || {};
      toast.success(
        `✅ Comprehensive cleanup complete!\n` +
        `${(summary.observations_processed || 0).toLocaleString()} observations processed\n` +
        `${(summary.duplicates_removed || 0).toLocaleString()} duplicates removed\n` +
        `${(summary.zone_corrections || 0).toLocaleString()} zones corrected\n` +
        `${(summary.compliance_changed || 0).toLocaleString()} compliance changed\n` +
        `${(summary.breach_alerts_created || 0).toLocaleString()} breach alerts created`,
        { duration: 10000 }
      );
    },
    onError: async (error: any) => {
      let errorMessage = error.message || 'Unknown error';
      if (error instanceof FunctionsHttpError) {
        try {
          const textContent = await error.context.text();
          errorMessage = `[Code: ${error.context.status}] ${textContent || errorMessage}`;
        } catch {
          errorMessage = `[Code: ${error.context.status}] Failed to read error details`;
        }
      }
      console.error('❌ Recalculation failed:', errorMessage);
      toast.error('Recalculation failed: ' + errorMessage, { duration: 10000 });
    },
  });

  const handleRunRecalculation = () => {
    // Validation
    if (scope === 'ZONE' && selectedZones.length === 0) {
      toast.error('Please select at least one zone');
      return;
    }
    if (scope === 'ORG' && selectedOrgs.length === 0) {
      toast.error('Please select at least one organization');
      return;
    }
    if (datePreset === 'custom' && (!customStartDate || !customEndDate)) {
      toast.error('Please select custom date range');
      return;
    }

    recalculateMutation.mutate();
  };

  return (
    <ResponsiveContainer maxWidth="2xl" padding="lg">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <RefreshCw className="h-8 w-8 text-blue-500" />
            Comprehensive Recalculation
          </h1>
          <p className="text-muted-foreground mt-1">
            All-in-one: Duplicate detection, zone corrections, data integrity, and compliance recalculation
          </p>
        </div>

        {/* Configuration Card */}
        <Card>
          <CardHeader>
            <CardTitle>Comprehensive Cleanup & Recalculation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Scope Type */}
            <div className="space-y-2">
              <Label htmlFor="scope">Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as any)}>
                <SelectTrigger id="scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ZONE">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      <span>Zone(s)</span>
                    </div>
                  </SelectItem>
                  {isMaster && (
                    <SelectItem value="ORG">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        <span>Organization(s)</span>
                      </div>
                    </SelectItem>
                  )}
                  {isMaster && (
                    <SelectItem value="BUILD">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4" />
                        <span>Entire System</span>
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Zone Selection */}
            {scope === 'ZONE' && (
              <div className="space-y-2">
                <Label>Select Zones</Label>
                <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                  {zones?.map((zone) => (
                    <label key={zone.id} className="flex items-center gap-2 p-2 hover:bg-muted rounded cursor-pointer">
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
                        className="h-4 w-4"
                      />
                      <span className="text-sm font-medium">{zone.name}</span>
                      <Badge variant="outline" className="text-xs ml-auto">
                        {(zone.organization as any)?.name}
                      </Badge>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedZones.length} zone(s) selected
                </p>
              </div>
            )}

            {/* Organization Selection */}
            {scope === 'ORG' && (
              <div className="space-y-2">
                <Label>Select Organizations</Label>
                <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                  {organizations?.map((org) => (
                    <label key={org.id} className="flex items-center gap-2 p-2 hover:bg-muted rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedOrgs.includes(org.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedOrgs([...selectedOrgs, org.id]);
                          } else {
                            setSelectedOrgs(selectedOrgs.filter(id => id !== org.id));
                          }
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-sm font-medium">{org.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedOrgs.length} organization(s) selected
                </p>
              </div>
            )}

            {/* Date Range */}
            <div className="space-y-2">
              <Label htmlFor="date-preset">
                <Calendar className="h-4 w-4 inline mr-2" />
                Date Range
              </Label>
              <Select value={datePreset} onValueChange={setDatePreset}>
                <SelectTrigger id="date-preset">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_time">All Time</SelectItem>
                  <SelectItem value="last_7_days">Last 7 Days</SelectItem>
                  <SelectItem value="last_30_days">Last 30 Days</SelectItem>
                  <SelectItem value="last_90_days">Last 90 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {datePreset === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="start-date">Start Date</Label>
                  <input
                    id="start-date"
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="mt-1 w-full p-2 border rounded-md"
                  />
                </div>
                <div>
                  <Label htmlFor="end-date">End Date</Label>
                  <input
                    id="end-date"
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="mt-1 w-full p-2 border rounded-md"
                  />
                </div>
              </div>
            )}

            {/* Warning for BUILD scope */}
            {scope === 'BUILD' && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>System-Wide Recalculation</AlertTitle>
                <AlertDescription>
                  This will process ALL observations across ALL zones and organizations.
                  This may take several minutes.
                </AlertDescription>
              </Alert>
            )}

            {/* Run Button */}
            <Button
              onClick={handleRunRecalculation}
              disabled={recalculateMutation.isPending}
              className="w-full h-12"
              size="lg"
            >
              {recalculateMutation.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  Run Recalculation
                </>
              )}
            </Button>

            {/* Processing Progress */}
            {recalculateMutation.isPending && (
              <div className="space-y-3">
                {processingOrgs.length > 0 && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3 w-3" />
                      Organization: {currentOrgIndex + 1} of {processingOrgs.length}
                    </div>
                    {currentOrgZones.length > 0 && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3 w-3" />
                        Zone: {currentZoneIndex + 1} of {currentOrgZones.length}
                      </div>
                    )}
                    {totalBatches > 0 && (
                      <div className="flex items-center gap-2">
                        <RefreshCw className="h-3 w-3" />
                        Batch: {currentBatch} of {totalBatches} ({batchSize} records/batch)
                      </div>
                    )}
                  </div>
                )}

                {/* Live Stats */}
                {totalProcessed > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 bg-muted/50 rounded border">
                    <div className="text-center">
                      <div className="text-lg font-bold">{totalProcessed.toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground">Processed</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-blue-600">{totalChanged.toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground">Changed</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-green-600">{totalBreachAlerts.toLocaleString()}</div>
                      <div className="text-[10px] text-muted-foreground">Breaches</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-amber-600">{Math.round((Date.now() - new Date().getTime()) / 1000)}s</div>
                      <div className="text-[10px] text-muted-foreground">Duration</div>
                    </div>
                  </div>
                )}

                {/* Live Processing Log */}
                {processingLogs.length > 0 && (
                  <div className="mt-4 p-3 bg-gray-900 text-gray-100 dark:bg-gray-950 rounded-lg max-h-64 overflow-y-auto font-mono text-xs">
                    {processingLogs.map((log, idx) => (
                      <div key={idx} className="whitespace-pre-wrap">
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Recalculations</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActions && recentActions.length > 0 ? (
              <div className="space-y-3">
                {recentActions.map((action: any) => (
                  <div key={action.id} className="p-4 bg-muted/50 rounded-lg border">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <Badge variant={
                          action.status === 'completed' ? 'default' :
                          action.status === 'running' ? 'secondary' : 'destructive'
                        }>
                          {action.status.toUpperCase()}
                        </Badge>
                        <span className="ml-2 text-sm font-semibold">
                          {action.scope_type} Scope
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(action.performed_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Processed</p>
                        <p className="font-semibold">{action.observations_processed?.toLocaleString() || 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Changed</p>
                        <p className="font-semibold text-amber-600">{action.compliance_changed?.toLocaleString() || 0}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Duration</p>
                        <p className="font-semibold">
                          {action.duration_seconds ? `${action.duration_seconds}s` : '-'}
                        </p>
                      </div>
                    </div>

                    {action.error_message && (
                      <Alert variant="destructive" className="mt-2">
                        <AlertDescription className="text-xs">
                          {action.error_message}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-muted-foreground py-8">
                No recent recalculations
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </ResponsiveContainer>
  );
}
