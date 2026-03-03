import { useState } from 'react'
import { Shield, AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type ActionType = 'notice_to_vacate' | 'infringement_notice' | 'tow_request' | 'police_referral'

interface EnforcementGuardModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  vehiclePlate: string
  breachType: string
  actionType: ActionType
  warningMessage?: string
  requiresWitness?: boolean
}

const actionLabels: Record<ActionType, string> = {
  notice_to_vacate: 'Notice to Vacate',
  infringement_notice: 'Infringement Notice',
  tow_request: 'Tow Request',
  police_referral: 'Police Referral',
}

export function EnforcementGuardModal({
  open,
  onClose,
  onConfirm,
  vehiclePlate,
  breachType,
  actionType,
  warningMessage,
  requiresWitness = false,
}: EnforcementGuardModalProps) {
  const [loading, setLoading] = useState(false)
  const [witness, setWitness] = useState('')

  const handleConfirm = async () => {
    if (requiresWitness && !witness.trim()) {
      toast.error('Witness name is required.')
      return
    }
    setLoading(true)
    try {
      await onConfirm()
      toast.success('Enforcement action confirmed.')
      setWitness('')
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to confirm enforcement action.'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (loading) return
    setWitness('')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 -mx-1">
            <Shield className="h-7 w-7 text-red-600 flex-shrink-0" />
            <div>
              <DialogTitle className="text-red-900 text-lg">Confirm Enforcement Action</DialogTitle>
              <DialogDescription className="text-red-700 text-sm mt-0.5">
                This action will be recorded and cannot be undone.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Vehicle plate */}
          <div className="text-center bg-gray-100 rounded-lg py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Vehicle Plate</p>
            <span className="font-mono text-2xl font-bold text-gray-900">{vehiclePlate}</span>
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-md px-3 py-2">
              <p className="text-xs text-gray-500 mb-0.5">Breach Type</p>
              <p className="font-semibold text-gray-800 capitalize">{breachType.replace(/_/g, ' ')}</p>
            </div>
            <div className="bg-gray-50 rounded-md px-3 py-2">
              <p className="text-xs text-gray-500 mb-0.5">Action Type</p>
              <p className="font-semibold text-gray-800">{actionLabels[actionType]}</p>
            </div>
          </div>

          {/* Optional warning */}
          {warningMessage && (
            <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-800">{warningMessage}</p>
            </div>
          )}

          {/* Witness name input */}
          {requiresWitness && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Witness Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={witness}
                onChange={(e) => setWitness(e.target.value)}
                placeholder="Enter witness name"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 flex gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1"
          >
            {loading ? 'Processing...' : 'Confirm Enforcement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
