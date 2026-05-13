import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useRosteredShift } from '@/hooks/useRosteredShift'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OfficerShell } from '@/components/features/OfficerShell'
import { Clock, LogOut, RefreshCw } from 'lucide-react'

const POLL_INTERVAL_MS = 30_000

export default function WaitingForShiftPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, logout } = useAuthStore()
  const { rosteredShift } = useRosteredShift()

  // Auto-redirect when a shift becomes available
  useEffect(() => {
    if (rosteredShift) {
      navigate('/field-officer', { replace: true })
    }
  }, [rosteredShift, navigate])

  // Poll every 30 s so the page unlocks without a manual refresh
  useEffect(() => {
    const timer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['rostered_shift_today'] })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [queryClient])

  return (
    <OfficerShell
      title={user?.first_name ? `Hi, ${user.first_name}` : 'Waiting for Shift'}
      description="Roster gate active"
    >
      <main className="mx-auto flex w-full max-w-xl flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full border-blue-200 bg-blue-50/70 dark:border-blue-800 dark:bg-[#1E1E1E]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
              <Clock className="h-5 w-5" />
              Waiting for Shift
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Access is locked until an active roster shift is available for your account.
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              This screen checks automatically every 30 seconds and will unlock once your shift is published or confirmed.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['rostered_shift_today'] })}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Check Now
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await logout()
                  navigate('/login', { replace: true })
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </OfficerShell>
  )
}
