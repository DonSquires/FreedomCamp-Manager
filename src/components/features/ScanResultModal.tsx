import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Car, ShieldCheck, ShieldX, AlertTriangle, Users, Eye, PlusCircle } from 'lucide-react'

interface ScanResult {
  plate_number: string
  found: boolean
  vehicle?: { make?: string; model?: string; year?: number; color?: string }
  certification?: { status: string; is_current: boolean; expiry_date?: string; max_occupants?: number }
  compliance?: { status: 'compliant' | 'breach' | 'warning' | 'unknown'; message?: string }
}

interface ScanResultModalProps {
  open: boolean
  onClose: () => void
  result: ScanResult | null
  onCreateObservation?: () => void
  onViewVehicle?: (plate: string) => void
}

function certBadge(cert: ScanResult['certification']) {
  if (!cert) return null
  if (cert.is_current) {
    return <Badge className="bg-green-100 text-green-800 border-green-200"><ShieldCheck className="h-3 w-3 mr-1" />Current</Badge>
  }
  const lower = cert.status?.toLowerCase() ?? ''
  if (lower === 'issued') {
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200"><AlertTriangle className="h-3 w-3 mr-1" />Issued</Badge>
  }
  return <Badge className="bg-red-100 text-red-800 border-red-200"><ShieldX className="h-3 w-3 mr-1" />{cert.status || 'Expired'}</Badge>
}

function complianceBadge(compliance: ScanResult['compliance']) {
  if (!compliance) return null
  const map = {
    compliant: 'bg-green-100 text-green-800 border-green-200',
    breach: 'bg-red-100 text-red-800 border-red-200',
    warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    unknown: 'bg-gray-100 text-gray-700 border-gray-200',
  }
  return (
    <Badge className={map[compliance.status] ?? map.unknown} variant="outline">
      {compliance.status.charAt(0).toUpperCase() + compliance.status.slice(1)}
    </Badge>
  )
}

export function ScanResultModal({ open, onClose, result, onCreateObservation, onViewVehicle }: ScanResultModalProps) {
  if (!result) return null

  const { plate_number, found, vehicle, certification, compliance } = result
  const formatVehicleLabel = (v: ScanResult['vehicle']) =>
    v ? [v.make, v.model, v.year ? `(${v.year})` : ''].filter(Boolean).join(' ') || null : null
  const vehicleLabel = formatVehicleLabel(vehicle)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            Scan Result
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Plate number */}
          <div className="text-center">
            <span className="text-3xl font-bold tracking-widest">{plate_number}</span>
            {!found && (
              <p className="text-sm text-gray-500 mt-1">Vehicle not found in database</p>
            )}
          </div>

          {/* Vehicle info */}
          {vehicleLabel && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-4 py-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Vehicle</span>
                <span className="font-medium">{vehicleLabel}</span>
              </div>
              {vehicle?.color && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Colour</span>
                  <span className="font-medium capitalize">{vehicle.color}</span>
                </div>
              )}
            </div>
          )}

          {/* Badges row */}
          <div className="flex flex-wrap gap-2">
            {certBadge(certification)}
            {complianceBadge(compliance)}
          </div>

          {/* Cert details */}
          {certification && (
            <div className="text-sm space-y-1">
              {certification.expiry_date && (
                <div className="flex justify-between text-gray-600">
                  <span>Certification expiry</span>
                  <span>{new Date(certification.expiry_date).toLocaleDateString('en-NZ')}</span>
                </div>
              )}
              {certification.max_occupants != null && (
                <div className="flex justify-between text-gray-600">
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />Max occupants</span>
                  <span>{certification.max_occupants}</span>
                </div>
              )}
            </div>
          )}

          {/* Compliance message */}
          {compliance?.message && (
            <p className="text-xs text-gray-500 italic">{compliance.message}</p>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:flex-row flex-col">
          {onCreateObservation && (
            <Button className="flex-1" onClick={onCreateObservation}>
              <PlusCircle className="h-4 w-4 mr-2" />
              Create Observation
            </Button>
          )}
          {onViewVehicle && (
            <Button variant="outline" className="flex-1" onClick={() => onViewVehicle(plate_number)}>
              <Eye className="h-4 w-4 mr-2" />
              View Vehicle
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
