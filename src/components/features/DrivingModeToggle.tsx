import { Car } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

interface DrivingModeToggleProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  className?: string
}

export function DrivingModeToggle({ enabled, onToggle, className }: DrivingModeToggleProps) {
  return (
    <Card className={className}>
      <CardContent className="flex items-center gap-4 py-4">
        <Car className="h-5 w-5 text-gray-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">Driving Mode</span>
            {enabled && <Badge className="bg-blue-600 text-white text-xs">Active</Badge>}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">Larger buttons for in-vehicle use</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </CardContent>
    </Card>
  )
}
