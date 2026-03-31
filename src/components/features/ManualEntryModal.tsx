import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Car } from 'lucide-react'

export interface ManualObservationData {
  plate_number: string
  zone_id?: string
  vehicle_make?: string
  vehicle_model?: string
  vehicle_color?: string
  is_self_contained?: boolean
  notes?: string
  has_sticker?: boolean
  recorded_at?: string
}

interface ManualEntryModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: ManualObservationData) => Promise<void>
  zoneId?: string
  defaultLocation?: { lat: number; lng: number }
}

function nowLocalDatetime() {
  const d = new Date()
  // Format as YYYY-MM-DDTHH:MM for datetime-local input
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ManualEntryModal({
  open,
  onClose,
  onSubmit,
  zoneId,
}: ManualEntryModalProps) {
  const [plateNumber, setPlateNumber] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [colour, setColour] = useState('')
  const [isSelfContained, setIsSelfContained] = useState(false)
  const [hasSticker, setHasSticker] = useState(false)
  const [notes, setNotes] = useState('')
  const [recordedAt, setRecordedAt] = useState(nowLocalDatetime)
  const [loading, setLoading] = useState(false)
  const [plateError, setPlateError] = useState('')

  const reset = () => {
    setPlateNumber('')
    setMake('')
    setModel('')
    setColour('')
    setIsSelfContained(false)
    setHasSticker(false)
    setNotes('')
    setRecordedAt(nowLocalDatetime())
    setPlateError('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!plateNumber.trim()) {
      setPlateError('Plate number is required')
      return
    }
    setPlateError('')
    setLoading(true)
    try {
      await onSubmit({
        plate_number: plateNumber.trim(),
        zone_id: zoneId,
        vehicle_make: make.trim() || undefined,
        vehicle_model: model.trim() || undefined,
        vehicle_color: colour.trim() || undefined,
        is_self_contained: isSelfContained,
        has_sticker: hasSticker,
        notes: notes.trim() || undefined,
        recorded_at: recordedAt ? new Date(recordedAt).toISOString() : undefined,
      })
      reset()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            Manual Vehicle Observation
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Plate number */}
          <div className="space-y-1">
            <Label htmlFor="me-plate">Plate Number <span className="text-red-500">*</span></Label>
            <Input
              id="me-plate"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
              placeholder="e.g. ABC123"
              autoFocus
            />
            {plateError && <p className="text-xs text-red-500">{plateError}</p>}
          </div>

          {/* Make / Model / Colour */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="me-make">Make</Label>
              <Input id="me-make" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Toyota" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-model">Model</Label>
              <Input id="me-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="HiAce" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-colour">Colour</Label>
              <Input id="me-colour" value={colour} onChange={(e) => setColour(e.target.value)} placeholder="White" />
            </div>
          </div>

          {/* Checkboxes */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={isSelfContained}
                onChange={(e) => setIsSelfContained(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Self-contained
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={hasSticker}
                onChange={(e) => setHasSticker(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Has sticker
            </label>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label htmlFor="me-notes">Notes</Label>
            <Textarea
              id="me-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional observations"
              rows={3}
            />
          </div>

          {/* Recorded at */}
          <div className="space-y-1">
            <Label htmlFor="me-recorded-at">Recorded At</Label>
            <Input
              id="me-recorded-at"
              type="datetime-local"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : 'Submit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
