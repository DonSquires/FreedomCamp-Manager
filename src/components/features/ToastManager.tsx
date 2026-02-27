/**
 * ToastManager Component
 * Centralized toast notification manager with custom presets
 */

import { toast as sonnerToast } from 'sonner'
import { 
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
} from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading'

interface ToastOptions {
  title?: string
  description?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

/**
 * Centralized toast notification system
 * Wraps sonner with custom icons and styling
 */
export const toast = {
  success: (message: string, options?: ToastOptions) => {
    sonnerToast.success(message, {
      description: options?.description,
      duration: options?.duration || 3000,
      icon: <CheckCircle2 className="h-5 w-5" />,
      action: options?.action,
    })
  },

  error: (message: string, options?: ToastOptions) => {
    sonnerToast.error(message, {
      description: options?.description,
      duration: options?.duration || 5000,
      icon: <XCircle className="h-5 w-5" />,
      action: options?.action,
    })
  },

  warning: (message: string, options?: ToastOptions) => {
    sonnerToast.warning(message, {
      description: options?.description,
      duration: options?.duration || 4000,
      icon: <AlertTriangle className="h-5 w-5" />,
      action: options?.action,
    })
  },

  info: (message: string, options?: ToastOptions) => {
    sonnerToast.info(message, {
      description: options?.description,
      duration: options?.duration || 3000,
      icon: <Info className="h-5 w-5" />,
      action: options?.action,
    })
  },

  loading: (message: string, options?: Omit<ToastOptions, 'action'>) => {
    return sonnerToast.loading(message, {
      description: options?.description,
      icon: <Loader2 className="h-5 w-5 animate-spin" />,
    })
  },

  promise: <T,>(
    promise: Promise<T>,
    {
      loading,
      success,
      error,
    }: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: any) => string)
    }
  ) => {
    return sonnerToast.promise(promise, {
      loading,
      success,
      error,
    })
  },

  dismiss: (toastId?: string | number) => {
    sonnerToast.dismiss(toastId)
  },

  // Custom presets for common scenarios
  presets: {
    saved: () => {
      toast.success('Changes saved successfully')
    },

    deleted: () => {
      toast.success('Deleted successfully')
    },

    copied: () => {
      toast.success('Copied to clipboard')
    },

    offline: () => {
      toast.warning('You are currently offline', {
        description: 'Changes will be synced when connection is restored',
      })
    },

    online: () => {
      toast.success('Connection restored', {
        description: 'Syncing offline changes...',
      })
    },

    unauthorized: () => {
      toast.error('Unauthorized access', {
        description: 'You do not have permission to perform this action',
      })
    },

    networkError: () => {
      toast.error('Network error', {
        description: 'Please check your internet connection and try again',
      })
    },

    validationError: (field?: string) => {
      toast.error('Validation error', {
        description: field 
          ? `Please check the ${field} field` 
          : 'Please check your input and try again',
      })
    },

    uploadSuccess: (fileName?: string) => {
      toast.success('Upload complete', {
        description: fileName ? `${fileName} uploaded successfully` : undefined,
      })
    },

    uploadError: (fileName?: string) => {
      toast.error('Upload failed', {
        description: fileName 
          ? `Failed to upload ${fileName}` 
          : 'Please try again or contact support',
      })
    },

    breachDetected: (plateNumber: string) => {
      toast.warning('Breach detected', {
        description: `Vehicle ${plateNumber} is non-compliant`,
        duration: 5000,
      })
    },

    assignmentReceived: (type: string) => {
      toast.info('New assignment', {
        description: `You have been assigned a new ${type}`,
        duration: 5000,
      })
    },
  },
}

/**
 * ToastManager component
 * Handles global toast notifications and auto-dismissal
 */
export function ToastManager() {
  // This component doesn't render anything
  // It's just a container for toast logic if needed
  return null
}

export default toast
