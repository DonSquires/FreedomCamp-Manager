/**
 * AlertAcknowledgementModal - Critical alert requiring officer acknowledgement
 * Triggered by: Flagged vehicles, H&S issues, breach alerts, homeless confirmations
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Flag,
  Heart,
  ShieldAlert,
  FileText,
  X as XIcon,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { playSounds } from '@/lib/sounds';

interface AlertAcknowledgementModalProps {
  alertType: 'flagged_vehicle' | 'hs_issue' | 'breach_alert' | 'homeless_confirmed';
  vehicleId?: string;
  plateNumber: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  photoUrl?: string;
  alertMessage: string;
  alertDetails?: string;
  onIgnore: () => void;
  onTakeAction: () => void;
}

export function AlertAcknowledgementModal({
  alertType,
  vehicleId,
  plateNumber,
  vehicleMake,
  vehicleModel,
  vehicleColor,
  photoUrl,
  alertMessage,
  alertDetails,
  onIgnore,
  onTakeAction,
}: AlertAcknowledgementModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [ignoreNotes, setIgnoreNotes] = useState('');
  const [showIgnoreConfirm, setShowIgnoreConfirm] = useState(false);

  // Alert configuration based on type
  const alertConfig = {
    flagged_vehicle: {
      icon: Flag,
      iconColor: 'text-red-600',
      bgColor: 'bg-red-50 dark:bg-red-950/30',
      borderColor: 'border-red-500',
      title: '🚩 FLAGGED VEHICLE DETECTED',
      severity: 'URGENT',
      severityColor: 'destructive' as const,
      sound: 'flaggedVehicle' as const,
    },
    hs_issue: {
      icon: Heart,
      iconColor: 'text-orange-600',
      bgColor: 'bg-orange-50 dark:bg-orange-950/30',
      borderColor: 'border-orange-500',
      title: '⚠️ HEALTH & SAFETY CONCERN',
      severity: 'HIGH',
      severityColor: 'destructive' as const,
      sound: 'healthSafety' as const,
    },
    breach_alert: {
      icon: ShieldAlert,
      iconColor: 'text-amber-600',
      bgColor: 'bg-amber-50 dark:bg-amber-950/30',
      borderColor: 'border-amber-500',
      title: '🚨 COMPLIANCE BREACH',
      severity: 'MEDIUM',
      severityColor: 'secondary' as const,
      sound: 'violationAlert' as const,
    },
    homeless_confirmed: {
      icon: AlertTriangle,
      iconColor: 'text-blue-600',
      bgColor: 'bg-blue-50 dark:bg-blue-950/30',
      borderColor: 'border-blue-500',
      title: '🏕️ HOMELESS STATUS CONFIRMED',
      severity: 'INFO',
      severityColor: 'secondary' as const,
      sound: 'homeless' as const,
    },
  };

  const config = alertConfig[alertType];
  const Icon = config.icon;

  const handleIgnore = async () => {
    if (!showIgnoreConfirm) {
      setShowIgnoreConfirm(true);
      return;
    }

    setIsProcessing(true);

    try {
      // Add "No action taken" note to vehicle record
      const noteText = `No action taken on ${config.title} alert. Officer notes: ${ignoreNotes || 'None provided'}.`;
      
      if (vehicleId) {
        // Find the most recent vehicle_record for this vehicle
        const { data: records, error: findError } = await supabase
          .from('vehicle_records')
          .select('id, notes')
          .eq('plate_number', plateNumber)
          .order('created_at', { ascending: false })
          .limit(1);

        if (findError) {
          console.error('Failed to find vehicle record:', findError);
          throw findError;
        }

        if (records && records.length > 0) {
          const record = records[0];
          const updatedNotes = record.notes 
            ? `${record.notes}\n\n[${new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })}] ${noteText}`
            : noteText;

          const { error: updateError } = await supabase
            .from('vehicle_records')
            .update({ 
              notes: updatedNotes,
            })
            .eq('id', record.id);

          if (updateError) {
            console.error('Failed to update vehicle record:', updateError);
            throw updateError;
          }

          console.log('✅ Added "no action taken" note to vehicle record');
        }
      }

      toast.success('Alert acknowledged - No action taken', {
        description: ignoreNotes || 'Note added to vehicle record',
      });
      
      onIgnore();
    } catch (error: any) {
      console.error('❌ Failed to add ignore note:', error);
      toast.error('Failed to save note: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTakeAction = () => {
    playSounds.processingComplete();
    onTakeAction();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-in fade-in duration-200">
      <Card className={`max-w-lg w-full max-h-[90vh] flex flex-col ${config.bgColor} border-2 ${config.borderColor} shadow-2xl animate-in zoom-in duration-300`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
              <div className={`p-3 rounded-full ${config.bgColor} ring-4 ring-white dark:ring-gray-900 ${config.iconColor}`}>
                <Icon className="h-8 w-8" />
              </div>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-2xl font-black mb-2 flex items-center gap-2 leading-tight">
                  {config.title}
                </CardTitle>
                <Badge variant={config.severityColor} className="font-bold text-sm px-3 py-1">
                  {config.severity} PRIORITY
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 overflow-y-auto flex-1">
          {/* Vehicle Photo */}
          {photoUrl && (
            <div className="relative rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600">
              <img 
                src={photoUrl} 
                alt={`Vehicle ${plateNumber}`}
                className="w-full h-48 object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm px-4 py-2">
                <p className="text-white font-mono font-black text-2xl tracking-wider">
                  {plateNumber}
                </p>
                {(vehicleMake || vehicleModel || vehicleColor) && (
                  <p className="text-white/80 text-sm">
                    {[vehicleColor, vehicleMake, vehicleModel].filter(Boolean).join(' ')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Alert Message - Scrollable */}
          <div className="p-5 bg-white dark:bg-gray-900 rounded-lg border-2 border-gray-300 dark:border-gray-700 space-y-3 max-h-[400px] overflow-y-auto">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Alert Reason:</p>
              <p className="font-bold text-lg leading-relaxed text-gray-900 dark:text-white">{alertMessage}</p>
            </div>
            {alertDetails && alertDetails.trim() && (
              <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Officer Notes:</p>
                <p className="text-base leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{alertDetails}</p>
              </div>
            )}
          </div>

          {/* Ignore Confirmation */}
          {showIgnoreConfirm && (
            <div className="p-5 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg border-2 border-yellow-500 space-y-4 animate-in slide-in-from-top duration-300">
              <p className="font-bold text-base text-yellow-900 dark:text-yellow-100 leading-relaxed">
                ⚠️ Confirm: No Action Taken
              </p>
              <div>
                <label className="text-sm font-semibold text-gray-900 dark:text-white mb-2 block">
                  Optional Notes:
                </label>
                <Textarea
                  value={ignoreNotes}
                  onChange={(e) => setIgnoreNotes(e.target.value)}
                  placeholder="Reason for not taking action (optional)..."
                  className="min-h-[100px] text-base leading-relaxed"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowIgnoreConfirm(false)}
                  className="flex-1 touch-manipulation h-14 text-base font-semibold"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleIgnore}
                  disabled={isProcessing}
                  className="flex-1 touch-manipulation h-14 text-base font-semibold"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <XIcon className="h-5 w-5 mr-2" />
                      Confirm Ignore
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {!showIgnoreConfirm && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <Button
                variant="outline"
                onClick={handleIgnore}
                disabled={isProcessing}
                className="h-20 text-lg font-bold touch-manipulation border-2"
              >
                <XIcon className="h-6 w-6 mr-2" />
                Ignore
              </Button>
              <Button
                variant="default"
                onClick={handleTakeAction}
                className="h-20 text-lg font-bold bg-primary hover:bg-primary/90 touch-manipulation shadow-lg"
              >
                <FileText className="h-6 w-6 mr-2" />
                Take Action
              </Button>
            </div>
          )}

          <p className="text-sm text-center text-muted-foreground font-semibold pt-2">
            ⚠️ Acknowledgement required to continue
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
