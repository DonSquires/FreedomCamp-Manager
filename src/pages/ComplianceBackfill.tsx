import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  Database,
  ArrowLeft,
  AlertTriangle,
  Play,
  Loader2,
  CheckCircle2,
  Calendar,
  Info,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useZones } from '@/hooks/useZones';
import { useOrganizations } from '@/hooks/useOrganizations';
import { FunctionsHttpError } from '@supabase/supabase-js';

interface ComplianceBackfillProps {
  onBack: () => void;
}

export function ComplianceBackfill({ onBack }: ComplianceBackfillProps) {
  const { user } = useAuthStore();
  const { data: zones } = useZones();
  const { data: organizations } = useOrganizations();

  const [selectedScope, setSelectedScope] = useState<'zone' | 'organization' | 'all'>('zone');
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [dateRangeStart, setDateRangeStart] = useState('');
  const [dateRangeEnd, setDateRangeEnd] = useState('');
  const [datePreset, setDatePreset] = useState<string>('');
  
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{
    total: number;
    processed: number;
    status: string;
  } | null>(null);

  const isMaster = user?.role === 'master';

  const applyDatePreset = (preset: string) => {
    const now = new Date();
    const end = now.toISOString().split('T')[0];
    let start = '';

    switch (preset) {
      case 'last_30':
        start = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
        break;
      case 'last_90':
        start = new Date(now.setDate(now.getDate() - 90)).toISOString().split('T')[0];
        break;
      case 'this_year':
        start = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
        break;
      case 'all':
        start = '';
        setDateRangeEnd('');
        break;
    }

    setDateRangeStart(start);
    if (preset !== 'all') {
      setDateRangeEnd(end);
    }
  };

  const handleBackfill = async () => {
    if (!user) return;

    // Validation
    if (selectedScope === 'zone' && selectedZones.length === 0) {
      toast.error('Please select at least one zone');
      return;
    }

    if (selectedScope === 'organization' && selectedOrgs.length === 0) {
      toast.error('Please select at least one organization');
      return;
    }

    if (selectedScope === 'organization' && !isMaster) {
      toast.error('Only master users can backfill organization-wide data');
      return;
    }

    if (selectedScope === 'all' && !isMaster) {
      toast.error('Only master users can backfill all historical data');
      return;
    }

    setShowConfirmDialog(false);
    setIsBackfilling(true);
    setBackfillProgress({ total: 0, processed: 0, status: 'Starting backfill...' });

    try {
      // Invoke backfill edge function
      const { data, error } = await supabase.functions.invoke('recalculate-compliance-v2', {
        body: {
          scope_type: selectedScope === 'all' ? 'build_wide' : selectedScope,
          target_zone_ids: selectedScope === 'zone' ? selectedZones : null,
          target_org_ids: selectedScope === 'organization' ? selectedOrgs : null,
          date_range_start: dateRangeStart || null,
          date_range_end: dateRangeEnd || null,
          backfill_mode: true, // Flag to indicate this is a backfill operation
        },
      });

      if (error) {
        // Extract actual error message from Edge Function
        let errorMessage = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const statusCode = error.context?.status ?? 500;
            const textContent = await error.context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`;
          } catch {
            errorMessage = error.message || 'Failed to read response';
          }
        }
        throw new Error(errorMessage);
      }

      toast.success(`✅ Backfill completed: ${data.observations_processed} observations processed`);
      setBackfillProgress({
        total: data.observations_processed,
        processed: data.observations_processed,
        status: 'Completed successfully',
      });

      // Reset form after success
      setTimeout(() => {
        setSelectedZones([]);
        setSelectedOrgs([]);
        setDateRangeStart('');
        setDateRangeEnd('');
        setDatePreset('');
        setIsBackfilling(false);
        setBackfillProgress(null);
      }, 5000);
    } catch (error: any) {
      console.error('Backfill failed:', error);
      toast.error('Backfill failed: ' + error.message);
      setIsBackfilling(false);
      setBackfillProgress(null);
    }
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Compliance Data Backfill</h1>
          <p className="text-sm text-muted-foreground">
            Populate historical compliance results with appropriate matrix versions
          </p>
        </div>
      </div>

      {/* Info Banner */}
      <Card className="border-blue-500/40 bg-blue-500/5">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-blue-700 dark:text-blue-400">What is Backfill?</p>
              <p className="text-muted-foreground">
                Backfill re-evaluates historical vehicle observations using the compliance matrix version that was 
                in effect at the time of each observation. This ensures accurate compliance tracking when matrix 
                criteria have changed over time.
              </p>
              <p className="text-muted-foreground">
                Use this tool after importing historical data or when you need to rebuild compliance results from scratch.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Backfill Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Backfill Configuration</CardTitle>
          <CardDescription>Select scope and date range for backfill operation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Scope Selection */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Backfill Scope</Label>
            <Select value={selectedScope} onValueChange={(value: any) => setSelectedScope(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zone">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    <span>Specific Zone(s)</span>
                  </div>
                </SelectItem>
                {isMaster && (
                  <>
                    <SelectItem value="organization">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        <span>Organization(s)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="all">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        <span>All Historical Data</span>
                      </div>
                    </SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Zone Selection */}
          {selectedScope === 'zone' && (
            <div>
              <Label className="text-sm font-semibold mb-2 block">Select Zones</Label>
              <div className="max-h-48 overflow-y-auto border rounded p-3 space-y-2">
                {zones?.map(zone => (
                  <div key={zone.id} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id={`backfill-zone-${zone.id}`}
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
                    <Label htmlFor={`backfill-zone-${zone.id}`} className="text-sm cursor-pointer">
                      {zone.name}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedZones.length} zone{selectedZones.length !== 1 ? 's' : ''} selected
              </p>
            </div>
          )}

          {/* Organization Selection */}
          {selectedScope === 'organization' && isMaster && (
            <div>
              <Label className="text-sm font-semibold mb-2 block">Select Organizations</Label>
              <div className="max-h-48 overflow-y-auto border rounded p-3 space-y-2">
                {organizations?.map(org => (
                  <div key={org.id} className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id={`backfill-org-${org.id}`}
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
                    <Label htmlFor={`backfill-org-${org.id}`} className="text-sm cursor-pointer">
                      {org.name}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedOrgs.length} organization{selectedOrgs.length !== 1 ? 's' : ''} selected
              </p>
            </div>
          )}

          {/* All Data Warning */}
          {selectedScope === 'all' && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-500">
                    Full Historical Backfill
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This will process ALL vehicle observations across ALL organizations and zones. 
                    This operation may take several minutes or hours depending on data volume.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Date Range */}
          <div className="border-t pt-4">
            <Label className="text-sm font-semibold mb-2 block">Date Range</Label>
            
            {/* Quick Presets */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Button
                variant={datePreset === 'last_30' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setDatePreset('last_30');
                  applyDatePreset('last_30');
                }}
              >
                Last 30 Days
              </Button>
              <Button
                variant={datePreset === 'last_90' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setDatePreset('last_90');
                  applyDatePreset('last_90');
                }}
              >
                Last 90 Days
              </Button>
              <Button
                variant={datePreset === 'this_year' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setDatePreset('this_year');
                  applyDatePreset('this_year');
                }}
              >
                This Year
              </Button>
              <Button
                variant={datePreset === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setDatePreset('all');
                  applyDatePreset('all');
                }}
              >
                All Time
              </Button>
            </div>

            {/* Custom Date Range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="backfill-start-date" className="text-xs">Start Date</Label>
                <input
                  id="backfill-start-date"
                  type="date"
                  value={dateRangeStart}
                  onChange={(e) => {
                    setDateRangeStart(e.target.value);
                    setDatePreset('');
                  }}
                  className="w-full mt-1 px-3 py-2 border rounded text-sm"
                />
              </div>
              <div>
                <Label htmlFor="backfill-end-date" className="text-xs">End Date</Label>
                <input
                  id="backfill-end-date"
                  type="date"
                  value={dateRangeEnd}
                  onChange={(e) => {
                    setDateRangeEnd(e.target.value);
                    setDatePreset('');
                  }}
                  className="w-full mt-1 px-3 py-2 border rounded text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Leave empty to backfill all historical observations
            </p>
          </div>

          {/* Start Backfill Button */}
          <div className="flex justify-end pt-4">
            <Button
              onClick={() => setShowConfirmDialog(true)}
              disabled={isBackfilling}
              size="lg"
            >
              {isBackfilling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Backfilling...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Backfill
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Progress Indicator */}
      {backfillProgress && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              {isBackfilling ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Backfill in Progress
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Backfill Completed
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-semibold">
                  {backfillProgress.processed} / {backfillProgress.total || '?'}
                </span>
              </div>
              <Progress 
                value={backfillProgress.total > 0 ? (backfillProgress.processed / backfillProgress.total) * 100 : 0} 
                className="h-2"
              />
            </div>
            <p className="text-sm text-muted-foreground">{backfillProgress.status}</p>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Backfill Operation</DialogTitle>
            <DialogDescription>
              This will re-evaluate historical compliance data
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-500 mb-2">
                    Warning: Data Overwrite
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    This operation will:
                  </p>
                  <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Re-evaluate all observations in the selected scope</li>
                    <li>Use the matrix version that was active at each observation's timestamp</li>
                    <li>Update existing compliance_results records</li>
                    <li>Potentially change compliance status for historical records</li>
                  </ul>
                  <p className="text-xs text-muted-foreground mt-2">
                    This cannot be undone. Ensure you have a database backup if needed.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleBackfill}>
              <Play className="h-4 w-4 mr-2" />
              Confirm & Start Backfill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
