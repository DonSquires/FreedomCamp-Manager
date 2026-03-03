import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PWAUpdateNotificationProps {
  updateAvailable: boolean
  onUpdate?: () => void
  onDismiss?: () => void
}

export function PWAUpdateNotification({ updateAvailable, onUpdate, onDismiss }: PWAUpdateNotificationProps) {
  if (!updateAvailable) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white px-4 py-2 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-3">
        <RefreshCw className="h-4 w-4 shrink-0" />
        <div>
          <span className="font-semibold">Update Available</span>
          <span className="ml-2 text-blue-100 text-sm">A new version is ready.</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="bg-white text-blue-600 hover:bg-blue-50"
          onClick={onUpdate}
        >
          Update Now
        </Button>
        {onDismiss && (
          <Button size="sm" variant="ghost" className="text-white hover:bg-blue-700" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
