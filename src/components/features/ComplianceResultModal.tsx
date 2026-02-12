/**
 * Compliance Result Modal - Shows after Check button
 * Displays compliance status and action options based on result
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Camera,
  ArrowRight,
  Home,
  HeartPulse,
  Flag,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ComplianceResultModalProps {
  open: boolean;
  plateNumber: string;
  isCompliant: boolean;
  isBreach: boolean;
  isAtRisk: boolean;
  isHomeless?: boolean;
  hasHSIssue?: boolean;
  isFlagged?: boolean;
  alerts: string[];
  onContinueScanning: () => void;
  onAddEvidence: () => void;
  onGoToEnforcement: () => void;
  onAcknowledge: () => void;
}

export function ComplianceResultModal({
  open,
  plateNumber,
  isCompliant,
  isBreach,
  isAtRisk,
  isHomeless,
  hasHSIssue,
  isFlagged,
  alerts,
  onContinueScanning,
  onAddEvidence,
  onGoToEnforcement,
  onAcknowledge,
}: ComplianceResultModalProps) {
  // Determine modal style based on status
  const getBackgroundClass = () => {
    if (isBreach) return 'bg-gradient-to-br from-red-100 to-red-200 dark:from-red-950/40 dark:to-red-900/40';
    if (isAtRisk) return 'bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-950/40 dark:to-orange-900/40';
    if (isHomeless || hasHSIssue || isFlagged) return 'bg-gradient-to-br from-yellow-100 to-yellow-200 dark:from-yellow-950/40 dark:to-yellow-900/40';
    return 'bg-gradient-to-br from-green-100 to-green-200 dark:from-green-950/40 dark:to-green-900/40';
  };

  const getStatusBadge = () => {
    if (isBreach) {
      return (
        <Badge className="bg-red-600 text-white text-lg px-4 py-2">
          <XCircle className="h-5 w-5 mr-2" />
          BREACH DETECTED
        </Badge>
      );
    }
    if (isAtRisk) {
      return (
        <Badge className="bg-orange-600 text-white text-lg px-4 py-2">
          <AlertTriangle className="h-5 w-5 mr-2" />
          AT RISK
        </Badge>
      );
    }
    if (isHomeless) {
      return (
        <Badge className="bg-purple-600 text-white text-lg px-4 py-2">
          <Home className="h-5 w-5 mr-2" />
          HOMELESS (FC ACT EXEMPT)
        </Badge>
      );
    }
    if (hasHSIssue) {
      return (
        <Badge className="bg-yellow-600 text-white text-lg px-4 py-2">
          <HeartPulse className="h-5 w-5 mr-2" />
          HEALTH & SAFETY
        </Badge>
      );
    }
    if (isFlagged) {
      return (
        <Badge className="bg-yellow-600 text-white text-lg px-4 py-2 animate-pulse">
          <Flag className="h-5 w-5 mr-2" />
          FLAGGED VEHICLE
        </Badge>
      );
    }
    return (
      <Badge className="bg-green-600 text-white text-lg px-4 py-2">
        <CheckCircle2 className="h-5 w-5 mr-2" />
        COMPLIANT
      </Badge>
    );
  };

  const getIcon = () => {
    if (isBreach || isAtRisk) {
      return <XCircle className="h-16 w-16 text-red-600" />;
    }
    if (isHomeless || hasHSIssue || isFlagged) {
      return <AlertTriangle className="h-16 w-16 text-yellow-600" />;
    }
    return <CheckCircle2 className="h-16 w-16 text-green-600" />;
  };

  // Determine which action buttons to show
  const requiresEnforcement = isBreach || isAtRisk;
  const isInformationalOnly = isHomeless || hasHSIssue || isFlagged;

  return (
    <Dialog open={open} onOpenChange={onContinueScanning}>
      <DialogContent 
        className={cn(
          "max-w-[95vw] w-full sm:max-w-md p-0 rounded-3xl shadow-2xl border-4 max-h-[90vh] overflow-y-auto",
          getBackgroundClass(),
          isBreach && "border-red-500",
          isAtRisk && "border-orange-500",
          (isHomeless || hasHSIssue || isFlagged) && "border-yellow-500",
          isCompliant && !isHomeless && !hasHSIssue && !isFlagged && "border-green-500"
        )}
      >
        <DialogHeader className="p-6 pb-4">
          <div className="flex flex-col items-center gap-4 mb-4">
            {getIcon()}
            {getStatusBadge()}
          </div>
          
          <DialogTitle className="text-2xl text-center text-gray-900 dark:text-white">
            {plateNumber}
          </DialogTitle>
          
          <p className="text-sm text-center text-gray-600 dark:text-gray-300 mt-2">
            Observation recorded at {new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </DialogHeader>

        <div className="px-6 pb-6 space-y-4">
          {/* Alerts */}
          {alerts.length > 0 && (
            <div className="space-y-2">
              {alerts.map((alert, index) => (
                <div
                  key={index}
                  className={cn(
                    "p-3 rounded-lg text-sm font-medium",
                    isBreach || isAtRisk
                      ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-2 border-red-300"
                      : isHomeless || hasHSIssue || isFlagged
                      ? "bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-300 border-2 border-yellow-300"
                      : "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-2 border-green-300"
                  )}
                >
                  {alert}
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3 pt-4">
            {requiresEnforcement ? (
              // Breach or At-Risk: Show Enforcement option
              <>
                <Button
                  onClick={onGoToEnforcement}
                  className="w-full h-16 text-lg font-bold bg-red-600 hover:bg-red-700 text-white"
                >
                  <AlertTriangle className="h-6 w-6 mr-2" />
                  Go to Enforcement
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
                <Button
                  onClick={onContinueScanning}
                  variant="outline"
                  className="w-full h-14 text-base font-bold border-2"
                >
                  Continue Scanning
                </Button>
              </>
            ) : isInformationalOnly ? (
              // Informational alerts (Homeless, H&S, Flagged): Just acknowledge
              <Button
                onClick={onAcknowledge}
                className="w-full h-16 text-lg font-bold bg-yellow-600 hover:bg-yellow-700 text-white"
              >
                <CheckCircle2 className="h-6 w-6 mr-2" />
                Acknowledge & Continue
              </Button>
            ) : (
              // Compliant: Show Continue or Add Evidence
              <>
                <Button
                  onClick={onContinueScanning}
                  className="w-full h-16 text-lg font-bold bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle2 className="h-6 w-6 mr-2" />
                  Continue Scanning
                </Button>
                <Button
                  onClick={onAddEvidence}
                  variant="outline"
                  className="w-full h-14 text-base font-bold border-2 border-blue-500 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                >
                  <Camera className="h-5 w-5 mr-2" />
                  Add More Evidence
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
