export interface PTTChannelAccessLike {
  channel_type: string
  channel_number: number
  scope_override?: string | null
}

export function canAccessPTTChannel(params: {
  channel: PTTChannelAccessLike
  effectiveOrgId: string | null
  userRole?: string | null
  allowedChannelScopes?: string[] | null
  getScope: (channel: PTTChannelAccessLike, effectiveOrgId: string) => string
}): boolean {
  const { channel, effectiveOrgId, userRole, allowedChannelScopes, getScope } = params

  if (!effectiveOrgId) return true
  if (userRole !== 'officer' && userRole !== 'admin_officer') return true

  const channelScope = getScope(channel, effectiveOrgId)
  if (channelScope === `org:${effectiveOrgId}`) {
    return true
  }

  return new Set(allowedChannelScopes ?? []).has(channelScope)
}