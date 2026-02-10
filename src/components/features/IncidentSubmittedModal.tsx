/**
 * IncidentSubmittedModal - Notification after incident report submission
 * Styled like AlertAcknowledgementModal with flag icon and red border
 * Requires acknowledgement before continuing
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Flag, CheckCircle2, Edit, Loader2 } from 'lucide-react';

interface IncidentSubmittedModalProps {
  incidentId: string;
  plateNumber: string;
  incidentType: string;
  onAcknowledge: () => void;
  onUpdate: () => void;
}

export function IncidentSubmittedModal({
  incidentId,
  plateNumber,
  incidentType,
  onAcknowledge,
  onUpdate,
}: IncidentSubmittedModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAcknowledge = () => {
    setIsProcessing(true);
    // Play acknowledgement sound (optional)
    onAcknowledge();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-200">
      <Card className="max-w-lg w-full bg-green-50 dark:bg-green-950/30 border-2 border-green-500 shadow-2xl animate-in zoom-in duration-300">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
              <div className="p-3 rounded-full bg-green-50 dark:bg-green-950/30 ring-4 ring-white dark:ring-gray-900 text-green-600">
                <Flag className="h-8 w-8" />
              </div>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-2xl font-black mb-2 flex items-center gap-2 leading-tight text-green-900 dark:text-green-100">
                  📋 REPORT SUBMITTED
                </CardTitle>
                <Badge className="font-bold text-sm px-3 py-1 bg-green-600 text-white">
                  PENDING REVIEW
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Vehicle Info */}
          <div className="p-5 bg-white dark:bg-gray-900 rounded-lg border-2 border-gray-300 dark:border-gray-700">
            <div className="mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Vehicle Plate:
              </p>
              <p className="font-mono font-black text-2xl tracking-wider text-gray-900 dark:text-white">
                {plateNumber}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Incident Type:
              </p>
              <p className="font-bold text-lg text-gray-900 dark:text-white">
                {incidentType}
              </p>
            </div>
          </div>

          {/* Submission Message */}
          <div className="p-5 bg-green-100 dark:bg-green-950/50 rounded-lg border-2 border-green-500 space-y-3">
            <div>
              <p className="text-base font-bold leading-relaxed text-green-900 dark:text-green-100">
                ✅ Your incident report has been submitted for admin review
              </p>
            </div>
            <div className="pt-3 border-t border-green-300 dark:border-green-700 space-y-2">
              <p className="text-sm leading-relaxed text-green-800 dark:text-green-200">
                • Report will be reviewed by admin team
              </p>
              <p className="text-sm leading-relaxed text-green-800 dark:text-green-200">
                • Once approved, this incident will be linked to the vehicle
              </p>
              <p className="text-sm leading-relaxed text-green-800 dark:text-green-200">
                • Future officers will see this incident when the vehicle is scanned
              </p>
              <p className="text-sm leading-relaxed text-green-800 dark:text-green-200">
                • You can review your reports in the "My Incidents" menu
              </p>
            </div>
          </div>

          {/* Retention Notice */}
          <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-300 dark:border-blue-700">
            <p className="text-sm text-blue-900 dark:text-blue-100 leading-relaxed">
              📱 <strong>24-Hour Access:</strong> Your incident reports are available for review and updates for 24 hours from submission time.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <Button
              variant="outline"
              onClick={onUpdate}
              className="h-20 text-lg font-bold touch-manipulation border-2"
            >
              <Edit className="h-6 w-6 mr-2" />
              Update
            </Button>
            <Button
              variant="default"
              onClick={handleAcknowledge}
              disabled={isProcessing}
              className="h-20 text-lg font-bold bg-green-600 hover:bg-green-700 touch-manipulation shadow-lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-6 w-6 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-6 w-6 mr-2" />
                  Acknowledge
                </>
              )}
            </Button>
          </div>

          <p className="text-sm text-center text-muted-foreground font-semibold pt-2">
            ⚠️ Acknowledgement required to continue
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
