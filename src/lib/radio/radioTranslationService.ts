/**
 * Radio Translation Service — Phase 3 stub
 *
 * Provides the interface for translating caption segments in real-time.
 * Implementation is filled in Phase 3 (Translation rollout).
 * Until then, all methods are no-ops.
 */

export interface TranslationSegment {
  /** The source caption segment id this belongs to */
  transcriptSegmentId: string
  /** Target BCP-47 language tag */
  targetLanguage: string
  /** Translated text */
  text: string
  /** Translation confidence 0–1 */
  confidence: number
  /** Translation provider identifier */
  provider: string
  /** Whether the translation confidence is below the low-confidence threshold */
  isLowConfidence: boolean
}

export type TranslationHandler = (segment: TranslationSegment) => void

class RadioTranslationService {
  private handlers: Set<TranslationHandler> = new Set()
  private _targetLanguage = 'en-NZ'

  get targetLanguage(): string {
    return this._targetLanguage
  }

  /** Set the active target language for all future translations. */
  setTargetLanguage(lang: string): void {
    this._targetLanguage = lang
  }

  /** Subscribe to incoming translated segments. Returns an unsubscribe function. */
  subscribe(handler: TranslationHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /**
   * Emit a translated segment to all subscribers.
   * Called by the backend translation pipeline when Phase 3 is active.
   */
  emit(segment: TranslationSegment): void {
    for (const h of this.handlers) {
      try {
        h(segment)
      } catch {
        // subscriber errors must not crash the service
      }
    }
  }

  /** Returns true once the Phase 3 backend is wired. Always false until then. */
  isReady(): boolean {
    return false
  }
}

export const radioTranslationService = new RadioTranslationService()
