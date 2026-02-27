import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { 
  CheckSquare, 
  Square, 
  Trash2, 
  Edit, 
  Send, 
  AlertTriangle,
  CheckCircle,
  X,
  MoreVertical
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

export interface BulkOperation {
  id: string
  label: string
  icon: React.ReactNode
  variant?: 'default' | 'destructive' | 'outline'
  requiresConfirmation?: boolean
  confirmationMessage?: string
  action: (selectedIds: string[]) => Promise<void>
}

interface BulkOperationToolbarProps {
  selectedIds: string[]
  totalItems: number
  onSelectAll: () => void
  onClearSelection: () => void
  operations: BulkOperation[]
  itemName?: string // e.g., "vehicles", "observations"
}

export function BulkOperationToolbar({
  selectedIds,
  totalItems,
  onSelectAll,
  onClearSelection,
  operations,
  itemName = 'items'
}: BulkOperationToolbarProps) {
  const [isExecuting, setIsExecuting] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    operation: BulkOperation | null
  }>({ open: false, operation: null })

  const hasSelection = selectedIds.length > 0
  const allSelected = selectedIds.length === totalItems

  const handleOperation = async (operation: BulkOperation) => {
    if (operation.requiresConfirmation) {
      setConfirmDialog({ open: true, operation })
    } else {
      await executeOperation(operation)
    }
  }

  const executeOperation = async (operation: BulkOperation) => {
    setIsExecuting(true)
    try {
      await operation.action(selectedIds)
      toast.success(`${operation.label} completed for ${selectedIds.length} ${itemName}`)
      onClearSelection()
    } catch (error: any) {
      toast.error(error.message || `Failed to ${operation.label.toLowerCase()}`)
    } finally {
      setIsExecuting(false)
      setConfirmDialog({ open: false, operation: null })
    }
  }

  if (!hasSelection) {
    return null
  }

  return (
    <>
      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-900/10">
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            {/* Selection Info */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-5 w-5 text-blue-600" />
                <Badge variant="secondary" className="text-sm">
                  {selectedIds.length} selected
                </Badge>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={allSelected ? onClearSelection : onSelectAll}
                >
                  {allSelected ? (
                    <>
                      <Square className="h-4 w-4 mr-1" />
                      Deselect All
                    </>
                  ) : (
                    <>
                      <CheckSquare className="h-4 w-4 mr-1" />
                      Select All ({totalItems})
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearSelection}
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              </div>
            </div>

            {/* Bulk Operations */}
            <div className="flex items-center gap-2">
              {operations.map((operation) => (
                <Button
                  key={operation.id}
                  variant={operation.variant || 'outline'}
                  size="sm"
                  onClick={() => handleOperation(operation)}
                  disabled={isExecuting}
                >
                  {operation.icon}
                  <span className="ml-2">{operation.label}</span>
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog 
        open={confirmDialog.open} 
        onOpenChange={(open) => !open && setConfirmDialog({ open: false, operation: null })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              Confirm Bulk Operation
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.operation?.confirmationMessage || 
                `Are you sure you want to ${confirmDialog.operation?.label.toLowerCase()} ${selectedIds.length} ${itemName}?`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setConfirmDialog({ open: false, operation: null })}
              disabled={isExecuting}
            >
              Cancel
            </Button>
            <Button
              variant={confirmDialog.operation?.variant || 'default'}
              onClick={() => confirmDialog.operation && executeOperation(confirmDialog.operation)}
              disabled={isExecuting}
            >
              {isExecuting ? 'Processing...' : 'Confirm'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Predefined common operations
export const commonBulkOperations = {
  markCompliant: (onUpdate: (ids: string[]) => Promise<void>): BulkOperation => ({
    id: 'mark-compliant',
    label: 'Mark Compliant',
    icon: <CheckCircle className="h-4 w-4" />,
    action: onUpdate,
  }),

  markBreach: (onUpdate: (ids: string[]) => Promise<void>): BulkOperation => ({
    id: 'mark-breach',
    label: 'Flag as Breach',
    icon: <AlertTriangle className="h-4 w-4" />,
    variant: 'destructive',
    requiresConfirmation: true,
    confirmationMessage: 'This will create breach alerts for all selected items.',
    action: onUpdate,
  }),

  delete: (onDelete: (ids: string[]) => Promise<void>): BulkOperation => ({
    id: 'delete',
    label: 'Delete',
    icon: <Trash2 className="h-4 w-4" />,
    variant: 'destructive',
    requiresConfirmation: true,
    confirmationMessage: 'This action cannot be undone. Are you sure you want to delete these items?',
    action: onDelete,
  }),

  sendNotification: (onSend: (ids: string[]) => Promise<void>): BulkOperation => ({
    id: 'send-notification',
    label: 'Send Notice',
    icon: <Send className="h-4 w-4" />,
    requiresConfirmation: true,
    confirmationMessage: 'This will send enforcement notices to all selected vehicles.',
    action: onSend,
  }),
}
