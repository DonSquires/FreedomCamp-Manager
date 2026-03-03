import { useState } from 'react'
import { ShieldAlert, FileWarning, Calendar, Eye } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ComplianceItem {
  id: string
  type: 'missing_credentials' | 'expired_document' | 'pending_review'
  description: string
  vehiclePlate?: string
  dueDate?: string
}

interface ComplianceBlockingModalProps {
  open: boolean
  onClose: () => void
  items: ComplianceItem[]
  onResolveItem?: (itemId: string) => void
  onContinueAnyway?: () => void
  canSkip?: boolean
}

const itemIcon = {
  missing_credentials: <FileWarning className="h-5 w-5 text-red-500 flex-shrink-0" />,
  expired_document: <Calendar className="h-5 w-5 text-orange-500 flex-shrink-0" />,
  pending_review: <Eye className="h-5 w-5 text-yellow-500 flex-shrink-0" />,
}

const itemLabel = {
  missing_credentials: 'Missing Credentials',
  expired_document: 'Expired Document',
  pending_review: 'Pending Review',
}

export function ComplianceBlockingModal({
  open,
  onClose,
  items,
  onResolveItem,
  onContinueAnyway,
  canSkip = false,
}: ComplianceBlockingModalProps) {
  const [acknowledged, setAcknowledged] = useState(false)

  const handleClose = () => {
    if (!acknowledged && !canSkip) return
    setAcknowledged(false)
    onClose()
  }

  const handleContinue = () => {
    if (onContinueAnyway) onContinueAnyway()
    setAcknowledged(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 -mx-1">
            <ShieldAlert className="h-7 w-7 text-red-600 flex-shrink-0" />
            <div>
              <DialogTitle className="text-red-900 text-lg">Compliance Action Required</DialogTitle>
              <DialogDescription className="text-red-700 text-sm mt-0.5">
                You have unresolved compliance items that must be addressed.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 border rounded-lg px-3 py-3 bg-white"
            >
              {itemIcon[item.type]}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800">{itemLabel[item.type]}</p>
                <p className="text-sm text-gray-600 mt-0.5">{item.description}</p>
                {item.vehiclePlate && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Vehicle: <span className="font-mono font-medium">{item.vehiclePlate}</span>
                  </p>
                )}
                {item.dueDate && (
                  <p className="text-xs text-orange-600 mt-0.5">
                    Due: {new Date(item.dueDate).toLocaleDateString()}
                  </p>
                )}
              </div>
              {onResolveItem && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-shrink-0 h-7 text-xs"
                  onClick={() => onResolveItem(item.id)}
                >
                  Resolve Now
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <input
            id="compliance-ack"
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-red-600 cursor-pointer"
          />
          <label htmlFor="compliance-ack" className="text-sm text-gray-700 cursor-pointer select-none">
            I acknowledge these compliance issues and understand my responsibilities.
          </label>
        </div>

        <DialogFooter className="mt-4 flex gap-2 justify-end">
          {canSkip && (
            <Button
              variant="outline"
              onClick={handleContinue}
              disabled={!acknowledged}
            >
              Continue Anyway
            </Button>
          )}
          <Button
            onClick={handleClose}
            disabled={!acknowledged}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
