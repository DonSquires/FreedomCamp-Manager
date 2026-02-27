/**
 * BulkActionToolbar Component
 * Batch operations UI for selected items
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Check,
  X,
  Trash2,
  Download,
  Send,
  Archive,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from './ConfirmDialog'

interface BulkAction {
  id: string
  label: string
  icon: React.ReactNode
  variant?: 'default' | 'destructive' | 'outline' | 'secondary'
  requiresConfirmation?: boolean
  confirmTitle?: string
  confirmMessage?: string
}

interface BulkActionToolbarProps {
  selectedCount: number
  totalCount: number
  onSelectAll?: () => void
  onDeselectAll?: () => void
  actions?: BulkAction[]
  onAction?: (actionId: string) => Promise<void>
}

export function BulkActionToolbar({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  actions = [],
  onAction,
}: BulkActionToolbarProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [confirmAction, setConfirmAction] = useState<BulkAction | null>(null)

  const handleAction = async (action: BulkAction) => {
    if (action.requiresConfirmation) {
      setConfirmAction(action)
      return
    }

    await executeAction(action)
  }

  const executeAction = async (action: BulkAction) => {
    if (!onAction) return

    setIsProcessing(true)
    try {
      await onAction(action.id)
      toast.success(`${action.label} completed for ${selectedCount} item${selectedCount > 1 ? 's' : ''}`)
    } catch (error: any) {
      toast.error(`Failed to ${action.label.toLowerCase()}: ${error.message}`)
    } finally {
      setIsProcessing(false)
      setConfirmAction(null)
    }
  }

  if (selectedCount === 0) {
    return null
  }

  return (
    <>
      <div className="flex items-center gap-3 p-4 bg-primary/10 border-b sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-base px-3 py-1">
            {selectedCount} selected
          </Badge>
          <span className="text-sm text-muted-foreground">
            of {totalCount} total
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Select all / Deselect all */}
          {onSelectAll && selectedCount < totalCount && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSelectAll}
              disabled={isProcessing}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Select All
            </Button>
          )}
          {onDeselectAll && selectedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDeselectAll}
              disabled={isProcessing}
            >
              <XCircle className="h-4 w-4 mr-2" />
              Deselect All
            </Button>
          )}

          {/* Custom actions */}
          {actions.map((action) => (
            <Button
              key={action.id}
              variant={action.variant || 'outline'}
              size="sm"
              onClick={() => handleAction(action)}
              disabled={isProcessing}
            >
              {action.icon}
              <span className="ml-2">{action.label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmAction && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setConfirmAction(null)}
          onConfirm={() => executeAction(confirmAction)}
          title={confirmAction.confirmTitle || `Confirm ${confirmAction.label}`}
          message={
            confirmAction.confirmMessage ||
            `Are you sure you want to ${confirmAction.label.toLowerCase()} ${selectedCount} item${selectedCount > 1 ? 's' : ''}? This action cannot be undone.`
          }
          confirmLabel={confirmAction.label}
          variant={confirmAction.variant === 'destructive' ? 'destructive' : 'default'}
        />
      )}
    </>
  )
}

// Common preset actions
export const COMMON_BULK_ACTIONS: BulkAction[] = [
  {
    id: 'delete',
    label: 'Delete',
    icon: <Trash2 className="h-4 w-4" />,
    variant: 'destructive',
    requiresConfirmation: true,
    confirmTitle: 'Delete Selected Items',
    confirmMessage: 'Are you sure you want to delete these items? This action cannot be undone.',
  },
  {
    id: 'export',
    label: 'Export',
    icon: <Download className="h-4 w-4" />,
    variant: 'outline',
  },
  {
    id: 'archive',
    label: 'Archive',
    icon: <Archive className="h-4 w-4" />,
    variant: 'secondary',
    requiresConfirmation: true,
  },
  {
    id: 'send',
    label: 'Send',
    icon: <Send className="h-4 w-4" />,
    variant: 'default',
  },
]
