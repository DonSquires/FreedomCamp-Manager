import { describe, expect, it } from 'vitest'
import { canAccessPTTChannel, type PTTChannelAccessLike } from '@/lib/pttChannelAccess'

function getScope(channel: PTTChannelAccessLike, effectiveOrgId: string): string {
  if (channel.scope_override) return channel.scope_override
  if (channel.channel_type === 'primary' || channel.channel_number === 1) {
    return `org:${effectiveOrgId}`
  }
  return `deployment:${channel.channel_number}`
}

describe('canAccessPTTChannel', () => {
  it('always allows the default organization channel for restricted officers', () => {
    expect(
      canAccessPTTChannel({
        channel: { channel_type: 'primary', channel_number: 1 },
        effectiveOrgId: 'org-1',
        userRole: 'officer',
        allowedChannelScopes: [],
        getScope,
      }),
    ).toBe(true)
  })

  it('hides non-default channels that are not in ptt_channel_access', () => {
    expect(
      canAccessPTTChannel({
        channel: { channel_type: 'dispatch', channel_number: 2 },
        effectiveOrgId: 'org-1',
        userRole: 'officer',
        allowedChannelScopes: ['deployment:4'],
        getScope,
      }),
    ).toBe(false)
  })

  it('shows non-default channels that are explicitly allowed', () => {
    expect(
      canAccessPTTChannel({
        channel: { channel_type: 'dispatch', channel_number: 2 },
        effectiveOrgId: 'org-1',
        userRole: 'officer',
        allowedChannelScopes: ['deployment:2'],
        getScope,
      }),
    ).toBe(true)
  })

  it('does not restrict admin users', () => {
    expect(
      canAccessPTTChannel({
        channel: { channel_type: 'dispatch', channel_number: 2 },
        effectiveOrgId: 'org-1',
        userRole: 'admin',
        allowedChannelScopes: [],
        getScope,
      }),
    ).toBe(true)
  })
})