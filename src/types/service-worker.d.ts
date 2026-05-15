export {}

declare global {
  interface Window {
    __WB_DISABLE_DEV_LOGS?: boolean
  }

  interface SyncManager {
    register(tag: string): Promise<void>
    getTags(): Promise<string[]>
  }

  interface ServiceWorkerRegistration {
    readonly sync: SyncManager
  }

  interface SyncEvent extends Event {
    readonly lastChance: boolean
    readonly tag: string
  }

  interface ServiceWorkerGlobalScopeEventMap {
    sync: SyncEvent
  }
}