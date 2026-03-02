/**
 * sounds.ts — Audio feedback helpers.
 *
 * Provides lightweight Web Audio API beeps for UI events (scan success, scan
 * failure, alert, notification) so the app can give audible feedback without
 * shipping audio files.
 */

function beep(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.3
): void {
  if (typeof window === 'undefined' || !window.AudioContext) return
  try {
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const gainNode = ctx.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(ctx.destination)

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime)

    gainNode.gain.setValueAtTime(volume, ctx.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + duration / 1000)

    oscillator.onended = () => ctx.close()
  } catch {
    // Audio not available — silently ignore
  }
}

/** High-pitched double beep: scan captured successfully */
export function playScanSuccess(): void {
  beep(880, 120, 'sine', 0.25)
  setTimeout(() => beep(1100, 100, 'sine', 0.2), 140)
}

/** Low-pitched descending beep: scan failed or invalid */
export function playScanFailure(): void {
  beep(440, 200, 'sawtooth', 0.3)
  setTimeout(() => beep(330, 250, 'sawtooth', 0.25), 220)
}

/** Attention tone: new breach alert or urgent notification */
export function playAlert(): void {
  beep(660, 150, 'square', 0.2)
  setTimeout(() => beep(660, 150, 'square', 0.2), 200)
  setTimeout(() => beep(880, 200, 'square', 0.25), 400)
}

/** Soft notification tone: informational event */
export function playNotification(): void {
  beep(523, 100, 'sine', 0.2)
  setTimeout(() => beep(659, 120, 'sine', 0.18), 120)
}

/** Man-down / welfare alert — three urgent descending tones */
export function playManDown(): void {
  beep(880, 150, 'sawtooth', 0.4)
  setTimeout(() => beep(660, 150, 'sawtooth', 0.4), 180)
  setTimeout(() => beep(440, 250, 'sawtooth', 0.5), 360)
}
