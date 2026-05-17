/**
 * PTT Transport Abstraction (C2)
 * Feature flag-based selection between P2P and SFU backends
 */

export interface PTTTransport {
  connect(): Promise<void>;
  requestFloor(): Promise<void>;
  startProducing(): Promise<void>;
  stopProducing(): Promise<void>;
  releaseFloor(): Promise<void>;
  disconnect(): Promise<void>;
  getFloorState(): any;
  isConnected(): boolean;
}

function flag(name: string): boolean {
  const raw = String((import.meta.env as Record<string, string | undefined>)[name] ?? '').toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

const SFU_ENABLED = flag('VITE_RADIO_SFU_ENABLED') || flag('VITE_FF_PHASE_0_SFU_ENABLED')

export async function createTransport(config: any): Promise<PTTTransport> {
  console.log(`[PTT Transport] Creating ${SFU_ENABLED ? 'SFU' : 'P2P'} transport`);
  
  if (SFU_ENABLED) {
    // SFU mode - import and create SFU transport
    const { createSFUTransport } = await import('./ptt-sfu-transport');
    return createSFUTransport(config);
  } else {
    // P2P mode - existing behavior from ppt.ts
    return {
      connect: () => Promise.resolve(),
      requestFloor: () => Promise.resolve(),
      startProducing: () => Promise.resolve(),
      stopProducing: () => Promise.resolve(),
      releaseFloor: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      getFloorState: () => null,
      isConnected: () => true,
    };
  }
}
