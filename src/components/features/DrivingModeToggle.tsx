/**
 * DrivingModeToggle - Manages automatic plate scanning while driving
 * Auto-captures every 5 seconds and creates vehicle observations
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DrivingModeToggleProps {
  isActive: boolean;
  scanCount: number;
  onToggle: (active: boolean) => void;
  disabled?: boolean;
}

export function DrivingModeToggle({ 
  isActive, 
  scanCount, 
  onToggle,
  disabled = false 
}: DrivingModeToggleProps) {
  
  const handleActivate = () => {
    onToggle(true);
    toast.success('🚗 Driving mode activated - Auto-capturing every 5 seconds');
  };

  const handleDeactivate = () => {
    onToggle(false);
    toast.success(`Driving mode stopped - ${scanCount} observations recorded`);
  };

  if (isActive) {
    return (
      <div className="space-y-3">
        <Alert className="bg-blue-50 dark:bg-blue-950 border-2 border-blue-500 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
              <Camera className="h-6 w-6 text-white animate-pulse" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-blue-900 dark:text-blue-100 text-lg">
                🚗 Driving Mode Active
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-200 mt-1">
                Auto-capturing every 5 seconds • {scanCount} observations completed
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-300 mt-2">
                ✅ Each scan creates a vehicle observation for compliance tracking
              </p>
            </div>
          </div>
        </Alert>
        
        <Button
          onClick={handleDeactivate}
          variant="destructive"
          className="w-full h-16 text-xl font-bold shadow-lg touch-manipulation"
          size="lg"
        >
          <X className="h-6 w-6 mr-2" />
          Stop Driving Mode
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2 p-3 bg-muted/50 rounded-lg border-2 border-muted">
      <Button
        variant="outline"
        className="flex-1 h-14 text-base touch-manipulation font-bold"
        disabled={disabled}
      >
        📱 Handheld
        <Badge variant="secondary" className="ml-2 text-xs">Manual</Badge>
      </Button>
      <Button
        variant="default"
        onClick={handleActivate}
        className={cn(
          "flex-1 h-14 text-base touch-manipulation font-bold",
          "bg-blue-600 hover:bg-blue-700"
        )}
        disabled={disabled}
      >
        🚗 Driving
        <Badge variant="secondary" className="ml-2 text-xs bg-green-500 text-white">
          Auto
        </Badge>
      </Button>
    </div>
  );
}
