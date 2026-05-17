import React, { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { edgeFunctions } from '../lib/edgeFunctions'
import { emitPTTAiTelemetry } from '../lib/pttAiContract'

export type DomainLane = 'freedom_camping' | 'biosecurity' | 'noise_control' | 'smoke_control' | 'parking_enforcement'

type DomainAssistResult = {
  answer: string
  provider: string | null
  model: string | null
  updatedAt: string
}

const DOMAIN_LANES: Array<{ value: DomainLane; label: string; promptLabel: string }> = [
  { value: 'freedom_camping', label: 'Freedom Camping', promptLabel: 'Freedom camping' },
  { value: 'biosecurity', label: 'Biosecurity', promptLabel: 'Biosecurity' },
  { value: 'noise_control', label: 'Noise', promptLabel: 'Noise control' },
  { value: 'smoke_control', label: 'Smoke', promptLabel: 'Smoke control' },
  { value: 'parking_enforcement', label: 'Parking', promptLabel: 'Parking enforcement' },
]

interface AiDomainAssistCardProps {
  organizationId?: string | null
  title?: string
  subtitle?: string
  contextSummary: string
}

export default function AiDomainAssistCard({
  organizationId,
  title = 'AI Domain Assist',
  subtitle = 'Inference guidance with explicit domain focus',
  contextSummary,
}: AiDomainAssistCardProps) {
  const [selectedDomainLane, setSelectedDomainLane] = useState<DomainLane>('freedom_camping')
  const [customPrompt, setCustomPrompt] = useState('')
  const [isRunningAssist, setIsRunningAssist] = useState(false)
  const [assistError, setAssistError] = useState<string | null>(null)
  const [assistResult, setAssistResult] = useState<DomainAssistResult | null>(null)

  const laneLabel = useMemo(() => {
    return DOMAIN_LANES.find((item) => item.value === selectedDomainLane)?.promptLabel || 'Operations'
  }, [selectedDomainLane])

  const runAssist = async (promptOverride?: string) => {
    const startedAt = Date.now()
    const operatorPrompt = String(promptOverride ?? customPrompt).trim()
    setIsRunningAssist(true)
    setAssistError(null)

    emitPTTAiTelemetry({
      surface: 'mobile',
      stage: 'assist',
      success: true,
      latency_ms: null,
      reason: 'assist_request',
      details: {
        lane: selectedDomainLane,
        title,
        has_custom_prompt: operatorPrompt.length > 0,
      },
    })

    try {
      const prompt = [
        `You are assisting a New Zealand ${laneLabel} operations team.`,
        'Return concise actionable guidance with this structure:',
        '1) Risk level: Low/Medium/High.',
        '2) Immediate actions: maximum 3 bullets.',
        '3) Evidence checklist: short practical list.',
        `Context summary: ${contextSummary}`,
        operatorPrompt ? `Operator request: ${operatorPrompt}` : null,
      ].filter(Boolean).join('\n')

      const { data, error } = await edgeFunctions.askBob({
        prompt,
        organization_id: organizationId ?? undefined,
      })

      if (error) throw new Error(error)

      const answer = String((data as any)?.answer || '').trim()
      if (!answer) throw new Error('No assistive guidance returned')

      setAssistResult({
        answer,
        provider: typeof (data as any)?.provider === 'string' ? (data as any).provider : null,
        model: typeof (data as any)?.model === 'string' ? (data as any).model : null,
        updatedAt: new Date().toISOString(),
      })

      emitPTTAiTelemetry({
        surface: 'mobile',
        stage: 'assist',
        success: true,
        latency_ms: Date.now() - startedAt,
        details: {
          lane: selectedDomainLane,
          title,
          provider: typeof (data as any)?.provider === 'string' ? (data as any).provider : null,
          model: typeof (data as any)?.model === 'string' ? (data as any).model : null,
          answer_chars: answer.length,
        },
      })
    } catch (err: any) {
      setAssistResult(null)
      setAssistError(err?.message ?? 'Assistant unavailable right now')

      emitPTTAiTelemetry({
        surface: 'mobile',
        stage: 'assist',
        success: false,
        latency_ms: Date.now() - startedAt,
        reason: err?.message ?? 'assist_failed',
        details: {
          lane: selectedDomainLane,
          title,
        },
      })
    } finally {
      setIsRunningAssist(false)
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="sparkles-outline" size={16} color="#0ea5e9" />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.laneWrap}>
        {DOMAIN_LANES.map((lane) => (
          <Pressable
            key={lane.value}
            onPress={() => setSelectedDomainLane(lane.value)}
            style={[
              styles.laneChip,
              selectedDomainLane === lane.value && styles.laneChipActive,
            ]}
          >
            <Text style={[
              styles.laneText,
              selectedDomainLane === lane.value && styles.laneTextActive,
            ]}>
              {lane.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        value={customPrompt}
        onChangeText={setCustomPrompt}
        placeholder="Optional: ask for specific next actions..."
        placeholderTextColor="#94a3b8"
        style={styles.promptInput}
        multiline
      />

      <Pressable style={styles.runButton} onPress={() => void runAssist()} disabled={isRunningAssist}>
        {isRunningAssist ? (
          <ActivityIndicator size="small" color="#0f172a" />
        ) : (
          <Ionicons name="analytics-outline" size={16} color="#0f172a" />
        )}
        <Text style={styles.runButtonText}>{isRunningAssist ? 'Generating...' : 'Run domain assist'}</Text>
      </Pressable>

      {assistError ? (
        <Text style={styles.errorText}>{assistError}</Text>
      ) : null}

      {assistResult?.answer ? (
        <View style={styles.resultCard}>
          <Text style={styles.resultHeading}>Assist result · {DOMAIN_LANES.find((item) => item.value === selectedDomainLane)?.label || selectedDomainLane}</Text>
          <Text style={styles.resultBody}>{assistResult.answer}</Text>
          {(assistResult.provider || assistResult.model || assistResult.updatedAt) && (
            <Text style={styles.resultMeta}>
              {assistResult.provider ? assistResult.provider : 'provider unknown'}
              {assistResult.model ? ` · ${assistResult.model}` : ''}
              {assistResult.updatedAt ? ` · ${new Date(assistResult.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bae6fd',
    backgroundColor: '#f0f9ff',
    padding: 12,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 11,
    color: '#334155',
  },
  laneWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  laneChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#38bdf8',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  laneChipActive: {
    backgroundColor: '#38bdf8',
    borderColor: '#0284c7',
  },
  laneText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369a1',
  },
  laneTextActive: {
    color: '#0f172a',
  },
  promptInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
    fontSize: 12,
    color: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 56,
  },
  runButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    backgroundColor: '#38bdf8',
    paddingVertical: 10,
  },
  runButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  errorText: {
    fontSize: 12,
    color: '#b91c1c',
  },
  resultCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#7dd3fc',
    backgroundColor: '#fff',
    padding: 10,
    gap: 6,
  },
  resultHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369a1',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  resultBody: {
    fontSize: 12,
    lineHeight: 18,
    color: '#0f172a',
  },
  resultMeta: {
    fontSize: 10,
    color: '#64748b',
  },
})
