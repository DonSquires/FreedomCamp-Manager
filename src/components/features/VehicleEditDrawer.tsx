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
    vehicle_id: string
    plate_number: string
    vehicle_make?: string
    vehicle_model?: string
    vehicle_year?: number | null
    vehicle_color?: string
    self_contained?: boolean
    notes?: string
  }
  onSave: (updates: Partial<VehicleEditDrawerProps['vehicle']>) => Promise<void>
}

export function VehicleEditDrawer({ open, onClose, vehicle, onSave }: VehicleEditDrawerProps) {
  const [form, setForm] = useState({
    vehicle_make: vehicle.vehicle_make ?? '',
    vehicle_model: vehicle.vehicle_model ?? '',
    // Form state is always strings (HTML inputs). Convert integer year to string for the field.
    vehicle_year: vehicle.vehicle_year != null ? String(vehicle.vehicle_year) : '',
    vehicle_color: vehicle.vehicle_color ?? '',
    notes: vehicle.notes ?? '',
    self_contained: vehicle.self_contained ?? false,
  })
  const [saving, setSaving] = useState(false)

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updates: Partial<VehicleEditDrawerProps['vehicle']> = {}
      if (form.vehicle_make !== (vehicle.vehicle_make ?? '')) updates.vehicle_make = form.vehicle_make || undefined
      if (form.vehicle_model !== (vehicle.vehicle_model ?? '')) updates.vehicle_model = form.vehicle_model || undefined
      if (form.vehicle_color !== (vehicle.vehicle_color ?? '')) updates.vehicle_color = form.vehicle_color || undefined
      if (form.notes !== (vehicle.notes ?? '')) updates.notes = form.notes || undefined
      if (form.self_contained !== (vehicle.self_contained ?? false))
        updates.self_contained = form.self_contained
      // Compare against string representation of stored integer; convert back to integer on save.
      const storedYear = vehicle.vehicle_year != null ? String(vehicle.vehicle_year) : ''
      if (form.vehicle_year !== storedYear) {
        updates.vehicle_year = form.vehicle_year ? (parseInt(form.vehicle_year, 10) || undefined) : null
      }

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
              <Label htmlFor="vehicle_make">Make</Label>
              <Input
                id="vehicle_make"
                value={form.vehicle_make}
                onChange={(e) => handleChange('vehicle_make', e.target.value)}
                placeholder="e.g. Toyota"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle_model">Model</Label>
              <Input
                id="vehicle_model"
                value={form.vehicle_model}
                onChange={(e) => handleChange('vehicle_model', e.target.value)}
                placeholder="e.g. HiAce"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="vehicle_year">Year</Label>
              <Input
                id="vehicle_year"
                value={form.vehicle_year}
                onChange={(e) => handleChange('vehicle_year', e.target.value)}
                placeholder="e.g. 2018"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle_color">Colour</Label>
              <Input
                id="vehicle_color"
                value={form.vehicle_color}
                onChange={(e) => handleChange('vehicle_color', e.target.value)}
                placeholder="e.g. White"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="self-contained" className="cursor-pointer">
              Self-Contained
            </Label>
            <Switch
              id="self-contained"
              checked={form.self_contained}
              onCheckedChange={(v) => handleChange('self_contained', v)}
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
