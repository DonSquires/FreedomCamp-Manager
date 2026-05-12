import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OfficerShell } from '@/components/features/OfficerShell'
import { Clock, LogOut } from 'lucide-react'

export default function WaitingForShiftPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  return (
    <OfficerShell
      title={user?.first_name ? `Hi, ${user.first_name}` : 'Waiting for Shift'}
      description="Roster gate active"
    >
      <main className="mx-auto flex w-full max-w-xl flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full border-blue-200 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/30">
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
              Once your shift is published/confirmed, this screen will unlock automatically.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => window.location.reload()}>
                Refresh Shift Status
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
