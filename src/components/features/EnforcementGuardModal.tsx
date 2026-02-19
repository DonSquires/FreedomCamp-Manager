/**
 * EnforcementGuardModal - Displays why an observation is not enforceable
 * 
 * Shows:
 * - Detailed error message
 * - Specific failing criteria
 * - Remediation guidance
 * - Evidence Act compliance requirements
 * 
 * Triggered by: is_observation_enforceable() RPC returning enforceable=false
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Shield,
  FileWarning,
  Eye,
  Camera,
  FileX,
} from 'lucide-react';

interface EnforcementGuardModalProps {
  open: boolean;
  onClose: () => void;
  checkResult: {
    enforceable: boolean;
    reason: string;
    message: string;
    is_legacy?: boolean;
    review_blocked?: boolean;
    evidence_state?: string;
    has_photo?: boolean;
  } | null;
}

export function EnforcementGuardModal({
  open,
  onClose,
  checkResult,
}: EnforcementGuardModalProps) {
  if (!checkResult || checkResult.enforceable) return null;

  // Map reason codes to icons and severity
  const reasonMetadata: Record<
    string,
    { icon: any; color: string; severity: 'error' | 'warning' }
  > = {
    legacy_import: {
      icon: FileWarning,
      color: 'text-amber-600',
      severity: 'warning',
    },
    review_blocked: {
      icon: Eye,
      color: 'text-orange-600',
      severity: 'error',
    },
    no_original_photo: {
      icon: Camera,
      color: 'text-red-600',
      severity: 'error',
    },
    evidence_state_invalid: {
      icon: FileX,
      color: 'text-red-600',
      severity: 'error',
    },
    observation_not_found: {
      icon: AlertTriangle,
      color: 'text-red-600',
      severity: 'error',
    },
  };

  const metadata = reasonMetadata[checkResult.reason] || {
    icon: AlertTriangle,
    color: 'text-red-600',
    severity: 'error',
  };

  const Icon = metadata.icon;

  // Generate remediation steps
  const getRemediationSteps = () => {
    switch (checkResult.reason) {
      case 'legacy_import':
        return [
          'This is a historical record imported without original photo evidence',
          'Cannot be used for enforcement actions (Evidence Act 2006 s8)',
          'Use for reporting and analytics only',
          'Consider re-capturing with photo-first workflow if vehicle returns',
        ];
      case 'review_blocked':
        return [
          'Observation flagged for admin review',
          'Requires resolution before enforcement',
          'Check admin panel for review status and notes',
          'Contact admin if urgent enforcement needed',
        ];
      case 'no_original_photo':
        return [
          'Original photo hash missing',
          'Cannot verify evidence integrity (Evidence Act 2006 s8)',
          'System should have prevented this (photo-first workflow breach)',
          'Contact system admin immediately',
        ];
      case 'evidence_state_invalid':
        return [
          `Evidence state: ${checkResult.evidence_state || 'unknown'}`,
          'Original photo not present or verified',
          'Court proceedings require unaltered original photos',
          'Check photo storage and hash verification',
        ];
      default:
        return ['Unknown enforcement block reason', 'Contact system admin'];
    }
  };

  const remediationSteps = getRemediationSteps();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div
              className={`p-3 rounded-full ${
                metadata.severity === 'error'
                  ? 'bg-red-100 dark:bg-red-950/30'
                  : 'bg-amber-100 dark:bg-amber-950/30'
              }`}
            >
              <Icon
                className={`h-6 w-6 ${metadata.color}`}
              />
            </div>
            <div>
              <DialogTitle className="text-xl">
                Cannot Issue Enforcement Notice
              </DialogTitle>
              <DialogDescription>
                This observation does not meet enforcement requirements
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Main Error Message */}
          <div
            className={`p-4 rounded-lg border-2 ${
              metadata.severity === 'error'
                ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
            }`}
          >
            <div className="flex items-start gap-3">
              <Shield className={`h-5 w-5 ${metadata.color} mt-0.5 shrink-0`} />
              <div>
                <p
                  className={`font-semibold mb-1 ${
                    metadata.severity === 'error'
                      ? 'text-red-900 dark:text-red-100'
                      : 'text-amber-900 dark:text-amber-100'
                  }`}
                >
                  {checkResult.message}
                </p>
                <p
                  className={`text-sm ${
                    metadata.severity === 'error'
                      ? 'text-red-700 dark:text-red-300'
                      : 'text-amber-700 dark:text-amber-300'
                  }`}
                >
                  Reason code: <code className="font-mono">{checkResult.reason}</code>
                </p>
              </div>
            </div>
          </div>

          {/* Remediation Steps */}
          <div className="space-y-3">
            <div className="font-semibold text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              What to do next:
            </div>
            <ul className="space-y-2 ml-6">
              {remediationSteps.map((step, index) => (
                <li key={index} className="text-sm flex items-start gap-2">
                  <Badge
                    variant="outline"
                    className="shrink-0 w-5 h-5 p-0 flex items-center justify-center text-[10px] mt-0.5"
                  >
                    {index + 1}
                  </Badge>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal/Compliance Note */}
          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-xs">
            <div className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
              📖 Evidence Act 2006 Compliance
            </div>
            <p className="text-blue-700 dark:text-blue-300">
              All enforcement actions require:
            </p>
            <ul className="list-disc list-inside text-blue-700 dark:text-blue-300 ml-2 mt-1 space-y-0.5">
              <li>Unaltered original photo evidence (s8 authenticity)</li>
              <li>SHA-256 hash verification</li>
              <li>GPS location accuracy {'<'}= 15m</li>
              <li>Chain-of-custody audit trail</li>
            </ul>
          </div>

          {/* Additional Metadata */}
          {(checkResult.is_legacy !== undefined ||
            checkResult.review_blocked !== undefined ||
            checkResult.evidence_state ||
            checkResult.has_photo !== undefined) && (
            <div className="p-3 bg-muted rounded-lg text-xs space-y-1">
              <div className="font-semibold mb-2">Observation Metadata:</div>
              {checkResult.is_legacy !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Legacy Import:</span>
                  <Badge
                    variant={checkResult.is_legacy ? 'destructive' : 'outline'}
                  >
                    {checkResult.is_legacy ? 'Yes' : 'No'}
                  </Badge>
                </div>
              )}
              {checkResult.review_blocked !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Review Blocked:</span>
                  <Badge
                    variant={checkResult.review_blocked ? 'destructive' : 'outline'}
                  >
                    {checkResult.review_blocked ? 'Yes' : 'No'}
                  </Badge>
                </div>
              )}
              {checkResult.evidence_state && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Evidence State:</span>
                  <Badge variant="outline">{checkResult.evidence_state}</Badge>
                </div>
              )}
              {checkResult.has_photo !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Has Original Photo:</span>
                  <Badge
                    variant={checkResult.has_photo ? 'outline' : 'destructive'}
                  >
                    {checkResult.has_photo ? 'Yes' : 'No'}
                  </Badge>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose} className="w-full sm:w-auto">
            Understood
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
