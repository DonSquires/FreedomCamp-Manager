import { Monitor, Smartphone } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Session {
  id: string
  device_info?: string
  ip_address?: string
  created_at: string
  last_active_at?: string
  is_current?: boolean
}

interface SessionListProps {
  sessions: Session[]
  onTerminate?: (sessionId: string) => void
  onTerminateAll?: () => void
  loading?: boolean
}

function maskIp(ip?: string) {
  if (!ip) return '—'
  return ip.slice(0, 6) + '***'
}

function isMobile(deviceInfo?: string) {
  return deviceInfo?.toLowerCase().includes('mobile') ?? false
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })
}

export function SessionList({ sessions, onTerminate, onTerminateAll, loading }: SessionListProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Active Sessions</CardTitle>
        {sessions.length > 1 && onTerminateAll && (
          <Button size="sm" variant="destructive" onClick={onTerminateAll} disabled={loading}>
            Terminate All Other Sessions
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">No active sessions found.</p>
        )}
        {sessions.map(session => (
          <div key={session.id} className="flex items-start gap-3 rounded-lg border p-3">
            <div className="mt-0.5 shrink-0 text-gray-400">
              {isMobile(session.device_info)
                ? <Smartphone className="h-5 w-5" />
                : <Monitor className="h-5 w-5" />}
            </div>
            <div className="flex-1 min-w-0 text-sm space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{session.device_info ?? 'Unknown device'}</span>
                {session.is_current && (
                  <Badge className="bg-green-600 text-white text-xs shrink-0">Current Session</Badge>
                )}
              </div>
              <p className="text-gray-500">IP: {maskIp(session.ip_address)}</p>
              <p className="text-gray-400 text-xs">Created: {formatDate(session.created_at)}</p>
              {session.last_active_at && (
                <p className="text-gray-400 text-xs">Last active: {formatDate(session.last_active_at)}</p>
              )}
            </div>
            {!session.is_current && onTerminate && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onTerminate(session.id)}
                disabled={loading}
                className="shrink-0"
              >
                Terminate
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
