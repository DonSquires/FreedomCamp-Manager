type RadioMessageListener = (payload: unknown) => void

type RadioEventHandlers = {
  onOpen?: () => void
  onError?: (error: Event) => void
  onClose?: () => void
}

class RadioManager {
  private static instance: RadioManager
  private ws: WebSocket | null = null
  private connectedUrl: string | null = null
  private listeners = new Set<RadioMessageListener>()

  private constructor() {}

  public static getInstance(): RadioManager {
    if (!RadioManager.instance) {
      RadioManager.instance = new RadioManager()
    }
    return RadioManager.instance
  }

  public connect(url: string, handlers?: RadioEventHandlers): void {
    if (!url) return

    const isSameUrl = this.connectedUrl === url
    const isOpen = this.ws?.readyState === WebSocket.OPEN
    const isConnecting = this.ws?.readyState === WebSocket.CONNECTING

    if (isSameUrl && (isOpen || isConnecting)) {
      return
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.connectedUrl = url
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      handlers?.onOpen?.()
    }

    this.ws.onerror = (event) => {
      handlers?.onError?.(event)
    }

    this.ws.onclose = () => {
      handlers?.onClose?.()
    }

    this.ws.onmessage = (msg: MessageEvent) => {
      let payload: unknown = msg.data
      try {
        payload = JSON.parse(msg.data)
      } catch {
        // Keep raw message payload when not JSON.
      }

      for (const listener of this.listeners) {
        listener(payload)
      }
    }
  }

  public subscribe(listener: RadioMessageListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    this.ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connectedUrl = null
  }

  public getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED
  }
}

const radioSingletonKey = '__fieldOpsRadioManagerSingleton__'

type GlobalScopeWithRadioSingleton = typeof globalThis & {
  [radioSingletonKey]?: RadioManager
}

const globalScope = globalThis as GlobalScopeWithRadioSingleton

if (!globalScope[radioSingletonKey]) {
  globalScope[radioSingletonKey] = RadioManager.getInstance()
}

export const radioManager = globalScope[radioSingletonKey] as RadioManager
