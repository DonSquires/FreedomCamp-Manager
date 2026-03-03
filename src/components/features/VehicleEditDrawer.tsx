import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

interface VehicleEditDrawerProps {
  open: boolean
  onClose: () => void
  vehicle: {
    id: string
    plate_number: string
    make?: string
    model?: string
    year?: number
    colour?: string
    vin?: string
    is_self_contained?: boolean
    notes?: string
  }
  onSave: (updates: Partial<VehicleEditDrawerProps['vehicle']>) => Promise<void>
}

export function VehicleEditDrawer({ open, onClose, vehicle, onSave }: VehicleEditDrawerProps) {
  const [form, setForm] = useState({
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    year: vehicle.year ?? '',
    colour: vehicle.colour ?? '',
    vin: vehicle.vin ?? '',
    notes: vehicle.notes ?? '',
    is_self_contained: vehicle.is_self_contained ?? false,
  })
  const [saving, setSaving] = useState(false)

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updates: Partial<VehicleEditDrawerProps['vehicle']> = {}
      if (form.make !== (vehicle.make ?? '')) updates.make = form.make || undefined
      if (form.model !== (vehicle.model ?? '')) updates.model = form.model || undefined
      if (form.colour !== (vehicle.colour ?? '')) updates.colour = form.colour || undefined
      if (form.vin !== (vehicle.vin ?? '')) updates.vin = form.vin || undefined
      if (form.notes !== (vehicle.notes ?? '')) updates.notes = form.notes || undefined
      if (form.is_self_contained !== (vehicle.is_self_contained ?? false))
        updates.is_self_contained = form.is_self_contained
      const yearNum = form.year !== '' ? Number(form.year) : undefined
      if (yearNum !== vehicle.year) updates.year = yearNum

      await onSave(updates)
      toast.success('Vehicle updated')
      onClose()
    } catch {
      toast.error('Failed to update')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Vehicle – {vehicle.plate_number}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="make">Make</Label>
              <Input
                id="make"
                value={form.make}
                onChange={(e) => handleChange('make', e.target.value)}
                placeholder="e.g. Toyota"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={form.model}
                onChange={(e) => handleChange('model', e.target.value)}
                placeholder="e.g. HiAce"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                type="number"
                value={form.year}
                onChange={(e) => handleChange('year', e.target.value)}
                placeholder="e.g. 2018"
                min={1900}
                max={new Date().getFullYear() + 1}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="colour">Colour</Label>
              <Input
                id="colour"
                value={form.colour}
                onChange={(e) => handleChange('colour', e.target.value)}
                placeholder="e.g. White"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vin">VIN</Label>
            <Input
              id="vin"
              value={form.vin}
              onChange={(e) => handleChange('vin', e.target.value)}
              placeholder="Vehicle Identification Number"
              className="font-mono"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="self-contained" className="cursor-pointer">
              Self-Contained
            </Label>
            <Switch
              id="self-contained"
              checked={form.is_self_contained}
              onCheckedChange={(v) => handleChange('is_self_contained', v)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Any additional notes..."
              rows={4}
            />
          </div>
        </div>

        <SheetFooter className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
