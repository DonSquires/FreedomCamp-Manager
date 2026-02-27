import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info' | 'success'
  isLoading?: boolean
}

const variantConfig = {
  danger: {
    icon: XCircle,
    iconColor: 'text-red-600',
    confirmButtonVariant: 'destructive' as const,
    bgColor: 'bg-red-50 dark:bg-red-900/20',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-orange-600',
    confirmButtonVariant: 'default' as const,
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-600',
    confirmButtonVariant: 'default' as const,
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
  },
  success: {
    icon: CheckCircle,
    iconColor: 'text-green-600',
    confirmButtonVariant: 'default' as const,
    bgColor: 'bg-green-50 dark:bg-green-900/20',
  },
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'info',
  isLoading = false,
}: ConfirmDialogProps) {
  const config = variantConfig[variant]
  const Icon = config.icon

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <div className={`${config.bgColor} p-3 rounded-lg mb-2 w-fit`}>
            <Icon className={`h-6 w-6 ${config.iconColor}`} />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-base">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button
            variant={config.confirmButtonVariant}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
