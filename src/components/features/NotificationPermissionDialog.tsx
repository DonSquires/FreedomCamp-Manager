/**
 * NotificationPermissionDialog - User-friendly permission request
 * Shows before browser's native notification permission dialog
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
import { Bell, BellOff, CheckCircle } from 'lucide-react';

interface NotificationPermissionDialogProps {
  open: boolean;
  reason: string;
  onAllow: () => void;
  onDeny: () => void;
}

export function NotificationPermissionDialog({
  open,
  reason,
  onAllow,
  onDeny,
}: NotificationPermissionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onDeny()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Bell className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">
            Stay Updated with Notifications
          </DialogTitle>
          <DialogDescription className="text-center space-y-4 pt-4">
            <p className="text-base text-foreground leading-relaxed">
              {reason}
            </p>
            
            <div className="space-y-3 text-left pt-2">
              <p className="text-sm font-semibold text-foreground">You'll receive notifications for:</p>
              <ul className="space-y-2">
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  <span className="text-sm">
                    <strong>Investigation job assignments</strong> - When you're assigned new investigations that require your attention
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  <span className="text-sm">
                    <strong>Job status updates</strong> - When investigation statuses change (completed, in progress, etc.)
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  <span className="text-sm">
                    <strong>Incident approvals</strong> - When your incident reports are reviewed and approved
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  <span className="text-sm">
                    <strong>Urgent follow-ups</strong> - When critical issues require immediate action
                  </span>
                </li>
              </ul>
            </div>

            <div className="pt-3 px-4 py-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-900 dark:text-blue-100">
                <strong>Your privacy matters:</strong> Notifications are sent only to your device. 
                You can turn them off anytime in your browser settings.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button
            onClick={onAllow}
            className="w-full h-12 text-base font-semibold"
            size="lg"
          >
            <Bell className="h-5 w-5 mr-2" />
            Enable Notifications
          </Button>
          <Button
            onClick={onDeny}
            variant="outline"
            className="w-full h-12 text-base"
            size="lg"
          >
            <BellOff className="h-5 w-5 mr-2" />
            Not Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
