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
  voiceActivatedConversation: boolean
  expressUserDataPermission: boolean
  permittedUserIdentity: string
  voicePatternLearningConsent: boolean
  faceClarificationConsent: boolean
  setDisplayName: (value: string) => void
  setTone: (value: BobTone) => void
  setVoiceGender: (value: BobVoiceGender) => void
  setAccent: (value: BobAccent) => void
  setSpeechEnabled: (value: boolean) => void
  setAutoSpeakReplies: (value: boolean) => void
  setVoiceActivatedConversation: (value: boolean) => void
  setExpressUserDataPermission: (value: boolean) => void
  setPermittedUserIdentity: (value: string) => void
  setVoicePatternLearningConsent: (value: boolean) => void
  setFaceClarificationConsent: (value: boolean) => void
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
      voiceActivatedConversation: false,
      expressUserDataPermission: false,
      permittedUserIdentity: '',
      voicePatternLearningConsent: false,
      faceClarificationConsent: false,
      setDisplayName: (value) => set({ displayName: value.trim() || 'Bob' }),
      setTone: (value) => set({ tone: value }),
      setVoiceGender: (value) => set({ voiceGender: value }),
      setAccent: (value) => set({ accent: value }),
      setSpeechEnabled: (value) => set({ speechEnabled: value }),
      setAutoSpeakReplies: (value) => set({ autoSpeakReplies: value }),
      setVoiceActivatedConversation: (value) => set({ voiceActivatedConversation: value }),
      setExpressUserDataPermission: (value) => set({ expressUserDataPermission: value }),
      setPermittedUserIdentity: (value) => set({ permittedUserIdentity: value.trim() }),
      setVoicePatternLearningConsent: (value) => set({ voicePatternLearningConsent: value }),
      setFaceClarificationConsent: (value) => set({ faceClarificationConsent: value }),
    }),
    {
      name: 'bob-assistant-settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
