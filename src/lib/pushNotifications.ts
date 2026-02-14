/**
 * Push Notification System for Investigation Jobs
 * Provides browser/device notifications with sound and click actions
 */

import { soundManager } from './sounds';

export interface PushNotificationOptions {
  title: string;
  message: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: any;
  silent?: boolean;
  onClick?: () => void;
}

class PushNotificationManager {
  private permission: NotificationPermission = 'default';
  private onRequestCallback: ((reason: string) => Promise<boolean>) | null = null;

  constructor() {
    if ('Notification' in window) {
      this.permission = Notification.permission;
    }
  }

  /**
   * Set callback for custom permission request UI
   * This allows the app to show a friendly explanation before the browser's native dialog
   */
  setPermissionRequestCallback(callback: (reason: string) => Promise<boolean>) {
    this.onRequestCallback = callback;
  }

  /**
   * Request notification permission from user
   * Shows custom dialog first if callback is set, then browser's native permission
   */
  async requestPermission(reason?: string): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('This browser does not support notifications');
      return false;
    }

    if (this.permission === 'granted') {
      return true;
    }

    // If callback is set, show custom UI first
    if (this.onRequestCallback) {
      const userAgreed = await this.onRequestCallback(
        reason || 'This app would like to send you notifications for important updates.'
      );
      
      if (!userAgreed) {
        console.log('User declined permission request in custom dialog');
        return false;
      }
    }

    // Now show browser's native permission dialog
    const permission = await Notification.requestPermission();
    this.permission = permission;
    
    return permission === 'granted';
  }

  /**
   * Check if notifications are enabled
   */
  isEnabled(): boolean {
    return 'Notification' in window && this.permission === 'granted';
  }

  /**
   * Show a push notification
   */
  async show(options: PushNotificationOptions): Promise<void> {
    // Ensure we have permission
    const hasPermission = await this.requestPermission('You have new updates that require your attention.');
    if (!hasPermission) {
      console.warn('Notification permission denied');
      return;
    }

    // Play sound unless silent
    if (!options.silent) {
      // Use urgent alert sound for critical notifications
      soundManager.violationAlert();
    }

    // Create notification
    const notification = new Notification(options.title, {
      body: options.message,
      icon: options.icon || '/iron-eagle-security-logo.jpg',
      badge: options.badge || '/iron-eagle-security-logo.jpg',
      tag: options.tag || `notification-${Date.now()}`,
      requireInteraction: true, // Keep notification visible until user interacts
      data: options.data || {},
      vibrate: [200, 100, 200], // Vibration pattern for mobile devices
    });

    // Handle notification click
    notification.onclick = (event) => {
      event.preventDefault();
      
      // Focus the window
      window.focus();
      
      // Execute custom click handler
      if (options.onClick) {
        options.onClick();
      }
      
      // Close notification
      notification.close();
    };

    // Auto-close after 30 seconds if not interacted with
    setTimeout(() => {
      notification.close();
    }, 30000);
  }

  /**
   * Show welfare check notification (high priority)
   */
  async notifyWelfareCheck(warning: {
    type: 'inactivity' | 'gps_welfare';
    minutesInactive?: number;
    minutesStationary?: number;
    secondsUntilAction: number;
  }): Promise<void> {
    const isInactivity = warning.type === 'inactivity';
    const emoji = isInactivity ? '⚠️' : '🚨';
    const title = isInactivity 
      ? `${emoji} Inactivity Warning` 
      : `${emoji} Welfare Check Alert`;
    
    const minutes = isInactivity 
      ? warning.minutesInactive || 0 
      : warning.minutesStationary || 0;
    
    const actionText = isInactivity
      ? `You will be automatically logged off in ${Math.floor(warning.secondsUntilAction / 60)} minutes.`
      : 'Your team has been notified. Tap to acknowledge if you\'re OK.';
    
    const message = isInactivity
      ? `No vehicle scans for ${Math.floor(minutes)} minutes. ${actionText}`
      : `GPS shows no movement for ${Math.floor(minutes)} minutes. ${actionText}`;

    await this.show({
      title,
      message,
      tag: isInactivity ? 'welfare-inactivity' : 'welfare-gps',
      data: {
        type: 'welfare_warning',
        warningType: warning.type,
        minutes: Math.floor(minutes),
        secondsUntilAction: warning.secondsUntilAction,
      },
      onClick: () => {
        // Bring app to foreground - the modal will show automatically
        window.focus();
        // Navigate to field officer portal if not already there
        if (!window.location.hash.includes('field-officer-portal')) {
          window.location.hash = '#/field-officer-portal';
        }
      },
    });
  }

  /**
   * Show investigation job assignment notification
   */
  async notifyJobAssignment(job: {
    id: string;
    reference_number: string;
    job_type: string;
    location_address: string;
    priority: string;
    due_date?: string;
  }): Promise<void> {
    const priorityEmoji = {
      urgent: '🚨',
      high: '⚠️',
      medium: '📋',
      low: '📝',
    }[job.priority] || '📋';

    const jobTypeLabel = {
      homeless_occupation: 'Homeless Occupation',
      abandoned_vehicle: 'Abandoned Vehicle',
      unauthorized_structure: 'Unauthorized Structure',
      other: 'Investigation',
    }[job.job_type] || 'Investigation';

    const dueDateText = job.due_date 
      ? `\nDue: ${new Date(job.due_date).toLocaleDateString('en-NZ')}`
      : '';

    await this.show({
      title: `${priorityEmoji} New Investigation Job Assigned`,
      message: `${job.reference_number}\n${jobTypeLabel}\n${job.location_address}${dueDateText}`,
      tag: `job-${job.id}`,
      data: {
        type: 'investigation_job',
        jobId: job.id,
        reference: job.reference_number,
      },
      onClick: () => {
        // Navigate to investigation jobs page
        window.location.hash = '#/investigation-jobs';
        
        // Scroll to the job (give time for page to load)
        setTimeout(() => {
          const jobElement = document.querySelector(`[data-job-id="${job.id}"]`);
          if (jobElement) {
            jobElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            jobElement.classList.add('ring-4', 'ring-primary', 'animate-pulse');
            setTimeout(() => {
              jobElement.classList.remove('ring-4', 'ring-primary', 'animate-pulse');
            }, 3000);
          }
        }, 500);
      },
    });
  }

  /**
   * Show incident approval notification
   */
  async notifyIncidentApproval(incident: {
    id: string;
    incident_type: string;
    plate_number?: string;
  }): Promise<void> {
    await this.show({
      title: '✅ Incident Approved',
      message: `Your ${incident.incident_type} report has been approved and is now court-ready.${incident.plate_number ? `\nVehicle: ${incident.plate_number}` : ''}`,
      tag: `incident-approval-${incident.id}`,
      data: {
        type: 'incident_approval',
        incidentId: incident.id,
      },
      silent: true, // Use success sound instead of urgent alert
      onClick: () => {
        window.location.hash = '#/field-officer-portal';
      },
    });
    
    // Play success sound separately
    soundManager.success();
  }

  /**
   * Show urgent follow-up notification
   */
  async notifyUrgentFollowUp(item: {
    id: string;
    type: 'observation' | 'incident' | 'homeless';
    plate_number?: string;
    reason: string;
  }): Promise<void> {
    const typeLabel = {
      observation: 'Observation',
      incident: 'Incident',
      homeless: 'Homeless Claim',
    }[item.type];

    await this.show({
      title: `⚠️ Urgent Follow-Up Required`,
      message: `${typeLabel}${item.plate_number ? `: ${item.plate_number}` : ''}\n${item.reason}`,
      tag: `followup-${item.type}-${item.id}`,
      data: {
        type: 'urgent_followup',
        itemType: item.type,
        itemId: item.id,
      },
      onClick: () => {
        window.location.hash = '#/urgent-followups';
      },
    });
  }

  /**
   * Show investigation job status change notification
   */
  async notifyJobStatusChange(job: {
    id: string;
    reference_number: string;
    job_type: string;
    location_address: string;
    old_status: string;
    new_status: string;
    updated_by?: string;
  }): Promise<void> {
    const statusEmoji = {
      in_progress: '🔄',
      completed: '✅',
      cancelled: '❌',
      assigned: '📋',
      pending: '⏳',
    }[job.new_status] || '📋';

    const statusLabel = {
      in_progress: 'In Progress',
      completed: 'Completed',
      cancelled: 'Cancelled',
      assigned: 'Assigned',
      pending: 'Pending',
    }[job.new_status] || job.new_status;

    const jobTypeLabel = {
      homeless_occupation: 'Homeless Occupation',
      abandoned_vehicle: 'Abandoned Vehicle',
      unauthorized_structure: 'Unauthorized Structure',
      other: 'Investigation',
    }[job.job_type] || 'Investigation';

    const updatedByText = job.updated_by ? `\nUpdated by: ${job.updated_by}` : '';

    await this.show({
      title: `${statusEmoji} Job Status Updated`,
      message: `${job.reference_number}\n${jobTypeLabel}\nStatus: ${statusLabel}\n${job.location_address}${updatedByText}`,
      tag: `job-status-${job.id}-${job.new_status}`,
      data: {
        type: 'job_status_change',
        jobId: job.id,
        reference: job.reference_number,
        status: job.new_status,
      },
      silent: job.new_status === 'completed', // Use success sound for completed
      onClick: () => {
        // Navigate to investigation jobs page
        window.location.hash = '#/investigation-jobs';
        
        // Scroll to the job
        setTimeout(() => {
          const jobElement = document.querySelector(`[data-job-id="${job.id}"]`);
          if (jobElement) {
            jobElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            jobElement.classList.add('ring-4', 'ring-primary', 'animate-pulse');
            setTimeout(() => {
              jobElement.classList.remove('ring-4', 'ring-primary', 'animate-pulse');
            }, 3000);
          }
        }, 500);
      },
    });
    
    // Play appropriate sound
    if (job.new_status === 'completed') {
      soundManager.success();
    } else if (job.new_status === 'cancelled') {
      soundManager.error();
    }
  }
}

// Singleton instance
export const pushNotificationManager = new PushNotificationManager();

// Initialize permission request on user interaction
export const initializePushNotifications = async (): Promise<boolean> => {
  return await pushNotificationManager.requestPermission();
};
