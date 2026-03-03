/**
 * EnforcementTimeline Component
 * Enforcement action history with visual timeline
 */

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { 
  History,
  FileText,
  Calendar,
  User,
  CheckCircle2,
  Clock,
  XCircle,
  ExternalLink,
} from 'lucide-react'
import type { Database } from '@/types/database'

// Type alias for enforcement action rows (not in generated Database types)
type EnforcementActionRow = {
  id: string
  plate_number: string | null
  action_type: string
  status: string
  notes: string | null
  action_notes: string | null
  zone_id: string | null
  recorded_by: string | null
  recorded_at: string | null
  assigned_to: string | null
  breach_status: string | null
  completion_outcome: string | null
  completion_notes: string | null
  delivery_method: string | null
  delivered_at: string | null
  created_at: string
  updated_at: string
}
type ZoneRow = Database['public']['Tables']['zones']['Row']
type UserProfileRow = Database['public']['Tables']['user_profiles']['Row']

// Extended type for enforcement action with joined relations
type EnforcementActionWithRelations = EnforcementActionRow & {
  zones: Pick<ZoneRow, 'name'> | null
  user_profiles: Pick<UserProfileRow, 'first_name' | 'last_name'> | null
}

interface EnforcementTimelineProps {
  plateNumber: string
  limit?: number
  onViewDetails?: (actionId: string) => void
}

export function EnforcementTimeline({
  plateNumber,
  limit = 20,
  onViewDetails,
}: EnforcementTimelineProps) {
  // Fetch enforcement actions
  const { data: actions, isLoading } = useQuery({
    queryKey: ['enforcement-timeline', plateNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enforcement_actions')
        .select(`
          *,
          zones!enforcement_actions_zone_id_fkey (
            name
          ),
          user_profiles!enforcement_actions_user_id_fkey (
            first_name,
            last_name
          )
        `)
        .eq('plate_number', plateNumber)
        .order('recorded_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return (data || []) as EnforcementActionWithRelations[]
    },
  })

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-600" />
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />
      default:
        return <Clock className="h-5 w-5 text-gray-600" />
    }
  }

  const getActionTypeLabel = (type: string) => {
    switch (type) {
      case 'warning':
        return 'Warning Notice'
      case 'notice_to_vacate':
        return 'Notice to Vacate'
      case 'tow_request':
        return 'Tow Request'
      case 'referral':
        return 'Escalation'
      default:
        return type
    }
  }

  const getActionTypeBadge = (type: string) => {
    switch (type) {
      case 'warning':
        return <Badge className="bg-yellow-600">Warning</Badge>
      case 'notice_to_vacate':
        return <Badge className="bg-orange-600">Notice</Badge>
      case 'tow_request':
        return <Badge variant="destructive">Tow</Badge>
      case 'referral':
        return <Badge className="bg-purple-600">Escalation</Badge>
      default:
        return <Badge variant="outline">{type}</Badge>
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Enforcement History
        </CardTitle>
        <CardDescription>
          Complete timeline of all enforcement actions for {plateNumber}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading enforcement history...
          </div>
        ) : actions && actions.length > 0 ? (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />

            {/* Timeline items */}
            <div className="space-y-6">
              {actions.map((action) => (
                <div key={action.id} className="relative flex gap-4">
                  {/* Timeline dot */}
                  <div className="relative flex-shrink-0 w-12 flex justify-center">
                    <div className="absolute top-2">
                      {getStatusIcon(action.status)}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-6">
                    <Card>
                      <CardContent className="pt-4">
                        {/* Header */}
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium">
                                {getActionTypeLabel(action.action_type)}
                              </span>
                              {getActionTypeBadge(action.action_type)}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span>{new Date(action.recorded_at).toLocaleString()}</span>
                            </div>
                          </div>
                          {onViewDetails && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onViewDetails(action.id)}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          )}
                        </div>

                        {/* Details */}
                        <div className="space-y-2 text-sm">
                          {/* Zone */}
                          {action.zones?.name && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Zone:</span>
                              <span>{action.zones.name}</span>
                            </div>
                          )}

                          {/* Officer */}
                          {action.user_profiles?.first_name && (
                            <div className="flex items-center gap-2">
                              <User className="h-3 w-3 text-muted-foreground" />
                              <span className="text-muted-foreground">Officer:</span>
                              <span>
                                {action.user_profiles.first_name}{' '}
                                {action.user_profiles.last_name}
                              </span>
                            </div>
                          )}

                          {/* Status */}
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">Status:</span>
                            <Badge variant="outline">{action.status}</Badge>
                          </div>

                          {/* Delivery info */}
                          {action.delivery_method && (
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Delivery:</span>
                              <span>{action.delivery_method}</span>
                              {action.delivered_at && (
                                <span className="text-muted-foreground">
                                  on {new Date(action.delivered_at).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Notes */}
                          {action.notes && (
                            <div className="p-2 bg-muted rounded text-xs mt-2">
                              {action.notes}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-2 opacity-20" />
            <p>No enforcement actions recorded</p>
          </div>
        )}

        {/* Count */}
        {actions && actions.length > 0 && (
          <div className="mt-4 text-sm text-center text-muted-foreground border-t pt-4">
            Showing {actions.length} enforcement actions
            {actions.length >= limit && ' (limited to most recent)'}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
