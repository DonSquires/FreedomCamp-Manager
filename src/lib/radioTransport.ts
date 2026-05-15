import { createTransport, type PTTTransport } from '@/lib/ptt-transport'

function enabled(name: string): boolean {
  const value = String((import.meta.env as Record<string, string | undefined>)[name] ?? '').toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export type RadioTransportConfig = {
  channelScope: string
  userId?: string
  orgId?: string
  metadata?: Record<string, unknown>
}

export type RadioTransportRuntime = {
  ptt: PTTTransport
  phase0: {
    sfuEnabled: boolean
    floorControlEnabled: boolean
    emergencyOverrideEnabled: boolean
  }
}

export function getPhase0RadioFlags() {
  return {
    sfuEnabled: enabled('VITE_FF_PHASE_0_SFU_ENABLED') || enabled('VITE_RADIO_SFU_ENABLED'),
    floorControlEnabled: enabled('VITE_FF_PHASE_0_FLOOR_CONTROL'),
    emergencyOverrideEnabled: enabled('VITE_FF_PHASE_0_EMERGENCY_OVERRIDE'),
  }
}

export async function createRadioTransport(config: RadioTransportConfig): Promise<RadioTransportRuntime> {
  const phase0 = getPhase0RadioFlags()

  const ptt = await createTransport({
    channelScope: config.channelScope,
    userId: config.userId,
    orgId: config.orgId,
    metadata: config.metadata,
  })

  return { ptt, phase0 }
}
