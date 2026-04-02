import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type BobVoiceGender = 'male' | 'female' | 'neutral'
export type BobAccent = 'en-NZ' | 'en-AU' | 'en-GB' | 'en-US'
export type BobTone = 'professional' | 'friendly' | 'coach'

interface BobAssistantState {
  displayName: string
  tone: BobTone
  voiceGender: BobVoiceGender
  accent: BobAccent
  speechEnabled: boolean
  autoSpeakReplies: boolean
  setDisplayName: (value: string) => void
  setTone: (value: BobTone) => void
  setVoiceGender: (value: BobVoiceGender) => void
  setAccent: (value: BobAccent) => void
  setSpeechEnabled: (value: boolean) => void
  setAutoSpeakReplies: (value: boolean) => void
}

export const useBobAssistantStore = create<BobAssistantState>()(
  persist(
    (set) => ({
      displayName: 'Bob',
      tone: 'friendly',
      voiceGender: 'male',
      accent: 'en-NZ',
      speechEnabled: true,
      autoSpeakReplies: true,
      setDisplayName: (value) => set({ displayName: value.trim() || 'Bob' }),
      setTone: (value) => set({ tone: value }),
      setVoiceGender: (value) => set({ voiceGender: value }),
      setAccent: (value) => set({ accent: value }),
      setSpeechEnabled: (value) => set({ speechEnabled: value }),
      setAutoSpeakReplies: (value) => set({ autoSpeakReplies: value }),
    }),
    {
      name: 'bob-assistant-settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
