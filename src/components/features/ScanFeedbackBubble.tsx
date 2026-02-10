/**
 * ScanFeedbackBubble - Visual feedback for plate scanning
 * Shows red bubbles for errors (center) and green bubbles for success (top)
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BubbleType = 'success' | 'error' | 'warning';

interface ScanFeedbackBubbleProps {
  show: boolean;
  type: BubbleType;
  message: string;
  duration?: number;
  onHide?: () => void;
}

export function ScanFeedbackBubble({
  show,
  type,
  message,
  duration = 3000,
  onHide,
}: ScanFeedbackBubbleProps) {
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    setVisible(show);
    
    if (show && duration > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        onHide?.();
      }, duration);
      
      return () => clearTimeout(timer);
    }
  }, [show, duration, onHide]);

  if (!visible) return null;

  const isError = type === 'error';
  const isSuccess = type === 'success';
  const isWarning = type === 'warning';

  return (
    <div
      className={cn(
        "fixed z-50 left-1/2 -translate-x-1/2 px-4 max-w-sm w-full",
        "animate-in fade-in slide-in-from-top-4 duration-300",
        isError && "top-1/2 -translate-y-1/2",
        (isSuccess || isWarning) && "top-20"
      )}
    >
      <div
        className={cn(
          "rounded-2xl shadow-2xl p-6 flex items-center gap-4",
          "border-4 backdrop-blur-sm",
          isError && "bg-red-500/95 border-red-700",
          isSuccess && "bg-green-500/95 border-green-700",
          isWarning && "bg-amber-500/95 border-amber-700"
        )}
      >
        {/* Icon */}
        <div className="shrink-0">
          {isError && <XCircle className="h-10 w-10 text-white" strokeWidth={3} />}
          {isSuccess && <CheckCircle2 className="h-10 w-10 text-white" strokeWidth={3} />}
          {isWarning && <AlertTriangle className="h-10 w-10 text-white" strokeWidth={3} />}
        </div>

        {/* Message */}
        <p className="text-xl font-black text-white leading-tight flex-1">
          {message}
        </p>
      </div>
    </div>
  );
}
