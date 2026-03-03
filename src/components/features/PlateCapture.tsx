import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ScanLine, X } from 'lucide-react'
import { toast } from 'sonner'

interface PlateCaptureProps {
  onCapture: (plate: string) => void
  onCancel?: () => void
  loading?: boolean
}

export function PlateCapture({ onCapture, onCancel, loading = false }: PlateCaptureProps) {
  const [plate, setPlate] = useState('')
  const [error, setError] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    setPlate(value)
    if (error) setError('')
  }

  const handleSubmit = () => {
    const trimmed = plate.trim()
    if (!/^[A-Z0-9]{2,8}$/.test(trimmed)) {
      const msg = 'Plate must be 2–8 alphanumeric characters'
      setError(msg)
      toast.error(msg)
      return
    }
    onCapture(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit()
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Input
          value={plate}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="e.g. ABC123 (NZ plate)"
          maxLength={8}
          disabled={loading}
          className={error ? 'border-red-500 focus-visible:ring-red-500' : ''}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={handleSubmit}
          disabled={loading || plate.length < 2}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Capturing…
            </>
          ) : (
            <>
              <ScanLine className="h-4 w-4 mr-2" />
              Capture
            </>
          )}
        </Button>

        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
