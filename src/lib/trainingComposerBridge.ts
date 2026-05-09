export type TrainingLessonStep = {
  step: number
  title: string
  instruction: string
  media_type: 'picture' | 'video' | 'interactive' | 'mixed'
  media_prompt: string
  interactive_activity: string
}

export type TrainingAssessmentItem = {
  question: string
  answer_guide: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
}

export type TrainingLegalReference = {
  title: string
  section: string
  summary: string
  source: string
  verification_status: 'verified' | 'needs_review'
}

export type TrainingModuleDraft = {
  title: string
  audience: string
  objectives: string[]
  lesson_plan: TrainingLessonStep[]
  assessments: TrainingAssessmentItem[]
  legal_references: TrainingLegalReference[]
  best_practices: string[]
  fact_check_notes: string[]
}

export type ReferenceVerification = {
  verified: string[]
  needs_review: string[]
  legal_risks: string[]
  recommendations: string[]
}

export type TrainingComposerPacket = {
  id: string
  title: string
  topic: string
  sourceText: string
  legalReferenceText: string
  audience?: string
  trainingDraft?: TrainingModuleDraft | null
  referenceVerification?: ReferenceVerification | null
  createdAt: string
  createdBy?: string | null
  source: 'bob-assistant' | 'officer-skills'
}

const TRAINING_COMPOSER_KEY = 'bob-training-composer-queue'

function canUseSessionStorage() {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

function readQueue(): TrainingComposerPacket[] {
  if (!canUseSessionStorage()) return []

  try {
    const raw = window.sessionStorage.getItem(TRAINING_COMPOSER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: TrainingComposerPacket[]) {
  if (!canUseSessionStorage()) return
  window.sessionStorage.setItem(TRAINING_COMPOSER_KEY, JSON.stringify(queue))
}

export function publishTrainingComposerPacket(packet: Omit<TrainingComposerPacket, 'id' | 'createdAt'>) {
  const entry: TrainingComposerPacket = {
    ...packet,
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
  }

  const queue = readQueue()
  queue.unshift(entry)
  writeQueue(queue.slice(0, 10))
  return entry
}

export function consumeLatestTrainingComposerPacket(): TrainingComposerPacket | null {
  const queue = readQueue()
  const entry = queue.shift() ?? null
  writeQueue(queue)
  return entry
}