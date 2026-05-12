/**
 * ArmedDangerOverlay
 *
 * Renders a fixed, pointer-events-none viewport border that pulses in
 * Iron Eagle critical red (#EF5350) to signal an active Armed Danger or
 * Welfare man-down event.
 *
 * The pulse continues until `active` becomes false (supervisor acknowledges).
 *
 * Accessibility:
 *   - `aria-live="assertive"` announces the danger state to screen readers.
 *   - Respects `prefers-reduced-motion` via the `.danger-overlay` CSS class
 *     (animation removed; static border remains — see src/index.css).
 *
 * Usage:
 *   <ArmedDangerOverlay active={isArmedDanger} label="Armed threat reported" />
 *
 * Place this as a direct child of the app root or portal-level layout so it
 * sits above all other content without affecting the layout flow.
 */

interface ArmedDangerOverlayProps {
  /** Whether the overlay is currently active */
  active: boolean
  /** Short human-readable description of the alert (used for aria-label) */
  label?: string
}

export function ArmedDangerOverlay({
  active,
  label = 'Armed Danger alert — await supervisor acknowledgement',
}: ArmedDangerOverlayProps) {
  if (!active) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-label={label}
      className="danger-overlay"
    />
  )
}
