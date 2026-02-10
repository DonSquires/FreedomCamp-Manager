/**
 * VehicleMigration.tsx - DEPRECATED
 * Redirects to HistoricalImport page
 * 
 * The old vehicle_records migration approach has been replaced with
 * observation-first migration via import-historical-data Edge Function.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function VehicleMigration() {
  const navigate = useNavigate();

  useEffect(() => {
    // Auto-redirect after 3 seconds
    const timer = setTimeout(() => {
      navigate('/admin/historical-import');
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Card className="border-amber-500">
        <CardContent className="p-8">
          <Alert variant="default" className="mb-6">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <AlertDescription className="text-base">
              <strong className="block mb-2">This page has been deprecated</strong>
              <p className="text-sm text-muted-foreground">
                The vehicle migration system has been replaced with a new observation-first
                migration approach that better preserves data provenance and supports compliance
                drift detection.
              </p>
            </AlertDescription>
          </Alert>

          <div className="text-center py-8 space-y-6">
            <div className="flex items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-lg">Redirecting to Historical Import...</span>
            </div>

            <Button
              onClick={() => navigate('/admin/historical-import')}
              size="lg"
              className="gap-2"
            >
              Go to Historical Import
              <ArrowRight className="h-5 w-5" />
            </Button>
          </div>

          <div className="mt-8 p-6 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-3">
              What's Different?
            </h3>
            <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">•</span>
                <span><strong>Observation-first:</strong> Legacy data imported as vehicle_observations with full provenance</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">•</span>
                <span><strong>Auto-enrichment:</strong> Missing data filled from existing records or zone defaults</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">•</span>
                <span><strong>Compliance recalculation:</strong> Evaluates against current matrix with drift detection</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 font-bold">•</span>
                <span><strong>Audit trail:</strong> Complete provenance tracking with source_record_id and migration timestamps</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
