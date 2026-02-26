import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export function KeepScreenAwake() {
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null)
  const [isSupported, setIsSupported] = useState(false)

  useEffect(() => {
    // Check if Wake Lock API is supported
    setIsSupported('wakeLock' in navigator)
  }, [])

  const requestWakeLock = async () => {
    if (!('wakeLock' in navigator)) {
      toast.error('Screen wake lock not supported on this device')
      return
    }

    try {
      const lock = await navigator.wakeLock.request('screen')
      setWakeLock(lock)
      toast.success('Screen will stay awake during patrol')

      lock.addEventListener('release', () => {
        console.log('Wake lock released')
        setWakeLock(null)
      })
    } catch (err: any) {
      toast.error(`Failed to keep screen awake: ${err.message}`)
    }
  }

  const releaseWakeLock = async () => {
    if (wakeLock) {
      try {
        await wakeLock.release()
        setWakeLock(null)
        toast.info('Screen can now sleep normally')
      } catch (err: any) {
        toast.error(`Failed to release wake lock: ${err.message}`)
      }
    }
  }

  // Auto-release on unmount
  useEffect(() => {
    return () => {
      if (wakeLock) {
        wakeLock.release()
      }
    }
  }, [wakeLock])

  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (wakeLock !== null && document.visibilityState === 'visible') {
        requestWakeLock()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [wakeLock])

  if (!isSupported) return null

  return (
    <Button
      variant={wakeLock ? 'default' : 'outline'}
      size="sm"
      onClick={wakeLock ? releaseWakeLock : requestWakeLock}
      className="fixed bottom-4 right-4 z-40"
    >
      {wakeLock ? (
        <>
          <Eye className="h-4 w-4 mr-2" />
          Screen Awake
        </>
      ) : (
        <>
          <EyeOff className="h-4 w-4 mr-2" />
          Keep Awake
        </>
      )}
    </Button>
  )
}
