import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Siren, MapPin, Clock, ShieldCheck } from 'lucide-react'

interface OfficerWelfareWarningModalProps {
  open: boolean
  onClose: () => void
  onConfirmSafe?: () => void
  onRequestHelp?: () => void
  officerName: string
  alertType: 'no_response' | 'man_down' | 'sos' | 'overdue'
  timeSinceLastCheck?: number // minutes
  location?: string
  supervisorNotified?: boolean
}

const ALERT_LABELS: Record<OfficerWelfareWarningModalProps['alertType'], string> = {
  no_response: 'No Response',
  man_down: 'Man Down',
  sos: 'SOS',
  overdue: 'Overdue Check-in',
}

const ALERT_COLORS: Record<OfficerWelfareWarningModalProps['alertType'], string> = {
  no_response: 'bg-orange-600',
  man_down: 'bg-red-700',
  sos: 'bg-red-600',
  overdue: 'bg-orange-500',
}

export function OfficerWelfareWarningModal({
  open,
  onConfirmSafe,
  onRequestHelp,
  officerName,
  alertType,
  timeSinceLastCheck,
  location,
  supervisorNotified,
}: OfficerWelfareWarningModalProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-md p-0 overflow-hidden [&>button:first-of-type]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Welfare Alert — {ALERT_LABELS[alertType]}</DialogTitle>
        {/* Header */}
        <div className={`${ALERT_COLORS[alertType]} px-6 py-5 text-white`}>
          <div className="flex items-center gap-3 mb-1">
            <Siren className="h-7 w-7 animate-pulse" />
            <span className="text-lg font-bold uppercase tracking-wide">
              Welfare Alert
            </span>
          </div>
          <Badge className="bg-white/20 text-white border-0 text-sm font-semibold">
            {ALERT_LABELS[alertType]}
          </Badge>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Officer</p>
            <p className="text-2xl font-bold text-gray-900">{officerName}</p>
          </div>

          {timeSinceLastCheck !== undefined && (
            <div className="flex items-center gap-2 text-gray-700">
              <Clock className="h-4 w-4 text-orange-500" />
              <span className="text-sm">
                Last check-in <strong>{timeSinceLastCheck} minutes ago</strong>
              </span>
            </div>
          )}

          {location && (
            <div className="flex items-center gap-2 text-gray-700">
              <MapPin className="h-4 w-4 text-blue-500" />
              <span className="text-sm">{location}</span>
            </div>
          )}

          {supervisorNotified && (
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              <Badge variant="outline" className="text-green-700 border-green-400 bg-green-50 text-xs">
                Supervisor Notified
              </Badge>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white h-12 text-base font-semibold"
              onClick={onConfirmSafe}
            >
              I'm Safe
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700 text-white h-12 text-base font-semibold"
              onClick={onRequestHelp}
            >
              Request Help
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
