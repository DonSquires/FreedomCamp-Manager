/**
 * Officer Notifications Hook
 * 
 * Provides real-time notifications for field officers:
 * - Breaches assigned to them (auto_assigned or manual)
 * - Almost breach warnings
 * - Enforcement job assignments
 * - Investigation job assignments
 * - Urgent follow-ups
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

export interface OfficerNotification {
  id: string;
  type: 'breach_assigned' | 'almost_breach' | 'enforcement_assigned' | 'investigation_assigned' | 'urgent_followup';
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  plate_number?: string;
  zone_name?: string;
  created_at: string;
  read: boolean;
  action_url?: string;
  metadata?: any;
}

export function useOfficerNotifications() {
  const { user } = useAuthStore();
  const [notifications, setNotifications] = useState<OfficerNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Load notifications
  const loadNotifications = async () => {
    if (!user?.id) return;

    try {
      const allNotifications: OfficerNotification[] = [];

      // 1. Auto-assigned breaches (auto_assign workflow)
      const { data: autoBreaches, error: breachError } = await supabase
        .from('breach_alerts')
        .select(`
          id,
          plate_number,
          breach_type,
          status,
          assigned_at,
          zones (name)
        `)
        .eq('assigned_to', user.id)
        .eq('status', 'auto_assigned')
        .order('assigned_at', { ascending: false })
        .limit(20);

      if (!breachError && autoBreaches) {
        autoBreaches.forEach(breach => {
          allNotifications.push({
            id: `breach-${breach.id}`,
            type: 'breach_assigned',
            title: '🚨 Breach Auto-Assigned',
            message: `Vehicle ${breach.plate_number} in ${(breach.zones as any)?.name || 'Unknown'} - ${breach.breach_type.replace(/_/g, ' ')}`,
            severity: 'high',
            plate_number: breach.plate_number,
            zone_name: (breach.zones as any)?.name,
            created_at: breach.assigned_at || new Date().toISOString(),
            read: false,
            action_url: '/field-portal?view=enforcement',
            metadata: { breach_id: breach.id },
          });
        });
      }

      // 2. Enforcement jobs assigned to officer
      const { data: enforcementJobs, error: enforcementError } = await supabase
        .from('enforcement_actions')
        .select(`
          id,
          plate_number,
          action_type,
          breach_status,
          assigned_at,
          zones (name)
        `)
        .eq('assigned_to', user.id)
        .in('breach_status', ['assigned', 'in_progress'])
        .order('assigned_at', { ascending: false })
        .limit(20);

      if (!enforcementError && enforcementJobs) {
        enforcementJobs.forEach(job => {
          allNotifications.push({
            id: `enforcement-${job.id}`,
            type: 'enforcement_assigned',
            title: '👮 Enforcement Job Assigned',
            message: `${job.action_type} for ${job.plate_number} in ${(job.zones as any)?.name || 'Unknown'}`,
            severity: 'medium',
            plate_number: job.plate_number,
            zone_name: (job.zones as any)?.name,
            created_at: job.assigned_at || new Date().toISOString(),
            read: false,
            action_url: '/field-portal?view=enforcement',
            metadata: { enforcement_id: job.id },
          });
        });
      }

      // 3. Investigation jobs assigned to officer
      const { data: investigationJobs, error: investigationError } = await supabase
        .from('investigation_jobs')
        .select(`
          id,
          job_type,
          location_address,
          status,
          assigned_at,
          plate_number
        `)
        .eq('assigned_to', user.id)
        .in('status', ['pending', 'in_progress'])
        .order('assigned_at', { ascending: false })
        .limit(10);

      if (!investigationError && investigationJobs) {
        investigationJobs.forEach(job => {
          allNotifications.push({
            id: `investigation-${job.id}`,
            type: 'investigation_assigned',
            title: '🔍 Investigation Job',
            message: `${job.job_type} at ${job.location_address}`,
            severity: 'medium',
            plate_number: job.plate_number,
            created_at: job.assigned_at || new Date().toISOString(),
            read: false,
            action_url: '/field-portal?view=investigations',
            metadata: { investigation_id: job.id },
          });
        });
      }

      // 4. Almost breach warnings (vehicles close to limits)
      // This requires checking compliance_results for vehicles nearing thresholds
      const { data: almostBreaches, error: almostError } = await supabase.rpc(
        'get_almost_breaches',
        {
          p_organization_id: user.organization_id,
          p_officer_id: user.id,
        }
      );

      if (!almostError && almostBreaches) {
        almostBreaches.forEach((vehicle: any) => {
          allNotifications.push({
            id: `almost-${vehicle.plate_number}`,
            type: 'almost_breach',
            title: '⚠️ Almost Breach Warning',
            message: `${vehicle.plate_number} in ${vehicle.zone_name} - ${vehicle.nights_stayed}/${vehicle.max_allowed} nights`,
            severity: 'low',
            plate_number: vehicle.plate_number,
            zone_name: vehicle.zone_name,
            created_at: new Date().toISOString(),
            read: false,
            metadata: vehicle,
          });
        });
      }

      // Sort by date (newest first)
      allNotifications.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setNotifications(allNotifications);
      setUnreadCount(allNotifications.filter(n => !n.read).length);

    } catch (error) {
      console.error('Failed to load officer notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Mark notification as read
  const markAsRead = (notificationId: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  // Mark all as read
  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  // Load on mount and refresh every 30 seconds
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [user?.id]);

  // Real-time subscriptions for instant updates
  useEffect(() => {
    if (!user?.id) return;

    // Subscribe to breach alerts assigned to this officer
    const breachChannel = supabase
      .channel('officer-breaches')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'breach_alerts',
          filter: `assigned_to=eq.${user.id}`,
        },
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    // Subscribe to enforcement actions
    const enforcementChannel = supabase
      .channel('officer-enforcement')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'enforcement_actions',
          filter: `assigned_to=eq.${user.id}`,
        },
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    // Subscribe to investigation jobs
    const investigationChannel = supabase
      .channel('officer-investigations')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'investigation_jobs',
          filter: `assigned_to=eq.${user.id}`,
        },
        () => {
          loadNotifications();
        }
      )
      .subscribe();

    return () => {
      breachChannel.unsubscribe();
      enforcementChannel.unsubscribe();
      investigationChannel.unsubscribe();
    };
  }, [user?.id]);

  return {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    refresh: loadNotifications,
  };
}
