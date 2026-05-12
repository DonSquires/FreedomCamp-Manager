/**
 * ArmedDangerOverlay
 *
 * Renders a fixed, pointer-events-none viewport border that pulses in
 * Iron Eagle critical red (#EF5350) to signal an active Armed Danger or
 * Welfare man-down event.
 *
 * The pulse continues until `active` becomes false (supervisor acknowledges
 * or the officer dismisses via the onDismiss callback).
 *
 * Accessibility:
 *   - `aria-live="assertive"` announces the danger state to screen readers.
 *   - Respects `prefers-reduced-motion` via the `.danger-overlay` CSS class
 *     (animation removed; static border remains — see src/index.css).
 *
 * Usage:
 *   <ArmedDangerOverlay active={isArmedDanger} onDismiss={() => setSosActive(false)} label="Armed threat reported" />
 *
 * Place this as a direct child of the app root or portal-level layout so it
 * sits above all other content without affecting the layout flow.
 */

interface ArmedDangerOverlayProps {
  /** Whether the overlay is currently active */
  active: boolean
  /** Optional callback — called when the officer taps the dismiss button */
  onDismiss?: () => void
  /** Short human-readable description of the alert (used for aria-label) */
  label?: string
}

export function ArmedDangerOverlay({
  active,
  onDismiss,
  label = 'Armed Danger alert — await supervisor acknowledgement',
}: ArmedDangerOverlayProps) {
  if (!active) return null

  return (
    <>
      {/* Pulsing red viewport border */}
      <div
        role="alert"
        aria-live="assertive"
        aria-label={label}
        className="danger-overlay"
      />

      {/* Dismiss button — bottom-centre, pointer-events enabled */}
      {onDismiss && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] pointer-events-auto">
          <button
            type="button"
            onClick={onDismiss}
            className="flex items-center gap-2 rounded-full border-2 border-[#EF5350] bg-[#121212] px-4 py-2 text-xs font-bold text-white shadow-xl hover:bg-[#1E1E1E] active:scale-95 transition-transform"
            aria-label="Dismiss SOS alert"
          >
            ✕ Dismiss SOS alert
          </button>
        </div>
      )}
    </>
  )
}
