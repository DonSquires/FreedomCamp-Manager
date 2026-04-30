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

import React, { useEffect, useState, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, MessageCircle, Zap, Mic, BarChart3, AlertCircle } from 'lucide-react'
import { useBobStore, type BobTask } from '@/stores/bobStore'
import { useBobConversation } from '@/hooks/useBobConversation'
import { useOperationalOrganization } from '@/hooks/useOperationalOrganization'

type BobStudioTab = 'chat' | 'planning' | 'voice' | 'testing' | 'diagnostics'

export default function BobStudio() {
  const [activeTab, setActiveTab] = useState<BobStudioTab>('chat')
  const [recordingAudio, setRecordingAudio] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)

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

  // On mount: load existing conversation or start new
  useEffect(() => {
    const restored = sessionStorage.getItem(`bob-conversation-${operationalOrganizationId}`)
    if (restored) {
      loadConversation(restored)
    }
  }, [operationalOrganizationId, loadConversation])

  const handleSendMessage = async (content: string) => {
    if (!operationalOrganizationId) return

    let convId = activeConversationId
    if (!convId) {
      const newConv = await createConversation('Bob Chat', operationalOrganizationId)
      if (newConv) {
        convId = newConv.conversation_id
        setActiveConversation(convId, newConv)
        sessionStorage.setItem(`bob-conversation-${operationalOrganizationId}`, convId)
      }
    }

    if (convId) {
      await sendMessage('user', content)
    }
  }

  const handleRecordAudio = async () => {
    if (recordingAudio && mediaRecorderRef.current) {
      // Stop and process
      mediaRecorderRef.current.stop()
      setRecordingAudio(false)
      // TODO: Send audio to speech-to-text service, then to Bob
    } else {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        mediaRecorderRef.current = recorder

        const chunks: Blob[] = []
        recorder.ondataavailable = (e) => chunks.push(e.data)
        recorder.onstop = () => {
          const audioBlob = new Blob(chunks, { type: 'audio/webm' })
          // TODO: Send audioBlob to inference service for STT
        }

        recorder.start()
        setRecordingAudio(true)
      } catch (error) {
        console.error('Failed to start audio recording:', error)
      }
    }
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
 * Voice/PTT interface
 */
interface BobVoiceTabProps {
  recording: boolean
  onToggleRecording: () => void
}

function BobVoiceTab({ recording, onToggleRecording }: BobVoiceTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice Input (PTT)</CardTitle>
        <CardDescription>Press and hold to record audio commands</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center py-12">
        <Button
          size="lg"
          onClick={onToggleRecording}
          variant={recording ? 'destructive' : 'default'}
        >
          <Mic className="mr-2 h-4 w-4" />
          {recording ? 'Stop Recording' : 'Start Recording'}
        </Button>
      </CardContent>
    </Card>
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
