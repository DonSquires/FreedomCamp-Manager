/**
 * Sound Effects Library for FreedomCamp Manager
 * Provides audible feedback for user actions and system events
 */

class SoundManager {
  private audioContext: AudioContext | null = null;

  constructor() {
    // Initialize AudioContext on first user interaction (required by browsers)
    if (typeof window !== 'undefined' && 'AudioContext' in window) {
      this.audioContext = new AudioContext();
    }
  }

  /**
   * Resume AudioContext (required by some browsers after page load)
   */
  private async ensureAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Play a simple beep tone
   */
  private playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volume: number = 0.3) {
    if (!this.audioContext) return;

    try {
      this.ensureAudioContext();

      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = type;

      gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

      oscillator.start(this.audioContext.currentTime);
      oscillator.stop(this.audioContext.currentTime + duration);
    } catch (error) {
      console.warn('Failed to play sound:', error);
    }
  }

  /**
   * Photo capture success - cheerful double beep
   */
  photoCapture() {
    this.playTone(800, 0.1, 'sine', 0.2);
    setTimeout(() => {
      this.playTone(1000, 0.1, 'sine', 0.2);
    }, 100);
  }

  /**
   * Processing complete - subtle confirmation
   */
  processingComplete() {
    this.playTone(600, 0.15, 'sine', 0.15);
  }

  /**
   * Violation detected - urgent alert (three-tone siren)
   */
  violationAlert() {
    this.playTone(800, 0.15, 'square', 0.4);
    setTimeout(() => {
      this.playTone(600, 0.15, 'square', 0.4);
    }, 150);
    setTimeout(() => {
      this.playTone(800, 0.15, 'square', 0.4);
    }, 300);
  }

  /**
   * Flagged vehicle - critical alert (rapid beeps)
   */
  flaggedVehicleAlert() {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        this.playTone(1200, 0.08, 'square', 0.35);
      }, i * 120);
    }
  }

  /**
   * Health & Safety issue - warning tone
   */
  healthSafetyWarning() {
    this.playTone(700, 0.2, 'triangle', 0.3);
    setTimeout(() => {
      this.playTone(700, 0.2, 'triangle', 0.3);
    }, 250);
  }

  /**
   * Homeless status detected - neutral info chime
   */
  homelessInfo() {
    this.playTone(500, 0.12, 'sine', 0.2);
    setTimeout(() => {
      this.playTone(650, 0.12, 'sine', 0.2);
    }, 120);
  }

  /**
   * Error - descending warning tone
   */
  error() {
    this.playTone(400, 0.15, 'sawtooth', 0.3);
    setTimeout(() => {
      this.playTone(300, 0.2, 'sawtooth', 0.3);
    }, 150);
  }

  /**
   * Generic success - pleasant chime
   */
  success() {
    this.playTone(800, 0.1, 'sine', 0.2);
    setTimeout(() => {
      this.playTone(1200, 0.15, 'sine', 0.2);
    }, 100);
  }

  /**
   * Background processing started - subtle notification
   */
  backgroundProcessing() {
    this.playTone(550, 0.08, 'sine', 0.15);
  }

  /**
   * Welfare warning - attention-getting but not alarming
   */
  welfareWarning() {
    this.playTone(700, 0.2, 'sine', 0.3);
    setTimeout(() => {
      this.playTone(900, 0.2, 'sine', 0.3);
    }, 250);
  }

  /**
   * Welfare critical - urgent alert
   */
  welfareCritical() {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        this.playTone(1200, 0.12, 'square', 0.4);
      }, i * 150);
    }
  }
}

// Singleton instance
export const soundManager = new SoundManager();

// Convenience exports
export const playSounds = {
  photoCapture: () => soundManager.photoCapture(),
  processingComplete: () => soundManager.processingComplete(),
  violationAlert: () => soundManager.violationAlert(),
  flaggedVehicle: () => soundManager.flaggedVehicleAlert(),
  healthSafety: () => soundManager.healthSafetyWarning(),
  homeless: () => soundManager.homelessInfo(),
  error: () => soundManager.error(),
  success: () => soundManager.success(),
  backgroundProcessing: () => soundManager.backgroundProcessing(),
  welfareWarning: () => soundManager.welfareWarning(),
  welfareCritical: () => soundManager.welfareCritical(),
};
