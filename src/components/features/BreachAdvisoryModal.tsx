/**
 * Breach Advisory Modal
 * Used when organization requires admin review before official enforcement
 * Officer can only advise owner verbally and record the advisory
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertTriangle, MessageSquare, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { playSounds } from '@/lib/sounds';

interface BreachAdvisoryModalProps {
  open: boolean;
  plateNumber: string;
  vehicleId?: string;
  observationId?: string;
  zoneId: string;
  organizationId: string;
  breachDetails: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function BreachAdvisoryModal({
  open,
  plateNumber,
  vehicleId,
  observationId,
  zoneId,
  organizationId,
  breachDetails,
  onClose,
  onSuccess,
}: BreachAdvisoryModalProps) {
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!notes.trim()) {
      toast.error('Please describe what you communicated to the vehicle owner');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const advisoryNotes = [
        `🚨 BREACH DETECTED: ${breachDetails}`,
        '',
        '💬 OFFICER ADVISORY:',
        notes.trim(),
        '',
        '⚠️ STATUS: Pending admin review for official enforcement action',
        '',
        `👮 Officer: ${user.email}`,
        `📅 Date: ${new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })}`,
      ].join('\n');

      const { error } = await supabase
        .from('enforcement_actions')
        .insert({
          organization_id: organizationId,
          zone_id: zoneId,
          plate_number: plateNumber,
          vehicle_record_id: vehicleId,
          observation_id: observationId,
          action_type: 'breach_advisory',
          status: 'pending',
          notes: advisoryNotes,
          user_id: user.id,
        });

      if (error) throw error;

      playSounds.processingComplete();
      toast.success('Breach advisory recorded - admin will review for official enforcement');
      onSuccess();

    } catch (error: any) {
      console.error('Failed to record breach advisory:', error);
      toast.error('Failed to record advisory: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-lg w-full border-4 border-orange-500">
        {/* Header */}
        <div className="p-6 bg-gradient-to-br from-orange-500 to-red-600 text-white rounded-t-lg">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 shrink-0" />
              <div>
                <h2 className="text-2xl font-black">Breach Advisory</h2>
                <p className="text-sm opacity-90 mt-1">Admin Review Required</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-10 w-10 text-white hover:bg-white/20 rounded-full"
            >
              <X className="h-6 w-6" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Vehicle Info */}
          <div className="p-4 bg-orange-50 dark:bg-orange-950/30 rounded-lg border-2 border-orange-200 dark:border-orange-700">
            <p className="text-sm text-muted-foreground mb-1">Vehicle Plate:</p>
            <p className="text-2xl font-black font-mono">{plateNumber}</p>
          </div>

          {/* Breach Details */}
          <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-lg border-2 border-red-200 dark:border-red-700">
            <p className="text-sm font-bold text-red-900 dark:text-red-100 mb-2">
              🚨 Breach Detected:
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {breachDetails}
            </p>
          </div>

          {/* Organization Policy Notice */}
          <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border-2 border-blue-200 dark:border-blue-700">
            <div className="flex items-start gap-3">
              <MessageSquare className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <p className="font-bold text-blue-900 dark:text-blue-100 mb-2">
                  ℹ️ Organization Policy:
                </p>
                <p className="mb-2">
                  Your organization requires admin review before official enforcement actions.
                </p>
                <p className="font-semibold">
                  You can verbally advise the vehicle owner of the breach and record what was communicated.
                </p>
              </div>
            </div>
          </div>

          {/* Advisory Notes */}
          <div className="space-y-2">
            <Label htmlFor="advisory-notes" className="text-base font-bold">
              What did you communicate to the owner? *
            </Label>
            <Textarea
              id="advisory-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Example: Advised owner that vehicle has exceeded consecutive night limit (4/3 nights). Explained they must relocate by tomorrow or risk tow notice. Owner acknowledged and stated they will move vehicle today."
              className="min-h-[150px] text-base"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              💡 Include: What you told them, their response, any commitments they made
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 h-14 text-base font-bold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !notes.trim()}
              className="flex-1 h-14 text-base font-bold bg-orange-600 hover:bg-orange-700"
            >
              {isSubmitting ? (
                <>Processing...</>
              ) : (
                <>
                  <MessageSquare className="h-5 w-5 mr-2" />
                  Record Advisory
                </>
              )}
            </Button>
          </div>

          {/* Info Footer */}
          <div className="pt-4 border-t">
            <p className="text-xs text-muted-foreground text-center">
              ⏳ This advisory will be sent to admin for review and approval before official enforcement action is issued
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
