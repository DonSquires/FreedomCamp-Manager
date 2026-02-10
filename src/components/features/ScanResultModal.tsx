/**
 * Scan Result Modal - Pop-up dialog requiring acknowledgement
 * Replaces toast notifications for scan processing results
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle, Info } from 'lucide-react';

interface ScanResultModalProps {
  open: boolean;
  onClose: () => void;
  result: {
    type: 'success' | 'error' | 'warning' | 'info';
    title: string;
    message: string;
    details?: string[];
  };
}

export function ScanResultModal({ open, onClose, result }: ScanResultModalProps) {
  const getIcon = () => {
    switch (result.type) {
      case 'success':
        return <CheckCircle2 className="h-12 w-12 text-green-600" />;
      case 'error':
        return <XCircle className="h-12 w-12 text-red-600" />;
      case 'warning':
        return <AlertTriangle className="h-12 w-12 text-orange-600" />;
      case 'info':
        return <Info className="h-12 w-12 text-blue-600" />;
    }
  };

  const getColor = () => {
    switch (result.type) {
      case 'success':
        return 'from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-900/40 border-green-500';
      case 'error':
        return 'from-red-50 to-red-100 dark:from-red-950/40 dark:to-red-900/40 border-red-500';
      case 'warning':
        return 'from-orange-50 to-orange-100 dark:from-orange-950/40 dark:to-orange-900/40 border-orange-500';
      case 'info':
        return 'from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/40 border-blue-500';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={`max-w-md bg-gradient-to-br ${getColor()} border-4`}>
        <DialogHeader>
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="mt-4">{getIcon()}</div>
            <DialogTitle className="text-xl font-bold">{result.title}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-center text-base font-semibold">{result.message}</p>

          {result.details && result.details.length > 0 && (
            <div className="space-y-2">
              {result.details.map((detail, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 p-3 bg-white dark:bg-gray-900 rounded-lg"
                >
                  <Badge variant="outline" className="text-xs shrink-0 mt-0.5">
                    {index + 1}
                  </Badge>
                  <p className="text-sm">{detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose} className="w-full h-12 text-base font-bold">
            Acknowledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
