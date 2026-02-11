/**
 * useNotifications Hook
 * Manages notifications for field officers based on scanned vehicles
 */

import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { pushNotificationManager } from '@/lib/pushNotifications';

export type NotificationType = 
  | 'flagged_vehicle'
  | 'breach_alert'
  | 'hs_report'
  | 'homeless_confirmed'
  | 'almost_breach'
  | 'assigned_incident'
  | 'zone_alert'
  | 'investigation_job'
  | 'urgent_followup';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'urgent';
  entityId: string;
  entityType: string;
  zoneName?: string;
  plateNumber?: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
  metadata?: {
    plateNumber?: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleColor?: string;
    photoUrl?: string | null;
    zoneName?: string;
    priorVisits?: number;
    vehicleId?: string;
    observationId?: string;
    zoneId?: string;
    gpsLocation?: {
      lat: number;
      lng: number;
      accuracy: number;
    };
    nightsStayed?: number;
    nightsAllowed?: number;
    consecutiveNights?: number;
    consecutiveAllowed?: number;
    willBreachTonight?: boolean;
    breachSeverity?: 'warning' | 'critical';
  };
}

export function useNotifications() {
  const { user } = useAuthStore();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Subscribe to investigation job assignments and status changes
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('investigation_jobs_notifications')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'investigation_jobs',
          filter: `assigned_to=eq.${user.id}`,
        },
        async (payload: any) => {
          console.log('🔔 Investigation job updated:', payload);
          
          const newRecord = payload.new;
          const oldRecord = payload.old;
          
          // Check if this is a new assignment
          if (newRecord.assigned_to && (!oldRecord.assigned_to || oldRecord.assigned_to !== newRecord.assigned_to)) {
            // Show push notification for assignment
            await pushNotificationManager.notifyJobAssignment({
              id: newRecord.id,
              reference_number: newRecord.reference_number,
              job_type: newRecord.job_type,
              location_address: newRecord.location_address,
              priority: newRecord.priority,
              due_date: newRecord.due_date,
            });

            // Add to in-app notifications
            const notif: Notification = {
              id: `job-assigned-${newRecord.id}-${Date.now()}`,
              type: 'investigation_job',
              title: '📋 New Investigation Job',
              message: `You've been assigned: ${newRecord.reference_number}\nLocation: ${newRecord.location_address}`,
              severity: newRecord.priority === 'urgent' ? 'urgent' : newRecord.priority === 'high' ? 'warning' : 'info',
              entityId: newRecord.id,
              entityType: 'investigation_job',
              timestamp: new Date(),
              read: false,
              actionUrl: '#/investigation-jobs',
              metadata: {
                plateNumber: newRecord.reference_number,
                zoneName: newRecord.location_address,
              },
            };

            setNotifications(prev => [notif, ...prev].slice(0, 50));
            setUnreadCount(prev => prev + 1);
          }
          
          // Check if status changed (for jobs assigned to current user)
          if (newRecord.status !== oldRecord.status && newRecord.assigned_to === user.id) {
            // Show push notification for status change
            await pushNotificationManager.notifyJobStatusChange({
              id: newRecord.id,
              reference_number: newRecord.reference_number,
              job_type: newRecord.job_type,
              location_address: newRecord.location_address,
              old_status: oldRecord.status,
              new_status: newRecord.status,
            });

            // Add to in-app notifications
            const statusEmoji = {
              in_progress: '🔄',
              completed: '✅',
              cancelled: '❌',
              assigned: '📋',
              pending: '⏳',
            }[newRecord.status] || '📋';

            const notif: Notification = {
              id: `job-status-${newRecord.id}-${newRecord.status}-${Date.now()}`,
              type: 'investigation_job',
              title: `${statusEmoji} Job Status Updated`,
              message: `${newRecord.reference_number}\nStatus: ${newRecord.status.replace('_', ' ').toUpperCase()}`,
              severity: newRecord.status === 'completed' ? 'info' : 'warning',
              entityId: newRecord.id,
              entityType: 'investigation_job',
              timestamp: new Date(),
              read: false,
              actionUrl: '#/investigation-jobs',
              metadata: {
                plateNumber: newRecord.reference_number,
                zoneName: newRecord.location_address,
              },
            };

            setNotifications(prev => [notif, ...prev].slice(0, 50));
            setUnreadCount(prev => prev + 1);
          }
        }
      )
      .subscribe();

    // Admin subscription - monitor ALL job status changes
    let adminChannel: any = null;
    if (user.role === 'admin' || user.role === 'master') {
      adminChannel = supabase
        .channel('admin_investigation_jobs_notifications')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'investigation_jobs',
          },
          async (payload: any) => {
            const newRecord = payload.new;
            const oldRecord = payload.old;
            
            // Only notify admins about status changes (not their own assignments)
            if (newRecord.status !== oldRecord.status && newRecord.assigned_to !== user.id) {
              // Get assigned officer name for context
              let updatedBy = 'Field Officer';
              if (newRecord.assigned_to) {
                const { data: assignedUser } = await supabase
                  .from('user_profiles')
                  .select('first_name, last_name')
                  .eq('id', newRecord.assigned_to)
                  .single();
                
                if (assignedUser) {
                  updatedBy = `${assignedUser.first_name} ${assignedUser.last_name}`;
                }
              }

              // Show push notification
              await pushNotificationManager.notifyJobStatusChange({
                id: newRecord.id,
                reference_number: newRecord.reference_number,
                job_type: newRecord.job_type,
                location_address: newRecord.location_address,
                old_status: oldRecord.status,
                new_status: newRecord.status,
                updated_by: updatedBy,
              });

              // Add to in-app notifications
              const statusEmoji = {
                in_progress: '🔄',
                completed: '✅',
                cancelled: '❌',
                assigned: '📋',
                pending: '⏳',
              }[newRecord.status] || '📋';

              const notif: Notification = {
                id: `admin-job-status-${newRecord.id}-${newRecord.status}-${Date.now()}`,
                type: 'investigation_job',
                title: `${statusEmoji} Job Status Updated`,
                message: `${newRecord.reference_number}\nStatus: ${newRecord.status.replace('_', ' ').toUpperCase()}\nBy: ${updatedBy}`,
                severity: newRecord.status === 'completed' ? 'info' : 'warning',
                entityId: newRecord.id,
                entityType: 'investigation_job',
                timestamp: new Date(),
                read: false,
                actionUrl: '#/investigation-jobs',
                metadata: {
                  plateNumber: newRecord.reference_number,
                  zoneName: newRecord.location_address,
                },
              };

              setNotifications(prev => [notif, ...prev].slice(0, 50));
              setUnreadCount(prev => prev + 1);
            }
          }
        )
        .subscribe();
    }

    return () => {
      supabase.removeChannel(channel);
      if (adminChannel) {
        supabase.removeChannel(adminChannel);
      }
    };
  }, [user?.id, user?.role]);

  // Auto-clear old notifications after 10 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      setNotifications(prev => {
        const filtered = prev.filter(n => {
          // Keep if read OR created within last 10 minutes
          return n.read || n.timestamp.getTime() > tenMinutesAgo;
        });
        return filtered;
      });
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  // Check notifications for a specific plate number
  const checkPlateNotifications = useCallback(async (
    plateNumber: string, 
    vehicleId?: string,
    metadata?: Notification['metadata']
  ) => {
    if (!user?.id || !plateNumber) return;

    try {
      setIsLoading(true);

      // Get user's organization
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!profile?.organization_id) return;

      const orgId = profile.organization_id;
      const notificationsList: Notification[] = [];

      // 1. Check if vehicle is flagged
      const { data: vehicle } = await supabase
        .from('canonical_vehicles')
        .select('vehicle_id, plate_number, is_flagged, flagged_priority, flagged_reason, homeless_confirmed, homeless_confirmed_at')
        .eq('plate_number', plateNumber.toUpperCase())
        .maybeSingle();

      if (vehicle?.is_flagged) {
        const notifId = `flagged_${plateNumber}_${Date.now()}`;
        notificationsList.push({
          id: notifId,
          type: 'flagged_vehicle',
          title: '🚩 Flagged Vehicle',
          message: `This vehicle (${plateNumber}) is flagged\nReason: ${vehicle.flagged_reason || 'See flagged vehicles list'}`,
          severity: vehicle.flagged_priority === 'high' ? 'urgent' : 'warning',
          entityId: vehicle.vehicle_id,
          entityType: 'vehicle',
          plateNumber: vehicle.plate_number,
          timestamp: new Date(),
          read: false,
          metadata: metadata || {},
        });
      }

      // 2. Check for homeless status
      if (vehicle?.homeless_confirmed) {
        const notifId = `homeless_${plateNumber}_${Date.now()}`;
        notificationsList.push({
          id: notifId,
          type: 'homeless_confirmed',
          title: '🏕️ Homeless Vehicle',
          message: `Vehicle ${plateNumber} is confirmed homeless`,
          severity: 'info',
          entityId: vehicle.vehicle_id,
          entityType: 'vehicle',
          plateNumber: vehicle.plate_number,
          timestamp: new Date(vehicle.homeless_confirmed_at || new Date()),
          read: false,
          metadata: metadata || {},
        });
      }

      // 3. Check for active breach alerts (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: breaches } = await supabase
        .from('breach_alerts')
        .select(`
          id,
          breach_type,
          created_at,
          status,
          zones(name)
        `)
        .eq('organization_id', orgId)
        .in('status', ['pending', 'notified'])
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(5);

      breaches?.forEach((breach: any) => {
        const notifId = `breach_${breach.id}_${plateNumber}`;
        notificationsList.push({
          id: notifId,
          type: 'breach_alert',
          title: '⚠️ Breach Alert',
          message: `${breach.breach_type} violation in ${breach.zones?.name || 'this zone'}`,
          severity: 'warning',
          entityId: breach.id,
          entityType: 'breach_alert',
          zoneName: breach.zones?.name,
          plateNumber: plateNumber,
          timestamp: new Date(breach.created_at),
          read: false,
          metadata: metadata || {},
        });
      });

      // 4. Check for almost breaches (vehicles that WILL BREACH if they stay tonight)
      if (metadata?.zoneName && metadata?.zoneId) {
        const { data: almostBreachData } = await supabase.functions.invoke('check-almost-breaches', {
          body: {
            organization_id: orgId,
            zone_id: metadata.zoneId,
            threshold_nights: 1, // Check if will breach with 1 more night
          },
        });

        if (almostBreachData?.vehicles) {
          const thisVehicle = almostBreachData.vehicles.find(
            (v: any) => v.plate_number === plateNumber
          );

          if (thisVehicle) {
            // Check if homeless exempt - if so, don't show breach warning
            const isHomelessExempt = thisVehicle.homeless_status === 'confirmed' || thisVehicle.homeless_status === 'claimed';
            
            if (isHomelessExempt) {
              console.log(`✅ Skipping breach notification for ${plateNumber} - homeless exempt`);
              // Still show info notification about homeless status
              const notifId = `homeless_info_${plateNumber}_${thisVehicle.zone_id}`;
              notificationsList.push({
                id: notifId,
                type: 'homeless_confirmed',
                title: '🏕️ Homeless Vehicle (Exempt)',
                message: `${plateNumber} is ${thisVehicle.homeless_status === 'confirmed' ? 'confirmed homeless' : 'claiming homeless status'} - no enforcement action required`,
                severity: 'info',
                entityId: thisVehicle.plate_number,
                entityType: 'vehicle',
                plateNumber: thisVehicle.plate_number,
                zoneName: thisVehicle.zone_name,
                timestamp: new Date(),
                read: false,
                metadata: {
                  ...metadata,
                  homelessStatus: thisVehicle.homeless_status,
                  homelessNotes: thisVehicle.homeless_notes,
                },
              });
            } else {
              // Determine severity and message based on breach prediction
              const severity = thisVehicle.will_breach_if_stays_tonight ? 'urgent' : 'warning';
              const title = thisVehicle.will_breach_if_stays_tonight 
                ? '🚨 WILL BREACH IF STAYS TONIGHT'
                : '⚠️ Approaching Limit';
              
              const breachTypeText = thisVehicle.breach_type === 'consecutive'
                ? `${thisVehicle.consecutive_nights + 1}/${thisVehicle.consecutive_allowed} consecutive nights`
                : thisVehicle.breach_type === 'monthly'
                ? `${thisVehicle.nights_stayed + 1}/${thisVehicle.nights_allowed} monthly nights`
                : 'stay limits';
              
              const message = thisVehicle.will_breach_if_stays_tonight
                ? `${plateNumber} WILL BREACH if stays tonight (${breachTypeText})`
                : `${plateNumber} is ${thisVehicle.nights_until_breach} night${thisVehicle.nights_until_breach !== 1 ? 's' : ''} away from ${breachTypeText} limit`;

              const notifId = `almost_breach_${plateNumber}_${thisVehicle.zone_id}`;
              notificationsList.push({
                id: notifId,
                type: 'almost_breach',
                title,
                message,
                severity,
                entityId: thisVehicle.plate_number,
                entityType: 'vehicle',
                plateNumber: thisVehicle.plate_number,
                zoneName: thisVehicle.zone_name,
                timestamp: new Date(),
                read: false,
                metadata: {
                  ...metadata,
                  nightsStayed: thisVehicle.nights_stayed,
                  nightsAllowed: thisVehicle.nights_allowed,
                  consecutiveNights: thisVehicle.consecutive_nights,
                  consecutiveAllowed: thisVehicle.consecutive_allowed,
                  willBreachTonight: thisVehicle.will_breach_if_stays_tonight,
                  breachSeverity: thisVehicle.breach_severity,
                  homelessStatus: thisVehicle.homeless_status,
                  homelessNotes: thisVehicle.homeless_notes,
                  gpsLocation: thisVehicle.gps_lat && thisVehicle.gps_lng ? {
                    lat: thisVehicle.gps_lat,
                    lng: thisVehicle.gps_lng,
                    accuracy: thisVehicle.gps_accuracy || 0,
                  } : undefined,
                },
              });
            }
          }
        }
      }

      // Sort notifications by timestamp (newest first)
      notificationsList.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Load read status from localStorage
      const readNotifications = JSON.parse(localStorage.getItem('read-notifications') || '[]');
      notificationsList.forEach(notif => {
        notif.read = readNotifications.includes(notif.id);
      });

      // Add to existing notifications (avoid duplicates)
      setNotifications(prev => {
        const existingIds = new Set(prev.map(n => n.id));
        const newNotifs = notificationsList.filter(n => !existingIds.has(n.id));
        const combined = [...newNotifs, ...prev];
        return combined.slice(0, 50); // Keep max 50 notifications
      });
      
      // Update unread count
      setUnreadCount(prev => {
        const newUnread = notificationsList.filter(n => !n.read).length;
        return prev + newUnread;
      });

    } catch (error: any) {
      console.error('Failed to check plate notifications:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));

    // Persist to localStorage
    const readNotifications = JSON.parse(localStorage.getItem('read-notifications') || '[]');
    if (!readNotifications.includes(notificationId)) {
      readNotifications.push(notificationId);
      localStorage.setItem('read-notifications', JSON.stringify(readNotifications));
    }
  }, []);

  const markAllAsRead = useCallback(() => {
    const allIds = notifications.map(n => n.id);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
    localStorage.setItem('read-notifications', JSON.stringify(allIds));
  }, [notifications]);

  const clearNotification = useCallback((notificationId: string) => {
    setNotifications(prev => {
      const notif = prev.find(n => n.id === notificationId);
      if (notif && !notif.read) {
        setUnreadCount(c => Math.max(0, c - 1));
      }
      return prev.filter(n => n.id !== notificationId);
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
    localStorage.removeItem('read-notifications');
  }, []);

  /**
   * Add a custom notification
   */
  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const notif: Notification = {
      ...notification,
      id: `custom-${Date.now()}`,
      timestamp: new Date(),
      read: false,
    };

    setNotifications(prev => [notif, ...prev].slice(0, 50));
    setUnreadCount(prev => prev + 1);
  }, []);

  return {
    notifications,
    unreadCount,
    isLoading,
    checkPlateNotifications,
    addNotification,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAll,
  };
}
