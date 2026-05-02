/**
 * BobStudio - Consolidated admin interface for operational AI
 *
 * Integrates:
 * - Chat: Real-time conversation with message history
 * - Planning: Task visualization & reasoning context
 * - Voice: PTT (Push-to-Talk) for hands-free operation
 * - Testing: Response evaluation & scoring
 * - Diagnostics: Performance metrics, learned patterns, approval gates
 *
 * Architecture:
 * - useBobStore() for global state (conversation, tone, reasoning)
 * - useBobConversation() for DB persistence (TanStack Query)
 * - WebSocket (via Supabase realtime) for multi-user sync
 * - localStorage persistence for user preferences
 *
 * Permission: Admin role required (enforced via App.tsx route guard)
 */

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, MessageCircle, Zap, Mic, MicOff, BarChart3, AlertCircle, Volume2, Languages } from 'lucide-react'
import { useBobStore, type BobTask } from '@/stores/bobStore'
import { useBobConversation } from '@/hooks/useBobConversation'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'
import { supabase } from '@/lib/supabase'
import { edgeFunctions } from '@/lib/edgeFunctions'
import { toast } from 'sonner'

type BobStudioTab = 'chat' | 'planning' | 'voice' | 'testing' | 'diagnostics'

export default function BobStudio() {
  const [activeTab, setActiveTab] = useState<BobStudioTab>('chat')
  const [recordingAudio, setRecordingAudio] = useState(false)

  // Global Bob state
  const {
    activeConversationId,
    setActiveConversation,
    activeTask,
    setActiveTask,
    currentReasoning,
    pendingApprovals,
    learningPatterns,
  } = useBobStore()

  // Organization context
  const { operationalOrganizationId } = useOperationalOrganization()

  // Conversation DB layer
  const {
    messages,
    loading: conversationLoading,
    createConversation,
    loadConversation,
    sendMessage,
    scoreMessage,
  } = useBobConversation({
    conversationId: activeConversationId ?? undefined,
    organizationId: operationalOrganizationId ?? undefined,
  })

  // On mount: sync Zustand from the hook's persisted sessionStorage key so both
  // layers agree on the active conversation (avoids new-conversation creation on reload).
  useEffect(() => {
    if (!activeConversationId && operationalOrganizationId) {
      const stored = sessionStorage.getItem(`bob-conversation-id-${operationalOrganizationId}`)
      if (stored) {
        setActiveConversation(stored, null)
        loadConversation(stored)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationalOrganizationId])

  const handleSendMessage = async (content: string) => {
    if (!operationalOrganizationId) return

    let convId = activeConversationId
    if (!convId) {
      const newConv = await createConversation('Bob Chat', operationalOrganizationId)
      if (!newConv) return
      convId = newConv.conversation_id
      setActiveConversation(convId, newConv)
      // Sync the hook's ref to the new conversation so sendMessage targets it
      // immediately, without waiting for a React re-render cycle.
      await loadConversation(convId)
    }

    if (!convId) return

    // Save user message to DB
    await sendMessage('user', content)

    // Build conversation history for AI context (existing turns + this new user message)
    const historyForAi = [
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      { role: 'user' as const, content },
    ]

    // Call Bob inference
    const { data, error } = await edgeFunctions.aiChat({
      messages: historyForAi,
      provider: 'auto',
    })

    if (error || !data?.response) {
      // Don't persist errors to the conversation history as they pollute future AI context
      console.error('[BobStudio] AI call failed:', error)
      toast.error('Bob could not respond right now. Please try again in a moment.')
      return
    }

    // Save assistant response to DB
    await sendMessage('assistant', data.response, { model: data.model, provider: data.provider })
  }

  const handleRecordAudio = () => {
    setRecordingAudio((prev) => !prev)
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Bob Studio</h1>
        <p className="text-muted-foreground">
          Operational AI for compliance workflows | Org: {operationalOrganizationId || 'N/A'}
        </p>
      </div>

      {/* Global Reasoning Context */}
      {currentReasoning && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4" />
              Active Reasoning Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <strong>Hypothesis:</strong> {currentReasoning.hypothesis}
            </p>
            <p className="text-xs text-muted-foreground">
              Confidence: {(currentReasoning.confidence * 100).toFixed(0)}% |
              {currentReasoning.requiresApproval && ' Requires Approval'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Pending Approvals Alert */}
      {pendingApprovals().length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4" />
              {pendingApprovals().length} Action(s) Awaiting Approval
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingApprovals().map((gate) => (
                <div key={gate.id} className="text-sm">
                  <p>{gate.action}</p>
                  <p className="text-xs text-muted-foreground">{gate.reason}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Tab Interface */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as BobStudioTab)}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="chat">
            <MessageCircle className="mr-2 h-4 w-4" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="planning">
            <Zap className="mr-2 h-4 w-4" />
            Planning
          </TabsTrigger>
          <TabsTrigger value="voice">
            <Mic className="mr-2 h-4 w-4" />
            Voice
          </TabsTrigger>
          <TabsTrigger value="testing">
            <BarChart3 className="mr-2 h-4 w-4" />
            Testing
          </TabsTrigger>
          <TabsTrigger value="diagnostics">
            <AlertCircle className="mr-2 h-4 w-4" />
            Diagnostics
          </TabsTrigger>
        </TabsList>

        {/* Chat Tab */}
        <TabsContent value="chat" className="space-y-4">
          <BobChatTab
            messages={messages}
            loading={conversationLoading}
            onSendMessage={handleSendMessage}
          />
        </TabsContent>

        {/* Planning Tab */}
        <TabsContent value="planning" className="space-y-4">
          <BobPlanningTab
            activeTask={activeTask}
            reasoning={currentReasoning}
            onCreateTask={(task) => setActiveTask(task)}
          />
        </TabsContent>

        {/* Voice Tab */}
        <TabsContent value="voice" className="space-y-4">
          <BobVoiceTab recording={recordingAudio} onToggleRecording={handleRecordAudio} />
        </TabsContent>

        {/* Testing Tab */}
        <TabsContent value="testing" className="space-y-4">
          <BobTestingTab messages={messages} onScoreMessage={scoreMessage} />
        </TabsContent>

        {/* Diagnostics Tab */}
        <TabsContent value="diagnostics" className="space-y-4">
          <BobDiagnosticsTab
            learningPatterns={learningPatterns}
            approvalGates={pendingApprovals()}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * Chat interface with message threading & history
 */
interface BobChatTabProps {
  messages: any[]
  loading: boolean
  onSendMessage: (content: string) => Promise<void>
}

function BobChatTab({ messages, loading, onSendMessage }: BobChatTabProps) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const handleSend = async () => {
    if (!input.trim()) return
    setSending(true)
    try {
      await onSendMessage(input)
      setInput('')
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader>
        <CardTitle>Conversation</CardTitle>
        <CardDescription>Multi-turn dialogue with context retention</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-xs px-4 py-2 rounded-lg ${
                    msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-black'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </CardContent>
      <div className="border-t p-4 space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ask Bob..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            disabled={sending}
            className="flex-1 px-3 py-2 border rounded-lg"
          />
          <Button onClick={handleSend} disabled={sending || !input.trim()}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send
          </Button>
        </div>
      </div>
    </Card>
  )
}

/**
 * Task planning & reasoning visualization
 */
interface BobPlanningTabProps {
  activeTask: BobTask | null
  reasoning: any | null
  onCreateTask: (task: BobTask) => void
}

function BobPlanningTab({ activeTask, reasoning }: BobPlanningTabProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Active Task</CardTitle>
        </CardHeader>
        <CardContent>
          {activeTask ? (
            <div className="space-y-2 text-sm">
              <p>
                <strong>Type:</strong> {activeTask.type}
              </p>
              <p>
                <strong>Status:</strong> {activeTask.status}
              </p>
              <p>
                <strong>Created:</strong> {new Date(activeTask.createdAt).toLocaleString()}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">No active task</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reasoning</CardTitle>
        </CardHeader>
        <CardContent>
          {reasoning ? (
            <div className="space-y-2 text-sm">
              <p>
                <strong>Hypothesis:</strong> {reasoning.hypothesis}
              </p>
              <p>
                <strong>Confidence:</strong> {(reasoning.confidence * 100).toFixed(0)}%
              </p>
              <p className="text-xs text-muted-foreground">
                Next: {reasoning.nextSteps.join(' → ')}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">No active reasoning</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Voice/PTT interface with real STT, TTS, translation, and voice profile matching.
 *
 * Flow:
 *  1. Officer presses PTT → MediaRecorder captures audio (webm)
 *  2. Audio base64 sent to transcribe-audio edge function (Whisper/browser-STT fallback)
 *  3. Transcript optionally translated via Bob AI (onspace-ai-chat action=translate)
 *  4. TTS via synthesize-speech edge function → voice_params returned
 *  5. Web Speech SpeechSynthesis renders audio with captured/default voice profile
 *
 * Voice profile matching:
 *  - Officer enrollment: capture pitch + rate + voice_name preferences
 *  - Persisted in localStorage under 'bob-voice-profile'
 *  - Applied to all TTS output so translated speech mirrors the officer's style
 */
interface VoiceProfile {
  pitch: number       // 0.5–2.0 (1.0 = default)
  rate: number        // 0.5–2.0 (1.0 = default)
  volume: number      // 0.0–1.0
  voice_name: string  // Web Speech API voice name, blank = browser default
  lang: string        // BCP-47 e.g. 'en-NZ'
}

const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  pitch: 1.0,
  rate: 1.0,
  volume: 1.0,
  voice_name: '',
  lang: 'en-NZ',
}

const TRANSLATE_LANGUAGES: Record<string, string> = {
  off: 'No Translation',
  zh: '中文 (Chinese)',
  ja: '日本語 (Japanese)',
  ko: '한국어 (Korean)',
  mi: 'Te Reo Māori',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
}

interface BobVoiceTabProps {
  recording: boolean
  onToggleRecording: () => void
}

function BobVoiceTab({ recording, onToggleRecording }: BobVoiceTabProps) {
  const [transcript, setTranscript] = useState('')
  const [translatedText, setTranslatedText] = useState('')
  const [targetLang, setTargetLang] = useState('off')
  const [statusMsg, setStatusMsg] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>(() => {
    try {
      const stored = localStorage.getItem('bob-voice-profile')
      return stored ? { ...DEFAULT_VOICE_PROFILE, ...JSON.parse(stored) } : DEFAULT_VOICE_PROFILE
    } catch { return DEFAULT_VOICE_PROFILE }
  })
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Load available Web Speech API voices
  useEffect(() => {
    const load = () => {
      const voices = window.speechSynthesis?.getVoices() ?? []
      if (voices.length) setAvailableVoices(voices)
    }
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])

  const saveVoiceProfile = useCallback((updated: VoiceProfile) => {
    setVoiceProfile(updated)
    localStorage.setItem('bob-voice-profile', JSON.stringify(updated))
  }, [])

  /** Speak text using Web Speech API with voice profile matching */
  const speakText = useCallback((text: string, params?: Partial<VoiceProfile>) => {
    if (!window.speechSynthesis || !text.trim()) return
    window.speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    const profile = { ...voiceProfile, ...params }
    utter.pitch = profile.pitch
    utter.rate = profile.rate
    utter.volume = profile.volume
    utter.lang = profile.lang
    if (profile.voice_name) {
      const match = availableVoices.find(v => v.name === profile.voice_name)
      if (match) utter.voice = match
    }
    utter.onstart = () => setIsSpeaking(true)
    utter.onend = () => setIsSpeaking(false)
    utter.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.speak(utter)
  }, [voiceProfile, availableVoices])

  /** Use browser Web Speech API for real-time transcription */
  const startBrowserSTT = useCallback((lang: string, onResult: (text: string) => void) => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return null
    const recognition = new SR()
    recognition.lang = lang || voiceProfile.lang || 'en-NZ'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event: any) => {
      const text = event.results[0]?.[0]?.transcript || ''
      onResult(text)
    }
    recognition.start()
    return recognition
  }, [voiceProfile.lang])

  /** Handle PTT button - record audio then transcribe */
  const handlePTT = async () => {
    if (recording) {
      // Stop and process
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop()
      }
      onToggleRecording()
      return
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setStatusMsg('Transcribing...')
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })

        // Convert Blob to base64
        const arrayBuffer = await blob.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const audioBase64 = btoa(binary)

        try {
          const { data: { session } } = await supabase.auth.getSession()
          const token = session?.access_token
          if (!token) throw new Error('Not authenticated')

          const resp = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-audio`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({
                audio_base64: audioBase64,
                audio_mime_type: 'audio/webm',
                language: voiceProfile.lang.split('-')[0],
              }),
            }
          )
          const result = await resp.json()

          let finalTranscript = result.transcript as string

          // If inference returned browser_fallback, use browser Web Speech API
          if (!finalTranscript && result.client_action === 'web_speech_recognition') {
            setStatusMsg('Using browser speech recognition...')
            await new Promise<void>((resolve) => {
              const recognition = startBrowserSTT(voiceProfile.lang, (text) => {
                finalTranscript = text
                resolve()
              })
              if (!recognition) resolve()
              setTimeout(resolve, 10000)
            })
          }

          if (finalTranscript) {
            setTranscript(finalTranscript)
            // Translate if language target selected
            if (targetLang !== 'off') {
              await handleTranslate(finalTranscript, targetLang)
            } else {
              setStatusMsg('Ready')
            }
          } else {
            setStatusMsg('Could not transcribe audio')
          }
        } catch (err: any) {
          setStatusMsg('Transcription error: ' + (err.message || 'Unknown'))
        }
      }

      recorder.start()
      onToggleRecording()
      setStatusMsg('Recording...')
    } catch (err: any) {
      setStatusMsg('Microphone access denied: ' + (err.message || ''))
    }
  }

  /** Translate text and play TTS with voice matching */
  const handleTranslate = async (text: string, lang: string) => {
    if (!text.trim() || lang === 'off') return
    setStatusMsg('Translating...')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setStatusMsg('Not authenticated'); return }

      // Translate via Bob
      const transResp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onspace-ai-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            action: 'translate',
            text,
            target_language: lang,
            provider: 'inference',
          }),
        }
      )
      const transResult = await transResp.json()
      const translated = transResult.translation || transResult.translated_text || ''
      if (!translated) { setStatusMsg('Translation failed'); return }
      setTranslatedText(translated)

      // Synthesize speech with voice profile matching
      setStatusMsg('Synthesizing speech...')
      const synthResp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/synthesize-speech`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            text: translated,
            style: 'default',
            voice: voiceProfile.voice_name || undefined,
            rate: Math.round(voiceProfile.rate * 160),
            pitch: Math.round((voiceProfile.pitch - 0.5) * 60),
            voice_profile: voiceProfile,
          }),
        }
      )
      const synthResult = await synthResp.json()

      if (synthResult.audio_base64) {
        // Server synthesized audio — play as audio element
        const audioData = `data:audio/wav;base64,${synthResult.audio_base64}`
        const audio = new Audio(audioData)
        setIsSpeaking(true)
        audio.onended = () => setIsSpeaking(false)
        await audio.play()
      } else {
        // Use Web Speech API with returned voice_params (or stored profile)
        const params = synthResult.voice_params || {}
        speakText(synthResult.spoken_text || translated, {
          pitch: params.pitch ?? voiceProfile.pitch,
          rate: params.rate ? params.rate / 160 : voiceProfile.rate,
          volume: params.volume ?? voiceProfile.volume,
          voice_name: params.voice_name || voiceProfile.voice_name,
          lang: params.lang || voiceProfile.lang,
        })
      }
      setStatusMsg('Done')
    } catch (err: any) {
      setStatusMsg('Error: ' + (err.message || 'Unknown'))
      // Fallback: speak original text
      speakText(text)
    }
  }

  return (
    <div className="space-y-4">
      {/* PTT Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Voice Input (PTT) + Translation
          </CardTitle>
          <CardDescription>
            Press to record, select target language for voice-matched translation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Language selector */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-muted-foreground">Translate to:</span>
            {Object.entries(TRANSLATE_LANGUAGES).map(([code, label]) => (
              <Button
                key={code}
                size="sm"
                variant={targetLang === code ? 'default' : 'outline'}
                onClick={() => setTargetLang(code)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* PTT button */}
          <div className="flex justify-center py-6">
            <Button
              size="lg"
              onClick={handlePTT}
              variant={recording ? 'destructive' : 'default'}
              className="w-40 h-16 text-lg"
            >
              {recording
                ? <><MicOff className="mr-2 h-6 w-6" /> Stop</>
                : <><Mic className="mr-2 h-6 w-6" /> PTT</>
              }
            </Button>
          </div>

          {/* Status */}
          {statusMsg && (
            <p className="text-center text-sm text-muted-foreground">{statusMsg}</p>
          )}

          {/* Transcript */}
          {transcript && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs font-semibold mb-1">Transcript</p>
              <p className="text-sm">{transcript}</p>
            </div>
          )}

          {/* Translation */}
          {translatedText && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
              <div className="flex justify-between items-start mb-1">
                <p className="text-xs font-semibold text-blue-700">
                  Translation ({TRANSLATE_LANGUAGES[targetLang] || targetLang})
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => speakText(translatedText)}
                  disabled={isSpeaking}
                  className="h-6 px-2"
                >
                  <Volume2 className="h-3 w-3 mr-1" />
                  {isSpeaking ? 'Speaking...' : 'Replay'}
                </Button>
              </div>
              <p className="text-sm">{translatedText}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Voice Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Volume2 className="h-4 w-4" />
            Voice Profile (Emulator Matching)
          </CardTitle>
          <CardDescription>
            Tune these to match the officer's natural voice for translated speech output
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium block mb-1">Pitch ({voiceProfile.pitch.toFixed(1)})</label>
              <input
                type="range" min="0.5" max="2.0" step="0.05"
                value={voiceProfile.pitch}
                onChange={e => saveVoiceProfile({ ...voiceProfile, pitch: Number(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Rate ({voiceProfile.rate.toFixed(1)})</label>
              <input
                type="range" min="0.5" max="2.0" step="0.05"
                value={voiceProfile.rate}
                onChange={e => saveVoiceProfile({ ...voiceProfile, rate: Number(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Volume ({voiceProfile.volume.toFixed(1)})</label>
              <input
                type="range" min="0.0" max="1.0" step="0.05"
                value={voiceProfile.volume}
                onChange={e => saveVoiceProfile({ ...voiceProfile, volume: Number(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Language</label>
              <select
                value={voiceProfile.lang}
                onChange={e => saveVoiceProfile({ ...voiceProfile, lang: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm bg-background"
              >
                <option value="en-NZ">English (NZ)</option>
                <option value="en-AU">English (AU)</option>
                <option value="en-US">English (US)</option>
                <option value="zh-CN">Chinese (Simplified)</option>
                <option value="ja-JP">Japanese</option>
                <option value="ko-KR">Korean</option>
                <option value="mi">Te Reo Māori</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
                <option value="es-ES">Spanish</option>
              </select>
            </div>
          </div>
          {availableVoices.length > 0 && (
            <div>
              <label className="text-sm font-medium block mb-1">Voice Engine</label>
              <select
                value={voiceProfile.voice_name}
                onChange={e => saveVoiceProfile({ ...voiceProfile, voice_name: e.target.value })}
                className="w-full border rounded px-2 py-1 text-sm bg-background"
              >
                <option value="">Browser Default</option>
                {availableVoices
                  .filter(v => v.lang.startsWith(voiceProfile.lang.split('-')[0]))
                  .map(v => (
                    <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                  ))
                }
              </select>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => speakText('Voice profile test. This is how Bob will sound when translating.')}
            disabled={isSpeaking}
          >
            <Volume2 className="mr-2 h-3 w-3" />
            Test Voice Profile
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Response evaluation & scoring interface
 */
interface BobTestingTabProps {
  messages: any[]
  onScoreMessage: (messageId: string, score: number, lessonKey: string, feedback?: string) => Promise<void>
}

function BobTestingTab({ messages, onScoreMessage }: BobTestingTabProps) {
  const recentResponses = messages.filter((m) => m.role === 'assistant').slice(-5)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Response Scoring</CardTitle>
        <CardDescription>Evaluate Bob's responses to tune future outputs</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {recentResponses.length > 0 ? (
            recentResponses.map((msg, idx) => (
              <div key={idx} className="border rounded-lg p-4 space-y-2">
                <p className="text-sm">{msg.content.substring(0, 100)}...</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <Button
                      key={score}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // TODO: Extract metadata and call onScoreMessage
                      }}
                    >
                      {score}⭐
                    </Button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No responses to score</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Performance metrics & diagnostics
 */
interface BobDiagnosticsTabProps {
  learningPatterns: any[]
  approvalGates: any[]
}

function BobDiagnosticsTab({ learningPatterns, approvalGates }: BobDiagnosticsTabProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Learned Patterns</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {learningPatterns.length > 0 ? (
              learningPatterns.map((p) => (
                <div key={p.key} className="border-b pb-2">
                  <p>
                    <strong>{p.key}</strong> ({(p.confidence * 100).toFixed(0)}%)
                  </p>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No patterns learned yet</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approval Gates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {approvalGates.length > 0 ? (
              approvalGates.map((gate) => (
                <div key={gate.id} className="border-b pb-2">
                  <p>
                    <strong>{gate.action}</strong> ({gate.status})
                  </p>
                  <p className="text-xs text-muted-foreground">{gate.reason}</p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No pending approvals</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
