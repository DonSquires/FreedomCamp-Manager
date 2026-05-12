const DEFAULT_WAKE_WORD = 'hey bob'

export function normalizeSpeechText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function containsWakeWord(transcript: string, wakeWord = DEFAULT_WAKE_WORD): boolean {
  const normalizedTranscript = normalizeSpeechText(transcript)
  const normalizedWakeWord = normalizeSpeechText(wakeWord)
  if (!normalizedTranscript || !normalizedWakeWord) return false
  return normalizedTranscript.includes(normalizedWakeWord)
}

export function getCoworkerChannelVolume(bobIntercomSpeaking: boolean, duckingEnabled: boolean): number {
  if (bobIntercomSpeaking && duckingEnabled) return 0.2
  return 1
}
