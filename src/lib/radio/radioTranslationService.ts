/**
 * Radio Translation Service — Phase 3 edge-backed helper
 *
 * Provides an event bus for translated segments and a best-effort translator
 * that calls the translate-message edge function when direct pipeline output
 * is unavailable.
 */

import { edgeFunctions } from '@/lib/edgeFunctions'
import type { CaptionSegment } from '@/lib/radio/radioCaptionService'

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
  private _ready = true

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

  async translateCaption(
    caption: CaptionSegment,
    targetLanguage = this._targetLanguage,
  ): Promise<TranslationSegment | null> {
    const sourceText = String(caption.text || '').trim()
    const sourceLanguage = String(caption.language || '').trim() || undefined
    if (!sourceText) return null
    if (sourceLanguage && sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) return null

    try {
      const { data, error } = await edgeFunctions.translateMessage({
        text: sourceText,
        target_language: targetLanguage,
        source_language: sourceLanguage,
      })

      if (error || !data?.translated_text) {
        this._ready = false
        return null
      }

      this._ready = true
      const confidenceRaw = Number(data.translation_confidence)
      const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.65

      const segment: TranslationSegment = {
        transcriptSegmentId: `${caption.transmissionId}:${caption.sequenceNum}`,
        targetLanguage,
        text: String(data.translated_text),
        confidence,
        provider: String(data.provider || 'bob-translate'),
        isLowConfidence: confidence < 0.7,
      }

      this.emit(segment)
      return segment
    } catch {
      this._ready = false
      return null
    }
  }

  /** Returns true once at least one backend translation request has succeeded in-session. */
  isReady(): boolean {
    return this._ready
  }
}

export const radioTranslationService = new RadioTranslationService()
