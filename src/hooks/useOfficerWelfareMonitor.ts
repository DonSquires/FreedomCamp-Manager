/**
 * Officer Welfare Monitor Hook
 * Client-side monitoring for inactivity and GPS-based welfare checks
 * Shows pre-warning 30 seconds before alert is sent to admin
 * Includes offline activity queuing and sync when connection returns
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { isOnline } from '@/lib/pwa';
import { pushNotificationManager } from '@/lib/pushNotifications';
import { soundManager } from '@/lib/sounds';

interface WelfareSettings {
  auto_logoff_enabled: boolean;
  welfare_check_enabled: boolean;
  inactivity_warning_time: number;
  auto_logoff_time: number;
  gps_inactivity_threshold: number;
  investigation_exception_enabled: boolean;
  gps_ping_interval: number;
}

interface WelfareWarning {
  type: 'inactivity' | 'gps_welfare';
  message: string;
  countdown: number; // seconds until alert
  severity: 'warning' | 'critical';
}

interface QueuedActivity {
  id: string;
  timestamp: Date;
  type: 'gps_update' | 'vehicle_scan' | 'welfare_acknowledged';
  data: {
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    metadata?: any;
  };
}

const OFFLINE_QUEUE_KEY = 'welfare_offline_queue';
const OFFLINE_STATUS_KEY = 'welfare_offline_status';

export function useOfficerWelfareMonitor() {
  const { user } = useAuthStore();
  const [settings, setSettings] = useState<WelfareSettings | null>(null);
  const [lastVehicleScan, setLastVehicleScan] = useState<Date | null>(null);
  const [lastGPSUpdate, setLastGPSUpdate] = useState<Date | null>(null);
  const [isInActiveInvestigation, setIsInActiveInvestigation] = useState(false);
  const [warning, setWarning] = useState<WelfareWarning | null>(null);
  const [isOffline, setIsOffline] = useState(!isOnline());
  const [queuedActivities, setQueuedActivities] = useState<number>(0);
  const [isMonitoringPaused, setIsMonitoringPaused] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  const checkIntervalRef = useRef<any>(null);
  const lastActivityRecordedRef = useRef<Date>(new Date());
  const syncIntervalRef = useRef<any>(null);
  const lastPushNotificationRef = useRef<Date | null>(null);
  const pushNotificationCooldown = 60000; // 60 seconds between push notifications

  // Load welfare settings
  useEffect(() => {
    if (!user?.id) return;

    const loadSettings = async () => {
      const { data } = await supabase
        .from('officer_welfare_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (data) {
        setSettings(data);
      } else {
        // Use defaults if no settings exist
        setSettings({
          auto_logoff_enabled: true,
          welfare_check_enabled: true,
          inactivity_warning_time: 10,
          auto_logoff_time: 20,
          gps_inactivity_threshold: 10,
          investigation_exception_enabled: true,
          gps_ping_interval: 30,
        });
      }
    };

    loadSettings();
  }, [user?.id]);

  // Check for active investigation
  useEffect(() => {
    if (!user?.id) return;

    const checkInvestigation = async () => {
      const { data } = await supabase
        .from('investigation_jobs')
        .select('id')
        .eq('assigned_to', user.id)
        .eq('status', 'in_progress')
        .limit(1)
        .single();

      setIsInActiveInvestigation(!!data);
    };

    checkInvestigation();

    // Check every 30 seconds
    const interval = setInterval(checkInvestigation, 30000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // Record vehicle scan activity
  const recordVehicleScan = useCallback(() => {
    const now = new Date();
    setLastVehicleScan(now);
    lastActivityRecordedRef.current = now;
    
    // Clear any existing inactivity warning
    setWarning(prev => prev?.type === 'inactivity' ? null : prev);
  }, []);

  // Load queued activities from localStorage
  const loadQueue = useCallback((): QueuedActivity[] => {
    try {
      const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
      if (stored) {
        const queue = JSON.parse(stored);
        return queue.map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp),
        }));
      }
    } catch (err) {
      console.warn('Failed to load offline queue:', err);
    }
    return [];
  }, []);

  // Save queue to localStorage
  const saveQueue = useCallback((queue: QueuedActivity[]) => {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      setQueuedActivities(queue.length);
    } catch (err) {
      console.warn('Failed to save offline queue:', err);
    }
  }, []);

  // Queue activity for offline sync
  const queueActivity = useCallback((activity: Omit<QueuedActivity, 'id' | 'timestamp'>) => {
    const queue = loadQueue();
    const newActivity: QueuedActivity = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date(),
      ...activity,
    };
    queue.push(newActivity);
    saveQueue(queue);
    console.log('📦 Queued activity for offline sync:', activity.type);
  }, [loadQueue, saveQueue]);

  // Sync queued activities when online (with progress tracking)
  const syncQueuedActivities = useCallback(async () => {
    if (!user?.id || !isOnline()) return;

    const queue = loadQueue();
    if (queue.length === 0) return;

    console.log(`🔄 Syncing ${queue.length} queued activities...`);
    setSyncProgress({ current: 0, total: queue.length });

    let successCount = 0;
    const failedActivities: QueuedActivity[] = [];

    for (let i = 0; i < queue.length; i++) {
      const activity = queue[i];
      try {
        if (activity.type === 'gps_update') {
          const { error } = await supabase.rpc('log_officer_activity', {
            p_user_id: user.id,
            p_activity_type: 'gps_update',
            p_gps_latitude: activity.data.latitude,
            p_gps_longitude: activity.data.longitude,
            p_gps_accuracy: activity.data.accuracy,
          });
          
          if (!error) {
            successCount++;
          } else {
            throw error;
          }
        } else if (activity.type === 'welfare_acknowledged') {
          const { error } = await supabase.rpc('log_officer_activity', {
            p_user_id: user.id,
            p_activity_type: 'welfare_acknowledged',
            p_metadata: activity.data.metadata,
          });
          
          if (!error) {
            successCount++;
          } else {
            throw error;
          }
        }
        
        // Update progress
        setSyncProgress({ current: i + 1, total: queue.length });
      } catch (err) {
        console.warn('Failed to sync activity:', activity.id, err);
        failedActivities.push(activity);
      }
    }

    // Keep only failed activities in queue
    saveQueue(failedActivities);

    // Clear progress indicator
    setSyncProgress({ current: 0, total: 0 });

    if (successCount > 0) {
      console.log(`✅ Synced ${successCount} activities, ${failedActivities.length} failed`);
    }
  }, [user?.id, loadQueue, saveQueue]);

  // Record GPS activity (with offline support and explicit error handling)
  const recordGPSUpdate = useCallback((lat: number, lng: number, accuracy: number) => {
    const now = new Date();
    setLastGPSUpdate(now);
    
    // Log GPS activity to database or queue if offline
    if (user?.id) {
      if (isOnline()) {
        // ✅ FIX: Use async/await with proper error handling
        (async () => {
          const { error } = await supabase.rpc('log_officer_activity', {
            p_user_id: user.id,
            p_activity_type: 'gps_update',
            p_gps_latitude: lat,
            p_gps_longitude: lng,
            p_gps_accuracy: accuracy,
          });
          
          if (error) {
            console.warn('Failed to log GPS activity, queuing for offline sync:', error);
            queueActivity({
              type: 'gps_update',
              data: { latitude: lat, longitude: lng, accuracy },
            });
          }
        })();
      } else {
        // Queue for later sync (offline mode)
        queueActivity({
          type: 'gps_update',
          data: { latitude: lat, longitude: lng, accuracy },
        });
      }
    }
    
    // Clear any existing GPS welfare warning
    setWarning(prev => prev?.type === 'gps_welfare' ? null : prev);
  }, [user?.id, queueActivity]);

  // Acknowledge warning (dismisses and records activity with offline support)
  const acknowledgeWarning = useCallback(async () => {
    const now = new Date();
    lastActivityRecordedRef.current = now;
    setLastVehicleScan(now);
    setWarning(null);

    // Record acknowledgement activity
    if (user?.id) {
      const metadata = {
        warning_type: warning?.type,
        acknowledged_at: now.toISOString(),
      };

      if (isOnline()) {
        const { error } = await supabase.rpc('log_officer_activity', {
          p_user_id: user.id,
          p_activity_type: 'welfare_acknowledged',
          p_metadata: metadata,
        });
        
        if (error) {
          console.warn('Failed to log acknowledgement, queuing for offline sync:', error);
          queueActivity({
            type: 'welfare_acknowledged',
            data: { metadata },
          });
        }
      } else {
        // Queue for later sync
        queueActivity({
          type: 'welfare_acknowledged',
          data: { metadata },
        });
      }
    }
  }, [user?.id, warning, queueActivity]);

  // Monitor inactivity and GPS
  useEffect(() => {
    if (!settings || !user?.id) return;

    const checkWelfare = () => {
      const now = new Date();

      // Skip if in active investigation and exception is enabled
      if (isInActiveInvestigation && settings.investigation_exception_enabled) {
        return;
      }

      // CHECK 1: Vehicle scan inactivity (auto-logoff warning)
      if (settings.auto_logoff_enabled && lastVehicleScan) {
        const minutesInactive = (now.getTime() - lastVehicleScan.getTime()) / (1000 * 60);
        const warningThreshold = settings.inactivity_warning_time;
        const logoffThreshold = settings.auto_logoff_time;

        // Show warning 30 seconds before reaching warning threshold
        const preWarningThreshold = warningThreshold - 0.5; // 30 seconds before

        if (minutesInactive >= preWarningThreshold && minutesInactive < logoffThreshold) {
          const secondsUntilLogoff = Math.max(0, Math.round((logoffThreshold - minutesInactive) * 60));
          const isCritical = minutesInactive >= warningThreshold;
          
          setWarning({
            type: 'inactivity',
            message: `No vehicle scans for ${Math.floor(minutesInactive)} minutes. You will be automatically logged off due to inactivity.`,
            countdown: secondsUntilLogoff,
            severity: isCritical ? 'critical' : 'warning',
          });
          
          // Send push notification when critical (only once per cooldown)
          if (isCritical) {
            const shouldSendPush = !lastPushNotificationRef.current || 
              (now.getTime() - lastPushNotificationRef.current.getTime()) > pushNotificationCooldown;
            
            if (shouldSendPush) {
              pushNotificationManager.show({
                title: '⚠️ Inactivity Warning',
                message: `No vehicle scans for ${Math.floor(minutesInactive)} minutes. You will be automatically logged off in ${Math.floor(secondsUntilLogoff / 60)} minutes.`,
                tag: 'welfare-inactivity',
                data: {
                  type: 'welfare_warning',
                  warningType: 'inactivity',
                  minutesInactive: Math.floor(minutesInactive),
                  secondsUntilLogoff,
                },
                onClick: () => {
                  // Bring app to foreground and acknowledge
                  window.focus();
                  acknowledgeWarning();
                },
              }).catch(err => {
                console.warn('Failed to send push notification:', err);
              });
              
              lastPushNotificationRef.current = now;
            }
          }
        }
      }

      // CHECK 2: GPS inactivity (welfare check)
      if (settings.welfare_check_enabled && lastGPSUpdate) {
        const minutesStationary = (now.getTime() - lastGPSUpdate.getTime()) / (1000 * 60);
        const welfareThreshold = settings.gps_inactivity_threshold;

        // Show warning 30 seconds before welfare alert would be sent
        const preWelfareThreshold = welfareThreshold - 0.5; // 30 seconds before

        if (minutesStationary >= preWelfareThreshold) {
          const secondsUntilAlert = Math.max(0, Math.round((welfareThreshold - minutesStationary) * 60));
          const isCritical = minutesStationary >= welfareThreshold;
          
          setWarning({
            type: 'gps_welfare',
            message: `GPS shows no movement for ${Math.floor(minutesStationary)} minutes. A welfare check alert will be sent to your team.`,
            countdown: secondsUntilAlert,
            severity: isCritical ? 'critical' : 'warning',
          });
          
          // Send push notification when critical (only once per cooldown)
          if (isCritical) {
            const shouldSendPush = !lastPushNotificationRef.current || 
              (now.getTime() - lastPushNotificationRef.current.getTime()) > pushNotificationCooldown;
            
            if (shouldSendPush) {
              pushNotificationManager.show({
                title: '🚨 Welfare Check Alert',
                message: `GPS shows no movement for ${Math.floor(minutesStationary)} minutes. Your team has been notified. Tap to acknowledge if you're OK.`,
                tag: 'welfare-gps',
                data: {
                  type: 'welfare_warning',
                  warningType: 'gps_welfare',
                  minutesStationary: Math.floor(minutesStationary),
                  secondsUntilAlert,
                },
                onClick: () => {
                  // Bring app to foreground and acknowledge
                  window.focus();
                  acknowledgeWarning();
                },
              }).catch(err => {
                console.warn('Failed to send push notification:', err);
              });
              
              lastPushNotificationRef.current = now;
            }
          }
        }
      }
    };

    // Check every 5 seconds
    checkWelfare();
    checkIntervalRef.current = setInterval(checkWelfare, 5000);

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [settings, lastVehicleScan, lastGPSUpdate, isInActiveInvestigation, user?.id, acknowledgeWarning]);

  // Monitor online/offline status
  useEffect(() => {
    const checkOnlineStatus = () => {
      const online = isOnline();
      const wasOffline = isOffline;
      setIsOffline(!online);

      // Update monitoring paused status
      setIsMonitoringPaused(!online);

      // If just came back online, sync queue
      if (wasOffline && online) {
        console.log('📡 Connection restored - syncing queued activities...');
        syncQueuedActivities();
        
        // Record back online status
        if (user?.id) {
          // ✅ FIX: Use async/await with proper error handling
          (async () => {
            const { error } = await supabase.rpc('log_officer_activity', {
              p_user_id: user.id,
              p_activity_type: 'back_online',
              p_metadata: { reconnected_at: new Date().toISOString() },
            });
            
            if (error) {
              console.warn('Failed to log back online status:', error);
            }
          })();
        }
      }

      // If just went offline, record offline status
      if (!wasOffline && !online) {
        console.log('📴 Connection lost - welfare monitoring paused');
        localStorage.setItem(OFFLINE_STATUS_KEY, new Date().toISOString());
      }
    };

    checkOnlineStatus();
    const interval = setInterval(checkOnlineStatus, 5000);
    return () => clearInterval(interval);
  }, [isOffline, user?.id, syncQueuedActivities]);

  // Auto-sync queue periodically when online
  useEffect(() => {
    if (isOnline() && user?.id) {
      syncQueuedActivities();
      
      syncIntervalRef.current = setInterval(() => {
        syncQueuedActivities();
      }, 30000); // Every 30 seconds

      return () => {
        if (syncIntervalRef.current) {
          clearInterval(syncIntervalRef.current);
        }
      };
    }
  }, [user?.id, syncQueuedActivities]);

  // Load initial queue count
  useEffect(() => {
    const queue = loadQueue();
    setQueuedActivities(queue.length);
  }, [loadQueue]);

  return {
    settings,
    warning,
    isInActiveInvestigation,
    isOffline,
    isMonitoringPaused,
    queuedActivities,
    syncProgress,
    recordVehicleScan,
    recordGPSUpdate,
    acknowledgeWarning,
    gpsPingInterval: settings?.gps_ping_interval || 30,
  };
}
