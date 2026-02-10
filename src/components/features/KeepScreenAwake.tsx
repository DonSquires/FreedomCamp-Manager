/**
 * Keep Screen Awake Component
 * Prevents screen from sleeping during active patrol/scanning
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sun, Moon } from 'lucide-react';

interface KeepScreenAwakeProps {
  isActive: boolean;
  onToggle?: (active: boolean) => void;
}

export function KeepScreenAwake({ isActive, onToggle }: KeepScreenAwakeProps) {
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // Check if Wake Lock API is supported
    setIsSupported('wakeLock' in navigator);
  }, []);

  useEffect(() => {
    if (!isSupported) return;

    const requestWakeLock = async () => {
      if (isActive && !wakeLock) {
        try {
          const lock = await (navigator as any).wakeLock.request('screen');
          setWakeLock(lock);
          console.log('✅ Screen wake lock activated');

          // Handle wake lock release (e.g., when user switches tabs)
          lock.addEventListener('release', () => {
            console.log('⚠️ Screen wake lock released');
            setWakeLock(null);
          });
        } catch (error) {
          console.error('Failed to request wake lock:', error);
        }
      } else if (!isActive && wakeLock) {
        try {
          await wakeLock.release();
          setWakeLock(null);
          console.log('🌙 Screen wake lock released');
        } catch (error) {
          console.error('Failed to release wake lock:', error);
        }
      }
    };

    requestWakeLock();

    // Re-request wake lock when page becomes visible
    const handleVisibilityChange = () => {
      if (isActive && document.visibilityState === 'visible' && !wakeLock) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, [isActive, wakeLock, isSupported]);

  if (!isSupported) return null;

  return (
    <div className="flex items-center gap-2">
      <Badge 
        variant={wakeLock ? 'default' : 'outline'} 
        className="text-xs"
      >
        {wakeLock ? (
          <>
            <Sun className="h-3 w-3 mr-1" />
            Screen Awake
          </>
        ) : (
          <>
            <Moon className="h-3 w-3 mr-1" />
            Auto-Sleep
          </>
        )}
      </Badge>
      
      {onToggle && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggle(!isActive)}
          className="h-7"
        >
          Toggle
        </Button>
      )}
    </div>
  );
}

// Auto-enable wake lock during active patrol
export function useAutoWakeLock(shouldActivate: boolean) {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    setIsActive(shouldActivate);
  }, [shouldActivate]);

  return { isActive, setIsActive };
}
