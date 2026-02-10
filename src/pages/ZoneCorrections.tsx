/**
 * Zone Corrections - Manual trigger for GPS-based zone correction
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  MapPin,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';

interface CorrectionSummary {
  total_checked: number;
  corrected: number;
  already_correct: number;
  corrections: {
    observation_id: string;
    plate_number: string;
    old_zone: string;
    new_zone: string;
    recorded_at: string;
  }[];
  timestamp: string;
}

export function ZoneCorrections() {
  const { user } = useAuthStore();
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<CorrectionSummary | null>(null);

  const handleRunCorrection = async () => {
    setIsRunning(true);
    toast.loading('Checking observations for zone mismatches...');

    try {
      const { data, error } = await supabase.functions.invoke('check-zone-corrections', {
        body: {},
      });

      if (error) throw error;

      setLastRun(data.summary);
      
      if (data.summary.corrected > 0) {
        toast.success(`✅ Corrected ${data.summary.corrected} observation${data.summary.corrected !== 1 ? 's' : ''}`);
      } else {
        toast.info('✓ All observations are in correct zones');
      }
    } catch (error: any) {
      console.error('Zone correction failed:', error);
      toast.error('Failed to run correction: ' + error.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <MapPin className="h-8 w-8 text-blue-600" />
          GPS Zone Corrections
        </h1>
        <p className="text-muted-foreground mt-1">
          Check and correct observations where GPS location doesn't match assigned zone
        </p>
      </div>

      {/* Info Alert */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>How Zone Correction Works</AlertTitle>
        <AlertDescription className="text-sm">
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li>Checks observations from the last 24 hours</li>
            <li>Uses GPS coordinates to detect correct zone via geofence</li>
            <li>Automatically updates zone_id if GPS indicates wrong zone</li>
            <li>Ignores observations without GPS data</li>
          </ul>
        </AlertDescription>
      </Alert>

      {/* Run Correction Card */}
      <Card className="border-2 border-blue-200">
        <CardHeader>
          <CardTitle>Manual Zone Correction</CardTitle>
          <CardDescription>
            Run this check to verify and correct zone assignments based on GPS data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleRunCorrection}
            disabled={isRunning}
            size="lg"
            className="w-full h-14 text-lg"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Running Correction...
              </>
            ) : (
              <>
                <RefreshCw className="h-5 w-5 mr-2" />
                Run Zone Correction Check
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Last Run Results */}
      {lastRun && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Last Run Results
              </span>
              <Badge variant="outline" className="text-xs">
                <Clock className="h-3 w-3 mr-1" />
                {new Date(lastRun.timestamp).toLocaleString('en-NZ')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-muted rounded-lg text-center">
                <p className="text-sm text-muted-foreground">Checked</p>
                <p className="text-2xl font-bold">{lastRun.total_checked}</p>
              </div>
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">Corrected</p>
                <p className="text-2xl font-bold text-green-700">{lastRun.corrected}</p>
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">Already Correct</p>
                <p className="text-2xl font-bold text-blue-700">{lastRun.already_correct}</p>
              </div>
            </div>

            {/* Corrections List */}
            {lastRun.corrections.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Recent Corrections:</p>
                {lastRun.corrections.map((correction) => (
                  <div
                    key={correction.observation_id}
                    className="p-3 bg-muted rounded-lg text-sm"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-semibold">{correction.plate_number}</span>
                      <Badge variant="secondary" className="text-xs">
                        {new Date(correction.recorded_at).toLocaleString('en-NZ', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2">
                      <span className="line-through">{correction.old_zone}</span>
                      <span>→</span>
                      <span className="text-green-600 font-semibold">{correction.new_zone}</span>
                    </div>
                  </div>
                ))}
                {lastRun.corrected > 10 && (
                  <p className="text-xs text-muted-foreground text-center">
                    Showing 10 of {lastRun.corrected} corrections
                  </p>
                )}
              </div>
            )}

            {lastRun.corrected === 0 && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  ✓ All recent observations are assigned to correct zones based on GPS data
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
