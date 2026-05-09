export type TrainingMarketResearchPreset = {
  id: string
  title: string
  description: string
  category: string
  question: string
}

const TRAINING_VENDOR_SET = [
  'TalentLMS',
  'Docebo',
  'Moodle Workplace',
  '360Learning',
  'Cornerstone',
  'Absorb LMS',
]

const TRAINING_VENDOR_TEXT = TRAINING_VENDOR_SET.join(', ')

export const TRAINING_MARKET_RESEARCH_PRESETS: TrainingMarketResearchPreset[] = [
  {
    id: 'competitor-matrix',
    title: 'Competitor Matrix',
    description: 'Benchmark enterprise training apps feature-by-feature against the FCM target state.',
    category: 'training_market',
    question: [
      `Research and compare these training platforms: ${TRAINING_VENDOR_TEXT}.`,
      'Focus on reusable content libraries, role-based assignment automation, learning paths, assessments, competency tracking, compliance reporting, mobile delivery, and AI/personalization.',
      'Return a concise competitor matrix with strengths, missing pieces, and the top 5 patterns Field Compliance Manager should adopt for Bob-driven training.',
      'Use current authoritative vendor sources where possible and call out anything that remains unverified.',
    ].join(' '),
  },
  {
    id: 'assignment-automation',
    title: 'Assignment Automation',
    description: 'Study how strong LMS products auto-assign required training before work or role changes.',
    category: 'training_market',
    question: [
      `Research how ${TRAINING_VENDOR_TEXT} handle training assignment automation.`,
      'Focus on assignment by role, audience, site, prerequisites, overdue escalation, and event or schedule triggers.',
      'Map the findings into concrete recommendations for Field Compliance Manager where assignments are triggered by roster shifts, site induction gaps, and officer skill gaps.',
    ].join(' '),
  },
  {
    id: 'competency-and-compliance',
    title: 'Competency And Compliance',
    description: 'Benchmark how enterprise platforms tie training completion to readiness, compliance, and renewal.',
    category: 'training_market',
    question: [
      `Research how ${TRAINING_VENDOR_SET.slice(0, 5).join(', ')} represent completion evidence, pass thresholds, certifications, expiries, and compliance dashboards.`,
      'Return the recommended data model and workflow for Field Compliance Manager so Bob tutoring, attempts, competency grants, recompletion, and legal review are auditable.',
    ].join(' '),
  },
  {
    id: 'ai-tutor-patterns',
    title: 'AI Tutor Patterns',
    description: 'Compare how modern training products position personalization, coaching, and contextual learning support.',
    category: 'training_market',
    question: [
      `Research AI, personalization, and coaching patterns in ${TRAINING_VENDOR_TEXT}.`,
      'Focus on tutoring after wrong answers, adaptive follow-up content, microlearning, contextual assistance, and manager visibility.',
      'Translate findings into a Bob-specific pattern set for composer, verifier, and classroom tutor modes inside Field Compliance Manager.',
    ].join(' '),
  },
]

export function isTrainingMarketKnowledgeRequest(request: {
  category?: string | null
  question?: string | null
}): boolean {
  const category = String(request.category || '').trim().toLowerCase()
  if (category === 'training_market') return true

  const question = String(request.question || '').toLowerCase()
  return /training|lms|learning platform|talentlms|docebo|moodle workplace|360learning|cornerstone|absorb/i.test(question)
}

export function filterTrainingMarketKnowledgeRequests<T extends {
  category?: string | null
  question?: string | null
}>(requests: T[]): T[] {
  return requests.filter((request) => isTrainingMarketKnowledgeRequest(request))
}
