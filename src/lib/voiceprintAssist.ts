export interface VoiceprintCaptureOptions {
  sampleDurationMs?: number
  bucketCount?: number
}

function normalizeVector(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  if (!norm) return values
  return values.map((value) => value / norm)
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  if (!len) return 0

  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  if (!denom) return 0
  return dot / denom
}

function bucketizeFrequencyData(frequencyData: Uint8Array, bucketCount: number): number[] {
  const output = new Array<number>(bucketCount).fill(0)
  const bucketSize = Math.max(1, Math.floor(frequencyData.length / bucketCount))

  for (let i = 0; i < bucketCount; i++) {
    const start = i * bucketSize
    const end = Math.min(frequencyData.length, start + bucketSize)
    if (start >= end) break

    let sum = 0
    for (let j = start; j < end; j++) {
      sum += frequencyData[j] / 255
    }
    output[i] = sum / (end - start)
  }

  return output
}

export async function captureVoiceprintSignature(options: VoiceprintCaptureOptions = {}): Promise<number[]> {
  const sampleDurationMs = options.sampleDurationMs ?? 1800
  const bucketCount = options.bucketCount ?? 64

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })

  const audioContext = new AudioContext()
  const source = audioContext.createMediaStreamSource(stream)
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)

  const frame = new Uint8Array(analyser.frequencyBinCount)
  const accumulator = new Array<number>(bucketCount).fill(0)
  let frameCount = 0

  try {
    const startedAt = Date.now()

    while (Date.now() - startedAt < sampleDurationMs) {
      analyser.getByteFrequencyData(frame)
      const buckets = bucketizeFrequencyData(frame, bucketCount)
      for (let i = 0; i < bucketCount; i++) {
        accumulator[i] += buckets[i]
      }
      frameCount += 1
      await new Promise((resolve) => setTimeout(resolve, 45))
    }

    const averaged = frameCount
      ? accumulator.map((value) => value / frameCount)
      : accumulator

    return normalizeVector(averaged)
  } finally {
    source.disconnect()
    analyser.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    await audioContext.close()
  }
}

export function compareVoiceprintSignatures(reference: number[], sample: number[]): number {
  return cosineSimilarity(normalizeVector(reference), normalizeVector(sample))
}
