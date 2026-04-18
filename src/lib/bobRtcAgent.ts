import type { PTTCustomAudioSource } from './ptt'

export type BobRadioSignalProfile = 'link-test' | 'attention' | 'warble' | 'spoken'

export interface BobRadioSignalOptions {
  profile: BobRadioSignalProfile
  signalText?: string
  level?: number
}

type ToneStep = {
  frequency: number
  durationMs: number
  gapMs?: number
  gain?: number
  rampToFrequency?: number
}

function clampLevel(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.2
  return Math.min(0.6, Math.max(0.05, value))
}

function buildSignalSteps(options: BobRadioSignalOptions): ToneStep[] {
  const text = (options.signalText || 'BOB LINK TEST').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 24)
  const steps: ToneStep[] = []

  if (options.profile === 'attention') {
    steps.push(
      { frequency: 1350, durationMs: 120, gapMs: 60, gain: 0.24 },
      { frequency: 980, durationMs: 220, gapMs: 120, gain: 0.2 },
    )
  } else if (options.profile === 'warble') {
    steps.push(
      { frequency: 780, rampToFrequency: 1180, durationMs: 260, gapMs: 80, gain: 0.22 },
      { frequency: 1180, rampToFrequency: 820, durationMs: 260, gapMs: 120, gain: 0.22 },
    )
  } else {
    steps.push(
      { frequency: 1040, durationMs: 140, gapMs: 45, gain: 0.22 },
      { frequency: 880, durationMs: 140, gapMs: 90, gain: 0.22 },
    )
  }

  for (const ch of text) {
    if (ch === ' ') {
      steps.push({ frequency: 700, durationMs: 45, gapMs: 90, gain: 0.08 })
      continue
    }

    const code = ch.charCodeAt(0)
    const base = 620 + (code % 11) * 55
    const durationMs = 55 + (code % 3) * 18
    steps.push({ frequency: base, durationMs, gapMs: 28, gain: 0.16 })
  }

  steps.push({ frequency: 920, durationMs: 180, gapMs: 0, gain: 0.18 })
  return steps
}

export function estimateBobRadioSignalDurationMs(options: BobRadioSignalOptions): number {
  return buildSignalSteps(options).reduce((total, step) => total + step.durationMs + (step.gapMs || 0), 0)
}

export async function createBobRadioAudioSource(options: BobRadioSignalOptions): Promise<PTTCustomAudioSource> {
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) {
    throw new Error('Web Audio API is not supported in this browser')
  }

  const context = new AudioCtx()
  const destination = context.createMediaStreamDestination()
  const masterGain = context.createGain()
  masterGain.gain.value = clampLevel(options.level)
  masterGain.connect(destination)

  const steps = buildSignalSteps(options)
  let cursor = context.currentTime + 0.05

  for (const step of steps) {
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = options.profile === 'warble' ? 'square' : 'sine'
    oscillator.frequency.setValueAtTime(step.frequency, cursor)

    if (typeof step.rampToFrequency === 'number') {
      oscillator.frequency.linearRampToValueAtTime(step.rampToFrequency, cursor + step.durationMs / 1000)
    }

    envelope.gain.setValueAtTime(0.0001, cursor)
    envelope.gain.linearRampToValueAtTime(step.gain ?? 0.16, cursor + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, cursor + step.durationMs / 1000)

    oscillator.connect(envelope)
    envelope.connect(masterGain)
    oscillator.start(cursor)
    oscillator.stop(cursor + step.durationMs / 1000)
    cursor += (step.durationMs + (step.gapMs || 0)) / 1000
  }

  const [track] = destination.stream.getAudioTracks()
  if (!track) {
    await context.close()
    throw new Error('Could not create Bob radio audio track')
  }

  return {
    stream: destination.stream,
    label: `bob-radio:${options.profile}`,
    cleanup: async () => {
      destination.stream.getTracks().forEach((audioTrack) => audioTrack.stop())
      await context.close()
    },
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

export async function createBobSpeechAudioSourceFromBase64(params: {
  audioBase64: string
  mimeType?: string
  level?: number
}): Promise<PTTCustomAudioSource> {
  const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) {
    throw new Error('Web Audio API is not supported in this browser')
  }

  const context = new AudioCtx()
  const destination = context.createMediaStreamDestination()
  const masterGain = context.createGain()
  masterGain.gain.value = clampLevel(params.level)
  masterGain.connect(destination)

  const audioData = base64ToArrayBuffer(params.audioBase64)
  const audioBuffer = await context.decodeAudioData(audioData.slice(0))
  const source = context.createBufferSource()
  source.buffer = audioBuffer
  source.connect(masterGain)
  source.start(context.currentTime + 0.03)

  const [track] = destination.stream.getAudioTracks()
  if (!track) {
    await context.close()
    throw new Error('Could not create Bob speech audio track')
  }

  return {
    stream: destination.stream,
    label: `bob-speech:${params.mimeType || 'audio/wav'}`,
    cleanup: async () => {
      source.stop(0)
      destination.stream.getTracks().forEach((audioTrack) => audioTrack.stop())
      await context.close()
    },
  }
}