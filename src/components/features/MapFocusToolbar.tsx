import { Button } from '@/components/ui/button'
import { MapPin } from 'lucide-react'

// Usage pattern:
// const [focusKey, setFocusKey] = useState(0)
// <MapFocusToolbar onFocus={() => setFocusKey((k) => k + 1)} />
// <JurisdictionMapViewport organizationId={orgId} focusKey={focusKey} />

interface MapFocusToolbarProps {
  onFocus: () => void
  label?: string
  className?: string
}

export function MapFocusToolbar({
  onFocus,
  label = 'Focus Jurisdiction',
  className,
}: MapFocusToolbarProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onFocus}
      className={className}
    >
      <MapPin className="h-4 w-4 mr-2" />
      {label}
    </Button>
  )
}
