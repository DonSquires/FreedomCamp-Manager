/**
 * BatchOperationRunner - Unified batch processing with progress tracking
 * Features:
 * - Organization/Zone filtering
 * - 50-record batches
 * - Real-time progress statistics
 * - Pause/Resume capability
 * - Detailed logging
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Play, 
  Pause, 
  StopCircle, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  TrendingUp,
  Users,
  Flag,
  Home,
  Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';

interface BatchStats {
  total: number;
  checked: number;
  changed: number;
  breached: number;
  homeless: number;
  compliant: number;
  errors: number;
  flagged?: number;
  [key: string]: number | undefined;
}

interface BatchLog {
  timestamp: Date;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface BatchOperationRunnerProps {
  operationType: 'recalculation' | 'zone_correction' | 'integrity_check' | 'cleanup';
  operationName: string;
  operationDescription: string;
  edgeFunctionName: string;
  organizationId?: string;
  zoneIds?: string[];
  dateRange?: { from: Date; to: Date };
  batchSize?: number;
  onComplete?: (stats: BatchStats) => void;
}

export function BatchOperationRunner({
  operationType,
  operationName,
  operationDescription,
  edgeFunctionName,
  organizationId,
  zoneIds,
  dateRange,
  batchSize = 50,
  onComplete,
}: BatchOperationRunnerProps) {
  const { user } = useAuthStore();
  
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [stats, setStats] = useState<BatchStats>({
    total: 0,
    checked: 0,
    changed: 0,
    breached: 0,
    homeless: 0,
    compliant: 0,
    errors: 0,
  });
  const [logs, setLogs] = useState<BatchLog[]>([]);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string>('');

  const addLog = (type: BatchLog['type'], message: string) => {
    const log: BatchLog = {
      timestamp: new Date(),
      type,
      message,
    };
    setLogs(prev => [log, ...prev].slice(0, 100)); // Keep last 100 logs
  };

  const calculateProgress = () => {
    if (stats.total === 0) return 0;
    return Math.round((stats.checked / stats.total) * 100);
  };

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const updateEstimatedTime = () => {
    if (!startTime || stats.checked === 0) {
      setEstimatedTimeRemaining('Calculating...');
      return;
    }

    const elapsed = Date.now() - startTime.getTime();
    const rate = stats.checked / elapsed; // records per ms
    const remaining = stats.total - stats.checked;
    const estimatedMs = remaining / rate;

    setEstimatedTimeRemaining(formatDuration(estimatedMs));
  };

  useEffect(() => {
    if (isRunning && !isPaused && stats.total > 0) {
      const interval = setInterval(updateEstimatedTime, 1000);
      return () => clearInterval(interval);
    }
  }, [isRunning, isPaused, stats, startTime]);

  const runBatchOperation = async () => {
    try {
      setIsRunning(true);
      setIsPaused(false);
      setStartTime(new Date());
      addLog('info', `🚀 Starting ${operationName}...`);

      // Build request payload
      const payload: any = {
        batch_size: batchSize,
        organization_id: organizationId || user?.organization_id,
      };

      if (zoneIds && zoneIds.length > 0) {
        payload.zone_ids = zoneIds;
      }

      if (dateRange) {
        payload.date_range_start = dateRange.from.toISOString().split('T')[0];
        payload.date_range_end = dateRange.to.toISOString().split('T')[0];
      }

      addLog('info', `📋 Filters: Org=${payload.organization_id}, Zones=${zoneIds?.length || 'All'}`);

      // Call Edge Function
      const { data, error } = await supabase.functions.invoke(edgeFunctionName, {
        body: payload,
      });

      if (error) {
        throw error;
      }

      if (!data.success) {
        throw new Error(data.error || 'Operation failed');
      }

      // Update stats from response
      const responseStats: BatchStats = {
        total: data.total_records || data.observations_processed || 0,
        checked: data.total_records || data.observations_processed || 0,
        changed: data.records_updated || data.compliance_changed || 0,
        breached: data.breaches_detected || data.breaches_created || 0,
        homeless: data.homeless_detected || 0,
        compliant: data.compliant_count || 0,
        errors: data.errors || 0,
        flagged: data.flagged_vehicles || 0,
      };

      setStats(responseStats);
      setTotalBatches(Math.ceil(responseStats.total / batchSize));

      addLog('success', `✅ ${operationName} completed successfully`);
      addLog('info', `📊 Processed: ${responseStats.checked}, Changed: ${responseStats.changed}, Breaches: ${responseStats.breached}`);

      toast.success(`${operationName} completed`, {
        description: `${responseStats.checked} records processed, ${responseStats.changed} updated`,
      });

      if (onComplete) {
        onComplete(responseStats);
      }

    } catch (error: any) {
      console.error(`${operationName} error:`, error);
      addLog('error', `❌ Error: ${error.message}`);
      toast.error(`${operationName} failed`, {
        description: error.message,
      });
      setStats(prev => ({ ...prev, errors: prev.errors + 1 }));
    } finally {
      setIsRunning(false);
      setIsPaused(false);
    }
  };

  const pauseOperation = () => {
    setIsPaused(true);
    addLog('warning', '⏸️ Operation paused');
  };

  const resumeOperation = () => {
    setIsPaused(false);
    addLog('info', '▶️ Operation resumed');
  };

  const stopOperation = () => {
    setIsRunning(false);
    setIsPaused(false);
    addLog('warning', '🛑 Operation stopped by user');
    toast.warning('Operation stopped');
  };

  const resetOperation = () => {
    setStats({
      total: 0,
      checked: 0,
      changed: 0,
      breached: 0,
      homeless: 0,
      compliant: 0,
      errors: 0,
    });
    setLogs([]);
    setCurrentBatch(0);
    setTotalBatches(0);
    setStartTime(null);
    setEstimatedTimeRemaining('');
  };

  return (
    <div className="space-y-6">
      {/* Operation Info */}
      <Alert>
        <Activity className="h-4 w-4" />
        <AlertDescription>
          <strong>{operationName}</strong>: {operationDescription}
          <br />
          <span className="text-xs text-muted-foreground mt-1 block">
            Batch size: {batchSize} records | Organization: {organizationId || 'Current'} | Zones: {zoneIds?.length || 'All'}
          </span>
        </AlertDescription>
      </Alert>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {!isRunning && stats.checked === 0 && (
          <Button onClick={runBatchOperation} className="gap-2">
            <Play className="h-4 w-4" />
            Start {operationName}
          </Button>
        )}

        {isRunning && !isPaused && (
          <>
            <Button onClick={pauseOperation} variant="outline" className="gap-2">
              <Pause className="h-4 w-4" />
              Pause
            </Button>
            <Button onClick={stopOperation} variant="destructive" className="gap-2">
              <StopCircle className="h-4 w-4" />
              Stop
            </Button>
          </>
        )}

        {isRunning && isPaused && (
          <>
            <Button onClick={resumeOperation} className="gap-2">
              <Play className="h-4 w-4" />
              Resume
            </Button>
            <Button onClick={stopOperation} variant="destructive" className="gap-2">
              <StopCircle className="h-4 w-4" />
              Stop
            </Button>
          </>
        )}

        {!isRunning && stats.checked > 0 && (
          <Button onClick={resetOperation} variant="outline">
            Reset
          </Button>
        )}

        {isRunning && (
          <Badge variant="secondary" className="gap-1 animate-pulse">
            <Activity className="h-3 w-3" />
            {isPaused ? 'Paused' : 'Running'}
          </Badge>
        )}
      </div>

      {/* Progress Bar */}
      {stats.total > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium">
              Progress: {stats.checked.toLocaleString()} / {stats.total.toLocaleString()}
            </span>
            <span className="text-muted-foreground">
              {calculateProgress()}%
            </span>
          </div>
          <Progress value={calculateProgress()} className="h-3" />
          {isRunning && estimatedTimeRemaining && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Estimated time remaining: {estimatedTimeRemaining}
            </div>
          )}
        </div>
      )}

      {/* Statistics Grid */}
      {stats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <CheckCircle2 className="h-4 w-4" />
              Checked
            </div>
            <div className="text-2xl font-bold">{stats.checked.toLocaleString()}</div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingUp className="h-4 w-4" />
              Changed
            </div>
            <div className="text-2xl font-bold text-blue-600">{stats.changed.toLocaleString()}</div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <AlertCircle className="h-4 w-4" />
              Breaches
            </div>
            <div className="text-2xl font-bold text-red-600">{stats.breached.toLocaleString()}</div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Home className="h-4 w-4" />
              Homeless
            </div>
            <div className="text-2xl font-bold text-yellow-600">{stats.homeless.toLocaleString()}</div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <CheckCircle2 className="h-4 w-4" />
              Compliant
            </div>
            <div className="text-2xl font-bold text-green-600">{stats.compliant.toLocaleString()}</div>
          </Card>

          {stats.flagged !== undefined && stats.flagged > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Flag className="h-4 w-4" />
                Flagged
              </div>
              <div className="text-2xl font-bold text-orange-600">{stats.flagged.toLocaleString()}</div>
            </Card>
          )}

          {stats.errors > 0 && (
            <Card className="p-4 border-red-200 bg-red-50">
              <div className="flex items-center gap-2 text-sm text-red-600 mb-1">
                <AlertCircle className="h-4 w-4" />
                Errors
              </div>
              <div className="text-2xl font-bold text-red-600">{stats.errors.toLocaleString()}</div>
            </Card>
          )}
        </div>
      )}

      {/* Activity Log */}
      {logs.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Activity Log
          </h3>
          <div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
            {logs.map((log, idx) => (
              <div
                key={idx}
                className={cn(
                  'flex items-start gap-2 p-2 rounded',
                  log.type === 'error' && 'bg-red-50 text-red-900',
                  log.type === 'warning' && 'bg-yellow-50 text-yellow-900',
                  log.type === 'success' && 'bg-green-50 text-green-900',
                  log.type === 'info' && 'bg-blue-50 text-blue-900'
                )}
              >
                <span className="text-muted-foreground shrink-0">
                  {log.timestamp.toLocaleTimeString('en-NZ', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    second: '2-digit' 
                  })}
                </span>
                <span className="flex-1">{log.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
