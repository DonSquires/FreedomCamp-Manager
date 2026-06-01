import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { User, MapPin, Clock, Car, AlertTriangle, CheckSquare, XCircle, Zap } from 'lucide-react'
import { SPECIALTY_TYPE_META, getSpecialtyPortalPath, type SpecialtyType } from '@/lib/officerPortalRouting'

interface PatrolCardProps {
  patrol: {
    id: string
    officer_name: string
    officer_id: string
    zone_name?: string
    status: 'active' | 'paused' | 'completed' | 'abandoned' | 'scheduled'
    started_at: string
    ended_at?: string
    vehicle_count?: number
    breach_count?: number
    checkpoint_visits?: number
    specialty_type?: string | null
    scheduled_start_time?: string | null
  }
  onViewDetails?: (patrolId: string) => void
  onEndPatrol?: (patrolId: string) => void
  onStartPatrol?: (patrolId: string) => void
  compact?: boolean
}

const statusStyles: Record<string, string> = {
  active: 'bg-green-50 text-green-700 border-green-200',
  paused: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  completed: 'bg-gray-50 text-gray-700 border-gray-200',
  abandoned: 'bg-red-50 text-red-700 border-red-200',
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
}

function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  const diffMs = Math.max(0, end - start)
  const hours = Math.floor(diffMs / 3600000)
  const minutes = Math.floor((diffMs % 3600000) / 60000)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function PatrolCard({ patrol, onViewDetails, onEndPatrol, onStartPatrol, compact = false }: PatrolCardProps) {
  const navigate = useNavigate()
  const specialtyMeta = patrol.specialty_type
    ? SPECIALTY_TYPE_META[patrol.specialty_type as SpecialtyType]
    : null

  function handleStart() {
    const path = getSpecialtyPortalPath(patrol.specialty_type)
    if (path) {
      navigate(`${path}&patrol=${patrol.id}`)
    } else if (onStartPatrol) {
      onStartPatrol(patrol.id)
    }
  }

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <User className="h-4 w-4 shrink-0" />
              <span className="truncate">{patrol.officer_name}</span>
            </CardTitle>
            {patrol.zone_name && (
              <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                <MapPin className="h-3 w-3 shrink-0" />
                {patrol.zone_name}
              </p>
            )}
            {specialtyMeta && (
              <Badge
                variant="outline"
                className={`mt-1 text-xs ${specialtyMeta.color}`}
              >
                <Zap className="h-3 w-3 mr-1" />
                {specialtyMeta.label}
              </Badge>
            )}
          </div>
          <Badge variant="outline" className={`shrink-0 ml-2 ${statusStyles[patrol.status] ?? ''}`}>
            {patrol.status.charAt(0).toUpperCase() + patrol.status.slice(1)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Clock className="h-3 w-3" />
          <span>Started {new Date(patrol.started_at).toLocaleTimeString()}</span>
          <span className="text-gray-400">·</span>
          <span>{formatDuration(patrol.started_at, patrol.ended_at)}</span>
        </div>

        {!compact && (
          <div className="grid grid-cols-3 gap-2 pt-2 border-t text-center text-sm">
            <div>
              <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                <Car className="h-3 w-3" /> Vehicles
              </div>
              <span className="font-semibold">{patrol.vehicle_count ?? 0}</span>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                <AlertTriangle className="h-3 w-3" /> Breaches
              </div>
              <span className={`font-semibold ${(patrol.breach_count ?? 0) > 0 ? 'text-red-600' : ''}`}>
                {patrol.breach_count ?? 0}
              </span>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1 text-gray-500 text-xs mb-1">
                <CheckSquare className="h-3 w-3" /> Checkpoints
              </div>
              <span className="font-semibold">{patrol.checkpoint_visits ?? 0}</span>
            </div>
          </div>
        )}

        {(onViewDetails || onEndPatrol || onStartPatrol || patrol.specialty_type) && (
          <div className="flex gap-2 pt-1">
            {patrol.status === 'scheduled' && (
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                onClick={handleStart}
              >
                <Zap className="h-4 w-4 mr-1" />
                {specialtyMeta ? `Start ${specialtyMeta.label}` : 'Start Patrol'}
              </Button>
            )}
            {patrol.status === 'active' && specialtyMeta && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => navigate(`${specialtyMeta.portalPath}&patrol=${patrol.id}`)}
              >
                <Zap className="h-4 w-4 mr-1" />
                Open {specialtyMeta.label}
              </Button>
            )}
            {onViewDetails && (
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onViewDetails(patrol.id)}>
                View Details
              </Button>
            )}
            {onEndPatrol && patrol.status === 'active' && (
              <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => onEndPatrol(patrol.id)}>
                <XCircle className="h-4 w-4 mr-1" />
                End
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

