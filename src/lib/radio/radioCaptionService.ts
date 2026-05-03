/**
 * Radio Caption Service — Phase 2 stub
 *
 * Provides the interface for streaming STT captions from radio transmissions.
 * Implementation is filled in Phase 2 (Transcript rollout).
 * Until then, all methods are no-ops and captions remain empty.
 */

export interface CaptionSegment {
  /** Transmission this caption belongs to */
  transmissionId: string
  /** Sequence number within the transmission */
  sequenceNum: number
  /** Start offset in ms from transmission start */
  segmentStartMs: number
  /** End offset in ms from transmission start */
  segmentEndMs: number
  /** Recognised text */
  text: string
  /** BCP-47 language tag */
  language: string
  /** STT confidence 0–1 */
  confidence: number
  /** Whether this is the final segment (not a partial) */
  isFinal: boolean
}

export type CaptionHandler = (segment: CaptionSegment) => void

class RadioCaptionService {
  private handlers: Set<CaptionHandler> = new Set()

  /** Subscribe to incoming caption segments. Returns an unsubscribe function. */
  subscribe(handler: CaptionHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /**
   * Emit a caption segment to all subscribers.
   * Called by the SFU AI tap when Phase 2 is active.
   */
  emit(segment: CaptionSegment): void {
    for (const h of this.handlers) {
      try {
        h(segment)
      } catch {
        // subscriber errors must not crash the service
      }
    }
  }

  /** Returns true once the Phase 2 backend is wired. Always false until then. */
  isReady(): boolean {
    return false
  }
}

export const radioCaptionService = new RadioCaptionService()
