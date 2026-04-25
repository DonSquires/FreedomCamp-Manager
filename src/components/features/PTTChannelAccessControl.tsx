/**
 * PTT Channel Access Control — Officer ACL Management
 *
 * Component for admins to configure which PTT channels each officer can access.
 * Embedded in admin UI for officer profile / permissions management.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, Loader2, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

interface Channel {
  id: string
  name: string
  channel_number?: number | null
  channel_type: string
  description?: string
  organization_id: string
  scope_override?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getChannelScopeValue(channel: Channel, organizationId: string): string {
  if (channel.scope_override) {
    return channel.scope_override
  }

  if (channel.channel_type === 'primary' || channel.channel_number === 1) {
    return `org:${organizationId}`
  }

  if (UUID_RE.test(channel.id)) {
    return `deployment:${channel.id}`
  }

  return `org:${organizationId}`
}

interface PTTChannelAccessControlProps {
  userId: string
  organizationId: string
  currentChannelAccess?: string[] | null
  onSave?: (channelAccess: string[]) => Promise<void>
  disabled?: boolean
}

export function PTTChannelAccessControl({
  userId,
  organizationId,
  currentChannelAccess,
  onSave,
  disabled = false,
}: PTTChannelAccessControlProps) {
  const [selectedChannels, setSelectedChannels] = useState<string[]>(currentChannelAccess || [])
  const [isSaving, setIsSaving] = useState(false)

  // Fetch channels for this org
  const { data: channels = [], isLoading: channelsLoading } = useQuery({
    queryKey: ['ptt-channels-admin', organizationId],
    queryFn: async () => {
      if (!organizationId) return []

      const { data, error } = await (supabase as any)
        .from('ptt_channels')
        .select('id, name, channel_number, channel_type, description, organization_id, scope_override')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true })

      if (error) {
        console.error('Error fetching channels:', error)
        return []
      }

      return (data || []) as Channel[]
    },
    enabled: !!organizationId,
  })

  // Update selectedChannels when currentChannelAccess changes
  useEffect(() => {
    if (currentChannelAccess !== undefined) {
      setSelectedChannels(currentChannelAccess || [])
    }
  }, [currentChannelAccess])

  const handleChannelToggle = (channelScope: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channelScope)
        ? prev.filter((scope) => scope !== channelScope)
        : [...prev, channelScope]
    )
  }

  const handleSave = async () => {
    if (!onSave) return

    setIsSaving(true)
    try {
      await onSave(selectedChannels)
      toast.success('Channel access updated')
    } catch (error: any) {
      console.error('Error saving channel access:', error)
      toast.error('Failed to save channel access')
    } finally {
      setIsSaving(false)
    }
  }

  const channelsByType = useMemo(() => {
    const grouped: Record<string, Channel[]> = {}
    channels.forEach((ch) => {
      if (!grouped[ch.channel_type]) {
        grouped[ch.channel_type] = []
      }
      grouped[ch.channel_type].push(ch)
    })
    return grouped
  }, [channels])

  const typeLabels: Record<string, string> = {
    org: 'Organization',
    team: 'Team',
    incident: 'Incident',
    direct: 'Direct',
    deployment: 'Deployment',
    emergency: 'Emergency',
    cross_org: 'Cross-Organization',
  }

  const hasChanges = JSON.stringify(selectedChannels.sort()) !== JSON.stringify((currentChannelAccess || []).sort())

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">PTT Channel Access</CardTitle>
        <CardDescription>
          Select which PTT channels this officer can access. If none selected, officer can only access the default organization channel.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {channelsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
          </div>
        ) : channels.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
            <AlertCircle className="h-4 w-4" />
            No channels available for this organization
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(channelsByType)
              .sort(([typeA], [typeB]) => {
                const orderMap: Record<string, number> = { org: 0, team: 1, incident: 2, deployment: 3, direct: 4, emergency: 5, cross_org: 6 }
                return (orderMap[typeA] ?? 99) - (orderMap[typeB] ?? 99)
              })
              .map(([type, typeChannels]) => (
                <div key={type} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-700">{typeLabels[type]}</h3>
                    <Badge variant="secondary" className="text-xs">
                      {typeChannels.length}
                    </Badge>
                  </div>

                  <div className="space-y-2 pl-4 border-l border-gray-200">
                    {typeChannels.map((channel) => (
                      <div key={channel.id} className="flex items-start gap-3">
                        {(() => {
                          const channelScope = getChannelScopeValue(channel, organizationId)
                          const isDefaultOrgScope = channelScope === `org:${organizationId}`
                          return (
                            <>
                        <Checkbox
                          id={`channel-${channel.id}`}
                          checked={isDefaultOrgScope || selectedChannels.includes(channelScope)}
                          onCheckedChange={() => handleChannelToggle(channelScope)}
                          disabled={isDefaultOrgScope || disabled || isSaving}
                          className="mt-1"
                        />
                        <label
                          htmlFor={`channel-${channel.id}`}
                          className="flex flex-col gap-1 cursor-pointer flex-1"
                        >
                          <span className="text-sm font-medium text-gray-900">{channel.name}</span>
                          {channel.description && (
                            <span className="text-xs text-gray-500">{channel.description}</span>
                          )}
                          <span className="text-[11px] text-gray-400">{channelScope}</span>
                        </label>
                        {isDefaultOrgScope && (
                          <Badge variant="outline" className="text-[10px]">
                            Default
                          </Badge>
                        )}
                            </>
                          )
                        })()}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Save button */}
        {onSave && (
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-gray-500">
              {selectedChannels.length > 0
                ? `${selectedChannels.length} channel${selectedChannels.length !== 1 ? 's' : ''} selected`
                : 'No channels selected (default org access only)'}
            </div>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || disabled || isSaving || channelsLoading}
              size="sm"
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isSaving ? 'Saving...' : 'Save Access Rules'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
