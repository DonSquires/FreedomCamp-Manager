/**
 * Officer Welfare Warning Modal
 * Shows 30-second pre-warning before welfare alert is sent
 * Plays continuous audible sound until acknowledged
 * Features:
 * - Mobile-optimized responsive design
 * - Background audio playback (works even when app is in background)
 * - Minimum volume 10%
 * - Voice announcement: "Safety Check"
 */

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  Heart,
  CheckCircle2,
  Clock,
  Shield,
  Volume2,
  WifiOff,
} from 'lucide-react';

interface WelfareWarning {
  type: 'inactivity' | 'gps_welfare';
  message: string;
  countdown: number; // seconds until alert
  severity: 'warning' | 'critical';
}

interface OfficerWelfareWarningModalProps {
  warning: WelfareWarning | null;
  isOffline?: boolean;
  isMonitoringPaused?: boolean;
  onAcknowledge: () => void;
}

export function OfficerWelfareWarningModal({
  warning,
  isOffline = false,
  isMonitoringPaused = false,
  onAcknowledge,
}: OfficerWelfareWarningModalProps) {
  const [countdown, setCountdown] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isPlayingRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const voiceAnnouncedRef = useRef(false);

  // Update countdown
  useEffect(() => {
    if (warning) {
      setCountdown(warning.countdown);

      const interval = setInterval(() => {
        setCountdown(prev => Math.max(0, prev - 1));
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [warning]);

  // Request wake lock to keep audio playing in background
  useEffect(() => {
    if (!warning) return;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          console.log('🔒 Wake lock acquired for welfare alert audio');
        }
      } catch (err) {
        console.warn('Wake lock failed:', err);
      }
    };

    requestWakeLock();

    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('🔓 Wake lock released');
      }
    };
  }, [warning]);

  // Play continuous warning sound with background support
  useEffect(() => {
    if (!warning || isPlayingRef.current) return;

    const playWarningSound = () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }

        const ctx = audioContextRef.current;

        // Resume context if suspended
        if (ctx.state === 'suspended') {
          ctx.resume();
        }

        // Create oscillator for continuous tone
        oscillatorRef.current = ctx.createOscillator();
        gainNodeRef.current = ctx.createGain();

        oscillatorRef.current.connect(gainNodeRef.current);
        gainNodeRef.current.connect(ctx.destination);

        // Play voice announcement "Safety Check" (only once)
        if (!voiceAnnouncedRef.current) {
          const utterance = new SpeechSynthesisUtterance('Safety Check');
          utterance.volume = 1.0; // Max volume for voice
          utterance.rate = 0.9; // Slightly slower for clarity
          utterance.pitch = 1.0;
          speechSynthesis.speak(utterance);
          voiceAnnouncedRef.current = true;
          console.log('🗣️ Voice announcement: "Safety Check"');
        }

        // Choose frequency and pattern based on severity
        // MINIMUM VOLUME: 10% (0.1)
        if (warning.severity === 'critical') {
          // Critical: Alternating high-pitched alarm (urgent)
          oscillatorRef.current.frequency.value = 1200;
          oscillatorRef.current.type = 'square';
          gainNodeRef.current.gain.value = Math.max(0.4, 0.1); // Min 10%

          // Create pulsing effect
          let isHigh = true;
          const pulseInterval = setInterval(() => {
            if (oscillatorRef.current) {
              oscillatorRef.current.frequency.value = isHigh ? 1200 : 800;
              isHigh = !isHigh;
            }
          }, 400);

          // Store interval for cleanup
          (oscillatorRef.current as any)._pulseInterval = pulseInterval;
        } else {
          // Warning: Steady mid-tone (attention-getting but less alarming)
          oscillatorRef.current.frequency.value = 700;
          oscillatorRef.current.type = 'sine';
          gainNodeRef.current.gain.value = Math.max(0.3, 0.1); // Min 10%

          // Gentle pulsing (min 10%)
          let volume = 0.3;
          let increasing = false;
          const pulseInterval = setInterval(() => {
            if (gainNodeRef.current) {
              volume += increasing ? 0.05 : -0.05;
              if (volume >= 0.35) increasing = false;
              if (volume <= 0.1) increasing = true; // Min 10%
              gainNodeRef.current.gain.value = Math.max(volume, 0.1); // Min 10%
            }
          }, 300);

          (oscillatorRef.current as any)._pulseInterval = pulseInterval;
        }

        oscillatorRef.current.start();
        isPlayingRef.current = true;
        console.log('🔊 Welfare warning sound started:', warning.severity);
      } catch (error) {
        console.error('Failed to play welfare warning sound:', error);
      }
    };

    playWarningSound();

    return () => {
      // Cleanup sound
      if (oscillatorRef.current) {
        try {
          const pulseInterval = (oscillatorRef.current as any)._pulseInterval;
          if (pulseInterval) {
            clearInterval(pulseInterval);
          }
          oscillatorRef.current.stop();
          oscillatorRef.current.disconnect();
          oscillatorRef.current = null;
        } catch (err) {
          console.warn('Error stopping oscillator:', err);
        }
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }
      isPlayingRef.current = false;
      voiceAnnouncedRef.current = false; // Reset for next warning
    };
  }, [warning]);

  const handleAcknowledge = () => {
    // Stop sound
    if (oscillatorRef.current) {
      try {
        const pulseInterval = (oscillatorRef.current as any)._pulseInterval;
        if (pulseInterval) {
          clearInterval(pulseInterval);
        }
        oscillatorRef.current.stop();
        oscillatorRef.current.disconnect();
        oscillatorRef.current = null;
      } catch (err) {
        console.warn('Error stopping oscillator:', err);
      }
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }
    
    // Stop speech synthesis if still speaking
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }
    
    // Release wake lock
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
    
    isPlayingRef.current = false;
    voiceAnnouncedRef.current = false;

    onAcknowledge();
  };

  if (!warning) return null;

  const isInactivityWarning = warning.type === 'inactivity';
  const Icon = isInactivityWarning ? AlertTriangle : Heart;
  const iconColor = warning.severity === 'critical' ? 'text-red-600' : 'text-amber-600';
  const bgColor = warning.severity === 'critical' 
    ? 'bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900'
    : 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900';
  const borderColor = warning.severity === 'critical' ? 'border-red-500' : 'border-amber-500';

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent 
        className={`max-w-[95vw] sm:max-w-md border-4 ${borderColor} ${bgColor} max-h-[95vh] overflow-y-auto`}
        // Prevent closing by clicking outside or pressing escape
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-2">
            <DialogTitle className="text-xl sm:text-2xl flex items-center gap-2 sm:gap-3">
              <Icon className={`h-6 w-6 sm:h-8 sm:w-8 ${iconColor} animate-pulse shrink-0`} />
              <span className="leading-tight">
                {warning.severity === 'critical' ? 'CRITICAL ALERT' : 'Welfare Warning'}
              </span>
            </DialogTitle>
            <Badge 
              variant={warning.severity === 'critical' ? 'destructive' : 'default'}
              className="text-sm sm:text-base px-2 sm:px-3 py-1 animate-pulse shrink-0"
            >
              {warning.severity.toUpperCase()}
            </Badge>
          </div>
          <DialogDescription className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white leading-snug">
            {warning.message}
          </DialogDescription>
        </DialogHeader>

        {/* Countdown Display - Mobile Optimized */}
        <div className={`p-4 sm:p-6 rounded-lg border-2 ${borderColor} bg-white dark:bg-gray-900 text-center`}>
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-2 sm:mb-3">
            <Clock className={`h-5 w-5 sm:h-6 sm:w-6 ${iconColor} shrink-0`} />
            <span className="text-xs sm:text-sm font-bold text-gray-700 dark:text-gray-200">
              Time Until Alert:
            </span>
          </div>
          <div className={`text-5xl sm:text-6xl font-black ${iconColor} tabular-nums`}>
            {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
          </div>
          <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-2">
            {countdown === 0 ? 'Alert being sent now!' : 'Acknowledge to prevent alert'}
          </div>
        </div>

        {/* Offline Mode Indicator */}
        {isOffline && (
          <div className="flex items-center justify-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
            <WifiOff className="h-5 w-5 text-amber-600" />
            <div className="flex-1">
              <span className="text-sm font-semibold text-amber-900 dark:text-amber-100 block">
                Offline Mode - Monitoring Paused
              </span>
              <span className="text-xs text-amber-700 dark:text-amber-200">
                Server-side welfare checks paused until connection returns
              </span>
            </div>
          </div>
        )}

        {/* Sound Indicator - Mobile Optimized */}
        {!isOffline && (
          <div className="flex items-center justify-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
            <Volume2 className="h-5 w-5 text-blue-600 animate-pulse shrink-0" />
            <span className="text-xs sm:text-sm font-semibold text-blue-900 dark:text-blue-100 text-center">
              Audible alert playing - will stop when acknowledged
            </span>
          </div>
        )}

        {/* Info based on type - Mobile Optimized */}
        <div className="space-y-2 text-xs sm:text-sm">
          {isInactivityWarning ? (
            <>
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 mt-0.5 shrink-0 text-gray-600 hidden sm:block" />
                <p className="text-gray-700 dark:text-gray-200">
                  <strong>Auto-Logoff Protection:</strong> You will be logged off automatically if no vehicle scans are recorded.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600 hidden sm:block" />
                <p className="text-gray-700 dark:text-gray-200">
                  <strong>Action Required:</strong> Acknowledge this warning or scan a vehicle to reset the timer.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <Heart className="h-4 w-4 mt-0.5 shrink-0 text-red-600 hidden sm:block" />
                <p className="text-gray-700 dark:text-gray-200">
                  <strong>Welfare Check:</strong> Your GPS shows no movement. This alert ensures your safety.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600 hidden sm:block" />
                <p className="text-gray-700 dark:text-gray-200">
                  <strong>Action Required:</strong> Acknowledge to confirm you're okay and prevent escalation.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="pt-4">
          <Button
            onClick={handleAcknowledge}
            className={`w-full h-14 sm:h-16 text-lg sm:text-xl font-bold touch-manipulation ${
              warning.severity === 'critical'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
            size="lg"
          >
            <CheckCircle2 className="h-5 w-5 sm:h-6 sm:w-6 mr-2 sm:mr-3 shrink-0" />
            <span className="leading-tight">I'm OK - Acknowledge Warning</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
